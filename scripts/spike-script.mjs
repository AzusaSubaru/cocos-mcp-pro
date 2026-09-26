/**
 * Spike #7：用户脚本 @ccclass 挂载 + 槽位连线（事务路径）。
 * 1. buildHierarchy upsert 面板节点，script.class=SpikeController
 *    refs.targetNode  → Title 节点（cc.Node 槽位）
 *    refs.targetLabel → OKButton 节点（cc.Label 组件槽位，自动取其上 Label）
 * 2. 回读组件 dump 验证槽位已填
 * 3. undo 一次：组件与连线应整体消失；redo 恢复
 * 用法：node scripts/spike-script.mjs "<项目>"
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const project = process.argv[2];
if (!project) { console.error('用法: node scripts/spike-script.mjs "<项目>"'); process.exit(1); }
const discovery = JSON.parse(readFileSync(join(project, 'temp', '.cocos-mcp.json'), 'utf8').replace(/^﻿/, ''));
const base = `http://127.0.0.1:${discovery.port}`;

async function rpc(target, method, args = []) {
  const r = await fetch(`${base}/rpc`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${discovery.token}` },
    body: JSON.stringify({ target, method, args }),
  });
  const j = await r.json();
  if (j.error) throw new Error(`${method}: ${j.error.message ?? JSON.stringify(j.error)}`);
  return j.data;
}

const panelPath = '/Canvas/McpSpikePanel';
const spec = {
  name: 'McpSpikePanel',
  script: {
    class: 'SpikeController',
    refs: {
      targetNode: `${panelPath}/Title`,
      targetLabel: `${panelPath}/OKButton/Label`,
    },
  },
};

console.log('== 1. 挂载脚本 + 连线（事务）==');
const build = await rpc('scene', 'buildHierarchy', [spec, { parent: '/Canvas', onExists: 'upsert' }]);
console.log(JSON.stringify(build, null, 2));

console.log('== 2. 回读面板组件，检查 SpikeController 槽位 ==');
const info = await rpc('scene', 'getNodeInfo', [panelPath]);
const comp = (info.components ?? []).find((c) => c.type === 'SpikeController');
if (!comp) throw new Error('SpikeController 未出现在组件列表');
const v = comp.properties ?? comp;
console.log(JSON.stringify({
  type: comp.type,
  targetNode: v.targetNode ?? comp.targetNode,
  targetLabel: v.targetLabel ?? comp.targetLabel,
  clickCount: v.clickCount ?? comp.clickCount,
}, null, 2));

console.log('== 3. undo 一次（脚本挂载与连线应整体消失）==');
await rpc('scene', 'raw', ['undo']);
const info2 = await rpc('scene', 'getNodeInfo', [panelPath]);
const still = (info2.components ?? []).some((c) => c.type === 'SpikeController');
console.log('undo 后 SpikeController 仍存在:', still);

console.log('== 4. redo 一次（应恢复）==');
await rpc('scene', 'raw', ['redo']);
const info3 = await rpc('scene', 'getNodeInfo', [panelPath]);
const comp3 = (info3.components ?? []).find((c) => c.type === 'SpikeController');
console.log('redo 后 SpikeController 存在:', !!comp3);
if (comp3) {
  const v3 = comp3.properties ?? comp3;
  console.log(JSON.stringify({ targetNode: v3.targetNode, targetLabel: v3.targetLabel }, null, 2));
}
