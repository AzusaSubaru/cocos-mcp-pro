/**
 * npx cocos-mcp-pro init [projectPath]
 * 把预编译扩展拷贝到 <project>/extensions/cocos-mcp-bridge/
 */
import { cp, mkdir, rm, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

function vendorCandidates(): string[] {
  const here = path.dirname(fileURLToPath(import.meta.url));
  return [
    path.resolve(here, '..', 'vendor', 'cocos-mcp-bridge'),
    path.resolve(here, '..', '..', 'cocos-extension'),
  ];
}

export async function runInit(targetProject: string | undefined, force: boolean): Promise<void> {
  const project = path.resolve(targetProject ?? process.cwd());
  if (!existsSync(path.join(project, 'assets'))) {
    throw new Error(
      `${project} 下没有 assets/ 目录，看起来不是 Cocos Creator 项目根。请在 Cocos 项目根目录执行本命令，或显式传入项目路径。`,
    );
  }

  const vendor = vendorCandidates().find((dir) => existsSync(path.join(dir, 'dist', 'main.js')));
  if (!vendor) {
    throw new Error('未找到扩展预编译产物（vendor/cocos-mcp-bridge 或 packages/cocos-extension/dist）。');
  }

  const extDir = path.join(project, 'extensions', 'cocos-mcp-bridge');
  if (existsSync(extDir)) {
    if (!force) {
      console.log(`[init] 已存在 ${extDir}，执行覆盖更新（--force 不再提示，默认覆盖）。`);
    }
    await rm(extDir, { recursive: true, force: true });
  }
  await mkdir(extDir, { recursive: true });
  await cp(path.join(vendor, 'dist'), path.join(extDir, 'dist'), { recursive: true });
  const pkg = JSON.parse(await readFile(path.join(vendor, 'package.json'), 'utf-8'));
  const { scripts, devDependencies, ...publishPkg } = pkg;
  void scripts;
  void devDependencies;
  const { writeFile } = await import('node:fs/promises');
  await writeFile(path.join(extDir, 'package.json'), JSON.stringify(publishPkg, null, 2), 'utf-8');

  console.log(`[init] 扩展已安装到: ${extDir}`);
  console.log('');
  console.log('接下来请在 Cocos Creator 中：');
  console.log('  1. 菜单「扩展 → 扩展管理器 → 已安装/项目」找到 cocos-mcp-bridge，点击启用（首次可能需要刷新/重启编辑器）');
  console.log('  2. 扩展启用后会生成 temp/.cocos-mcp.json');
  console.log('  3. 在 AI 客户端配置 MCP（stdio）: node /path/to/dist/index.js，或 npx cocos-mcp-pro');
  console.log('  4. 验证：npx cocos-mcp-pro selftest --project <项目路径>');
}
