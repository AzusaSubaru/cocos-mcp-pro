import { CocosClient } from './client/cocos-client.js';

interface Probe {
  label: string;
  ok: boolean;
  detail: string;
}

export async function runSelftest(project?: string): Promise<number> {
  let client: CocosClient;
  try {
    client = await CocosClient.connect(project);
  } catch (e: any) {
    console.error('✗ 无法连接桥接扩展：');
    console.error('  ' + (e?.message ?? e));
    console.error('');
    console.error('排查顺序：扩展是否已 init 到本项目 → 扩展管理器是否启用 → 编辑器是否运行 → temp/.cocos-mcp.json 是否存在');
    return 2;
  }

  console.log('== cocos-mcp-pro 真机自检 ==');
  console.log(`项目: ${client.info.project}`);
  console.log(`Cocos: ${client.info.cocosVersion}  扩展: ${client.info.extensionVersion}`);
  console.log('');

  const report: any = await client.call('main', 'selftest');
  let failures = 0;

  const printProbes = (probes: Probe[]) => {
    for (const p of probes) {
      const mark = p.ok ? '✓' : '✗';
      if (!p.ok) failures++;
      console.log(`${mark} ${p.label}`);
      console.log(`    ${p.detail}`);
    }
  };

  console.log('[main 进程]');
  printProbes(report.results ?? []);
  console.log('');
  console.log('[scene 脚本]');
  if (report.scene?.results) {
    printProbes(report.scene.results);
  } else {
    console.log('✗ scene 脚本无返回（execute-scene-script 调用失败，检查 contributions.scene.script 注册与 dist/scene.js）');
    failures++;
  }

  console.log('');
  if (failures === 0) {
    console.log('全部通过。Spike 结果请回填设计文档第 3.8 节消息核实表。');
    return 0;
  }
  console.log(`共 ${failures} 项失败：把本输出连同 扩展管理器→控制台 日志一并反馈，据失败项修正 adapter/messages.ts。`);
  return 1;
}
