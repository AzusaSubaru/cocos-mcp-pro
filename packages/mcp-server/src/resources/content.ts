export const KNOWLEDGE_RESOURCES = [
  {
    uri: 'cocos://knowledge/coordinate-system.md',
    name: 'Cocos UI 坐标系与分辨率规则',
    mimeType: 'text/markdown',
    text: `# Cocos Creator UI 坐标系与设计分辨率（3.8）

- Canvas 是 UI 根节点，原点在屏幕**中心**，x 向右为正、y 向上为正。左上角按钮的 y 是正数，底部按钮 y 是负数。
- 子节点坐标相对**父节点锚点**。父节点不是 (0,0) 时，子节点 position 不是屏幕坐标。
- UITransform.anchorPoint 默认 (0.5, 0.5)；contentSize 是节点矩形尺寸。
- 设计分辨率在 项目设置 里配置（如 720x1280）。fitWidth=true 时以宽度等比缩放，高度可能超出；fitHeight 反之。
- Widget 用于相对父节点四边/中心对齐。**配置 Widget 后 position 会被对齐覆盖**，二者不要同时依赖。
- 全屏背景：挂 Widget，top/bottom/left/right 全 0。
- Label/Sprite/Button 节点依赖 UITransform（添加组件时编辑器会自动补）。
- SpriteFrame 是图片资源的**子资源**：设置 spriteFrame 用的是 sprite-frame 子资源 UUID，不是图片/Texture2D 本身的 UUID。
- 内置资源别名：default_sprite_splash（白色块）、default_btn_normal（默认按钮底图）。
- 颜色用 #RRGGBB 或 #RRGGBBAA（AA 为透明度十六进制）。
`,
  },
  {
    uri: 'cocos://knowledge/ui-rules.md',
    name: 'UI 搭建与脚本连线规则',
    mimeType: 'text/markdown',
    text: `# UI 搭建与脚本连线规则

## 常见节点结构
- 按钮：Button 节点（UITransform + Sprite 底图 + Button 组件）+ 子节点 Label（UITransform + Label）。
- 图片：UITransform + Sprite，九宫格把 Sprite.Type 设为 SLICED(1) 并设置 Border。
- 文本：UITransform + Label，string 是文本内容，fontSize 字号。

## 脚本挂载与引用
- 用户脚本用 @ccclass('XxxScene') 注册类名；attach_script 的 className 必须与装饰器一致。
- 脚本未编译或有 TS 报错时类不会注册，挂载会报 SCRIPT_CLASS_NOT_FOUND；先跑 cocos_editor_diagnostics。
- @property(Node) 槽位连节点；@property(Label)/@property(Button) 槽位连目标节点上的对应组件。
- build_scene 的 refs：key 是属性名，value 是树内节点 id；id 只在 JSON 树内有效。
- 搭完场景流程：build_scene(save=true) → validate_full_audit → preview_run → screenshot_game / preview_logs → 修复 → save。

## 幂等
- build_hierarchy/build_scene 默认 onExists=upsert：同父子级下同名节点更新而不是重建。
- 需要两个同名节点时必须改不同 name。
- 一次构建 = 一次撤销（Ctrl+Z / cocos_scene_undo）。
`,
  },
];
