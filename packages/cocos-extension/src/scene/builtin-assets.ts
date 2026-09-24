/**
 * 内置资源别名 → db://internal 路径（3.8.8 真机确认）。
 * 编辑器内 builtinResMgr 不保证这些 SpriteFrame 可按名字 get，
 * 走 asset-db 查 SpriteFrame 子资源 UUID，再用 assetManager 真正加载进内存。
 * 注意：绝不能把 { __uuid__ } 占位对象直接赋给 spriteFrame ——
 * 引擎 setter 会同步访问 frame.rect，占位对象导致 TypeError。
 */
import { getEditor } from '../editor';

export const BUILTIN_ALIASES: Record<string, string> = {
  default_sprite_splash: 'db://internal/default_ui/default_sprite_splash.png',
  default_sprite: 'db://internal/default_ui/default_sprite_splash.png',
  default_btn_normal: 'db://internal/default_ui/default_btn_normal.png',
  default_btn_pressed: 'db://internal/default_ui/default_btn_pressed.png',
  default_btn_disabled: 'db://internal/default_ui/default_btn_disabled.png',
};

/** 按 UUID 加载资源（子资源带 type） */
export function loadAssetByUuid(cc: any, uuid: string, type?: any): Promise<any> {
  return new Promise((resolve, reject) => {
    const done = (err: any, asset: any) => (err ? reject(err) : resolve(asset));
    if (type) cc.assetManager.loadAny({ uuid, type }, done);
    else cc.assetManager.loadAny(uuid, done);
  });
}

/** 从 query-asset-info 结果中取 SpriteFrame 子资源 UUID */
function pickSpriteFrameUuid(info: any): string | null {
  const subs = info?.subAssets ? Object.values(info.subAssets) : info?.sub_assets;
  if (Array.isArray(subs)) {
    const hit = subs.find((s: any) => {
      const t = String(s.type ?? s.importer ?? '').toLowerCase();
      return t.includes('sprite-frame') || t.includes('spriteframe');
    });
    return (hit?.uuid as string) ?? null;
  }
  return null;
}

/** 从内存缓存取（兼容 @f9941 子资源后缀） */
function fromCache(cc: any, uuid: string): any {
  const cache = cc.assetManager?.assets;
  return cache?.get?.(uuid) ?? cache?.get?.(uuid.replace(/@f9941$/, '')) ?? null;
}

/**
 * 解析别名/路径为已加载的 SpriteFrame 对象。
 */
export async function resolveBuiltin(cc: any, aliasOrName: string): Promise<any | null> {
  const Editor = getEditor();
  const url = BUILTIN_ALIASES[aliasOrName] ?? (aliasOrName.startsWith('db://') ? aliasOrName : null);
  if (!url || !Editor?.Message?.request) return null;
  let info: any;
  try {
    info = await Editor.Message.request('asset-db', 'query-asset-info', url);
  } catch {
    return null;
  }
  const uuid = pickSpriteFrameUuid(info);
  if (!uuid) return null;
  const cached = fromCache(cc, uuid);
  if (cached) return cached;
  try {
    return await loadAssetByUuid(cc, uuid, cc.SpriteFrame);
  } catch {
    return null;
  }
}
