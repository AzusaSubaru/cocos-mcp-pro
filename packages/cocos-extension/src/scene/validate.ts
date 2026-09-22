/**
 * scene 进程：场景校验。
 * - references：用户脚本的引用槽位空值检查（防运行时 NPE）
 * - layout：节点世界 AABB 是否超出 Canvas/设计分辨率
 * - overlap：可交互节点（Button / BlockInputEvents）重叠检查
 */
import { getSerializedProperties, resolveClass } from './properties';

const ENGINE_TYPES = new Set([
  'UITransform', 'Canvas', 'Widget', 'Sprite', 'Label', 'Button', 'Layout',
  'BlockInputEvents', 'Camera', 'Animation', 'UIOpacity', 'Mask', 'Graphics',
  'RichText', 'EditBox', 'ProgressBar', 'Toggle', 'Slider', 'ScrollView',
  'PageView', 'SafeArea', 'MeshRenderer', 'SkinnedMeshRenderer',
]);

export function validateReferences(cc: any) {
  const issues: any[] = [];
  const scene = cc.director.getScene();
  const walk = (node: any) => {
    for (const comp of node.components ?? []) {
      const typeName = comp.constructor?.name ?? '';
      if (ENGINE_TYPES.has(typeName) || typeName.startsWith('cc.')) continue;
      const props = getSerializedProperties(comp.constructor);
      for (const p of props) {
        if (p.startsWith('_')) continue;
        const v = comp[p];
        if (v === null || v === undefined) {
          // 引用类型槽位默认值为 null；数字/布尔默认 0/false，字符串默认 ''，误报率低
          issues.push({
            severity: 'warning',
            code: 'EMPTY_REFERENCE',
            node: node.name,
            component: typeName,
            property: p,
            message_zh: `节点「${node.name}」的脚本 ${typeName}.${p} 未赋值`,
          });
        }
      }
    }
    (node.children ?? []).forEach(walk);
  };
  walk(scene);
  return { checker: 'references', issueCount: issues.length, issues };
}

export function validateLayout(cc: any, design?: { w: number; h: number }) {
  const issues: any[] = [];
  const canvasNode = findCanvas(cc);
  if (!canvasNode) {
    return { checker: 'layout', issueCount: 0, issues, note: '未找到 Canvas 节点，跳过布局校验' };
  }
  const canvasUi = canvasNode.getComponent(cc.UITransform);
  let bounds = canvasUi?.getBoundingBoxToWorld?.();
  if (!bounds && design) {
    const p = canvasNode.worldPosition ?? canvasNode.position;
    bounds = { xMin: p.x - design.w / 2, xMax: p.x + design.w / 2, yMin: p.y - design.h / 2, yMax: p.y + design.h / 2 };
  }
  if (!bounds) return { checker: 'layout', issueCount: 0, issues, note: '无法确定设计分辨率边界' };

  const walk = (node: any) => {
    const ui = node.getComponent?.(cc.UITransform);
    if (ui && node !== canvasNode && node.activeInHierarchy !== false) {
      const widget = node.getComponent(cc.Widget);
      const r = ui.getBoundingBoxToWorld?.();
      if (r && widget === null) {
        const out =
          r.xMin < bounds.xMin - 1 || r.xMax > bounds.xMax + 1 ||
          r.yMin < bounds.yMin - 1 || r.yMax > bounds.yMax + 1;
        if (out) {
          issues.push({
            severity: 'warning',
            code: 'OUT_OF_DESIGN',
            node: node.name,
            rect: { xMin: round(r.xMin), xMax: round(r.xMax), yMin: round(r.yMin), yMax: round(r.yMax) },
            message_zh: `节点「${node.name}」超出设计分辨率边界（${Math.round(bounds.xMin)},${Math.round(bounds.yMin)} - ${Math.round(bounds.xMax)},${Math.round(bounds.yMax)}）`,
          });
        }
      }
    }
    (node.children ?? []).forEach(walk);
  };
  walk(canvasNode);
  return { checker: 'layout', issueCount: issues.length, issues };
}

export function validateOverlap(cc: any) {
  const issues: any[] = [];
  const interactive: { node: any; rect: any }[] = [];
  const scene = cc.director.getScene();
  const walk = (node: any) => {
    const ui = node.getComponent?.(cc.UITransform);
    const clickable = node.getComponent?.(cc.Button) || node.getComponent?.(cc.BlockInputEvents);
    if (ui && clickable && node.activeInHierarchy !== false) {
      const rect = ui.getBoundingBoxToWorld?.();
      if (rect) interactive.push({ node, rect });
    }
    (node.children ?? []).forEach(walk);
  };
  walk(scene);
  for (let i = 0; i < interactive.length; i++) {
    for (let j = i + 1; j < interactive.length; j++) {
      const a = interactive[i].rect;
      const b = interactive[j].rect;
      if (a.intersects?.(b) && a.intersection(b).width > 4 && a.intersection(b).height > 4) {
        issues.push({
          severity: 'warning',
          code: 'INTERACTIVE_OVERLAP',
          nodes: [interactive[i].node.name, interactive[j].node.name],
          message_zh: `可交互节点「${interactive[i].node.name}」与「${interactive[j].node.name}」区域重叠，可能导致点击被遮挡`,
        });
      }
    }
  }
  return { checker: 'overlap', issueCount: issues.length, issues };
}

export function fullAudit(cc: any, design?: { w: number; h: number }) {
  const reports = [validateReferences(cc), validateLayout(cc, design), validateOverlap(cc)];
  const issues = reports.flatMap((r) => r.issues);
  return {
    summary: {
      total: issues.length,
      references: reports[0].issueCount,
      layout: reports[1].issueCount,
      overlap: reports[2].issueCount,
    },
    notes: reports.map((r) => (r as any).note).filter(Boolean),
    issues,
  };
}

function findCanvas(cc: any) {
  const scene = cc.director.getScene();
  let found: any = null;
  const walk = (n: any) => {
    if (found) return;
    if (n.getComponent(cc.Canvas)) {
      found = n;
      return;
    }
    (n.children ?? []).forEach(walk);
  };
  walk(scene);
  return found;
}

function round(n: number) {
  return Math.round(n * 100) / 100;
}

// 避免未使用告警（resolveClass 预留给后续按类型精细校验）
void resolveClass;
