/**
 * 控制通道 HTTP server（仅 127.0.0.1）。
 * 安全：随机 Bearer token + Origin 校验 + 拒绝跨域预检 + 仅接受 JSON POST。
 */
import * as http from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import { callSceneMethod } from './adapter/messages';

const MAX_BODY_BYTES = 20 * 1024 * 1024;

export interface HealthInfo {
  ok: true;
  extensionVersion: string;
  protocolVersion: number;
  cocosVersion: string;
  projectPath: string;
}

function isLocalOrigin(origin: string): boolean {
  return /^https?:\/\/(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])(:\d+)?\/?$/.test(origin);
}

function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

function toBridgeError(e: any) {
  const code = e?.code && typeof e.code === 'string' ? e.code : 'INTERNAL';
  const msg = String(e?.message ?? e);
  const zhMap: Record<string, string> = {
    SCRIPT_CLASS_NOT_FOUND: '脚本类未注册，可能未编译或存在编译错误',
    ASSET_NOT_FOUND: '资源未找到',
    NODE_NOT_FOUND: '节点未找到',
    COMPONENT_NOT_FOUND: '组件未找到',
    METHOD_NOT_FOUND: '编辑器消息/方法不可用（可能是 Cocos 版本差异）',
    PREVIEW_UNAVAILABLE: '预览不可用',
    INTERNAL: '扩展内部错误',
  };
  return {
    code,
    message_zh: `${zhMap[code] ?? '操作失败'}：${msg}`,
    message_en: msg,
    stack: e?.stack?.split('\n').slice(1, 9).map((s: string) => s.trim()),
    recoverable: true,
  };
}

export function startControlServer(
  token: string,
  mainMethods: Record<string, (...args: any[]) => any>,
  health: () => HealthInfo,
): Promise<{ server: http.Server; port: number }> {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const origin = req.headers.origin;
      if (origin && !isLocalOrigin(origin)) {
        res.writeHead(403);
        res.end('forbidden origin');
        return;
      }
      if (req.method === 'OPTIONS') {
        // 跨域预检一律不放行，使浏览器网页无法携带 Authorization 调用
        res.writeHead(origin ? 403 : 204);
        res.end();
        return;
      }

      if (req.method === 'GET' && req.url === '/health') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(health()));
        return;
      }

      if (req.method === 'POST' && req.url === '/rpc') {
        const auth = req.headers.authorization ?? '';
        if (!auth.startsWith('Bearer ') || !safeEqual(auth.slice(7), token)) {
          res.writeHead(401, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: { code: 'UNAUTHORIZED', message_zh: 'token 无效', message_en: 'invalid token' } }));
          return;
        }
        const chunks: Buffer[] = [];
        let size = 0;
        req.on('data', (c: Buffer) => {
          size += c.length;
          if (size > MAX_BODY_BYTES) {
            res.writeHead(413);
            res.end('payload too large');
            req.destroy();
            return;
          }
          chunks.push(c);
        });
        req.on('end', async () => {
          const started = Date.now();
          try {
            const body = JSON.parse(Buffer.concat(chunks).toString('utf-8'));
            const { target, method, args } = body;
            if (!target || !method || (args !== undefined && !Array.isArray(args))) {
              throw Object.assign(new Error('请求需包含 target/method/args[]'), { code: 'INVALID_PARAMS' });
            }
            let data: unknown;
            if (target === 'scene') {
              data = await callSceneMethod(method, args ?? []);
            } else if (target === 'main') {
              const fn = mainMethods[method];
              if (typeof fn !== 'function') {
                throw Object.assign(new Error(`main 方法不存在: ${method}`), { code: 'METHOD_NOT_FOUND' });
              }
              data = await fn(...(args ?? []));
            } else {
              throw Object.assign(new Error(`未知 target: ${target}`), { code: 'INVALID_PARAMS' });
            }
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: true, data, elapsedMs: Date.now() - started }));
          } catch (e: any) {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: false, error: toBridgeError(e), elapsedMs: Date.now() - started }));
          }
        });
        req.on('error', () => res.destroy());
        return;
      }

      res.writeHead(404);
      res.end('not found');
    });

    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      if (!addr || typeof addr === 'string') {
        reject(new Error('监听失败'));
        return;
      }
      resolve({ server, port: addr.port });
    });
  });
}
