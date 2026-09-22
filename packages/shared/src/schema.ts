/**
 * build_scene / build_hierarchy 输入 schema（v1）
 * 见设计文档第六章。Server 端用它做不触达编辑器的前置校验。
 */
import { z } from 'zod';

export const BUILD_SCENE_SCHEMA_VERSION = 1;

export const Vec3Schema = z.object({
  x: z.number().optional(),
  y: z.number().optional(),
  z: z.number().optional(),
});

export const SizeSchema = z.object({
  w: z.number(),
  h: z.number(),
});

/** #RGB / #RGBA / #RRGGBB / #RRGGBBAA */
export const ColorStringSchema = z
  .string()
  .regex(/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/, {
    message: '颜色需为 #RGB/#RGBA/#RRGGBB/#RRGGBBAA 形式',
  });

/** 组件：字符串简写 "Canvas" 或带参数对象 { type, ... } */
export const ComponentSchema: z.ZodTypeAny = z.lazy(() =>
  z.union([
    z.string().transform((t) => ({ type: t })),
    z
      .object({ type: z.string() })
      .catchall(z.any())
      .refine((o) => typeof o.type === 'string' && o.type.length > 0, {
        message: '组件对象必须包含非空 type',
      }),
  ]),
);

export const LabelSpecSchema = z
  .object({
    text: z.string().optional(),
    fontSize: z.number().positive().optional(),
    color: ColorStringSchema.optional(),
    lineHeight: z.number().positive().optional(),
  })
  .strict();

export const NodeSchema: z.ZodTypeAny = z.lazy(() =>
  z
    .object({
      /** 树内稳定标识，用于 refs 连线与幂等寻址，不写入引擎 */
      id: z.string().optional(),
      /** 场景中的真实节点名 */
      name: z.string().min(1),
      /** 常用节点语法糖：Button / Label / Sprite / Node */
      type: z.string().optional(),
      active: z.boolean().optional(),
      position: Vec3Schema.optional(),
      rotation: Vec3Schema.optional(),
      scale: Vec3Schema.optional(),
      contentSize: SizeSchema.optional(),
      color: ColorStringSchema.optional(),
      components: z.array(ComponentSchema).optional(),
      children: z.array(NodeSchema).optional(),
      label: LabelSpecSchema.optional(),
      text: z.string().optional(),
      fontSize: z.number().positive().optional(),
      spriteFrame: z.string().optional(),
      /** 直接挂在该节点上的用户脚本（根节点常用，等价于 components 中带 refs 的脚本） */
      script: z
        .object({
          class: z.string().min(1),
          refs: z.record(z.string()).optional(),
        })
        .optional(),
    })
    .strict()
    .refine((n) => {
      const ids = new Set<string>();
      const walk = (node: any): boolean => {
        if (node.id) {
          if (ids.has(node.id)) return false;
          ids.add(node.id);
        }
        return !(node.children ?? []).some((c: any) => !walk(c));
      };
      return walk(n);
    }, '节点 id 在树内必须唯一'),
);

export const BuildOptionsSchema = z
  .object({
    /** 已存在节点的处理：upsert 更新 / skip 跳过 / fail 整体失败 */
    onExists: z.enum(['upsert', 'skip', 'fail']).default('upsert'),
    /** 是否用撤销事务包裹整次构建 */
    transaction: z.boolean().default(true),
    /** 成功后是否自动保存场景 */
    save: z.boolean().default(false),
    /** 挂载的父节点：UUID 或节点路径；默认当前场景根 */
    parent: z.string().optional(),
  })
  .strip();

export const BuildSceneInputSchema = z
  .object({
    schemaVersion: z.literal(1),
    /** 目标场景名（不含扩展名）；不传则构建到当前场景 */
    scene: z.string().optional(),
    design: z
      .object({
        w: z.number().positive(),
        h: z.number().positive(),
        fitWidth: z.boolean().optional(),
        fitHeight: z.boolean().optional(),
      })
      .optional(),
    options: BuildOptionsSchema.optional().default({}),
    root: NodeSchema,
  })
  .strict();

export type BuildSceneInput = z.infer<typeof BuildSceneInputSchema>;
export type NodeSpec = z.infer<typeof NodeSchema>;
export type ComponentSpec = z.infer<typeof ComponentSchema>;

export interface ValidationResult {
  valid: boolean;
  issues: string[];
  data?: BuildSceneInput;
}

export function validateBuildScene(input: unknown): ValidationResult {
  const parsed = BuildSceneInputSchema.safeParse(input);
  if (!parsed.success) {
    return {
      valid: false,
      issues: parsed.error.issues.map(
        (i) => `${i.path.join('.') || '(root)'}: ${i.message}`,
      ),
    };
  }
  const data = parsed.data as BuildSceneInput;

  // 跨字段校验：refs 必须指向树内存在的 id
  const issues: string[] = [];
  const ids = new Set<string>();
  const walk = (n: any) => {
    if (n.id) ids.add(n.id);
    (n.children ?? []).forEach(walk);
  };
  walk(data.root);
  const checkRefs = (n: any, path: string) => {
    if (n.script?.refs) {
      for (const [slot, target] of Object.entries(n.script.refs)) {
        if (!ids.has(target as string)) {
          issues.push(`${path}.script.refs.${slot} 指向了不存在的节点 id: ${target}`);
        }
      }
    }
    (n.children ?? []).forEach((c: any, i: number) =>
      checkRefs(c, `${path}.children[${i}]`),
    );
  };
  checkRefs(data.root, 'root');

  if (issues.length) return { valid: false, issues };
  return { valid: true, issues: [], data };
}
