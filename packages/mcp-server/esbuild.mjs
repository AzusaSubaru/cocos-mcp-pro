import { build } from 'esbuild';
import { cp, mkdir, rm, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../..');
const extDir = resolve(root, 'packages/cocos-extension');
const vendorDir = resolve(here, 'vendor/cocos-mcp-bridge');

await build({
  entryPoints: ['src/index.ts'],
  bundle: true,
  outfile: 'dist/index.js',
  platform: 'node',
  target: 'node18',
  format: 'esm',
  sourcemap: true,
  banner: { js: '#!/usr/bin/env node' },
  external: ['playwright', 'playwright-core'],
  logLevel: 'info',
});

// 复制静态资源（AI 客户端规则模板等）到 dist，init 运行时读取
await rm(resolve(here, 'dist/assets'), { recursive: true, force: true });
await cp(resolve(here, 'assets'), resolve(here, 'dist/assets'), { recursive: true });
console.log('[build] assets copied -> dist/assets');

// 把预编译扩展拷进 vendor，init 命令从这里安装到用户项目
await rm(vendorDir, { recursive: true, force: true });
await mkdir(vendorDir, { recursive: true });
if (!existsSync(resolve(extDir, 'dist/main.js'))) {
  console.warn('[build] 扩展 dist 不存在，请先构建 cocos-extension');
} else {
  await cp(resolve(extDir, 'dist'), resolve(vendorDir, 'dist'), { recursive: true });
  const pkg = JSON.parse(await readFile(resolve(extDir, 'package.json'), 'utf-8'));
  delete pkg.scripts;
  delete pkg.devDependencies;
  await writeFile(resolve(vendorDir, 'package.json'), JSON.stringify(pkg, null, 2));
  console.log('[build] extension vendored ->', vendorDir);
}
