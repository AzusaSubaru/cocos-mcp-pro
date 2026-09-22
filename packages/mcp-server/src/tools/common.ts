/**
 * 工具注册公共辅助：客户端单例、错误转 MCP 结果、声明式代理工具。
 */
import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { CocosClient, BridgeCallError } from '../client/cocos-client.js';

export { z };

let projectOverride: string | undefined;
let clientPromise: Promise<CocosClient> | null = null;

export function configureClient(project?: string) {
  projectOverride = project;
  clientPromise = null;
}

async function getClient(): Promise<CocosClient> {
  if (!clientPromise) clientPromise = CocosClient.connect(projectOverride);
  return clientPromise;
}

export async function rpc<T = any>(
  target: 'main' | 'scene',
  method: string,
  ...args: unknown[]
): Promise<T> {
  try {
    const c = await getClient();
    return await c.call<T>(target, method, ...args);
  } catch (e: any) {
    if (e?.code === 'BRIDGE_UNHEALTHY' || e?.code === 'BRIDGE_NOT_FOUND') {
      clientPromise = null;
    }
    throw e;
  }
}

export function textResult(data: unknown) {
  return {
    content: [
      {
        type: 'text' as const,
        text: typeof data === 'string' ? data : JSON.stringify(data, null, 2),
      },
    ],
  };
}

export function errorResult(e: unknown) {
  const err = e as any;
  let text = err?.message ?? String(e);
  if (err?.hint) text += `\n建议：${err.hint}`;
  if (err instanceof BridgeCallError && err.code) {
    text = `[${err.code}] ${text}`;
  }
  return { content: [{ type: 'text' as const, text }], isError: true };
}

export interface ProxyDef {
  name: string;
  description: string;
  schema: Record<string, z.ZodTypeAny>;
  target: 'main' | 'scene';
  method: string;
  args: (a: any) => unknown[];
  annotations?: { readOnlyHint?: boolean; destructiveHint?: boolean };
}

export function registerProxyTools(server: McpServer, defs: ProxyDef[]) {
  for (const d of defs) {
    server.registerTool(
      d.name,
      {
        title: d.name,
        description: d.description,
        inputSchema: d.schema,
        annotations: d.annotations ?? {},
      },
      async (args: any) => {
        try {
          const data = await rpc(d.target, d.method, ...d.args(args ?? {}));
          return textResult(data);
        } catch (e) {
          return errorResult(e);
        }
      },
    );
  }
}

export async function runTool(fn: () => Promise<unknown> | unknown) {
  try {
    return textResult(await fn());
  } catch (e) {
    return errorResult(e);
  }
}
