/**
 * scene 进程：节点树遍历与寻址。
 */

export interface HierarchyOptions {
  depth?: number;
  includeComponents?: boolean;
  rootRef?: string; // UUID 或 /Path/To/Node；不传 = 整棵场景
}

export function nodeToJson(cc: any, node: any, depth: number, opts: HierarchyOptions): any {
  const ui = node.getComponent?.(cc.UITransform);
  const out: any = {
    uuid: node.uuid ?? node.id ?? '',
    name: node.name,
    active: node.active,
    position: vec3(node.position),
    rotation: node.eulerAngles ? vec3(node.eulerAngles) : undefined,
    scale: vec3(node.scale),
  };
  if (ui) {
    out.contentSize = { w: ui.contentSize.width, h: ui.contentSize.height };
    out.anchor = { x: ui.anchorPoint.x, y: ui.anchorPoint.y };
  }
  if (opts.includeComponents) {
    out.components = (node.components ?? []).map((c: any) => ({
      type: c.constructor?.name ?? c.__cid__,
      uuid: c.uuid ?? '',
      enabled: c.enabled !== false,
    }));
  }
  if (depth !== 0) {
    const children = node.children ?? [];
    if (children.length) {
      out.children = children.map((ch: any) =>
        nodeToJson(cc, ch, depth - 1, opts),
      );
    }
  } else if ((node.children ?? []).length) {
    out.childCount = node.children.length;
  }
  return out;
}

export function getHierarchy(cc: any, opts: HierarchyOptions = {}): any {
  const scene = cc.director.getScene();
  if (!scene) return null;
  const depth = opts.depth ?? 32;
  if (opts.rootRef) {
    const root = findNode(cc, opts.rootRef);
    if (!root) return null;
    return nodeToJson(cc, root, depth, opts);
  }
  return nodeToJson(cc, scene, depth + 1, opts);
}

/** 建立 UUID → 节点索引（每次操作前构建，保证新鲜） */
export function buildUuidIndex(cc: any): Map<string, any> {
  const map = new Map<string, any>();
  const scene = cc.director.getScene();
  if (!scene) return map;
  const walk = (n: any) => {
    const id = n.uuid ?? n.id;
    if (id) map.set(id, n);
    (n.children ?? []).forEach(walk);
  };
  walk(scene);
  return map;
}

/**
 * 寻址：
 *  - 以 '/' 开头：场景内路径，如 /Canvas/Panel/Btn
 *  - 纯 UUID
 *  - 普通字符串：按名称深度优先返回第一个匹配
 */
export function findNode(cc: any, ref: string, from?: any): any {
  const scene = from ?? cc.director.getScene();
  if (!scene) return null;
  // 优先按 UUID 精确匹配（编辑器节点 UUID 可能是压缩格式，不能靠格式猜测）
  const map = buildUuidIndex(cc);
  if (map.has(ref)) return map.get(ref);
  if (ref.startsWith('/')) {
    const parts = ref.split('/').filter(Boolean);
    let cur: any = scene;
    for (const p of parts) {
      cur = (cur.children ?? []).find((c: any) => c.name === p);
      if (!cur) return null;
    }
    return cur === scene ? null : cur;
  }
  let found: any = null;
  const walk = (n: any) => {
    if (found) return;
    if (n.name === ref) {
      found = n;
      return;
    }
    (n.children ?? []).forEach(walk);
  };
  walk(scene);
  return found;
}

export function getNodeInfo(cc: any, ref: string): any {
  const node = findNode(cc, ref);
  if (!node) return null;
  return nodeToJson(cc, node, 32, { includeComponents: true });
}

function vec3(v: any) {
  return { x: round(v.x), y: round(v.y), z: round(v.z) };
}

function round(n: number) {
  return Math.round(n * 10000) / 10000;
}
