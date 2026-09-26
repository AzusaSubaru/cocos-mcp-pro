/**
 * npx cocos-mcp-pro init [projectPath]
 * 把预编译扩展拷贝到 <project>/extensions/cocos-mcp-bridge/
 */
import { cp, mkdir, rm, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

/** 本包编译后的服务器入口（dist/index.js），用于写入 AI 客户端配置 */
function localServerEntry(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  return path.resolve(here, 'index.js');
}

type ClientName = 'trae' | 'cursor' | 'claude';

/**
 * 把 MCP Server 配置写入对应 AI 客户端：
 *  - trae:   <project>/.trae/mcp.json
 *  - cursor: <project>/.cursor/mcp.json
 *  - claude: <project>/.mcp.json（Claude Code / Cline 同形态）
 * 已存在配置时合并，保留其它 server 条目。
 */
async function writeClientConfig(project: string, client: ClientName): Promise<string> {
  const rel =
    client === 'trae' ? path.join('.trae', 'mcp.json')
    : client === 'cursor' ? path.join('.cursor', 'mcp.json')
    : path.join('.mcp.json');
  const file = path.join(project, rel);
  await mkdir(path.dirname(file), { recursive: true });

  const serverConfig = {
    command: 'node',
    args: [localServerEntry(), '--project', project],
  };
  const next: any = { mcpServers: { 'cocos-mcp-pro': serverConfig } };
  if (existsSync(file)) {
    try {
      const old = JSON.parse(await readFile(file, 'utf8'));
      next.mcpServers = { ...(old.mcpServers ?? {}), ...next.mcpServers };
    } catch {
      // 旧文件损坏则覆盖
    }
  }
  await writeFile(file, JSON.stringify(next, null, 2), 'utf8');
  return file;
}

/**
 * 把项目协作指南（规则模板）写到对应客户端的规则位置：
 *  - trae:   .trae/rules/cocos-mcp-guide.md（自动加载，托管覆盖）
 *  - cursor: .cursor/rules/cocos-mcp-guide.md（自动加载，托管覆盖）
 *  - claude: AGENTS.md（项目根；已存在则保留用户文件，不覆盖）
 */
async function writeClientGuide(project: string, client: ClientName): Promise<string> {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const template = path.resolve(here, 'assets', 'cocos-mcp-guide.md');
  const content = await readFile(template, 'utf8');

  if (client === 'claude') {
    const file = path.join(project, 'AGENTS.md');
    if (existsSync(file)) return `${file}（已存在，保留未覆盖）`;
    await writeFile(file, content, 'utf8');
    return file;
  }
  const rel =
    client === 'trae'
      ? path.join('.trae', 'rules', 'cocos-mcp-guide.md')
      : path.join('.cursor', 'rules', 'cocos-mcp-guide.md');
  const file = path.join(project, rel);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, content, 'utf8');
  return file;
}

function vendorCandidates(): string[] {
  const here = path.dirname(fileURLToPath(import.meta.url));
  return [
    path.resolve(here, '..', 'vendor', 'cocos-mcp-bridge'),
    path.resolve(here, '..', '..', 'cocos-extension'),
  ];
}

export async function runInit(
  targetProject: string | undefined,
  force: boolean,
  client?: ClientName,
): Promise<void> {
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
  await writeFile(path.join(extDir, 'package.json'), JSON.stringify(publishPkg, null, 2), 'utf-8');

  console.log(`[init] 扩展已安装到: ${extDir}`);

  if (client) {
    const configFile = await writeClientConfig(project, client);
    console.log(`[init] 已写入 ${client} MCP 配置: ${configFile}`);
    const guideFile = await writeClientGuide(project, client);
    console.log(`[init] 已写入 ${client} 项目规则: ${guideFile}`);
  }

  console.log('');
  console.log('接下来请在 Cocos Creator 中：');
  console.log('  1. 菜单「扩展 → 扩展管理器 → 项目」找到 cocos-mcp-bridge，点击启用');
  console.log('  2. 扩展启用后会生成 temp/.cocos-mcp.json');
  if (client === 'trae') {
    console.log('  3. Trae：设置 → MCP → 打开「启用项目 MCP」，然后在对话里直接使用');
  } else {
    console.log('  3. 在 AI 客户端配置 MCP（可重跑本命令加 --client trae|cursor|claude 自动生成）');
  }
  console.log('  4. 验证：npx cocos-mcp-pro selftest --project <项目路径>');
}
