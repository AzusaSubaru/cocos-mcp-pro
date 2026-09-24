/**
 * Spike：在当前场景构建一套 UI，连跑两次验证幂等，然后保存场景。
 * 用法: node scripts/spike-build.mjs <项目路径>
 */
import fs from 'node:fs';
import path from 'node:path';

const project = process.argv[2];
if (!project) {
  console.error('用法: node scripts/spike-build.mjs <项目路径>');
  process.exit(1);
}
const disc = JSON.parse(
  fs.readFileSync(path.join(project, 'temp', '.cocos-mcp.json'), 'utf8'),
);

async function rpc(target, method, args = []) {
  const res = await fetch(`http://127.0.0.1:${disc.port}/rpc`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${disc.token}`,
    },
    body: JSON.stringify({ target, method, args }),
  });
  const j = await res.json();
  if (j.error) {
    throw new Error(
      typeof j.error === 'string'
        ? j.error
        : `${j.error.message_en ?? j.error.message_zh}\n${(j.error.stack ?? []).join('\n')}`,
    );
  }
  return j.data;
}

const spec = {
  id: 'panel',
  name: 'McpSpikePanel',
  type: 'Sprite',
  spriteFrame: 'default_sprite_splash',
  color: '#3b5b92',
  contentSize: { w: 420, h: 320 },
  children: [
    {
      id: 'title',
      name: 'Title',
      type: 'Label',
      text: 'MCP Spike 面板',
      fontSize: 30,
      color: '#ffffff',
      position: { x: 0, y: 120 },
    },
    {
      id: 'okBtn',
      name: 'OKButton',
      type: 'Button',
      position: { x: -90, y: -110 },
      contentSize: { w: 160, h: 60 },
      label: { text: '确认', fontSize: 24, color: '#ffffff' },
    },
    {
      id: 'cancelBtn',
      name: 'CancelButton',
      type: 'Button',
      position: { x: 90, y: -110 },
      contentSize: { w: 160, h: 60 },
      label: { text: '取消', fontSize: 24, color: '#ffffff' },
    },
  ],
};
const options = { onExists: 'upsert', transaction: true, parent: '/Canvas' };

for (const p of ['/McpSpikePanel', '/Canvas/McpSpikePanel']) {
  try {
    const d = await rpc('scene', 'deleteNode', [p]);
    console.log(`清理残留 ${p}:`, JSON.stringify(d));
  } catch {}
}

console.log('== 第 1 次构建 ==');
const r1 = await rpc('scene', 'buildHierarchy', [spec, options]);
console.log(JSON.stringify(r1, null, 2));

console.log('== 第 2 次构建（幂等：应全部 updated，无 created）==');
const r2 = await rpc('scene', 'buildHierarchy', [spec, options]);
console.log(JSON.stringify({
  created: r2.created,
  updated: r2.updated,
  warnings: r2.warnings,
  rootUuid: r2.rootUuid,
}, null, 2));

console.log('== 层级回读 ==');
const h = await rpc('scene', 'getHierarchy', [{ depth: 3 }]);
console.log(JSON.stringify(h, null, 2));

console.log('== 保存场景 ==');
await rpc('main', 'saveScene');
const scenes = await rpc('main', 'listScenes');
console.log('场景列表:', JSON.stringify(scenes, null, 2));
