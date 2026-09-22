/**
 * 控制通道 HTTP 客户端：把 MCP 工具调用转发为扩展 RPC。
 */
import { discoverBridge } from './discovery.js';

export class BridgeCallError extends Error {
  code: string;
  hint?: string;
  constructor(public bridgeError: any) {
    super(bridgeError?.message_zh ?? bridgeError?.message_en ?? '桥接调用失败');
    this.code = bridgeError?.code ?? 'INTERNAL';
    this.hint = bridgeError?.hint_zh;
    this.name = 'BridgeCallError';
  }
}

export class CocosClient {
  constructor(
    public readonly baseUrl: string,
    public readonly token: string,
    public readonly project: string,
    public readonly discovery: any,
  ) {}

  static async connect(explicitProject?: string): Promise<CocosClient> {
    const d = await discoverBridge(explicitProject);
    return new CocosClient(d.baseUrl, d.token, d.project, d.discovery);
  }

  async call<T = any>(target: 'main' | 'scene', method: string, ...args: unknown[]): Promise<T> {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 60000);
    let res: Response;
    try {
      res = await fetch(`${this.baseUrl}/rpc`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.token}`,
        },
        body: JSON.stringify({ target, method, args }),
        signal: ctrl.signal,
      });
    } catch (e: any) {
      if (e?.name === 'AbortError') {
        const err: any = new Error(`调用 ${target}.${method} 超时（60s），可能是大场景操作或编辑器卡死`);
        err.code = 'BRIDGE_UNHEALTHY';
        throw err;
      }
      const err: any = new Error(`控制通道请求失败：${e?.message ?? e}，请确认 Cocos Creator 仍在运行`);
      err.code = 'BRIDGE_UNHEALTHY';
      throw err;
    } finally {
      clearTimeout(timer);
    }
    const body = await res.json();
    if (!body.ok) throw new BridgeCallError(body.error);
    return body.data as T;
  }

  get info() {
    return {
      project: this.project,
      cocosVersion: this.discovery.cocosVersion,
      extensionVersion: this.discovery.extensionVersion,
    };
  }
}
