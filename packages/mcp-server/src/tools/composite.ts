import { registerProxyTools, rpc, runTool, z } from './common.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

const Ref = z.string().describe('节点定位：UUID、/Canvas/路径 或唯一节点名');
const Vec3 = z.object({
  x: z.number().optional(),
  y: z.number().optional(),
  z: z.number().optional(),
});
const Size = z.object({ w: z.number(), h: z.number() });

export function registerCompositeTools(server: McpServer) {
  registerProxyTools(server, [
    {
      name: 'cocos_composite_attach_script',
      description:
        '给节点挂载用户脚本组件并连接引用槽位。className 为脚本 @ccclass 名；refs 的 key 是脚本 @property 名，value 是目标节点定位（优先用 build_hierarchy 返回的节点 UUID）。槽位类型不匹配会报错。',
      schema: {
        ref: Ref,
        className: z.string().describe("脚本 @ccclass 名，如 'ShootScene'"),
        refs: z.record(z.string()).optional().describe('属性槽位 → 目标节点'),
      },
      target: 'scene',
      method: 'attachScript',
      args: (a) => [a.ref, a.className, a.refs ?? {}],
    },
    {
      name: 'cocos_composite_batch_set',
      description: '一次事务内批量设置多个属性，避免多次调用与多次撤销记录。',
      schema: {
        ops: z
          .array(
            z.object({
              node: z.string(),
              component: z.string().nullable().optional(),
              property: z.string(),
              value: z.any(),
            }),
          )
          .min(1),
      },
      target: 'scene',
      method: 'batchSet',
      args: (a) => [a.ops],
    },
  ]);

  const hierarchyOptions = z
    .object({
      onExists: z.enum(['upsert', 'skip', 'fail']).optional(),
      parent: Ref.optional().describe('挂载父节点；不传为场景根'),
    })
    .optional();

  server.registerTool(
    'cocos_composite_create_label',
    {
      title: 'cocos_composite_create_label',
      description: '一键创建 Label 节点（文本、字号、颜色、位置、尺寸）。',
      annotations: {},
      inputSchema: {
        parent: Ref.optional(),
        name: z.string().default('Label'),
        text: z.string().default(''),
        fontSize: z.number().optional(),
        color: z.string().optional(),
        position: Vec3.optional(),
        contentSize: Size.optional(),
      },
    },
    async (a: any) =>
      runTool(() =>
        rpc('scene', 'buildHierarchy', {
          name: a.name,
          type: 'Label',
          text: a.text,
          fontSize: a.fontSize,
          color: a.color,
          position: a.position,
          contentSize: a.contentSize,
        }, { onExists: 'upsert', parent: a.parent }),
      ),
  );

  server.registerTool(
    'cocos_composite_create_sprite',
    {
      title: 'cocos_composite_create_sprite',
      description: '一键创建 Sprite 节点（SpriteFrame 别名/路径、颜色、是否九宫格、尺寸、位置）。',
      annotations: {},
      inputSchema: {
        parent: Ref.optional(),
        name: z.string().default('Sprite'),
        spriteFrame: z.string().optional().describe('默认 default_sprite_splash'),
        color: z.string().optional(),
        sliced: z.boolean().optional().describe('是否九宫格 SLICED'),
        position: Vec3.optional(),
        contentSize: Size.optional(),
      },
    },
    async (a: any) =>
      runTool(async () => {
        let frame = a.spriteFrame;
        if (frame && !frame.startsWith('default_')) {
          const r = await rpc<{ uuid: string }>('main', 'resolveAsset', frame, 'sprite-frame');
          frame = r.uuid;
        }
        return rpc(
          'scene',
          'buildHierarchy',
          {
            name: a.name,
            type: 'Sprite',
            spriteFrame: frame ?? 'default_sprite_splash',
            color: a.color,
            sliced: a.sliced,
            position: a.position,
            contentSize: a.contentSize,
          },
          { onExists: 'upsert', parent: a.parent },
        );
      }),
  );

  server.registerTool(
    'cocos_composite_create_button',
    {
      title: 'cocos_composite_create_button',
      description: '一键创建 Button 节点（默认按钮底图 + 内置 Label 子节点 + 尺寸位置）。',
      annotations: {},
      inputSchema: {
        parent: Ref.optional(),
        name: z.string().default('Button'),
        text: z.string().default('Button'),
        fontSize: z.number().optional(),
        position: Vec3.optional(),
        contentSize: Size.optional(),
      },
    },
    async (a: any) =>
      runTool(() =>
        rpc(
          'scene',
          'buildHierarchy',
          {
            name: a.name,
            type: 'Button',
            label: { text: a.text, fontSize: a.fontSize },
            position: a.position,
            contentSize: a.contentSize,
          },
          { onExists: 'upsert', parent: a.parent },
        ),
      ),
  );

  server.registerTool(
    'cocos_composite_build_hierarchy',
    {
      title: 'cocos_composite_build_hierarchy',
      description:
        '从 JSON 树幂等构建节点子树（单事务、可一次撤销、失败不留半成品）。节点字段：name/type(Button|Label|Sprite)/components/position/rotation/scale/contentSize/color/children/id/script。重名节点按 upsert 更新而非重复创建。',
      annotations: {},
      inputSchema: {
        spec: z.any().describe('节点树 JSON（schemaVersion 不需要，build_scene 才需要）'),
        options: hierarchyOptions,
      },
    },
    async (a: any) =>
      runTool(() =>
        rpc('scene', 'buildHierarchy', a.spec, {
          onExists: a.options?.onExists ?? 'upsert',
          parent: a.options?.parent,
        }),
      ),
  );
}
