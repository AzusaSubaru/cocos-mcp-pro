/**
 * 发现文件：扩展启动后把端口/token 写入 <project>/temp/.cocos-mcp.json，
 * MCP Server 据此连接。
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { DISCOVERY_FILENAME } from './constants';

export function discoveryPath(projectPath: string): string {
  return path.join(projectPath, 'temp', DISCOVERY_FILENAME);
}

export function writeDiscovery(projectPath: string, data: Record<string, unknown>): string {
  const tempDir = path.join(projectPath, 'temp');
  fs.mkdirSync(tempDir, { recursive: true });
  const file = discoveryPath(projectPath);
  fs.writeFileSync(file, JSON.stringify(data, null, 2), { encoding: 'utf-8', mode: 0o600 });
  return file;
}

export function removeDiscovery(projectPath: string): void {
  try {
    fs.unlinkSync(discoveryPath(projectPath));
  } catch {
    /* 忽略 */
  }
}
