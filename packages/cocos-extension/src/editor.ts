/**
 * 获取编辑器注入的 Editor 对象。
 * main 进程与 scene 进程都可能以全局或模块两种形式提供，做兜底。
 */
export function getEditor(): any {
  const g = globalThis as any;
  if (g.Editor) return g.Editor;
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const mod = require('editor');
    return mod?.default ?? mod;
  } catch {
    return undefined;
  }
}

export function getCc(): any {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    return require('cc');
  } catch (e) {
    throw new Error('无法加载 cc 模块，本方法只能在 scene 脚本中调用: ' + String(e));
  }
}

export function log(...args: unknown[]) {
  console.log('[cocos-mcp-bridge]', ...args);
}

export function warn(...args: unknown[]) {
  console.warn('[cocos-mcp-bridge]', ...args);
}
