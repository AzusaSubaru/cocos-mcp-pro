/**
 * scene 进程：类名解析、颜色/向量编码、属性类型探测。
 * 这是设计文档 3.2「四种值编码」的实现，Spike 重点验证对象。
 */

/** 按 cc 类名解析构造器：同时尝试 'Sprite' / 'cc.Sprite' / cc.Sprite */
export function resolveClass(cc: any, name: string): any | null {
  if (!name) return null;
  const js = cc.js;
  const short = name.replace(/^cc\./, '');
  const candidates = [name, name.startsWith('cc.') ? short : `cc.${short}`];
  for (const c of candidates) {
    const cls = js?.getClassByName?.(c);
    if (cls) return cls;
  }
  if (cc[name]) return cc[name];
  if (cc[short]) return cc[short];
  return null;
}

/** #RGB/#RGBA/#RRGGBB/#RRGGBBAA → {r,g,b,a}（0-255） */
export function parseHexColor(hex: string): { r: number; g: number; b: number; a: number } {
  let s = hex.trim().replace(/^#/, '');
  if (s.length === 3 || s.length === 4) {
    s = s
      .split('')
      .map((ch) => ch + ch)
      .join('');
  }
  const num = parseInt(s, 16);
  if (s.length === 6) {
    return { r: (num >> 16) & 255, g: (num >> 8) & 255, b: num & 255, a: 255 };
  }
  if (s.length === 8) {
    return { r: (num >> 24) & 255, g: (num >> 16) & 255, b: (num >> 8) & 255, a: num & 255 };
  }
  throw new Error(`无法解析颜色: ${hex}`);
}

function isInstance(cc: any, v: any, ctorName: string): boolean {
  return v instanceof (cc as any)[ctorName];
}

/**
 * 把 JSON 输入值转换为引擎值。
 * - Vec2/Vec3/Size/Color：按当前值类型构造
 * - 资源/节点引用：value 为 { uuid } / { nodeUuid } / 内置别名（由上层先解析）
 * - 基础值/枚举：原样返回
 */
export function encodeValue(cc: any, currentValue: any, input: any): any {
  if (input === null || input === undefined) return input;

  if (typeof input === 'string' && input.startsWith('#') && currentValue && isInstance(cc, currentValue, 'Color')) {
    const c = parseHexColor(input);
    return new cc.Color(c.r, c.g, c.b, c.a);
  }

  if (currentValue) {
    if (isInstance(cc, currentValue, 'Vec3')) {
      return new cc.Vec3(
        input.x ?? currentValue.x,
        input.y ?? currentValue.y,
        input.z ?? currentValue.z,
      );
    }
    if (isInstance(cc, currentValue, 'Vec2')) {
      return new cc.Vec2(input.x ?? currentValue.x, input.y ?? currentValue.y);
    }
    if (isInstance(cc, currentValue, 'Size')) {
      return new cc.Size(
        input.w ?? input.width ?? currentValue.width,
        input.h ?? input.height ?? currentValue.height,
      );
    }
    if (isInstance(cc, currentValue, 'Color')) {
      const c = input;
      return new cc.Color(
        c.r ?? currentValue.r,
        c.g ?? currentValue.g,
        c.b ?? currentValue.b,
        c.a ?? currentValue.a,
      );
    }
  }
  return input;
}

/** 取类的可序列化属性名列表（不同引擎版本字段名不同，多路径兜底） */
export function getSerializedProperties(cls: any): string[] {
  const candidates = [cls?.__props__, cls?.__values__, cls?.$__props__];
  for (const c of candidates) if (Array.isArray(c)) return c;
  return [];
}

/** 判断是否引擎内置组件类（用户脚本之外的） */
export function isEngineClass(cc: any, cls: any): boolean {
  if (!cls) return false;
  const name = cls.name || cls.__cid__;
  return !!(resolveClass(cc, name) && /^cc\.|^[A-Z]/.test(name) && isBundled(cc, cls));
}

function isBundled(cc: any, cls: any): boolean {
  // 引擎类都能在 cc 命名空间或 cc.js 注册表中找到
  const name = cls.name;
  return !!(cc[name] || cc.js?.getClassByName?.(`cc.${name}`) === cls);
}

/** 把节点/组件上的属性引用解析为引擎对象（节点 UUID / 资源 UUID） */
export function resolveReference(cc: any, uuidIndex: Map<string, any>, input: any): any {
  if (input === null || typeof input !== 'object') return input;
  if (input.nodeUuid) {
    const node = uuidIndex.get(input.nodeUuid);
    if (!node) throw new Error(`引用的节点 UUID 不存在: ${input.nodeUuid}`);
    return node;
  }
  if (input.uuid) {
    // scene 进程的资源缓存（编辑器已导入资源通常在其中）
    const asset = cc.assetManager?.assets?.get?.(input.uuid);
    if (asset) return asset;
    return { __uuid__: input.uuid, expectedType: input.type };
  }
  return input;
}
