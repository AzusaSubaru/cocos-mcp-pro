// 属性变更撤销 Spike：手动 recording 内 set-property（颜色 + spriteFrame），验证 undo/redo
// 用法：node scripts/spike-property.mjs <项目路径>
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

// 所有 scene 消息在 scene 进程内发送
const raw = (name, ...args) => rpc('scene', 'raw', [name, ...args]);

const SPLASH_SF = '7d8f9b89-4fd1-4c9f-a3ab-38ec7cded7ca@f9941';

// 1. 找 UndoA 的 Sprite 组件
const info = await rpc('scene', 'getNodeInfo', ['/Canvas/UndoA']);
const spriteUuid = info.components.find((c) => c.type === 'Sprite')?.uuid;
if (!spriteUuid) throw new Error('UndoA 上没有 Sprite，请先跑 create-component 测试');
console.log('Sprite uuid:', spriteUuid);

// 2. 查 dump
const dump = await raw('query-component', spriteUuid);
const colorProp = dump.value.color;
const sfProp = dump.value.spriteFrame;
const snapshotState = async () => {
  const d2 = await raw('query-component', spriteUuid);
  const c = d2.value.color.value;
  const sf = d2.value.spriteFrame.value.uuid;
  return `rgba(${c.r},${c.g},${c.b},${c.a}) sf=${sf ? sf.slice(0, 13) : '(empty)'}`;
};
console.log('before:       ', await snapshotState());

// 3. 手动 recording
const id = await raw('begin-recording', spriteUuid, { auto: false });
colorProp.value = { r: 255, g: 0, b: 0, a: 255 };
sfProp.value = { uuid: SPLASH_SF };
const r1 = await raw('set-property', { uuid: spriteUuid, path: 'color', dump: colorProp });
const r2 = await raw('set-property', { uuid: spriteUuid, path: 'spriteFrame', dump: sfProp });
console.log('set-property:', r1, r2);
const endR = await raw('end-recording', id);
console.log('end-recording:', endR);
await new Promise((r) => setTimeout(r, 800));
console.log('after build:  ', await snapshotState());

await raw('undo');
await new Promise((r) => setTimeout(r, 800));
console.log('after undo:   ', await snapshotState());

await raw('redo');
await new Promise((r) => setTimeout(r, 800));
console.log('after redo:   ', await snapshotState());
