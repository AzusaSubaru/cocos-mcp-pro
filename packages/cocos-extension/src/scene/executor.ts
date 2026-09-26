/**
 * scene 进程：节点/组件原语 + buildHierarchy 批量执行器。
 * 设计要求：幂等（upsert）、事务包裹（一次构建一次撤销）、失败回滚（不留半成品）。
 */
import { getEditor } from '../editor';
import { resolveBuiltin, loadAssetByUuid } from './builtin-assets';
import { buildUuidIndex, findNode } from './hierarchy';
import {
  encodeValue,
  getSerializedProperties,
  parseHexColor,
  resolveClass,
} from './properties';

function markDirty() {
  const Editor = getEditor();
  Editor?.Message?.request?.('scene', 'mark-dirty')?.catch?.(() => {});
}

/** 尝试用编辑器操作事务包裹批量动作；消息不可用时降级为直接执行 */
async function withOperation<T>(name: string, fn: () => T | Promise<T>): Promise<T> {
  const Editor = getEditor();
  let began = false;
  try {
    if (Editor?.Message?.request) {
      await Editor.Message.request('scene', 'begin-operation', name);
      began = true;
    }
  } catch {
    began = false;
  }
  try {
    const r = await fn();
    if (began) {
      try {
        await Editor.Message.request('scene', 'end-operation');
      } catch {}
    }
    markDirty();
    return r;
  } catch (e) {
    if (began) {
      try {
        await Editor.Message.request('scene', 'cancel-operation');
      } catch {}
    }
    throw e;
  }
}

function ensureUITransform(cc: any, node: any) {
  return node.getComponent(cc.UITransform) ?? node.addComponent(cc.UITransform);
}

/* ---------------- 节点原语 ---------------- */

export function createNode(cc: any, parentRef: string | null, name: string): any {
  const parent = parentRef ? findNode(cc, parentRef) : cc.director.getScene();
  if (!parent) throw new Error(`父节点不存在: ${parentRef ?? '<scene>'}`);
  const node = new cc.Node(name);
  parent.addChild(node);
  markDirty();
  return { uuid: node.uuid ?? node.id ?? '', name, parent: parent.name };
}

export function deleteNode(cc: any, ref: string) {
  const node = findNode(cc, ref);
  if (!node) throw new Error(`节点不存在: ${ref}`);
  const name = node.name;
  node.destroy();
  markDirty();
  return { deleted: name };
}

export function renameNode(cc: any, ref: string, name: string) {
  const node = findNode(cc, ref);
  if (!node) throw new Error(`节点不存在: ${ref}`);
  node.name = name;
  markDirty();
  return { uuid: node.uuid ?? node.id ?? '', name };
}

export function setTransform(cc: any, ref: string, t: any) {
  const node = findNode(cc, ref);
  if (!node) throw new Error(`节点不存在: ${ref}`);
  if (t.position) node.setPosition(t.position.x ?? 0, t.position.y ?? 0, t.position.z ?? 0);
  if (t.rotation) node.setRotationFromEuler?.(t.rotation.x ?? 0, t.rotation.y ?? 0, t.rotation.z ?? 0);
  if (t.scale) node.setScale(t.scale.x ?? 1, t.scale.y ?? 1, t.scale.z ?? 1);
  if (typeof t.active === 'boolean') node.active = t.active;
  markDirty();
  return { uuid: node.uuid ?? node.id ?? '', name: node.name };
}

export function addComponent(cc: any, ref: string, className: string) {
  const node = findNode(cc, ref);
  if (!node) throw new Error(`节点不存在: ${ref}`);
  const cls = resolveClass(cc, className);
  if (!cls) {
    const err: any = new Error(`组件类不存在或未注册: ${className}（用户脚本可能未编译）`);
    err.code = 'SCRIPT_CLASS_NOT_FOUND';
    throw err;
  }
  const existed = node.getComponent(cls);
  const comp = existed ?? node.addComponent(cls);
  markDirty();
  return {
    node: node.name,
    component: comp.constructor?.name ?? className,
    reused: !!existed,
  };
}

export function removeComponent(cc: any, ref: string, className: string) {
  const node = findNode(cc, ref);
  if (!node) throw new Error(`节点不存在: ${ref}`);
  const cls = resolveClass(cc, className);
  const comp = cls ? node.getComponent(cls) : null;
  if (!comp) throw new Error(`节点 ${node.name} 上没有组件 ${className}`);
  comp.destroy();
  markDirty();
  return { removed: className };
}

export function listComponents(cc: any, ref: string) {
  const node = findNode(cc, ref);
  if (!node) throw new Error(`节点不存在: ${ref}`);
  return (node.components ?? []).map((c: any) => ({
    type: c.constructor?.name ?? c.__cid__,
    enabled: c.enabled !== false,
  }));
}

export function getProperty(cc: any, ref: string, component: string | null, property: string) {
  const { target } = resolveTarget(cc, ref, component);
  return serializeValue(cc, target?.[property]);
}

export async function setProperty(
  cc: any,
  ref: string,
  component: string | null,
  property: string,
  value: any,
  uuidIndex?: Map<string, any>,
) {
  const { node, target } = resolveTarget(cc, ref, component);
  if (!(property in target) && target[property] === undefined) {
    const err: any = new Error(`${component ?? 'Node'} 上不存在属性 ${property}`);
    err.code = 'INVALID_PARAMS';
    throw err;
  }
  const converted = await convertInput(
    cc,
    target[property],
    value,
    uuidIndex ?? buildUuidIndex(cc),
    target,
    property,
  );
  target[property] = converted;
  markDirty();
  return { node: node.name, property, set: serializeValue(cc, converted) };
}

export async function setSpriteFrame(cc: any, ref: string, ref2: string) {
  const node = findNode(cc, ref);
  if (!node) throw new Error(`节点不存在: ${ref}`);
  let sprite = node.getComponent(cc.Sprite);
  if (!sprite) {
    ensureUITransform(cc, node);
    sprite = node.addComponent(cc.Sprite);
  }
  const frame = await resolveAsset(cc, ref2);
  if (!frame) throw new Error(`SpriteFrame 解析失败: ${ref2}（不是内置别名或已导入资源 UUID）`);
  sprite.spriteFrame = frame;
  if (sprite.sizeMode !== undefined && cc.Sprite?.SizeMode) {
    sprite.sizeMode = cc.Sprite.SizeMode.CUSTOM ?? sprite.sizeMode;
  }
  markDirty();
  return { node: node.name, spriteFrame: frame.name ?? ref2 };
}

export function setColor(cc: any, ref: string, hex: string) {
  const node = findNode(cc, ref);
  if (!node) throw new Error(`节点不存在: ${ref}`);
  const c = parseHexColor(hex);
  const targets = [node.getComponent(cc.Sprite), node.getComponent(cc.Label)].filter(Boolean);
  if (!targets.length) throw new Error(`节点 ${node.name} 上没有可设置颜色的 Sprite/Label`);
  for (const t of targets) t.color = new cc.Color(c.r, c.g, c.b, c.a);
  markDirty();
  return { node: node.name, color: c };
}

export function setContentSize(cc: any, ref: string, w: number, h: number) {
  const node = findNode(cc, ref);
  if (!node) throw new Error(`节点不存在: ${ref}`);
  const ui = ensureUITransform(cc, node);
  ui.setContentSize(w, h);
  markDirty();
  return { node: node.name, contentSize: { w, h } };
}

export function setupWidget(cc: any, ref: string, spec: any) {
  const node = findNode(cc, ref);
  if (!node) throw new Error(`节点不存在: ${ref}`);
  let widget = node.getComponent(cc.Widget);
  if (!widget) widget = node.addComponent(cc.Widget);
  configureWidget(widget, spec);
  markDirty();
  return { node: node.name, widget: spec };
}

function configureWidget(widget: any, spec: any) {
  const flags = ['isAlignTop', 'isAlignBottom', 'isAlignLeft', 'isAlignRight'];
  for (const f of flags) widget[f] = false;
  widget.isAlignHorizontalCenter = false;
  widget.isAlignVerticalCenter = false;
  if (spec.align === 'center' || spec.align === 'middle') {
    widget.isAlignHorizontalCenter = true;
    widget.isAlignVerticalCenter = true;
    widget.horizontalCenter = 0;
    widget.verticalCenter = 0;
  }
  const map = {
    top: ['isAlignTop', 'top'],
    bottom: ['isAlignBottom', 'bottom'],
    left: ['isAlignLeft', 'left'],
    right: ['isAlignRight', 'right'],
    horizontalCenter: ['isAlignHorizontalCenter', 'horizontalCenter'],
    verticalCenter: ['isAlignVerticalCenter', 'verticalCenter'],
  } as const;
  for (const [key, [flag, prop]] of Object.entries(map)) {
    if (spec[key] !== undefined) {
      widget[flag] = true;
      widget[prop] = spec[key];
    }
  }
  widget.updateAlignment?.();
}

/* ---------------- 用户脚本挂载与引用连线 ---------------- */

export function attachScript(
  cc: any,
  ref: string,
  className: string,
  refs: Record<string, string> = {},
  idMap?: Map<string, any>,
) {
  const node = findNode(cc, ref);
  if (!node) throw new Error(`节点不存在: ${ref}`);
  const cls = resolveClass(cc, className);
  if (!cls) {
    const err: any = new Error(`脚本类 ${className} 未注册，请检查 @ccclass 名称与编译错误`);
    err.code = 'SCRIPT_CLASS_NOT_FOUND';
    throw err;
  }
  const comp = node.getComponent(cls) ?? node.addComponent(cls);
  const uuidIndex = idMap ? extendIndexWithIds(cc, idMap) : buildUuidIndex(cc);
  const assigned: string[] = [];
  const warnings: string[] = [];
  for (const [slot, targetRef] of Object.entries(refs)) {
    const targetNode = uuidIndex.get(targetRef) ?? findNode(cc, targetRef);
    if (!targetNode) throw new Error(`refs.${slot} 指向的节点不存在: ${targetRef}`);
    const value = resolveRefBySlot(cc, comp, slot, targetNode, warnings);
    comp[slot] = value;
    assigned.push(slot);
  }
  markDirty();
  return { node: node.name, script: className, assigned, warnings };
}

function resolveRefBySlot(cc: any, comp: any, slot: string, targetNode: any, warnings: string[]) {
  // 1) 槽位当前已是节点 → 直接赋节点
  if (comp[slot] instanceof cc.Node) return targetNode;
  // 2) 尝试从装饰器元数据取类型名，在目标节点上找同类型组件
  const typeName = getSlotTypeName(comp, slot);
  if (typeName && typeName !== 'Node' && typeName !== 'cc.Node') {
    const cls = resolveClass(cc, typeName);
    const c = cls && targetNode.getComponent?.(cls);
    if (c) return c;
  }
  // 3) 目标节点上唯一的非 UITransform/Canvas 内置组件
  const candidates = (targetNode.components ?? []).filter(
    (x: any) => x.constructor !== cc.UITransform,
  );
  if (candidates.length === 1 && !(candidates[0] instanceof cc.Node)) {
    warnings.push(`槽位 ${slot} 类型未知，已按目标节点唯一组件 ${candidates[0].constructor?.name} 赋值`);
    return candidates[0];
  }
  return targetNode;
}

function getSlotTypeName(comp: any, slot: string): string | null {
  const cls = comp.constructor;
  const containers = [cls?.__attrs__, cls?.__attributes__];
  // Cocos 3.8.x stores attrs as propName$_$type / propName$_$ctor
  const keyType = slot + '$_$type';
  const keyCtor = slot + '$_$ctor';
  for (const c of containers) {
    if (!c) continue;
    const typeVal = c[keyType] ?? c[slot]?.type;
    const ctorVal = c[keyCtor] ?? c[slot]?.ctor;
    let t: string | null = null;
    if (typeof typeVal === 'function') {
      t = typeVal.name;
    } else if (typeof typeVal === 'string' && typeVal !== 'Object' && typeVal !== 'cc.Object') {
      // 具体类型字符串（如 "cc.Node"）直接使用；"Object" 是组件引用的泛化标记，需继续看 ctor
      t = typeVal;
    }
    // typeVal 为 "Object"/空 时，真实组件类型在 ctorVal（构造函数）
    if (!t) {
      if (typeof ctorVal === 'function') t = ctorVal.name;
      else if (typeof ctorVal === 'string') t = ctorVal;
    }
    if (t) return t.replace(/^function\s+/, '');
  }
  return null;
}

/* ---------------- 批量设置 ---------------- */

export async function batchSet(cc: any, ops: any[]) {
  return withOperation('mcp-batch-set', async () => {
    const idx = buildUuidIndex(cc);
    const results = await Promise.all(
      ops.map((op) =>
        setProperty(cc, op.node, op.component ?? null, op.property, op.value, idx),
      ),
    );
    return { count: results.length, results };
  });
}

/* ---------------- buildHierarchy ---------------- */

export async function buildHierarchy(cc: any, spec: any, options: any = {}) {
  const ctx: BuildCtx = {
    created: [],
    updated: [],
    skipped: [],
    warnings: [],
    idMap: new Map(),
    uuidIndex: buildUuidIndex(cc),
  };
  const parent = options.parent ? findNode(cc, options.parent) : cc.director.getScene();
  if (!parent) throw new Error(`挂载父节点不存在: ${options.parent ?? '<scene>'}`);

  return withOperation(`mcp-build-${spec?.name ?? 'hierarchy'}`, async () => {
    const node = await upsertNode(cc, spec, parent, options, ctx);
    // 脚本引用在所有子节点创建后连线
    if (spec.script) {
      const r = attachScript(cc, node.uuid ?? node.id, spec.script.class, spec.script.refs ?? {}, ctx.idMap);
      ctx.warnings.push(...r.warnings);
    }
    return {
      created: ctx.created,
      updated: ctx.updated,
      skipped: ctx.skipped,
      warnings: ctx.warnings,
      nodeUuids: Object.fromEntries([...ctx.idMap.entries()].map(([id, n]) => [id, n.uuid ?? n.id])),
      rootUuid: node.uuid ?? node.id,
    };
  });
}

interface BuildCtx {
  created: string[];
  updated: string[];
  skipped: string[];
  warnings: string[];
  idMap: Map<string, any>;
  uuidIndex: Map<string, any>;
}

async function upsertNode(cc: any, spec: any, parent: any, options: any, ctx: BuildCtx): Promise<any> {
  let node = (parent.children ?? []).find((c: any) => c.name === spec.name);
  const isNew = !node;
  if (!isNew && options.onExists === 'skip') {
    ctx.skipped.push(spec.name);
    registerId(spec, node, ctx);
    return node;
  }
  if (!isNew && options.onExists === 'fail') {
    throw new Error(`节点已存在且 onExists=fail: ${parent.name}/${spec.name}`);
  }
  if (isNew) {
    node = new cc.Node(spec.name);
    parent.addChild(node);
    ctx.created.push(spec.name);
  } else {
    ctx.updated.push(spec.name);
  }
  registerId(spec, node, ctx);
  await applyNodeSpec(cc, node, spec, isNew, options, ctx);
  return node;
}

function registerId(spec: any, node: any, ctx: BuildCtx) {
  if (spec.id) ctx.idMap.set(spec.id, node);
  const uid = node.uuid ?? node.id;
  if (uid) ctx.uuidIndex.set(uid, node);
}

async function applyNodeSpec(cc: any, node: any, spec: any, isNew: boolean, options: any, ctx: BuildCtx) {
  if (typeof spec.active === 'boolean') node.active = spec.active;
  if (spec.position) node.setPosition(spec.position.x ?? 0, spec.position.y ?? 0, spec.position.z ?? 0);
  if (spec.rotation) node.setRotationFromEuler?.(spec.rotation.x ?? 0, spec.rotation.y ?? 0, spec.rotation.z ?? 0);
  if (spec.scale) node.setScale(spec.scale.x ?? 1, spec.scale.y ?? 1, spec.scale.z ?? 1);

  const needsUI =
    spec.contentSize ||
    spec.type === 'Button' ||
    spec.type === 'Label' ||
    spec.type === 'Sprite' ||
    (spec.components ?? []).some((c: any) =>
      ['UITransform', 'Sprite', 'Label', 'Button', 'Widget', 'Canvas', 'Layout'].includes(
        typeof c === 'string' ? c : c.type,
      ),
    );
  if (needsUI) ensureUITransform(cc, node);
  if (spec.contentSize) {
    node.getComponent(cc.UITransform).setContentSize(spec.contentSize.w, spec.contentSize.h);
  }

  // 语法糖
  // 注意：Button 的 spec.label 表示按钮子节点 Label，由 applyButton 处理，不能挂在按钮自身
  if (spec.type !== 'Button' && (spec.type === 'Label' || spec.text !== undefined)) {
    applyLabel(cc, node, spec);
  }
  if (spec.type === 'Sprite' || spec.spriteFrame) await applySprite(cc, node, spec);
  if (spec.type === 'Button') await applyButton(cc, node, spec, options, ctx);

  // 显式组件列表
  for (const compSpec of spec.components ?? []) {
    const c = typeof compSpec === 'string' ? { type: compSpec } : compSpec;
    if (c.type === 'Canvas' || c.type === 'cc.Canvas') {
      const comp = node.getComponent(cc.Canvas) ?? node.addComponent(cc.Canvas);
      applyComponentParams(cc, node, comp, c, ctx);
      continue;
    }
    const cls = resolveClass(cc, c.type);
    if (!cls) {
      ctx.warnings.push(`组件类未注册，已跳过: ${c.type}（节点 ${spec.name}）`);
      continue;
    }
    const comp = node.getComponent(cls) ?? node.addComponent(cls);
    applyComponentParams(cc, node, comp, c, ctx);
  }

  if (spec.color) {
    const c = parseHexColor(spec.color);
    for (const t of [node.getComponent(cc.Sprite), node.getComponent(cc.Label)].filter(Boolean)) {
      t.color = new cc.Color(c.r, c.g, c.b, c.a);
    }
  }

  for (const child of spec.children ?? []) {
    await upsertNode(cc, child, node, options, ctx);
  }
}

function applyLabel(cc: any, node: any, spec: any) {
  const label = node.getComponent(cc.Label) ?? node.addComponent(cc.Label);
  const cfg = spec.label ?? {};
  const text = spec.text ?? cfg.text ?? '';
  label.string = text;
  if (spec.fontSize ?? cfg.fontSize) label.fontSize = spec.fontSize ?? cfg.fontSize;
  if (cfg.lineHeight) label.lineHeight = cfg.lineHeight;
  const colorHex = spec.color ?? cfg.color;
  if (colorHex) {
    const c = parseHexColor(colorHex);
    label.color = new cc.Color(c.r, c.g, c.b, c.a);
  }
}

async function applySprite(cc: any, node: any, spec: any) {
  const sprite = node.getComponent(cc.Sprite) ?? node.addComponent(cc.Sprite);
  const ref = spec.spriteFrame ?? 'default_sprite_splash';
  const frame = await resolveAsset(cc, ref);
  if (frame) sprite.spriteFrame = frame;
  else console.warn('[cocos-mcp-bridge] SpriteFrame 未解析:', ref);
  if (cc.Sprite?.SizeMode) sprite.sizeMode = cc.Sprite.SizeMode.CUSTOM;
  if (cc.Sprite?.Type && spec.sliced) sprite.type = cc.Sprite.Type.SLICED;
}

async function applyButton(cc: any, node: any, spec: any, options: any, ctx: BuildCtx) {
  const sprite = node.getComponent(cc.Sprite) ?? node.addComponent(cc.Sprite);
  const frame = await resolveAsset(cc, 'default_btn_normal');
  if (frame) sprite.spriteFrame = frame;
  if (cc.Sprite?.Type) sprite.type = cc.Sprite.Type.SLICED;
  node.getComponent(cc.Button) ?? node.addComponent(cc.Button);
  if (spec.label && !(node.children ?? []).some((c: any) => c.name === 'Label')) {
    const child = new cc.Node('Label');
    node.addChild(child);
    child.addComponent(cc.UITransform);
    const label = child.addComponent(cc.Label);
    label.string = spec.label.text ?? 'Button';
    if (spec.label.fontSize) label.fontSize = spec.label.fontSize;
    if (spec.label.color) {
      const c = parseHexColor(spec.label.color);
      label.color = new cc.Color(c.r, c.g, c.b, c.a);
    }
    if (spec.id) ctx.idMap.set(`${spec.id}__label`, child);
  }
}

function applyComponentParams(cc: any, node: any, comp: any, spec: any, ctx: BuildCtx) {
  if (comp.constructor === cc.Widget || spec.type === 'Widget') {
    configureWidget(comp, spec.align ? { align: spec.align, ...spec } : spec);
    return;
  }
  for (const [k, v] of Object.entries(spec)) {
    if (k === 'type') continue;
    try {
      comp[k] = encodeValue(cc, comp[k], v);
    } catch (e: any) {
      ctx.warnings.push(`${spec.type}.${k} 设置失败: ${e?.message ?? e}`);
    }
  }
}

/* ---------------- 通用辅助 ---------------- */

function resolveTarget(cc: any, ref: string, component: string | null) {
  const node = findNode(cc, ref);
  if (!node) throw new Error(`节点不存在: ${ref}`);
  if (!component) return { node, target: node };
  const cls = resolveClass(cc, component);
  const comp = cls ? node.getComponent(cls) : null;
  if (!comp) throw new Error(`节点 ${node.name} 上没有组件 ${component}`);
  return { node, target: comp };
}

async function convertInput(cc: any, current: any, input: any, uuidIndex: Map<string, any>, target?: any, property?: string) {
  if (input && typeof input === 'object' && (input.nodeUuid || input.uuid)) {
    if (input.nodeUuid) {
      const n = uuidIndex.get(input.nodeUuid);
      if (!n) throw new Error(`引用节点不存在: ${input.nodeUuid}`);
      // 通过装饰器元数据判断属性声明类型，若非 Node 则在目标节点上找同类型组件
      let typeName = target && property ? getSlotTypeName(target, property) : null;
      // 兜底1：若元数据未取到类型，尝试从目标节点上找非 UITransform/Canvas/Widget 的组件
      if (!typeName || typeName === 'UITransform' || typeName === 'Canvas' || typeName === 'Widget') {
        const comps = (n.components ?? []).filter(
          (x: any) => x.constructor !== cc.UITransform && x.constructor !== cc.Canvas && x.constructor !== cc.Widget && !(x instanceof cc.Node),
        );
        if (comps.length === 1) {
          typeName = comps[0].constructor?.name ?? typeName;
        } else if (comps.length > 1) {
          // 多个候选时，优先匹配属性名后缀（如 startBtn -> Button）
          const lower = String(property).toLowerCase();
          const matched = comps.find((x: any) => {
            const cn = (x.constructor?.name ?? '').toLowerCase();
            return lower.endsWith(cn) || cn.endsWith(lower.replace(/^.*?(btn|button|label|sprite|node|camera|scroll|layout|widget|mask|graphics|progress|slider|toggle|editbox|richtext|pageview|webview|video|spine|dragonbones|particle|animation|audioclip|audioplayer|collider|rigidbody|joint|phyicsmaterial)$/, '$1'));
          });
          if (matched) typeName = matched.constructor?.name ?? typeName;
        }
      }
      // 兜底2：若仍无类型但当前值是组件，沿用当前值类型（仅当非 UITransform 时）
      if ((!typeName || typeName === 'UITransform') && target && property && target[property] && typeof target[property] === 'object' && !(target[property] instanceof cc.Node)) {
        const curName = target[property] && target[property].constructor && target[property].constructor.name;
        if (curName && curName !== 'Object' && curName !== 'UITransform') typeName = curName;
      }
      
      if (typeName && typeName !== 'Node' && typeName !== 'cc.Node') {
        const cls = resolveClass(cc, typeName);
        if (cls) {
          const c = n.getComponent?.(cls);
          if (c) return c;
        }
      }
      return n;
    }
    const uuid: string = input.uuid;
    const cache = cc.assetManager?.assets;
    const cached = cache?.get?.(uuid) ?? cache?.get?.(uuid.replace(/@f9941$/, ''));
    if (cached) return cached;
    try {
      return await loadAssetByUuid(
        cc,
        uuid,
        /@f9941$/.test(uuid) ? cc.SpriteFrame : undefined,
      );
    } catch {}
    throw new Error(`资源未能加载: ${uuid}`);
  }
  return encodeValue(cc, current, input);
}

async function resolveAsset(cc: any, ref: string): Promise<any> {
  const builtin = await resolveBuiltin(cc, ref);
  if (builtin) return builtin;
  if (ref.length >= 20) {
    const cache = cc.assetManager?.assets;
    const cached = cache?.get?.(ref) ?? cache?.get?.(ref.replace(/@f9941$/, ''));
    if (cached) return cached;
    try {
      return await loadAssetByUuid(
        cc,
        ref,
        /@f9941$/.test(ref) ? cc.SpriteFrame : undefined,
      );
    } catch {}
  }
  return null;
}

function extendIndexWithIds(cc: any, idMap: Map<string, any>) {
  const idx = buildUuidIndex(cc);
  for (const n of idMap.values()) {
    const uid = n.uuid ?? n.id;
    if (uid) idx.set(uid, n);
  }
  return idx;
}

function serializeValue(cc: any, v: any, seen = new WeakSet()): any {
  if (v === null || v === undefined) return v;
  if (typeof v === 'number' || typeof v === 'string' || typeof v === 'boolean') return v;
  if (seen.has(v)) return '[Circular]';
  seen.add(v);
  if (v instanceof cc.Node) return { nodeUuid: v.uuid ?? v.id, name: v.name };
  if (cc.Asset && v instanceof cc.Asset) {
    return { uuid: v._uuid ?? v.uuid, type: v.constructor?.name, name: v.name };
  }
  if (v instanceof cc.Vec3) return { x: v.x, y: v.y, z: v.z };
  if (v instanceof cc.Vec2) return { x: v.x, y: v.y };
  if (v instanceof cc.Color) return { r: v.r, g: v.g, b: v.b, a: v.a };
  if (cc.Size && v instanceof cc.Size) return { w: v.width, h: v.height };
  if (Array.isArray(v)) return v.slice(0, 20).map((x) => serializeValue(cc, x, seen));
  if (v.constructor?.name) return { $type: v.constructor.name };
  return String(v);
}
