import { registerProxyTools, rpc, runTool, textResult, z } from './common.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

export function registerSceneTools(server: McpServer) {
  registerProxyTools(server, [
    {
      name: 'cocos_editor_get_project_info',
      description: '获取当前 Cocos 项目信息：项目路径、项目名、Cocos Creator 版本、设计分辨率。连接后建议先调用。',
      schema: {},
      target: 'main',
      method: 'getProjectInfo',
      args: () => [],
      annotations: { readOnlyHint: true },
    },
    {
      name: 'cocos_scene_list',
      description: '列出项目 assets 目录下全部场景（.scene），返回名称、db:// 路径与 UUID。',
      schema: {},
      target: 'main',
      method: 'listScenes',
      args: () => [],
      annotations: { readOnlyHint: true },
    },
    {
      name: 'cocos_scene_current',
      description: '获取当前打开的场景名称、UUID 与 dirty（未保存）状态。',
      schema: {},
      target: 'main',
      method: 'currentScene',
      args: () => [],
      annotations: { readOnlyHint: true },
    },
    {
      name: 'cocos_scene_open',
      description: '打开指定场景，参数为 db:// 路径（由 cocos_scene_list 获取）。未保存修改可能被编辑器拦截。',
      schema: { url: z.string().describe('场景 db:// 路径') },
      target: 'main',
      method: 'openScene',
      args: (a) => [a.url],
    },
    {
      name: 'cocos_scene_save',
      description: '保存当前场景到磁盘。',
      schema: {},
      target: 'main',
      method: 'saveScene',
      args: () => [],
    },
    {
      name: 'cocos_scene_undo',
      description: '撤销编辑器中上一步场景操作（build_hierarchy 整次构建通常只需撤销一次）。',
      schema: {},
      target: 'main',
      method: 'undo',
      args: () => [],
    },
    {
      name: 'cocos_scene_hierarchy',
      description:
        '获取当前场景节点树（UUID/名称/激活状态/位置/旋转/缩放，可选尺寸与组件）。depth 限制深度，rootRef 可只查子树（UUID 或 /Canvas/Path）。',
      schema: {
        depth: z.number().int().min(1).max(64).optional().describe('最大遍历深度，默认 32'),
        includeComponents: z.boolean().optional().describe('是否返回每个节点的组件列表'),
        rootRef: z.string().optional().describe('子树根：UUID 或 /Canvas/xxx 路径'),
      },
      target: 'scene',
      method: 'getHierarchy',
      args: (a) => [{ depth: a.depth, includeComponents: a.includeComponents, rootRef: a.rootRef }],
      annotations: { readOnlyHint: true },
    },
  ]);

  server.registerTool(
    'cocos_spike_selftest',
    {
      title: 'cocos_spike_selftest',
      description:
        '【诊断工具】探测扩展与编辑器各消息/API 在当前 Cocos 版本上是否可用，输出 main 与 scene 两侧的检查表。配置失败、功能异常时首先运行本工具。',
      inputSchema: {},
      annotations: { readOnlyHint: true },
    },
    async () =>
      runTool(async () => {
        const report = await rpc('main', 'selftest');
        return report;
      }),
  );

  // 让 textResult 在本模块被引用（统一结果风格，供后续自定义工具使用）
  void textResult;
}
