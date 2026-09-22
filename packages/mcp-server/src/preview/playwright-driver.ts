/**
 * Playwright sidecar：连接 Cocos 浏览器预览，收集运行时日志并截图。
 * playwright 为可选依赖，缺失时返回明确的安装指引。
 */
export interface PreviewCaptureResult {
  url: string;
  console: Array<{ type: string; text: string }>;
  pageErrors: string[];
  failedRequests: string[];
  screenshotBase64?: string;
}

async function tryImportPackage(name: string): Promise<any | null> {
  try {
    // 变量形式动态导入：playwright 为可选依赖，不参与类型解析与打包
    const mod = await import(/* @vite-ignore */ name);
    return mod;
  } catch {
    return null;
  }
}

async function loadPlaywright(): Promise<any> {
  const pw = (await tryImportPackage('playwright')) ?? (await tryImportPackage('playwright-core'));
  if (pw?.chromium) return pw;
  const err: any = new Error(
    '未安装 playwright（预览日志/截图依赖）。请在运行 MCP Server 的环境执行：npm i -g playwright && npx playwright install chromium（国内可设置 PLAYWRIGHT_DOWNLOAD_HOST=https://cdn.npmmirror.com/binaries/playwright）',
  );
  err.code = 'PLAYWRIGHT_MISSING';
  throw err;
}

export async function capturePreview(
  url: string,
  options: { waitMs?: number; screenshot?: boolean } = {},
): Promise<PreviewCaptureResult> {
  const pw = await loadPlaywright();
  const waitMs = options.waitMs ?? 3000;

  let browser: any;
  try {
    browser = await pw.chromium.launch({ headless: true });
  } catch (e: any) {
    const err: any = new Error(
      `Chromium 启动失败：${e?.message ?? e}。请执行 npx playwright install chromium 安装浏览器。`,
    );
    err.code = 'PLAYWRIGHT_MISSING';
    throw err;
  }

  try {
    const page = await browser.newPage({ viewport: { width: 720, height: 1280 } });
    const logs: Array<{ type: string; text: string }> = [];
    const pageErrors: string[] = [];
    const failedRequests: string[] = [];

    page.on('console', (msg: any) => {
      try {
        logs.push({ type: msg.type(), text: msg.text() });
      } catch {
        logs.push({ type: 'log', text: String(msg) });
      }
    });
    page.on('pageerror', (e: any) => pageErrors.push(String(e?.message ?? e)));
    page.on('requestfailed', (req: any) =>
      failedRequests.push(`${req.method?.() ?? '?'} ${req.url()} - ${req.failure()?.errorText ?? ''}`),
    );

    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 15000 });
    await page.waitForTimeout(waitMs);

    const result: PreviewCaptureResult = { url, console: logs, pageErrors, failedRequests };
    if (options.screenshot !== false) {
      const buf = await page.screenshot({ type: 'png' });
      result.screenshotBase64 = buf.toString('base64');
    }
    return result;
  } finally {
    await browser.close().catch(() => {});
  }
}
