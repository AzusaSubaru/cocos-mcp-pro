import { registerProxyTools, rpc, runTool, z } from './common.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

const Ref = z.string().describe('节点定位：UUID、/Canvas/路径 或唯一节点名');
const ComponentType = z
  .string()
  .describe("组件 cc 类名，如 'Sprite'、'Label'、'Button'、'UITransform'、'Widget' 或用户脚本 @ccclass 名");
const PropertyValue = z
  .any()
  .describe('属性值：基础值直接传；Vec3/Color/Size 传对象；节点引用传 {"nodeUuid":"..."}；资源引用传 {"uuid":"..."}');

export function registerComponentTools(server: McpServer) {
  registerProxyTools(server, [
    {
      name: 'cocos_component_add',
      description: '给节点添加组件（按 cc 类名或用户脚本 @ccclass 名）。已存在同类型组件时复用。',
      schema: { ref: Ref, type: ComponentType },
      target: 'scene',
      method: 'addComponent',
      args: (a) => [a.ref, a.type],
    },
    {
      name: 'cocos_component_remove',
      description: '移除节点上的指定组件。',
      schema: { ref: Ref, type: ComponentType },
      target: 'scene',
      method: 'removeComponent',
      args: (a) => [a.ref, a.type],
      annotations: { destructiveHint: true },
    },
    {
      name: 'cocos_component_list',
      description: '列出节点上全部组件及启用状态。',
      schema: { ref: Ref },
      target: 'scene',
      method: 'listComponents',
      args: (a) => [a.ref],
      annotations: { readOnlyHint: true },
    },
    {
      name: 'cocos_component_get_property',
      description: '读取组件属性；component 不传时读取节点自身属性（如 name/active）。',
      schema: {
        ref: Ref,
        component: z.string().nullable().optional().describe('组件类名；节点属性传 null'),
        property: z.string(),
      },
      target: 'scene',
      method: 'getProperty',
      args: (a) => [a.ref, a.component ?? null, a.property],
      annotations: { readOnlyHint: true },
    },
    {
      name: 'cocos_component_set_property',
      description:
        '设置组件或节点属性。值编码：Vec3 传 {x,y,z}，颜色传 {r,g,b,a} 或 #RRGGBB，节点引用传 {"nodeUuid":"..."}，资源传 {"uuid":"..."}。',
      schema: {
        ref: Ref,
        component: z.string().nullable().optional(),
        property: z.string(),
        value: PropertyValue,
      },
      target: 'scene',
      method: 'setProperty',
      args: (a) => [a.ref, a.component ?? null, a.property, a.value],
    },
    {
      name: 'cocos_component_set_color',
      description: '设置节点上 Sprite/Label 的颜色（含透明度），颜色支持 #RGB/#RRGGBB/#RRGGBBAA。',
      schema: { ref: Ref, color: z.string().describe('#RRGGBB 或 #RRGGBBAA') },
      target: 'scene',
      method: 'setColor',
      args: (a) => [a.ref, a.color],
    },
    {
      name: 'cocos_component_set_content_size',
      description: '设置节点 UITransform 的 ContentSize（宽高）。',
      schema: { ref: Ref, w: z.number(), h: z.number() },
      target: 'scene',
      method: 'setContentSize',
      args: (a) => [a.ref, a.w, a.h],
    },
    {
      name: 'cocos_composite_setup_widget',
      description:
        '配置 Widget 对齐：align="center" 整体居中；或传 top/bottom/left/right/horizontalCenter/verticalCenter 边距数值。',
      schema: {
        ref: Ref,
        align: z.enum(['center']).optional(),
        top: z.number().optional(),
        bottom: z.number().optional(),
        left: z.number().optional(),
        right: z.number().optional(),
        horizontalCenter: z.number().optional(),
        verticalCenter: z.number().optional(),
      },
      target: 'scene',
      method: 'setupWidget',
      args: (a) => [
        a.ref,
        {
          align: a.align,
          top: a.top,
          bottom: a.bottom,
          left: a.left,
          right: a.right,
          horizontalCenter: a.horizontalCenter,
          verticalCenter: a.verticalCenter,
        },
      ],
    },
  ]);

  server.registerTool(
    'cocos_component_set_spriteframe',
    {
      title: 'cocos_component_set_spriteframe',
      description:
        '设置 Sprite 的 SpriteFrame。输入可为：内置别名（default_sprite_splash / default_btn_normal）、资源 UUID、db:// 路径或图片资源名（自动解析 sprite-frame 子资源 UUID）。节点没有 Sprite 时自动添加。',
      annotations: {},
      inputSchema: {
        ref: Ref,
        spriteFrame: z.string().describe('内置别名 / UUID / db:// 路径 / 图片名'),
      },
    },
    async (args: any) =>
      runTool(async () => {
        const ref = args.spriteFrame;
        const isBuiltin = ref.startsWith('default_');
        let uuidOrAlias = ref;
        if (!isBuiltin) {
          const resolved = await rpc<{ uuid: string }>('main', 'resolveAsset', ref, 'sprite-frame');
          uuidOrAlias = resolved.uuid;
        }
        return await rpc('scene', 'setSpriteFrame', args.ref, uuidOrAlias);
      }),
  );
}
