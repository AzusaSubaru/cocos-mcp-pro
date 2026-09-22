/**
 * MCP Server <-> Cocos 扩展 控制通道协议（v1）
 * 两端共享，变更必须同步升 PROTOCOL_VERSION。
 */

export const PROTOCOL_VERSION = 1;

/** 扩展写入 Cocos 项目 temp/.cocos-mcp.json 的发现文件 */
export interface DiscoveryFile {
  /** 控制通道监听端口 */
  port: number;
  /** 每会话随机 Bearer Token（hex） */
  token: string;
  /** 扩展所在编辑器进程 pid */
  pid: number;
  /** Cocos Creator 版本，如 3.8.6 */
  cocosVersion: string;
  /** 项目绝对路径（编辑器上报） */
  projectPath: string;
  /** 扩展版本 */
  extensionVersion: string;
  /** 协议版本 */
  protocolVersion: number;
  /** ISO 时间字符串 */
  startedAt: string;
}

export const DISCOVERY_FILENAME = '.cocos-mcp.json';

/** RPC 目标：main = 扩展主进程控制器；scene = scene 脚本方法 */
export type RpcTarget = 'main' | 'scene';

export interface RpcRequest {
  target: RpcTarget;
  /** main 控制器方法名或 scene 脚本 exports.methods 中的方法名 */
  method: string;
  args?: unknown[];
}

export interface BridgeError {
  code: ErrorCode;
  message_zh: string;
  message_en: string;
  hint_zh?: string;
  recoverable?: boolean;
  details?: Record<string, unknown>;
}

export interface RpcResponse {
  ok: boolean;
  data?: unknown;
  error?: BridgeError;
  /** 扩展侧耗时（ms），便于排查性能 */
  elapsedMs?: number;
}

/** 统一错误码（Server 与扩展共用） */
export const ErrorCode = {
  // 连接 / 发现类
  BRIDGE_NOT_FOUND: 'BRIDGE_NOT_FOUND',
  BRIDGE_UNHEALTHY: 'BRIDGE_UNHEALTHY',
  UNAUTHORIZED: 'UNAUTHORIZED',
  PROTOCOL_MISMATCH: 'PROTOCOL_MISMATCH',
  // 请求类
  INVALID_PARAMS: 'INVALID_PARAMS',
  METHOD_NOT_FOUND: 'METHOD_NOT_FOUND',
  SCENE_NOT_OPEN: 'SCENE_NOT_OPEN',
  NODE_NOT_FOUND: 'NODE_NOT_FOUND',
  COMPONENT_NOT_FOUND: 'COMPONENT_NOT_FOUND',
  SCRIPT_CLASS_NOT_FOUND: 'SCRIPT_CLASS_NOT_FOUND',
  ASSET_NOT_FOUND: 'ASSET_NOT_FOUND',
  TYPE_MISMATCH: 'TYPE_MISMATCH',
  PREFAB_CONTEXT_GUARD: 'PREFAB_CONTEXT_GUARD',
  BUILD_FAILED: 'BUILD_FAILED',
  PREVIEW_UNAVAILABLE: 'PREVIEW_UNAVAILABLE',
  PLAYWRIGHT_MISSING: 'PLAYWRIGHT_MISSING',
  UNSUPPORTED_COCOS_VERSION: 'UNSUPPORTED_COCOS_VERSION',
  FEATURE_DISABLED: 'FEATURE_DISABLED',
  INTERNAL: 'INTERNAL',
} as const;

export type ErrorCode = (typeof ErrorCode)[keyof typeof ErrorCode];

export function makeError(
  code: ErrorCode,
  zh: string,
  en: string,
  extra?: Partial<BridgeError>,
): BridgeError {
  return {
    code,
    message_zh: zh,
    message_en: en,
    recoverable: extra?.recoverable ?? true,
    ...extra,
  };
}

/** MCP 工具注解分组（注册时使用） */
export const ToolAnnotations = {
  readOnly: { readOnlyHint: true } as const,
  destructive: { destructiveHint: true } as const,
  write: {} as const,
};
