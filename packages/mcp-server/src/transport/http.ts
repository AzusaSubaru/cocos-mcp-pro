/**
 * Streamable HTTP（无状态模式）传输，供 Cursor 等需要 HTTP 的客户端使用。
 * 端点：POST http://127.0.0.1:<port>/mcp
 */
import * as http from 'node:http';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { createServer } from '../server.js';

export async function runHttp(project: string | undefined, port: number): Promise<void> {
  const mcp = createServer(project);
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  await mcp.connect(transport);

  const server = http.createServer((req, res) => {
    if (req.method === 'POST' && req.url === '/mcp') {
      const chunks: Buffer[] = [];
      req.on('data', (c) => chunks.push(c));
      req.on('end', () => {
        try {
          const body = JSON.parse(Buffer.concat(chunks).toString('utf-8'));
          transport.handleRequest(req, res, body);
        } catch {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ jsonrpc: '2.0', error: { code: -32700, message: 'Parse error' }, id: null }));
        }
      });
      return;
    }
    if (req.method === 'GET' && req.url === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, transport: 'streamable-http', endpoint: '/mcp' }));
      return;
    }
    // 无状态模式不支持 SSE 会话与 DELETE
    res.writeHead(405, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'method not allowed (stateless mode)' }));
  });

  await new Promise<void>((resolve) => server.listen(port, '127.0.0.1', resolve));
  console.error(`[cocos-mcp-pro] Streamable HTTP MCP: http://127.0.0.1:${port}/mcp`);
}
