/**
 * Cocos 扩展主入口（编辑器主进程）。
 * 生命周期：onload 启动控制通道并写发现文件；unload 关闭并清理。
 */
import { randomBytes } from 'node:crypto';
import type { Server } from 'node:http';
import { startControlServer, type HealthInfo } from './http-server';
import { removeDiscovery, writeDiscovery } from './discovery';
import { EXTENSION_NAME, EXTENSION_VERSION, PROTOCOL_VERSION } from './constants';
import { getEditor, log, warn } from './editor';
import { mainMethods, startDiagnostics, stopDiagnostics } from './controllers/main-api';

let state: { server: Server; projectPath: string; port: number; token: string } | null = null;

async function boot() {
  const Editor = getEditor();
  const projectPath: string = Editor?.Project?.path ?? process.cwd();
  const cocosVersion: string = Editor?.App?.version ?? 'unknown';
  const token = randomBytes(24).toString('hex');

  const health = (): HealthInfo => ({
    ok: true,
    extensionVersion: EXTENSION_VERSION,
    protocolVersion: PROTOCOL_VERSION,
    cocosVersion,
    projectPath,
  });

  const { server, port } = await startControlServer(token, mainMethods as any, health);
  const file = writeDiscovery(projectPath, {
    port,
    token,
    pid: process.pid,
    cocosVersion,
    projectPath,
    extensionVersion: EXTENSION_VERSION,
    protocolVersion: PROTOCOL_VERSION,
    startedAt: new Date().toISOString(),
  });
  startDiagnostics();
  state = { server, projectPath, port, token };
  log(`控制通道已启动: 127.0.0.1:${port}，发现文件: ${file}`);
}

async function shutdown() {
  if (!state) return;
  stopDiagnostics();
  await new Promise<void>((resolve) => state!.server.close(() => resolve()));
  removeDiscovery(state.projectPath);
  log('控制通道已关闭');
  state = null;
}

/* 编辑器消息（菜单） */
export const methods = {
  'show-connection-info'() {
    if (!state) {
      warn('扩展尚未完成启动');
      return;
    }
    log(`连接信息 → 端口: ${state.port}，发现文件: ${state.projectPath}/temp/.cocos-mcp.json`);
  },
};

/* 生命周期钩子（不同 3.x 版本命名略有差异，全部导出） */
export function onload() {
  boot().catch((e) => warn('启动失败:', e?.message ?? e));
}
export function onunload() {
  shutdown().catch((e) => warn('关闭失败:', e?.message ?? e));
}
export const load = onload;
export const unload = onunload;

void EXTENSION_NAME;
