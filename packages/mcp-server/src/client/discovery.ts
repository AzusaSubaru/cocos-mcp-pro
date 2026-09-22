/**
 * 发现 Cocos 扩展：
 * 定位项目 → 读 temp/.cocos-mcp.json → /health 探活。
 */
import { readFile } from 'node:fs/promises';
import * as path from 'node:path';
import * as fs from 'node:fs';

export const DISCOVERY_FILENAME = '.cocos-mcp.json';

export function locateProject(explicit?: string): string {
  const candidates = [
    explicit,
    process.env.COCOS_MCP_PROJECT,
    process.cwd(),
  ].filter(Boolean) as string[];

  for (const c of candidates) {
    const abs = path.resolve(c);
    if (fs.existsSync(path.join(abs, 'temp', DISCOVERY_FILENAME))) return abs;
    // 向上最多 3 层查找（AI 客户端可能以子目录为 cwd）
    let cur = abs;
    for (let i = 0; i < 3; i++) {
      const parent = path.dirname(cur);
      if (parent === cur) break;
      cur = parent;
      if (fs.existsSync(path.join(cur, 'temp', DISCOVERY_FILENAME))) return cur;
    }
  }
  return path.resolve(explicit ?? process.env.COCOS_MCP_PROJECT ?? process.cwd());
}

export function discoveryFileFor(project: string): string {
  return path.join(project, 'temp', DISCOVERY_FILENAME);
}

export async function discoverBridge(explicitProject?: string): Promise<{
  project: string;
  baseUrl: string;
  token: string;
  discovery: any;
}> {
  const project = locateProject(explicitProject);
  const file = discoveryFileFor(project);
  let discovery: any;
  try {
    discovery = JSON.parse(await readFile(file, 'utf-8'));
  } catch {
    const err: any = new Error(
      `未找到桥接扩展发现文件：${file}。请确认：1) 已在 Cocos 项目执行 npx cocos-mcp-pro init；2) 已在 Cocos 扩展管理器中启用 cocos-mcp-bridge；3) 编辑器正在运行。`,
    );
    err.code = 'BRIDGE_NOT_FOUND';
    throw err;
  }

  const baseUrl = `http://127.0.0.1:${discovery.port}`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 2500);
  try {
    const res = await fetch(`${baseUrl}/health`, { signal: ctrl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const health = await res.json();
    if (health.protocolVersion !== discovery.protocolVersion) {
      // 仅警告，不阻断（小版本可能兼容）
      console.error(
        `[cocos-mcp-pro] 协议版本不一致：server 发现文件 v${discovery.protocolVersion}，扩展健康检查 v${health.protocolVersion}`,
      );
    }
  } catch (e: any) {
    const err: any = new Error(
      `无法连接 Cocos 桥接扩展（127.0.0.1:${discovery.port}）：${e?.message ?? e}。编辑器可能已关闭，请重启 Cocos Creator。`,
    );
    err.code = 'BRIDGE_UNHEALTHY';
    throw err;
  } finally {
    clearTimeout(timer);
  }

  return { project, baseUrl, token: discovery.token, discovery };
}
