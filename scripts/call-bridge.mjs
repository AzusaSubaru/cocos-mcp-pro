// 通用桥接调用器（开发调试用）：node scripts/call-bridge.mjs <project> <method> [jsonArgs...]
import fs from 'node:fs';
import path from 'node:path';

const [, , project, target, method, ...rawArgs] = process.argv;
const disc = JSON.parse(
  fs.readFileSync(path.join(project, 'temp', '.cocos-mcp.json'), 'utf8'),
);
const args = rawArgs.map((a) => {
  try {
    return JSON.parse(a);
  } catch {
    return a; // 裸字符串直接作为字符串参数
  }
});
const res = await fetch(`http://127.0.0.1:${disc.port}/rpc`, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${disc.token}`,
  },
  body: JSON.stringify({ target, method, args }),
});
const text = await res.text();
try {
  const j = JSON.parse(text);
  console.log(JSON.stringify(j.data ?? j.error, null, 2));
} catch {
  console.log('status', res.status, text.slice(0, 500));
}
