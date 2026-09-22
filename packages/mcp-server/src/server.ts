import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { KNOWLEDGE_RESOURCES } from './resources/content.js';
import { registerSceneTools } from './tools/scene.js';
import { registerNodeTools } from './tools/node.js';
import { registerComponentTools } from './tools/component.js';
import { registerCompositeTools } from './tools/composite.js';
import { registerAssetTools } from './tools/asset.js';
import { registerEditorTools } from './tools/editor.js';
import { registerValidateTools } from './tools/validate.js';
import { registerBuilderTools } from './tools/builder.js';
import { configureClient } from './tools/common.js';

export const SERVER_NAME = 'cocos-mcp-pro';
export const SERVER_VERSION = '0.1.0';

export function createServer(project?: string): McpServer {
  configureClient(project);
  const server = new McpServer(
    { name: SERVER_NAME, version: SERVER_VERSION },
    {
      capabilities: {
        tools: {},
        resources: {},
      },
      instructions:
        '你是 Cocos Creator 3.8 场景搭建助手。工作流程：先 cocos_editor_get_project_info 与 cocos_scene_current 了解环境；搭建 UI 优先用 cocos_builder_build_scene / cocos_composite_build_hierarchy 一次性幂等构建；脚本挂载后用 cocos_editor_diagnostics 查编译错误；完成后用 cocos_validate_full_audit 校验、cocos_view_screenshot_game 与 cocos_editor_preview_logs 验证运行效果。坐标系等规则见 cocos://knowledge 资源。',
    },
  );

  registerSceneTools(server);
  registerNodeTools(server);
  registerComponentTools(server);
  registerCompositeTools(server);
  registerAssetTools(server);
  registerEditorTools(server);
  registerValidateTools(server);
  registerBuilderTools(server);

  for (const r of KNOWLEDGE_RESOURCES) {
    server.registerResource(
      r.name,
      r.uri,
      { description: r.name, mimeType: r.mimeType },
      async () => ({ contents: [{ uri: r.uri, mimeType: r.mimeType, text: r.text }] }),
    );
  }

  return server;
}
