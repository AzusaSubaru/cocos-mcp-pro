import { registerProxyTools, z } from './common.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

export function registerAssetTools(server: McpServer) {
  registerProxyTools(server, [
    {
      name: 'cocos_asset_list',
      description: '列出指定 db:// 目录下的资源（默认 db://assets/）。',
      schema: { folder: z.string().optional() },
      target: 'main',
      method: 'listAssets',
      args: (a) => [a.folder ?? 'db://assets/'],
      annotations: { readOnlyHint: true },
    },
    {
      name: 'cocos_asset_search',
      description: '按名称关键字搜索资源，可限定类型。',
      schema: {
        keyword: z.string(),
        type: z.string().optional().describe("如 cc.SceneAsset / cc.Prefab / cc.SpriteFrame"),
      },
      target: 'main',
      method: 'searchAssets',
      args: (a) => [a.keyword, a.type],
      annotations: { readOnlyHint: true },
    },
    {
      name: 'cocos_asset_create_folder',
      description: '在资源目录下创建文件夹。',
      schema: {
        parentUrl: z.string().describe('如 db://assets/'),
        name: z.string(),
      },
      target: 'main',
      method: 'createFolder',
      args: (a) => [a.parentUrl, a.name],
    },
    {
      name: 'cocos_asset_create_script',
      description: "创建 TypeScript 脚本（含 @ccclass 模板），返回类名。创建后用 attach_script 挂载。",
      schema: {
        folderUrl: z.string().describe('如 db://assets/scripts/'),
        name: z.string().describe('文件名（不含 .ts），如 shoot_scene'),
      },
      target: 'main',
      method: 'createScript',
      args: (a) => [a.folderUrl, a.name],
    },
    {
      name: 'cocos_asset_create_scene',
      description: '创建新场景文件（依赖编辑器 create-asset 消息，若当前 Cocos 版本不支持请用 selftest 排查）。',
      schema: {
        folderUrl: z.string().describe('如 db://assets/scenes/'),
        name: z.string().describe('场景名（不含 .scene）'),
      },
      target: 'main',
      method: 'createScene',
      args: (a) => [a.folderUrl, a.name],
    },
    {
      name: 'cocos_asset_refresh',
      description: '刷新资源数据库（外部直接写盘后调用）。',
      schema: { url: z.string().optional() },
      target: 'main',
      method: 'refresh',
      args: (a) => [a.url],
    },
  ]);
}
