# Cocos Creator 项目协作指南（cocos-mcp-pro）

> 本文件告诉 AI 助手：当前工作区是什么、可用哪些 MCP 工具、应按什么规则工作。
> 每次开始 Cocos 相关任务前先读完本文件。

## 1. 这是什么

- 当前工作区是一个 **Cocos Creator 3.8+** 游戏项目（项目根即工作区根）。
- 项目中安装了社区 MCP 服务 **cocos-mcp-pro**，它由两部分组成：
  1. **编辑器扩展** `cocos-mcp-bridge`（位于 `extensions/cocos-mcp-bridge/`），运行在 Cocos 的 main 进程和 scene 进程内；
  2. **MCP Server**（本地 node 进程，stdio 与本 AI 客户端通信），通过扩展以官方消息机制安全操作编辑器。
- 架构链路：**AI 客户端 ↔ MCP Server ↔ HTTP(127.0.0.1, Bearer token) ↔ 编辑器扩展 ↔ Cocos 引擎**。
- 扩展连接信息写在 `temp/.cocos-mcp.json`（端口/token 每次编辑器重启会变，由 server 自动重读，不要手写）。

## 2. 可用能力（MCP 工具，前缀 `cocos_`）

- **项目/场景**：`editor_get_project_info`、`scene_list`、`scene_current`、`scene_open`、`scene_save`、`scene_undo`、`scene_hierarchy`
- **节点**：`node_find`、`node_get_info`、`node_create`、`node_delete`、`node_rename`、`node_set_transform`
- **组件**：`component_add/remove/list`、`component_get_property/set_property`、`component_set_color`、`component_set_content_size`、`component_set_spriteframe`、`composite_setup_widget`
- **复合构建（优先使用）**：`builder_build_scene`、`composite_build_hierarchy`、`composite_create_label/create_sprite/create_button`、`composite_attach_script`、`composite_batch_set`
- **资源**：`asset_list/search/refresh`、`asset_create_folder/create_script/create_scene`
- **预览/诊断**：`editor_preview_run`、`editor_diagnostics`、`editor_preview_logs`、`view_screenshot_game`
- **校验**：`validate_references`、`validate_overlap`、`validate_layout`、`validate_full_audit`
- 另有知识资源 `cocos://knowledge`（坐标系与组件规则）。

## 3. 标准工作流

1. **了解环境**：`editor_get_project_info` + `scene_current` + `scene_hierarchy`，不要凭记忆假设节点存在。
2. **搭建/修改 UI**：优先用 `builder_build_scene` 或 `composite_build_hierarchy` **一次性声明式构建**（幂等、一次构建=一次撤销），避免连续堆大量单节点调用。
3. **涉及脚本**：创建或挂载脚本后，必须调用 `editor_diagnostics` 查编译错误，有错据错误信息修正后再继续。
4. **校验**：完成后 `validate_full_audit`（空引用、出画布、重叠等）。
5. **验证视觉效果**：`view_screenshot_game` 截图核对，必要时 `editor_preview_logs` 看运行时日志。
6. **持久化**：确认无误后 `scene_save`。

## 4. 必须遵守的规则

- **幂等优先**：同一构建可重复执行，已存在节点按名匹配更新，不得产生重复节点。
- **一次构建 = 一次撤销**：构建走消息事务（begin-recording…end-recording），用户一次 Ctrl+Z 即可整体回退；不要用绕过事务的方式逐个改。
- **坐标系**：UI 节点挂在 Canvas 下；原点在屏幕中心，x 向右、y 向上；默认设计分辨率 **960×640**（fitWidth）。
- **值编码**：
  - 向量 `cc.Vec3 {x,y,z}`、`cc.Vec2 {x,y}`、尺寸 `cc.Size {width,height}`、颜色 `cc.Color {r,g,b,a}`；
  - 枚举用数字（可先查 dump 的 enumList）；
  - 资源引用传资源 UUID，SpriteFrame 子资源 UUID 带 `@f9941` 后缀；
  - 节点槽位传**节点**压缩 UUID；**组件槽位传目标组件实例自身的 `_id`**（不是节点 UUID）。
- **内置 UI 资源别名**：`default_sprite_splash`、`default_btn_normal/pressed/disabled`，直接引用即可。
- **不编造 UUID/路径**：需要引用时先查层级；路径形如 `/Canvas/McpSpikePanel/OKButton`。

## 5. 限制与排错

- 使用期间 **Cocos Creator 必须保持打开且项目一致**；若连接失败，提示用户打开编辑器/启用扩展，不要反复重试。
- **场景视图没有截图 API**，所有视觉核对走浏览器预览（`view_screenshot_game`）。
- 预览服务随编辑器运行，无单独停止。
- 扩展若被 init 覆盖过文件，工具无响应时在 Cocos 扩展管理器里禁用→启用一次。
- 工具返回中文错误即为可诊断信息，按提示处理，不要把堆栈原样抛给用户。

## 6. 典型任务示例

- “读一下项目信息和当前场景层级”
- “在 Canvas 下建一个标题为 主菜单 的面板，含 开始游戏/设置 两个按钮，按钮点击先留空”
- “给开始按钮挂一个脚本，点击时打印 hello（先创建脚本再连按钮）”
- “预览并截图，检查有没有节点重叠或空引用”
- “把刚才的构建撤销 / 重做”
