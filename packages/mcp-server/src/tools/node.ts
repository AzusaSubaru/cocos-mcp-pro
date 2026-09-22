import { registerProxyTools, z } from './common.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

const Ref = z
  .string()
  .describe('节点定位：UUID、/Canvas/父/子 路径，或当前场景内唯一节点名');

const Vec3 = z
  .object({
    x: z.number().optional(),
    y: z.number().optional(),
    z: z.number().optional(),
  })
  .describe('三维向量，只传需要修改的分量');

export function registerNodeTools(server: McpServer) {
  registerProxyTools(server, [
    {
      name: 'cocos_node_find',
      description: '查找节点并返回完整信息（transform、UITransform 尺寸、组件列表）。',
      schema: { ref: Ref },
      target: 'scene',
      method: 'getNodeInfo',
      args: (a) => [a.ref],
      annotations: { readOnlyHint: true },
    },
    {
      name: 'cocos_node_get_info',
      description: '同 cocos_node_find：获取节点完整信息。',
      schema: { ref: Ref },
      target: 'scene',
      method: 'getNodeInfo',
      args: (a) => [a.ref],
      annotations: { readOnlyHint: true },
    },
    {
      name: 'cocos_node_create',
      description: '在父节点下创建空节点。parent 不传则建在场景根。UI 节点会自动补 UITransform。',
      schema: {
        parent: Ref.optional().describe('父节点；不传为场景根'),
        name: z.string().min(1).describe('节点名'),
      },
      target: 'scene',
      method: 'createNode',
      args: (a) => [a.parent ?? null, a.name],
    },
    {
      name: 'cocos_node_delete',
      description: '删除节点及其整棵子树（不可恢复，请谨慎）。',
      schema: { ref: Ref },
      target: 'scene',
      method: 'deleteNode',
      args: (a) => [a.ref],
      annotations: { destructiveHint: true },
    },
    {
      name: 'cocos_node_rename',
      description: '重命名节点。',
      schema: { ref: Ref, name: z.string().min(1) },
      target: 'scene',
      method: 'renameNode',
      args: (a) => [a.ref, a.name],
    },
    {
      name: 'cocos_node_set_transform',
      description:
        '设置节点 Position/Rotation（欧拉角，度）/Scale/active，各字段可选、一次调用可改多项。UI 节点坐标相对父节点，受 Widget 对齐影响。',
      schema: {
        ref: Ref,
        position: Vec3.optional(),
        rotation: Vec3.optional().describe('欧拉角，单位度'),
        scale: Vec3.optional(),
        active: z.boolean().optional(),
      },
      target: 'scene',
      method: 'setTransform',
      args: (a) => [a.ref, { position: a.position, rotation: a.rotation, scale: a.scale, active: a.active }],
    },
  ]);
}
