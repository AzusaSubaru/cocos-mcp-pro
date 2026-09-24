/**
 * 内置资源别名 → db://internal 路径（3.8.8 真机确认）。
 * 编辑器内 builtinResMgr 不保证这些 SpriteFrame 可按名字 get，
 * 统一走 asset-db 查询 SpriteFrame 子资源 UUID。
 */
import { getEditor } from '../editor';

export const BUILTIN_ALIASES: Record<string, string> = {
  default_sprite_splash: 'db://internal/default_ui/default_sprite_splash.png',
  default_sprite: 'db://internal/default_ui/default_sprite_splash.png',
  default_btn_normal: 'db://internal/default_ui/default_btn_normal.png',
  default_btn_pressed: 'db://internal/default_ui/default_btn_pressed.png',
  default_btn_disabled: 'db://internal/default_ui/default_btn_disabled.png',
};

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

/**
 * 解析别名/路径为可用的 SpriteFrame：
 * 优先返回内存中的资源对象；拿不到时返回 { __uuid__ } 占位（由编辑器反序列化）。
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
  const cache = cc.assetManager?.assets;
  const live = cache?.get?.(uuid) ?? cache?.get?.(uuid.replace(/@f9941$/, ''));
  return live ?? { __uuid__: uuid };
}
