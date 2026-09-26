/**
 * Spike #10：预览端到端。
 * 读发现文件 → main.previewStart 拿 URL → Playwright 打开，
 * 采集 console / pageerror / requestfailed，保存 PNG 截图。
 * 用法：node scripts/spike-preview.mjs "<项目>" [waitMs]
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';

// playwright 声明在 mcp-server 包中（可选依赖），从那里解析
const serverRequire = createRequire(join(process.cwd(), 'packages/mcp-server/package.json'));
const { chromium } = serverRequire('playwright');

const project = process.argv[2];
const waitMs = Number(process.argv[3] ?? 3000);
if (!project) { console.error('用法: node scripts/spike-preview.mjs "<项目>" [waitMs]'); process.exit(1); }

const discovery = JSON.parse(readFileSync(join(project, 'temp', '.cocos-mcp.json'), 'utf8').replace(/^﻿/, ''));
const { port, token } = discovery;
const base = `http://127.0.0.1:${port}`;

async function rpc(target, method, args = []) {
  const r = await fetch(`${base}/rpc`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify({ target, method, args }),
  });
  const j = await r.json();
  if (j.error) throw new Error(`${method}: ${j.error.message ?? JSON.stringify(j.error)}`);
  return j.data;
}

const info = await rpc('main', 'previewStart', [{ platform: 'browser' }]);
let url = info?.previewUrl;
if (!url) {
  const u = await rpc('main', 'rawMessage', ['preview', 'query-preview-url', []]);
  url = u;
}
console.log('预览 URL:', url);

const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 960, height: 640 } });
  const logs = [];
  const pageErrors = [];
  const failedRequests = [];
  page.on('console', (m) => logs.push({ type: m.type(), text: m.text() }));
  page.on('pageerror', (e) => pageErrors.push(String(e?.message ?? e)));
  page.on('requestfailed', (q) => failedRequests.push(`${q.method()} ${q.url()} - ${q.failure()?.errorText ?? ''}`));

  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 });
  await page.waitForTimeout(waitMs);

  const png = await page.screenshot({ type: 'png' });
  const outPng = join(process.env.TEMP, 'spike-preview.png');
  writeFileSync(outPng, png);

  const report = {
    url,
    title: await page.title(),
    consoleCount: logs.length,
    logs,
    pageErrors,
    failedRequests,
    screenshot: outPng,
    screenshotBytes: png.length,
  };
  console.log(JSON.stringify(report, null, 2));
} finally {
  await browser.close();
}
