/**
 * 编辑器内部消息适配层（3.8.x）。
 * 所有 Editor.Message 调用收敛在这里：
 *  - 消息名无官方稳定性承诺，Spike 中逐个真机验证；
 *  - 版本差异只改本文件；
 *  - probe() 用于 selftest，探测某消息是否存在/可用，绝不抛异常。
 */
import { getEditor } from '../editor';

export function EditorMsg(...args: unknown[]): Promise<any> {
  const Editor = getEditor();
  if (!Editor?.Message?.request) {
    return Promise.reject(new Error('Editor.Message.request 不可用'));
  }
  return Editor.Message.request(...(args as [string, string, ...unknown[]]));
}

export function addBroadcastListener(channel: string, cb: (...args: any[]) => void) {
  const Editor = getEditor();
  Editor?.Message?.addBroadcastListener?.(channel, cb);
}

export function removeBroadcastListener(channel: string, cb: (...args: any[]) => void) {
  const Editor = getEditor();
  Editor?.Message?.removeBroadcastListener?.(channel, cb);
}

/** 调用本扩展注册的 scene 脚本方法 */
export function callSceneMethod(method: string, args: unknown[] = []) {
  return EditorMsg('scene', 'execute-scene-script', {
    name: 'cocos-mcp-bridge',
    method,
    args,
  });
}

/** 带超时的消息探测，selftest 使用 */
export async function probe(
  label: string,
  invoke: () => Promise<unknown>,
  timeoutMs = 4000,
): Promise<{ label: string; ok: boolean; detail: string }> {
  const timer = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error(`timeout ${timeoutMs}ms`)), timeoutMs),
  );
  try {
    const r = await Promise.race([invoke(), timer]);
    return {
      label,
      ok: true,
      detail: r === undefined ? 'ok（无返回值）' : truncate(safeStringify(r), 300),
    };
  } catch (e: any) {
    return { label, ok: false, detail: truncate(String(e?.message ?? e), 300) };
  }
}

function truncate(s: string, n: number) {
  return s.length > n ? s.slice(0, n) + '…' : s;
}

function safeStringify(v: unknown): string {
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}

/* ---------------- 消息封装（名字以真机验证为准） ---------------- */

export const Msg = {
  // 场景
  openScene: (url: string) => EditorMsg('scene', 'open-scene', url),
  saveScene: () => EditorMsg('scene', 'save-scene'),
  closeScene: () => EditorMsg('scene', 'close-scene'),
  queryScene: () => EditorMsg('scene', 'query-current-scene'),
  markDirty: () => EditorMsg('scene', 'mark-dirty'),
  beginOperation: (name: string) => EditorMsg('scene', 'begin-operation', name),
  endOperation: () => EditorMsg('scene', 'end-operation'),
  cancelOperation: () => EditorMsg('scene', 'cancel-operation'),
  undo: () => EditorMsg('scene', 'undo'),

  // 资源（3.8 签名：query-assets(options: QueryAssetsOption) → AssetInfo[]）
  queryAssets: (selector: string | Record<string, unknown>, type?: string) => {
    const options =
      typeof selector === 'string'
        ? { pattern: selector, ...(type ? { ccType: type } : {}) }
        : { ...selector, ...(type ? { ccType: type } : {}) };
    return EditorMsg('asset-db', 'query-assets', options).then(normalizeAssetList);
  },
  queryAssetInfo: (url: string) => EditorMsg('asset-db', 'query-asset-info', url),
  refreshAsset: (url?: string) => EditorMsg('asset-db', 'refresh-asset', url ?? 'db://assets/'),
  createAsset: (name: string, url: urlType, type: string) =>
    EditorMsg('asset-db', 'create-asset', name, url, type),
  deleteAsset: (url: string) => EditorMsg('asset-db', 'delete-asset', url),

  // 预览
  previewStart: (options?: unknown) => EditorMsg('preview', 'start', options),
  previewStop: () => EditorMsg('preview', 'stop'),
  queryPreviewUrl: () => EditorMsg('preview', 'query-preview-url'),

  // 构建（M2）
  build: (options: unknown) => EditorMsg('builder', 'build', options),
};

/** query-assets 真机返回数组；防御性归一（对象/空值） */
function normalizeAssetList(r: any): any[] {
  if (Array.isArray(r)) return r;
  if (r && typeof r === 'object') {
    return Object.values(r).filter(
      (x: any) => x && (x.uuid || x.url) && x.type !== 'database',
    );
  }
  return [];
}

// 仅用于类型提示占位，createAsset 的 url 是字符串
type urlType = string;
