/**
 * 内置资源别名 → builtinResMgr 资源名。
 * Spike 中在真机导出实际可用名称表后回填/修正。
 */
export const BUILTIN_ALIASES: Record<string, string> = {
  default_sprite_splash: 'default-sprite-splash',
  default_sprite: 'default-sprite-splash',
  default_sprite_frame: 'default-sprite-frame',
  default_btn_normal: 'default-btn-normal-sprite-frame',
  default_btn_pressed: 'default-btn-pressed-sprite-frame',
  default_btn_hover: 'default-btn-hover-sprite-frame',
  default_btn_disabled: 'default-btn-disabled-sprite-frame',
};

export function resolveBuiltin(cc: any, aliasOrName: string): any | null {
  const mgr = cc.builtinResMgr;
  if (!mgr) return null;
  const name = BUILTIN_ALIASES[aliasOrName] ?? aliasOrName;
  try {
    const r = mgr.get(name);
    return r ?? null;
  } catch {
    return null;
  }
}
