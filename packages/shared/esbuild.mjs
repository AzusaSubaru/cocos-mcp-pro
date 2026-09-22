import { build } from 'esbuild';

const shared = {
  bundle: true,
  sourcemap: true,
  logLevel: 'info',
  packages: 'external',
};

await build({
  ...shared,
  entryPoints: ['src/index.ts'],
  format: 'esm',
  outfile: 'dist/index.js',
  platform: 'node',
});

await build({
  ...shared,
  entryPoints: ['src/index.ts'],
  format: 'cjs',
  outfile: 'dist/index.cjs',
  platform: 'node',
});
