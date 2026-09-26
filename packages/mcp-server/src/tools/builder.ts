import { validateBuildScene } from '@cocos-mcp/shared';
import { rpc, runTool, z } from './common.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

export function registerBuilderTools(server: McpServer) {
  server.registerTool(
    'cocos_builder_build_scene',
    {
      title: 'cocos_builder_build_scene',
      description:
        '【核心能力】从完整 JSON 描述幂等构建场景：schemaVersion=1，root 为节点树（支持 type 语法糖 Button/Label/Sprite、components、children、id 与 script.refs 连线）。可选 scene（自动切换场景）、design 设计分辨率、options.onExists(upsert|skip|fail)、options.save 构建后自动保存。同一 JSON 重复执行不会产生重复节点。',
      inputSchema: {
        input: z.any().describe('build_scene JSON，详见工具描述与设计文档第六章'),
      },
      annotations: {},
    },
    async (args: any) =>
      runTool(async () => {
        const v = validateBuildScene(args.input);
        if (!v.valid) {
          const err: any = new Error(`场景 JSON 校验失败：\n- ${v.issues.join('\n- ')}`);
          err.code = 'INVALID_PARAMS';
          throw err;
        }
        const data = v.data!;
        const warnings: string[] = [];

        if (data.scene) {
          // scene 参数支持：场景名 / db:// URL / 资源 UUID（统一在 listScenes 里解析）
          const want = String(data.scene);
          const cur = await rpc<any>('main', 'currentScene');
          const scenes = await rpc<Array<{ name: string; url: string; uuid?: string }>>('main', 'listScenes');
          const hit = scenes.find(
            (s) =>
              s.name === want ||
              s.url === want ||
              (!!s.uuid && want.toLowerCase() === String(s.uuid).toLowerCase()),
          );
          if (!hit) {
            // 目标不存在必须中止：静默落到当前场景构建会污染该场景
            const err: any = new Error(
              `目标场景不存在: ${want}（可用场景: ${scenes.map((s) => s.name).join('、')}）；已中止构建以避免污染当前场景 ${cur?.name ?? '?'}`,
            );
            err.code = 'SCENE_NOT_FOUND';
            throw err;
          }
          if (cur?.name !== hit.name) {
            await rpc('main', 'openScene', hit.url);
            warnings.push(`已切换到场景 ${hit.url}`);
          }
        }

        const options = {
          onExists: data.options?.onExists ?? 'upsert',
          transaction: data.options?.transaction ?? true,
        };
        const report = await rpc('scene', 'buildHierarchy', data.root, options);
        let saved = false;
        if (data.options?.save) {
          await rpc('main', 'saveScene');
          saved = true;
        }
        return { ...report, warnings: [...warnings, ...(report.warnings ?? [])], saved };
      }),
  );
}
