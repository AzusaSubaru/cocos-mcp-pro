/**
 * scene 脚本入口。
 * 由 main 进程通过 Editor.Message.request('scene', 'execute-scene-script',
 *   { name: 'cocos-mcp-bridge', method, args }) 调用。
 */
import { getEditor } from '../editor';
import * as executor from './executor';
import { getHierarchy, getNodeInfo } from './hierarchy';
import { resolveClass } from './properties';
import { resolveBuiltin } from './builtin-assets';
import * as validate from './validate';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const cc = require('cc');

function runSceneSelftest() {
  const results: Array<{ label: string; ok: boolean; detail: string }> = [];
  const check = (label: string, fn: () => string) => {
    try {
      results.push({ label, ok: true, detail: fn() });
    } catch (e: any) {
      results.push({ label, ok: false, detail: String(e?.message ?? e) });
    }
  };

  check('cc 模块加载', () => `version=${cc.engineVersion ?? 'unknown'}`);
  const scene = cc.director.getScene();
  check('当前场景可访问', () => scene?.name ?? '(无打开场景)');
  check('节点 UUID 字段', () => {
    const n = scene?.children?.[0];
    return n ? `name=${n.name}, uuid=${n.uuid ?? n.id ?? '(无)'}` : '(无节点)';
  });

  for (const name of ['Sprite', 'Label', 'Button', 'UITransform', 'Widget', 'Canvas']) {
    check(`类解析 ${name}`, () => {
      const cls = resolveClass(cc, name);
      if (!cls) throw new Error('解析失败');
      return cls.name ?? name;
    });
  }

  for (const alias of ['default-sprite-splash', 'default-btn-normal-sprite-frame']) {
    check(`内置资源 ${alias}`, () => {
      const r = resolveBuiltin(cc, alias);
      if (!r) throw new Error('builtinResMgr 未返回资源');
      return r.name ?? alias;
    });
  }

  check('assetManager.assets 缓存', () => {
    const cache = cc.assetManager?.assets;
    return cache ? `count=${cache.count ?? cache.size ?? '?'}` : '不可用';
  });

  check('Editor 全局对象', () => {
    const Editor = getEditor();
    return Editor?.Message?.request ? 'Message.request 可用' : 'Editor 不可用（场景脚本将无法标记 dirty/撤销）';
  });

  return { target: 'scene', results };
}

export const methods = {
  ping: () => ({
    pong: true,
    scene: cc.director.getScene()?.name ?? null,
    time: Date.now(),
  }),

  // 查询
  getHierarchy: (opts: any) => getHierarchy(cc, opts ?? {}),
  getNodeInfo: (ref: string) => getNodeInfo(cc, ref),

  // 节点原语
  createNode: (parentRef: string | null, name: string) =>
    executor.createNode(cc, parentRef, name),
  deleteNode: (ref: string) => executor.deleteNode(cc, ref),
  renameNode: (ref: string, name: string) => executor.renameNode(cc, ref, name),
  setTransform: (ref: string, t: any) => executor.setTransform(cc, ref, t),

  // 组件原语
  addComponent: (ref: string, className: string) => executor.addComponent(cc, ref, className),
  removeComponent: (ref: string, className: string) =>
    executor.removeComponent(cc, ref, className),
  listComponents: (ref: string) => executor.listComponents(cc, ref),
  getProperty: (ref: string, component: string | null, property: string) =>
    executor.getProperty(cc, ref, component, property),
  setProperty: (ref: string, component: string | null, property: string, value: any) =>
    executor.setProperty(cc, ref, component, property, value),
  setSpriteFrame: (ref: string, assetRef: string) =>
    executor.setSpriteFrame(cc, ref, assetRef),
  setColor: (ref: string, hex: string) => executor.setColor(cc, ref, hex),
  setContentSize: (ref: string, w: number, h: number) =>
    executor.setContentSize(cc, ref, w, h),
  setupWidget: (ref: string, spec: any) => executor.setupWidget(cc, ref, spec),

  // 脚本与批量
  attachScript: (ref: string, className: string, refs: Record<string, string>) =>
    executor.attachScript(cc, ref, className, refs),
  batchSet: (ops: any[]) => executor.batchSet(cc, ops),
  buildHierarchy: (spec: any, options: any) =>
    executor.buildHierarchy(cc, spec, options),

  // 校验
  validateReferences: () => validate.validateReferences(cc),
  validateLayout: (design: { w: number; h: number }) => validate.validateLayout(cc, design),
  validateOverlap: () => validate.validateOverlap(cc),
  validateAudit: (design: { w: number; h: number }) => validate.fullAudit(cc, design),

  // 自检
  selftest: runSceneSelftest,
};
