/**
 * main 进程控制器：项目信息、资源库、场景开关、预览、诊断。
 * 所有编辑器消息调用走 adapter/messages，消息名以真机验证为准。
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { getEditor, log, warn } from '../editor';
import { Msg, addBroadcastListener, removeBroadcastListener, callSceneMethod, probe } from '../adapter/messages';

const MAX_LOGS = 300;
const ringBuffer: Array<{ level: string; message: string; time: string }> = [];

function pushLog(level: string, args: unknown[]) {
  const message = args
    .map((a) => {
      try {
        return typeof a === 'string' ? a : JSON.stringify(a);
      } catch {
        return String(a);
      }
    })
    .join(' ');
  ringBuffer.push({ level, message, time: new Date().toISOString() });
  if (ringBuffer.length > MAX_LOGS) ringBuffer.shift();
}

const consoleHandler = {
  log: (...a: unknown[]) => pushLog('log', a),
  warn: (...a: unknown[]) => pushLog('warn', a),
  error: (...a: unknown[]) => pushLog('error', a),
};

export function startDiagnostics() {
  for (const [level, channel] of [
    ['log', 'console:log'],
    ['warn', 'console:warn'],
    ['error', 'console:error'],
  ] as const) {
    addBroadcastListener(channel, consoleHandler[level]);
  }
}

export function stopDiagnostics() {
  removeBroadcastListener('console:log', consoleHandler.log);
  removeBroadcastListener('console:warn', consoleHandler.warn);
  removeBroadcastListener('console:error', consoleHandler.error);
}

function projectPath(): string {
  const Editor = getEditor();
  return Editor?.Project?.path ?? Editor?.projectPath ?? process.cwd();
}

function cocosVersion(): string {
  const Editor = getEditor();
  return Editor?.App?.version ?? Editor?.app?.version ?? 'unknown';
}

function readDesignResolution(): { w: number; h: number } | null {
  const candidates = [
    'settings/v2/packages/project.json',
    'settings/v2/packages/scene.json',
    'settings/project.json',
  ];
  for (const rel of candidates) {
    try {
      const file = path.join(projectPath(), rel);
      if (!fs.existsSync(file)) continue;
      const json = JSON.parse(fs.readFileSync(file, 'utf-8'));
      const dr = json?.general?.designResolution ?? json?.designResolution;
      if (dr?.width && dr?.height) return { w: dr.width, h: dr.height };
    } catch {
      /* 继续尝试 */
    }
  }
  return null;
}

/* ---------------- 方法表 ---------------- */

export const mainMethods = {
  async ping() {
    return { pong: true, time: Date.now() };
  },

  async getProjectInfo() {
    const p = projectPath();
    return {
      projectPath: p,
      projectName: path.basename(p),
      cocosVersion: cocosVersion(),
      designResolution: readDesignResolution(),
    };
  },

  async listScenes() {
    try {
      const assets = await Msg.queryAssets('db://assets/**/*.scene', 'cc.SceneAsset');
      return (assets ?? []).map((a: any) => ({
        name: a.name?.replace(/\.scene$/, ''),
        url: a.url,
        uuid: a.uuid,
      }));
    } catch (e: any) {
      warn('queryAssets 失败，降级为磁盘扫描:', e?.message);
      return scanScenesFromDisk();
    }
  },

  async currentScene() {
    try {
      const info = await Msg.queryScene();
      if (info) return info;
    } catch {}
    const pong = await callSceneMethod('ping', []);
    return { name: pong?.scene ?? null, uuid: null, dirty: null };
  },

  async openScene(url: string) {
    await Msg.openScene(url);
    return { opened: url };
  },

  async saveScene() {
    await Msg.saveScene();
    return { saved: true, time: new Date().toISOString() };
  },

  async closeScene() {
    await Msg.closeScene();
    return { closed: true };
  },

  async undo() {
    await Msg.undo();
    return { undo: true };
  },

  async listAssets(folderUrl = 'db://assets/') {
    const base = folderUrl.endsWith('/') ? folderUrl : `${folderUrl}/`;
    try {
      const assets = await Msg.queryAssets(`${base}*`);
      return (assets ?? []).map((a: any) => ({
        name: a.name,
        url: a.url,
        uuid: a.uuid,
        type: a.type,
        isDirectory: a.isDirectory ?? false,
      }));
    } catch (e: any) {
      const err: any = new Error(`资源列表查询失败: ${e?.message ?? e}`);
      err.code = 'METHOD_NOT_FOUND';
      throw err;
    }
  },

  async refresh(url?: string) {
    await Msg.refreshAsset(url);
    return { refreshed: url ?? 'db://assets/' };
  },

  async searchAssets(keyword: string, assetType?: string) {
    const pattern = `db://assets/**/*${keyword}*`;
    const assets = await Msg.queryAssets(pattern, assetType as string);
    return (assets ?? []).map((a: any) => ({
      name: a.name,
      url: a.url,
      uuid: a.uuid,
      type: a.type,
    }));
  },

  /**
   * 解析资源引用：
   *  - db:// 路径 / 资源名 → asset-db 查询
   *  - 图片自动返回 SpriteFrame 子资源 UUID
   */
  async resolveAsset(ref: string, expectSubAsset?: string) {
    if (!ref) throw new Error('资源引用为空');
    if (/^[0-9a-f-]{20,}$/i.test(ref) && !ref.endsWith('.png') && !ref.endsWith('.jpg')) {
      return { uuid: ref };
    }
    const url = ref.startsWith('db://') ? ref : `db://assets/**/${ref}`;
    let info: any;
    try {
      info = await Msg.queryAssetInfo(url.includes('*') ? url : url);
    } catch {}
    if (!info && url.includes('*')) {
      const list = await Msg.queryAssets(url);
      info = list?.[0];
    }
    if (!info) {
      const err: any = new Error(`资源未找到: ${ref}`);
      err.code = 'ASSET_NOT_FOUND';
      throw err;
    }
    if (expectSubAsset === 'sprite-frame' || /\.(png|jpg|jpeg|webp)$/i.test(info.name ?? '')) {
      const sub = pickSpriteFrame(info);
      if (sub) return { uuid: sub, type: 'sprite-frame', source: info.url };
    }
    return { uuid: info.uuid, type: info.type, url: info.url };
  },

  async createFolder(parentUrl: string, name: string) {
    const diskRoot = urlToPath(parentUrl);
    const target = path.join(diskRoot, name);
    fs.mkdirSync(target, { recursive: true });
    await Msg.refreshAsset(parentUrl);
    return { created: `${parentUrl}/${name}` };
  },

  /** 创建用户脚本（写盘 + 刷新，最可靠路径） */
  async createScript(folderUrl: string, name: string) {
    const cls = toClassName(name);
    const diskRoot = urlToPath(folderUrl);
    fs.mkdirSync(diskRoot, { recursive: true });
    const file = path.join(diskRoot, `${name}.ts`);
    if (fs.existsSync(file)) throw new Error(`脚本已存在: ${file}`);
    fs.writeFileSync(file, scriptTemplate(cls), 'utf-8');
    await Msg.refreshAsset(`${folderUrl}/${name}.ts`);
    return { created: `${folderUrl}/${name}.ts`, className: cls };
  },

  /** 创建场景（消息名待 Spike 验证） */
  async createScene(folderUrl: string, name: string) {
    try {
      const r = await Msg.createAsset(`${name}.scene`, `${folderUrl}/${name}.scene` as unknown as string, 'scene');
      return { created: `${folderUrl}/${name}.scene`, raw: r };
    } catch (e: any) {
      const err: any = new Error(`create-asset 场景失败（消息名可能不同）: ${e?.message ?? e}`);
      err.code = 'METHOD_NOT_FOUND';
      throw err;
    }
  },

  async previewStart(options?: unknown) {
    try {
      const r = await Msg.previewStart(options ?? { platform: 'browser' });
      let url: string | null = null;
      try {
        url = await Msg.queryPreviewUrl();
      } catch {}
      return { started: true, previewUrl: url, raw: r ?? null };
    } catch (e: any) {
      const err: any = new Error(`预览启动失败: ${e?.message ?? e}`);
      err.code = 'PREVIEW_UNAVAILABLE';
      throw err;
    }
  },

  async previewStop() {
    await Msg.previewStop();
    return { stopped: true };
  },

  async getDiagnostics(clear = false) {
    const errors = ringBuffer.filter((l) => l.level === 'error');
    const warns = ringBuffer.filter((l) => l.level === 'warn');
    const snapshot = { errorCount: errors.length, warnCount: warns.length, logs: ringBuffer.slice(-100) };
    if (clear) ringBuffer.length = 0;
    return snapshot;
  },

  /** Spike 自检：main 进程侧探测项 */
  async selftest() {
    const results = [];
    results.push(await probe('project:query-project-info', () => Msg.queryProjectInfo()));
    results.push(await probe('asset-db:query-assets(.scene)', () => Msg.queryAssets('db://assets/**/*.scene', 'cc.SceneAsset')));
    results.push(
      await probe('设计分辨率文件', async () => {
        const d = readDesignResolution();
        if (!d) throw new Error('未读到 designResolution');
        return `${d.w}x${d.h}`;
      }),
    );
    results.push(await probe('scene:query-scene', () => Msg.queryScene()));
    results.push(await probe('preview:query-preview-url', () => Msg.queryPreviewUrl(), 2500));
    results.push(
      await probe('控制台广播监听（静态检查）', async () => {
        const Editor = getEditor();
        if (!Editor?.Message?.addBroadcastListener) throw new Error('addBroadcastListener 不可用');
        return '已注册 console:log/warn/error';
      }),
    );
    results.push(
      await probe('temp 目录可写', async () => {
        const dir = path.join(projectPath(), 'temp');
        fs.mkdirSync(dir, { recursive: true });
        const f = path.join(dir, '.mcp-write-test');
        fs.writeFileSync(f, '1');
        fs.unlinkSync(f);
        return dir;
      }),
    );
    // scene 进程探测
    try {
      const sceneReport = await callSceneMethod('selftest', []);
      results.push({ label: '--- scene 脚本 ---', ok: true, detail: '见下' });
      return { target: 'main', results, scene: sceneReport };
    } catch (e: any) {
      results.push({ label: 'scene 脚本调用', ok: false, detail: String(e?.message ?? e) });
      return { target: 'main', results };
    }
  },
};

/* ---------------- 辅助 ---------------- */

function pickSpriteFrame(info: any): string | null {
  const subs = info.subAssets ? Object.values(info.subAssets) : info.sub_assets;
  if (Array.isArray(subs)) {
    const hit = subs.find((s: any) => {
      const t = String(s.type ?? s.importer ?? '').toLowerCase();
      return t.includes('sprite-frame') || t.includes('spriteframe');
    });
    return hit?.uuid ?? null;
  }
  return null;
}

function urlToPath(dbUrl: string): string {
  const rel = dbUrl.replace(/^db:\/\//, '').replace(/\//g, path.sep);
  return path.join(projectPath(), rel);
}

function scanScenesFromDisk() {
  const assetsDir = path.join(projectPath(), 'assets');
  const out: Array<{ name: string; url: string }> = [];
  if (!fs.existsSync(assetsDir)) return out;
  const walk = (dir: string) => {
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, ent.name);
      if (ent.isDirectory()) walk(full);
      else if (ent.name.endsWith('.scene')) {
        const rel = path.relative(path.join(projectPath(), 'assets'), full).replace(/\\/g, '/');
        out.push({ name: ent.name.replace('.scene', ''), url: `db://assets/${rel}` });
      }
    }
  };
  walk(assetsDir);
  return out;
}

function toClassName(fileName: string): string {
  const parts = fileName.split(/[-_\/\s]+/).map((p) => p.charAt(0).toUpperCase() + p.slice(1));
  return parts.join('').replace(/[^A-Za-z0-9_]/g, '');
}

function scriptTemplate(cls: string): string {
  return `import { _decorator, Component, Node } from 'cc';
const { ccclass, property } = _decorator;

@ccclass('${cls}')
export class ${cls} extends Component {
    start() {
        // TODO
    }
}
`;
}

void log;
