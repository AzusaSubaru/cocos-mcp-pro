import { build, context } from 'esbuild';

/**
 * 扩展产物两个入口：
 * - dist/main.js  编辑器主进程（Node 环境，可用 node:http/fs）
 * - dist/scene.js 场景脚本（scene 进程，require('cc')）
 * cc / editor / electron 由 Cocos 运行时提供，必须 external。
 */
const common = {
  bundle: true,
  sourcemap: true,
  platform: 'node',
  format: 'cjs',
  target: 'node18',
  logLevel: 'info',
  external: ['cc', 'editor', 'electron'],
};

const entries = [
  { entryPoints: ['src/main.ts'], outfile: 'dist/main.js' },
  { entryPoints: ['src/scene/scene.ts'], outfile: 'dist/scene.js' },
];

const watch = process.argv.includes('--watch');

if (watch) {
  for (const opts of entries) {
    const ctx = await context({ ...common, ...opts });
    await ctx.watch();
  }
  console.log('[cocos-mcp-bridge] esbuild watch started');
} else {
  for (const opts of entries) {
    await build({ ...common, ...opts });
  }
  console.log('[cocos-mcp-bridge] build done');
}
