import { registerProxyTools, rpc, runTool, textResult, z } from './common.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { capturePreview } from '../preview/playwright-driver.js';

async function ensurePreviewUrl(url: string | undefined, platform: string): Promise<string> {
  if (url) return url;
  const info = await rpc<any>('main', 'previewStart', { platform });
  if (info?.previewUrl) return info.previewUrl;
  // 再查一次
  const err: any = new Error(
    '编辑器未返回预览 URL。请先在 Cocos 中确认浏览器预览端口，或把预览地址（如 http://localhost:7456/）作为 url 参数传入。',
  );
  err.code = 'PREVIEW_UNAVAILABLE';
  throw err;
}

export function registerEditorTools(server: McpServer) {
  registerProxyTools(server, [
    {
      name: 'cocos_editor_preview_run',
      description: '启动浏览器预览，返回预览 URL。',
      schema: { platform: z.string().default('browser') },
      target: 'main',
      method: 'previewStart',
      args: (a) => [{ platform: a.platform ?? 'browser' }],
    },
    {
      name: 'cocos_editor_preview_stop',
      description: '停止预览。',
      schema: {},
      target: 'main',
      method: 'previewStop',
      args: () => [],
    },
    {
      name: 'cocos_editor_diagnostics',
      description: '读取编辑器控制台诊断（编译错误/警告聚合环存）。创建或挂载脚本后必查。',
      schema: { clear: z.boolean().optional() },
      target: 'main',
      method: 'getDiagnostics',
      args: (a) => [a.clear ?? false],
      annotations: { readOnlyHint: true },
    },
  ]);

  server.registerTool(
    'cocos_editor_preview_logs',
    {
      title: 'cocos_editor_preview_logs',
      description:
        '启动/连接浏览器预览，运行指定时长后返回 console 日志、页面报错与失败请求，用于 AI 自修闭环。',
      inputSchema: {
        url: z.string().optional().describe('预览 URL；不传则调用编辑器启动预览'),
        waitMs: z.number().int().min(500).max(30000).optional().describe('页面打开后采集时长，默认 3000ms'),
        platform: z.string().default('browser'),
      },
      annotations: {},
    },
    async (a: any) =>
      runTool(async () => {
        const url = await ensurePreviewUrl(a.url, a.platform ?? 'browser');
        const r = await capturePreview(url, { waitMs: a.waitMs, screenshot: false });
        const { screenshotBase64, ...text } = r;
        void screenshotBase64;
        return text;
      }),
  );

  server.registerTool(
    'cocos_view_screenshot_game',
    {
      title: 'cocos_view_screenshot_game',
      description: '启动/连接浏览器预览并返回 PNG 截图（同时附带控制台错误），用于核对 UI 实际效果。',
      inputSchema: {
        url: z.string().optional(),
        waitMs: z.number().int().min(500).max(30000).optional(),
        platform: z.string().default('browser'),
      },
      annotations: {},
    },
    async (a: any) => {
      try {
        const url = await ensurePreviewUrl(a.url, a.platform ?? 'browser');
        const r = await capturePreview(url, { waitMs: a.waitMs, screenshot: true });
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                {
                  url: r.url,
                  pageErrors: r.pageErrors,
                  failedRequests: r.failedRequests,
                  logCount: r.console.length,
                  errorLogs: r.console.filter((l) => l.type === 'error'),
                },
                null,
                2,
              ),
            },
            { type: 'image', data: r.screenshotBase64!, mimeType: 'image/png' },
          ],
        };
      } catch (e) {
        return textResult(`截图失败：${(e as any)?.message ?? e}`);
      }
    },
  );
}
