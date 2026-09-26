/**
 * cocos-mcp-pro CLI
 *   （默认）             以 stdio 启动 MCP 服务器
 *   --http [--port 9118] 以 Streamable HTTP 启动
 *   init [path]          安装编辑器扩展到 Cocos 项目
 *   selftest             真机自检（Spike 验证用）
 */
import { runStdio } from './transport/stdio.js';
import { runHttp } from './transport/http.js';
import { runInit } from './init.js';
import { runSelftest } from './selftest.js';

function flagValue(args: string[], name: string): string | undefined {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
}

/** 位置参数：去掉选项及其值 */
function positional(args: string[]): string[] {
  const flags = new Set(['--http', '--force', '--help', '-h']);
  const withValues = new Set(['--project', '--port', '--client']);
  const out: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (withValues.has(a)) {
      i++;
      continue;
    }
    if (flags.has(a)) continue;
    if (a.startsWith('-')) continue;
    out.push(a);
  }
  return out;
}

const HELP = `cocos-mcp-pro - Cocos Creator 社区 MCP 服务器

用法:
  cocos-mcp-pro                      stdio 模式启动 MCP（默认，TRAE/Claude/Cline）
  cocos-mcp-pro --http [--port 9118] Streamable HTTP 模式（Cursor）
  cocos-mcp-pro init [项目路径] [--force] [--client trae|cursor|claude]
        安装编辑器扩展，并可选自动写入 AI 客户端 MCP 配置
  cocos-mcp-pro selftest [--project 路径]   真机自检

通用参数:
  --project <path>   显式指定 Cocos 项目根（默认取 cwd 或 COCOS_MCP_PROJECT）
  --help, -h         显示帮助
`;

async function main() {
  const args = process.argv.slice(2);
  if (args.includes('--help') || args.includes('-h')) {
    console.log(HELP);
    return;
  }

  const project = flagValue(args, '--project');
  const positionals = positional(args);
  const command = positionals[0];

  if (command === 'init') {
    const clientRaw = flagValue(args, '--client');
    const client = clientRaw ? (clientRaw.toLowerCase() as 'trae' | 'cursor' | 'claude') : undefined;
    if (clientRaw && !['trae', 'cursor', 'claude'].includes(client!)) {
      console.error(`不支持的客户端: ${clientRaw}（可选 trae / cursor / claude）`);
      process.exit(1);
    }
    await runInit(positionals[1], args.includes('--force'), client);
    return;
  }

  if (command === 'selftest') {
    const code = await runSelftest(project);
    process.exit(code);
  }

  if (args.includes('--http')) {
    const port = Number(flagValue(args, '--port') ?? process.env.COCOS_MCP_HTTP_PORT ?? 9118);
    await runHttp(project, port);
    return;
  }

  await runStdio(project);
}

main().catch((e) => {
  console.error('[cocos-mcp-pro] 启动失败:', e?.message ?? e);
  process.exit(1);
});
