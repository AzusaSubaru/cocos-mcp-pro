/**
 * 消息事务版层级构建器（3.8+ 真机验证的原语组合）：
 *   begin-recording(auto:false) → create-node → create-component → set-property → end-recording
 * 保证：幂等（按名 upsert）、一次构建 = 一次 Ctrl+Z、失败 cancel 不留半成品。
 * 所有 scene 消息必须在 scene 进程内发送（从 main 跨进程调 create-component/set-property 会静默失败）。
 */
import { getEditor } from '../editor';
import { findNode } from './hierarchy';
import { parseHexColor } from './properties';
import { resolveBuiltin } from './builtin-assets';

/* ---------------- 类型 ---------------- */

interface PlannedNode {
  spec: any;
  parentUuid: string; // 父节点压缩 UUID（live）
  exists: boolean;
  nodeUuid?: string; // live 压缩 UUID
  depth: number;
  existingAncestorUuid: string; // 最近的已存在祖先（撤销录制目标）
}

interface BuildSummary {
  created: string[];
  updated: string[];
  skipped: string[];
  warnings: string[];
  nodeUuids: Record<string, string>;
  rootUuid: string;
}

/* ---------------- 规划：节点需要哪些组件 ---------------- */

const UI_COMPS = new Set(['UITransform', 'Sprite', 'Label', 'Button', 'Widget', 'Canvas', 'Layout']);

function ccclassOf(typeName: string): string {
  if (typeName.startsWith('cc.')) return typeName;
  if (UI_COMPS.has(typeName)) return `cc.${typeName}`;
  return typeName; // 用户脚本 @ccclass 名原样
}

/** 返回节点需要的组件 ccclass 列表（去重、保序）；同时返回需要注入的子节点（按钮 Label） */
function desiredComponents(spec: any): { comps: string[]; injectedChildren: any[] } {
  const comps: string[] = [];
  const add = (c: string) => {
    const cc = ccclassOf(c);
    if (!comps.includes(cc)) comps.push(cc);
  };
  const injectedChildren: any[] = [];

  const explicitTypes: string[] = [];
  for (const c of spec.components ?? []) {
    explicitTypes.push(typeof c === 'string' ? c : c.type);
  }
  const needsUI =
    !!spec.contentSize ||
    !!spec.anchorPoint ||
    spec.type === 'Button' ||
    spec.type === 'Label' ||
    spec.type === 'Sprite' ||
    explicitTypes.some((t) => UI_COMPS.has(t.replace(/^cc\./, '')));

  if (needsUI) add('UITransform');
  if (spec.type === 'Label' || spec.text !== undefined) add('Label');
  if (spec.type === 'Sprite' || spec.spriteFrame) add('Sprite');
  if (spec.type === 'Button') {
    add('Sprite');
    add('Button');
    if (spec.label) {
      injectedChildren.push({
        name: 'Label',
        type: 'Label',
        text: spec.label.text ?? 'Button',
        fontSize: spec.label.fontSize,
        color: spec.label.color,
      });
    }
  }
  for (const t of explicitTypes) add(t);
  if (spec.script?.class) add(spec.script.class);

  return { comps, injectedChildren };
}

/* ---------------- 构建入口 ---------------- */

export async function buildViaMessages(cc: any, spec: any, options: any = {}): Promise<BuildSummary> {
  const Editor = getEditor();
  if (!Editor?.Message?.request) {
    throw new Error('scene 进程 Editor.Message 不可用，无法走消息事务');
  }
  const send = (name: string, ...args: any[]) => Editor.Message.request('scene', name, ...args);

  const rootParent = options.parent ? findNode(cc, options.parent) : cc.director.getScene();
  if (!rootParent) throw new Error(`挂载父节点不存在: ${options.parent ?? '<scene>'}`);

  // ---- 规划（无副作用）----
  const planned: PlannedNode[] = [];
  const summary: BuildSummary = {
    created: [],
    updated: [],
    skipped: [],
    warnings: [],
    nodeUuids: {},
    rootUuid: '',
  };
  const idMap = new Map<string, string>();

  const planWalk = (
    nodeSpec: any,
    parentUuid: string,
    liveParent: any,
    depth: number,
    existingAncestorUuid: string,
  ): PlannedNode => {
    // 注入子节点（按钮 Label），不修改用户 spec
    const { comps, injectedChildren } = desiredComponents(nodeSpec);
    const childSpecs = [...(nodeSpec.children ?? []), ...injectedChildren];
    const liveChild = (liveParent?.children ?? []).find((c: any) => c.name === nodeSpec.name);

    const p: PlannedNode = {
      spec: { ...nodeSpec, children: childSpecs, __desiredComps: comps },
      parentUuid,
      exists: !!liveChild,
      nodeUuid: liveChild ? liveChild.uuid : undefined,
      depth,
      existingAncestorUuid,
    };
    planned.push(p);

    if (liveChild) {
      if (options.onExists === 'skip') {
        summary.skipped.push(nodeSpec.name);
      } else if (options.onExists === 'fail') {
        throw new Error(`节点已存在且 onExists=fail: ${liveParent?.name}/${nodeSpec.name}`);
      } else {
        summary.updated.push(nodeSpec.name);
      }
    } else {
      summary.created.push(nodeSpec.name);
    }
    if (nodeSpec.id && liveChild) idMap.set(nodeSpec.id, liveChild.uuid);

    // 子节点：新父节点在规划时 live 为 null（create-node 后初始为空）
    for (const ch of childSpecs) {
      const chLive = liveChild ? liveChild.children.find((c: any) => c.name === ch.name) : null;
      const chParentUuid = liveChild
        ? liveChild.uuid
        : '__pending__' + planned.indexOf(p);
      // 子节点的最近已存在祖先：父节点若存在则是它，否则沿用当前的
      const chAncestor = liveChild ? liveChild.uuid : existingAncestorUuid;
      planWalk(ch, chParentUuid, liveChild, depth + 1, chAncestor);
    }
    return p;
  };

  planWalk(spec, rootParent.uuid, rootParent, 0, rootParent.uuid);

  // ---- begin-recording：被修改的已存在节点 + 新子树的最近已存在祖先 ----
  const targets = new Set<string>();
  for (const p of planned) {
    if (p.exists) targets.add(p.nodeUuid!);
    else targets.add(p.existingAncestorUuid);
  }
  const commandId = await send('begin-recording', [...targets], { auto: false });

  try {
    // ---- 建节点（规划顺序即深度优先，父先于子；pending 父 uuid 此时解析）----
    for (const p of planned) {
      if (!p.exists) {
        let parentUuid = p.parentUuid;
        if (parentUuid.startsWith('__pending__')) {
          const idx = Number(parentUuid.slice('__pending__'.length));
          parentUuid = planned[idx].nodeUuid!;
          if (!parentUuid) throw new Error('内部错误：父节点尚未创建（规划顺序非深度优先）');
        }
        const uuid = await send('create-node', { name: p.spec.name, parent: parentUuid });
        p.nodeUuid = uuid;
        if (p.spec.id) idMap.set(p.spec.id, uuid);
      }
    }

    // ---- 组件 + 属性 ----
    for (const p of planned) {
      await applyNode(cc, send, p, idMap, summary);
    }

    await send('end-recording', commandId);
  } catch (e) {
    try {
      await send('cancel-recording', commandId);
    } catch {}
    throw e;
  }

  summary.nodeUuids = Object.fromEntries(idMap.entries());
  summary.rootUuid = planned[0].nodeUuid!;
  return summary;
}

/* ---------------- 单节点：组件确保 + 属性应用 ---------------- */

async function applyNode(
  cc: any,
  send: (name: string, ...args: any[]) => any,
  p: PlannedNode,
  idMap: Map<string, string>,
  summary: BuildSummary,
) {
  const nodeUuid = p.nodeUuid!;
  let dump = await send('query-node', nodeUuid);
  const compList: any[] = Array.isArray(dump.__comps__) ? dump.__comps__ : [];
  const compTypeIndex = new Map<string, number>();
  compList.forEach((c: any, i: number) => compTypeIndex.set(c.type, i));

  // 确保组件
  const wanted: string[] = p.spec.__desiredComps ?? [];
  let added = false;
  for (const w of wanted) {
    if (!compTypeIndex.has(w)) {
      await send('create-component', { uuid: nodeUuid, component: w });
      added = true;
    }
  }
  if (added) {
    dump = await send('query-node', nodeUuid);
    compList.length = 0;
    compList.push(...(Array.isArray(dump.__comps__) ? dump.__comps__ : []));
    compTypeIndex.clear();
    compList.forEach((c: any, i: number) => compTypeIndex.set(c.type, i));
  }

  const setNodeProp = async (path: string, type: string, value: any) => {
    const r = await send('set-property', { uuid: nodeUuid, path, dump: { type, value } });
    if (r === false) summary.warnings.push(`节点 ${p.spec.name}.${path} 设置被引擎拒绝`);
  };
  const setCompProp = async (compType: string, path: string, type: string, value: any) => {
    const idx = compTypeIndex.get(compType);
    if (idx === undefined) {
      summary.warnings.push(`节点 ${p.spec.name} 缺少组件 ${compType}，跳过 ${path}`);
      return;
    }
    const r = await send('set-property', {
      uuid: nodeUuid,
      path: `__comps__.${idx}.${path}`,
      dump: { type, value },
    });
    if (r === false) summary.warnings.push(`${compType}.${path} 设置被引擎拒绝（节点 ${p.spec.name}）`);
  };

  const spec = p.spec;

  // ---- 节点级属性 ----
  if (p.exists && spec.name !== undefined) {
    // 已存在节点按名匹配，通常无需改名；保留显式改名能力
  }
  if (typeof spec.active === 'boolean') await setNodeProp('active', 'Boolean', spec.active);
  if (spec.position) {
    await setNodeProp('position', 'cc.Vec3', {
      x: spec.position.x ?? 0,
      y: spec.position.y ?? 0,
      z: spec.position.z ?? 0,
    });
  }
  if (spec.rotation) {
    await setNodeProp('rotation', 'cc.Vec3', {
      x: spec.rotation.x ?? 0,
      y: spec.rotation.y ?? 0,
      z: spec.rotation.z ?? 0,
    });
  }
  if (spec.scale) {
    await setNodeProp('scale', 'cc.Vec3', {
      x: spec.scale.x ?? 1,
      y: spec.scale.y ?? 1,
      z: spec.scale.z ?? 1,
    });
  }

  // ---- UITransform ----
  if (spec.contentSize) {
    await setCompProp('cc.UITransform', 'contentSize', 'cc.Size', {
      width: spec.contentSize.w ?? spec.contentSize.width,
      height: spec.contentSize.h ?? spec.contentSize.height,
    });
  }
  if (spec.anchorPoint) {
    await setCompProp('cc.UITransform', 'anchorPoint', 'cc.Vec2', {
      x: spec.anchorPoint.x ?? 0.5,
      y: spec.anchorPoint.y ?? 0.5,
    });
  }

  // ---- Label ----
  const labelCfg = spec.label ?? {};
  if (compTypeIndex.has('cc.Label')) {
    const text = spec.text ?? labelCfg.text ?? '';
    if (text !== undefined) await setCompProp('cc.Label', 'string', 'String', text);
    const fontSize = spec.fontSize ?? labelCfg.fontSize;
    if (fontSize) await setCompProp('cc.Label', 'fontSize', 'Number', fontSize);
    if (labelCfg.lineHeight) await setCompProp('cc.Label', 'lineHeight', 'Number', labelCfg.lineHeight);
    const colorHex = spec.color ?? labelCfg.color;
    if (colorHex) {
      const c = parseHexColor(colorHex);
      await setCompProp('cc.Label', 'color', 'cc.Color', { r: c.r, g: c.g, b: c.b, a: c.a });
    }
  }

  // ---- Sprite ----
  if (compTypeIndex.has('cc.Sprite')) {
    const ref = spec.spriteFrame ?? (spec.type === 'Button' ? 'default_btn_normal' : 'default_sprite_splash');
    const sfUuid = await resolveAssetUuid(cc, ref);
    if (sfUuid) await setCompProp('cc.Sprite', 'spriteFrame', 'cc.SpriteFrame', { uuid: sfUuid });
    else summary.warnings.push(`SpriteFrame 未解析: ${ref}（节点 ${spec.name}）`);
    if (spec.sliced || spec.type === 'Button') {
      await setCompProp('cc.Sprite', 'type', 'Enum', 1); // SLICED
    }
    if (spec.color && spec.type !== 'Button') {
      const c = parseHexColor(spec.color);
      await setCompProp('cc.Sprite', 'color', 'cc.Color', { r: c.r, g: c.g, b: c.b, a: c.a });
    }
  }

  // ---- Button ----
  if (compTypeIndex.has('cc.Button')) {
    // transition: NONE=0, COLOR=1, SPRITE=2, SCALE=3
    await setCompProp('cc.Button', 'transition', 'Enum', 2);
    await setCompProp('cc.Button', 'target', 'cc.Node', { uuid: nodeUuid });
    const normal = await resolveAssetUuid(cc, 'default_btn_normal');
    const pressed = await resolveAssetUuid(cc, 'default_btn_pressed');
    const disabled = await resolveAssetUuid(cc, 'default_btn_disabled');
    if (normal) await setCompProp('cc.Button', 'normalSprite', 'cc.SpriteFrame', { uuid: normal });
    if (pressed) await setCompProp('cc.Button', 'pressedSprite', 'cc.SpriteFrame', { uuid: pressed });
    if (disabled) await setCompProp('cc.Button', 'disabledSprite', 'cc.SpriteFrame', { uuid: disabled });
  }

  // ---- Widget（显式组件）----
  if (compTypeIndex.has('cc.Widget')) {
    const wSpec = (spec.components ?? []).find(
      (c: any) => (typeof c === 'object' ? c.type : c).replace(/^cc\./, '') === 'Widget',
    );
    if (wSpec && typeof wSpec === 'object') {
      await applyWidgetProps(send, compTypeIndex.get('cc.Widget')!, nodeUuid, wSpec, summary);
    }
  }

  // ---- 显式组件参数（含用户脚本）----
  for (const compSpec of spec.components ?? []) {
    if (typeof compSpec === 'string') continue;
    const compType = ccclassOf(compSpec.type);
    const idx = compTypeIndex.get(compType);
    if (idx === undefined) {
      summary.warnings.push(`组件未创建，跳过参数: ${compSpec.type}（节点 ${spec.name}）`);
      continue;
    }
    const compDump = compList[idx];
    for (const [k, v] of Object.entries(compSpec)) {
      if (k === 'type' || v === undefined) continue;
      const propDump = compDump.value?.[k];
      if (!propDump) {
        summary.warnings.push(`${compSpec.type}.${k} 不在 dump 中（节点 ${spec.name}）`);
        continue;
      }
      const encoded = await encodeByDump(cc, propDump, v, nodeUuid, idMap, summary);
      const r = await send('set-property', {
        uuid: nodeUuid,
        path: `__comps__.${idx}.${k}`,
        dump: encoded,
      });
      if (r === false) summary.warnings.push(`${compSpec.type}.${k} 设置被引擎拒绝（节点 ${spec.name}）`);
    }
  }

  // ---- 用户脚本 + refs 连线 ----
  if (spec.script?.class) {
    const compType = ccclassOf(spec.script.class);
    const idx = compTypeIndex.get(compType);
    if (idx !== undefined) {
      const compDump = compList[idx];
      for (const [slot, targetRef] of Object.entries(spec.script.refs ?? {})) {
        const propDump = compDump.value?.[slot];
        const targetUuid = idMap.get(targetRef as string) ?? findNode(cc, targetRef as string)?.uuid;
        if (!targetUuid) {
          summary.warnings.push(`refs.${slot} 目标不存在: ${targetRef}`);
          continue;
        }
        if (propDump?.type === 'cc.Node' || !propDump?.type) {
          await send('set-property', {
            uuid: nodeUuid,
            path: `__comps__.${idx}.${slot}`,
            dump: { type: 'cc.Node', value: { uuid: targetUuid } },
          });
        } else {
          // 组件类型槽位：取目标节点上同类型组件实例的编辑器 UUID（comp._id 压缩 UUID）
          const targetNode = findNode(cc, targetUuid);
          const targetComp = targetNode?.getComponent?.(propDump.type);
          const compUuid = targetComp?.uuid ?? targetComp?._id;
          if (compUuid) {
            const r = await send('set-property', {
              uuid: nodeUuid,
              path: `__comps__.${idx}.${slot}`,
              dump: { type: propDump.type, value: { uuid: compUuid } },
            });
            if (r === false) summary.warnings.push(`refs.${slot} 组件槽位连线被引擎拒绝（${propDump.type}）`);
          } else {
            summary.warnings.push(
              `refs.${slot} 目标节点上没有 ${propDump.type} 组件: ${targetRef}`,
            );
          }
        }
      }
    }
  }
}

async function applyWidgetProps(
  send: (name: string, ...args: any[]) => any,
  idx: number,
  nodeUuid: string,
  spec: any,
  summary: BuildSummary,
) {
  const setW = async (path: string, type: string, value: any) => {
    const r = await send('set-property', {
      uuid: nodeUuid,
      path: `__comps__.${idx}.${path}`,
      dump: { type, value },
    });
    if (r === false) summary.warnings.push(`Widget.${path} 设置被拒绝`);
  };
  const flags: Record<string, string> = {
    top: 'isAlignTop',
    bottom: 'isAlignBottom',
    left: 'isAlignLeft',
    right: 'isAlignRight',
  };
  for (const [k, flag] of Object.entries(flags)) {
    if (spec[k] !== undefined) {
      await setW(flag, 'Boolean', true);
      await setW(k, 'Number', spec[k]);
    }
  }
  if (spec.horizontalCenter !== undefined) {
    await setW('isAlignHorizontalCenter', 'Boolean', true);
    await setW('horizontalCenter', 'Number', spec.horizontalCenter);
  }
  if (spec.verticalCenter !== undefined) {
    await setW('isAlignVerticalCenter', 'Boolean', true);
    await setW('verticalCenter', 'Number', spec.verticalCenter);
  }
}

/* ---------------- 通用编码（按 live dump 的 type） ---------------- */

async function encodeByDump(
  cc: any,
  propDump: any,
  raw: any,
  selfUuid: string,
  idMap: Map<string, string>,
  summary: BuildSummary,
): Promise<{ type: string; value: any }> {
  const t: string = propDump.type;
  if (raw === null || raw === undefined) return { type: t, value: raw };
  switch (t) {
    case 'String':
      return { type: t, value: String(raw) };
    case 'Number':
      return { type: t, value: Number(raw) };
    case 'Boolean':
      return { type: t, value: !!raw };
    case 'Enum': {
      if (typeof raw === 'number') return { type: t, value: raw };
      const enumList: any[] = propDump.enumList ?? [];
      const found = enumList.find((e) => e.name === raw);
      return { type: t, value: found ? found.value : Number(raw) };
    }
    case 'cc.Color': {
      const c = typeof raw === 'string' ? parseHexColor(raw) : raw;
      return { type: t, value: { r: c.r, g: c.g, b: c.b, a: c.a ?? 255 } };
    }
    case 'cc.Vec3':
      return { type: t, value: { x: raw.x ?? 0, y: raw.y ?? 0, z: raw.z ?? 0 } };
    case 'cc.Vec2':
      return { type: t, value: { x: raw.x ?? 0, y: raw.y ?? 0 } };
    case 'cc.Size':
      return { type: t, value: { width: raw.width ?? raw.w, height: raw.height ?? raw.h } };
    case 'cc.Node': {
      const uuid = idMap.get(raw) ?? findNode(cc, raw)?.uuid ?? raw;
      return { type: t, value: { uuid } };
    }
    default: {
      // 资源引用（cc.SpriteFrame / cc.Asset 子类）
      if (t.startsWith('cc.') && propDump.value && typeof propDump.value === 'object') {
        const uuid = await resolveAssetUuid(cc, raw);
        return { type: t, value: { uuid: uuid ?? raw } };
      }
      if (typeof raw === 'object') return { type: t, value: raw };
      return { type: t, value: raw };
    }
  }
}

/* ---------------- 资源解析为 dump 可用的完整 UUID ---------------- */

const assetUuidCache = new Map<string, string>();

export async function resolveAssetUuid(cc: any, ref: string): Promise<string | null> {
  if (assetUuidCache.has(ref)) return assetUuidCache.get(ref)!;
  // 已经是 UUID 形态
  if (ref.length >= 22) {
    let uuid = ref;
    // 子资源：SpriteFrame 需带 @f9941
    if (!/@f\d+$/.test(ref) && !cc.assetManager?.assets?.has?.(ref)) {
      // 尝试作为 SpriteFrame 加载，成功则引擎会补全子资源 id
      try {
        const asset: any = await new Promise((resolve, reject) => {
          cc.assetManager.loadAny({ uuid: ref, type: cc.SpriteFrame }, (e: any, a: any) =>
            e ? reject(e) : resolve(a),
          );
        });
        uuid = asset.uuid;
      } catch {
        uuid = ref;
      }
    }
    assetUuidCache.set(ref, uuid);
    return uuid;
  }
  // 内置别名：走 scene 进程的资源解析（builtin-assets 通过 main 查询，这里直接用引擎缓存）
  try {
    const asset: any = await resolveBuiltin(cc, ref);
    if (asset) {
      const uuid: string = asset.uuid;
      assetUuidCache.set(ref, uuid);
      return uuid;
    }
  } catch {}
  return null;
}
