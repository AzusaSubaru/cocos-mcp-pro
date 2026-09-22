import { registerProxyTools, rpc, runTool, z } from './common.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

async function resolveDesign(explicit?: { w: number; h: number }) {
  if (explicit) return explicit;
  const info = await rpc<any>('main', 'getProjectInfo');
  return info.designResolution ?? undefined;
}

export function registerValidateTools(server: McpServer) {
  registerProxyTools(server, [
    {
      name: 'cocos_validate_references',
      description: '检查场景中所有用户脚本组件的空引用槽位（@property 未拖节点/资源，运行时可能 NPE）。',
      schema: {},
      target: 'scene',
      method: 'validateReferences',
      args: () => [],
      annotations: { readOnlyHint: true },
    },
    {
      name: 'cocos_validate_overlap',
      description: '检查可交互节点（Button/BlockInputEvents）世界矩形重叠，防止按钮互相遮挡点不到。',
      schema: {},
      target: 'scene',
      method: 'validateOverlap',
      args: () => [],
      annotations: { readOnlyHint: true },
    },
  ]);

  const designSchema = {
    design: z
      .object({ w: z.number(), h: z.number() })
      .optional()
      .describe('设计分辨率；不传则读取项目设置'),
  };

  server.registerTool(
    'cocos_validate_layout',
    {
      title: 'cocos_validate_layout',
      description: '检查节点是否超出 Canvas/设计分辨率边界（带 Widget 拉伸的节点自动跳过）。',
      inputSchema: designSchema,
      annotations: { readOnlyHint: true },
    },
    async (a: any) =>
      runTool(async () => {
        const design = await resolveDesign(a.design);
        return rpc('scene', 'validateLayout', design);
      }),
  );

  server.registerTool(
    'cocos_validate_full_audit',
    {
      title: 'cocos_validate_full_audit',
      description: '综合校验：空引用 + 越界 + 可交互重叠，一次返回全部问题与数量汇总。搭完场景后必跑。',
      inputSchema: designSchema,
      annotations: { readOnlyHint: true },
    },
    async (a: any) =>
      runTool(async () => {
        const design = await resolveDesign(a.design);
        return rpc('scene', 'validateAudit', design);
      }),
  );
}
