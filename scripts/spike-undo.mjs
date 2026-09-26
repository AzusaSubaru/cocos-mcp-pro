// 撤销 Spike：验证「一次构建 = 一次 Ctrl+Z」
// 用法：node scripts/spike-undo.mjs <项目路径>
import fs from 'node:fs';
import path from 'node:path';

const [, , project] = process.argv;
const disc = JSON.parse(
  fs.readFileSync(path.join(project, 'temp', '.cocos-mcp.json'), 'utf8'),
);

async function rpc(target, method, args = [], timeoutMs = 20000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(`http://127.0.0.1:${disc.port}/rpc`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${disc.token}`,
      },
      body: JSON.stringify({ target, method, args }),
      signal: ctrl.signal,
    });
    const j = await res.json();
    if (!j.ok) throw new Error(j.error?.message_en ?? JSON.stringify(j.error));
    return j.data;
  } finally {
    clearTimeout(timer);
  }
}

const raw = (name, ...args) => rpc('main', 'rawMessage', ['scene', name, args]);
const canvasChildren = async () => {
  const h = await rpc('scene', 'getHierarchy', [{ depth: 1, rootRef: '/Canvas' }]);
  const canvas = h.name === 'Canvas' ? h : h.children.find((c) => c.name === 'Canvas');
  return (canvas?.children ?? []).map((c) => c.name);
};

const log = (step, names) => console.log(`${step.padEnd(14)} Canvas: ${names.join(',')}`);

// 取 Canvas 压缩 UUID
const hier = await rpc('scene', 'getHierarchy', [{ depth: 1 }]);
const canvas = hier.children.find((c) => c.name === 'Canvas');
const cv = canvas.uuid;
console.log('Canvas compressed uuid:', cv);

// 方案：手动 recording（auto:false）包裹两个 create-node 消息
const id = await raw('begin-recording', cv, { auto: false });
console.log('begin-recording id:', id);
const u1 = await raw('create-node', { name: 'UndoA', parent: cv });
const u2 = await raw('create-node', { name: 'UndoB', parent: cv });
console.log('created:', u1, u2);
const endR = await raw('end-recording', id);
console.log('end-recording:', endR);
await new Promise((r) => setTimeout(r, 500));
log('after build', await canvasChildren());

try {
  await raw('undo');
  await new Promise((r) => setTimeout(r, 500));
  log('after undo', await canvasChildren());
} catch (e) {
  console.log('undo error:', e.message);
}

try {
  await raw('redo');
  await new Promise((r) => setTimeout(r, 500));
  log('after redo', await canvasChildren());
} catch (e) {
  console.log('redo error:', e.message);
}
