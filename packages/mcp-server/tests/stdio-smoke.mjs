/**
 * stdio 协议冒烟测试：启动 dist/index.js，完成 MCP 握手，
 * 校验工具与资源注册数量。不依赖 Cocos 编辑器。
 * 用法：node tests/stdio-smoke.mjs
 */
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const bin = resolve(here, '..', 'dist', 'index.js');

const child = spawn(process.execPath, [bin], { stdio: ['pipe', 'pipe', 'inherit'] });

let buf = '';
const responses = new Map();

child.stdout.on('data', (chunk) => {
  buf += chunk.toString();
  let idx;
  while ((idx = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, idx).trim();
    buf = buf.slice(idx + 1);
    if (!line) continue;
    const msg = JSON.parse(line);
    if (msg.id) responses.set(msg.id, msg);
  }
});

function send(obj) {
  child.stdin.write(JSON.stringify(obj) + '\n');
}

const waitFor = async (id, timeout = 8000) =>
  new Promise((resolvePromise, reject) => {
    const t = setInterval(() => {
      if (responses.has(id)) {
        clearInterval(t);
        clearTimeout(to);
        resolvePromise(responses.get(id));
      }
    }, 50);
    const to = setTimeout(() => {
      clearInterval(t);
      reject(new Error(`等待响应 id=${id} 超时`));
    }, timeout);
  });

try {
  send({
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'smoke', version: '1' } },
  });
  const init = await waitFor(1);
  if (!init.result?.serverInfo) throw new Error('initialize 无 serverInfo');
  console.log('✓ initialize:', init.result.serverInfo.name, init.result.serverInfo.version);

  send({ jsonrpc: '2.0', method: 'notifications/initialized' });

  send({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} });
  const tools = await waitFor(2);
  const list = tools.result?.tools ?? [];
  console.log(`✓ tools/list: ${list.length} 个工具`);
  if (list.length < 30) throw new Error(`工具数异常: ${list.length}`);
  const missingAnnotations = list.filter(
    (t) => t.name.startsWith('cocos_') && t.annotations === undefined,
  );
  if (missingAnnotations.length) console.log('~ 未声明 annotations 的工具:', missingAnnotations.map((t) => t.name).join(', '));

  send({ jsonrpc: '2.0', id: 3, method: 'resources/list', params: {} });
  const res = await waitFor(3);
  const rlist = res.result?.resources ?? [];
  console.log(`✓ resources/list: ${rlist.length} 个知识库资源`);
  if (rlist.length < 2) throw new Error('知识库资源缺失');

  // 未连接编辑器时的错误路径
  send({ jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'cocos_editor_get_project_info', arguments: {} } });
  const call = await waitFor(4);
  const text = call.result?.content?.[0]?.text ?? '';
  if (!call.result?.isError || !/扩展|桥接|bridge/i.test(text)) {
    throw new Error('未连接时应返回中文错误提示，实际: ' + text.slice(0, 120));
  }
  console.log('✓ 未连接编辑器时返回结构化中文错误');

  console.log('\nSMOKE PASS');
} catch (e) {
  console.error('SMOKE FAIL:', e.message);
  process.exitCode = 1;
} finally {
  child.kill();
}
