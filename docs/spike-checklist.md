# 阶段 0 真机 Spike 检查表

目标：在真实 Cocos Creator 3.8.x 项目中验证脚手架可用性。所有 ✗ 项修正 `packages/cocos-extension/src/adapter/messages.ts`（消息名）或对应 scene 脚本后重新构建验证。

## 执行方式

```powershell
pnpm run build
node packages/mcp-server/dist/index.js init "D:/你的Cocos项目"
# Cocos 中启用扩展（扩展管理器 → 项目 → cocos-mcp-bridge）
node packages/mcp-server/dist/index.js selftest --project "D:/你的Cocos项目"
```

selftest 输出分 main / scene 两段。把结果记录到本文档「实测记录」。

## 10 项验证点

| # | 验证点 | 期望 | 实测结果 |
|---|---|---|---|
| 1 | 扩展加载、HTTP + token、`temp/.cocos-mcp.json` | 文件存在，selftest 能连上 | 待测 |
| 2 | scene 脚本注册与 `execute-scene-script` 往返 | selftest scene 段有输出 | 待测 |
| 3 | 节点树遍历（含 UUID 字段） | `getHierarchy` 返回 Canvas 子树，节点带 uuid | 待测 |
| 4 | 创建节点 / 添加组件 / set-property | 层级管理器中真实出现节点与组件 | 待测 |
| 5 | 四种值编码：Vec3 / Color / 资源 UUID（SpriteFrame 子资源）/ 节点引用 | 属性面板显示正确 | 待测 |
| 6 | 内置资源别名 `default_sprite_splash` / `default_btn_normal` | Sprite/Button 显示默认图 | 待测 |
| 7 | 用户脚本：`@ccclass` 解析、类注册校验、Node 槽位连线 | 脚本挂载成功，属性槽显示节点 | 待测 |
| 8 | 撤销事务：一次 build_hierarchy = 一次 Ctrl+Z | 一次撤销整棵树消失；消息不存在则记录替代方案 | 待测 |
| 9 | 保存场景，重开编辑器内容仍在 | 节点/组件持久化 | 待测 |
| 10 | 预览：拿到 URL，Playwright 截图 + console 日志；场景视图截图可行性结论 | screenshot_game 返回 PNG，preview_logs 有日志 | 待测 |

## 重点手工验证（selftest 覆盖不到）

1. `cocos_builder_build_scene`：用 README 示例 JSON 构建，**连跑 3 次**节点不重复；
2. 构建中途给一个不存在的组件类名，确认场景不留半成品；
3. `validate_full_audit`：故意留空脚本引用、把按钮移出画布、两个按钮重叠，确认全部检出；
4. 关闭编辑器后调用工具，确认返回中文连接错误而非堆栈；
5. 菜单「扩展 → cocos-mcp → 打印连接信息」有输出。

## 待确认的编辑器内部消息（3.8.x）

selftest 已内置探测，结果回填：

| 能力 | 代码中的消息名 | 实测 |
|---|---|---|
| 项目信息 | `project:query-project-info` | 待测 |
| 场景查询 | `scene:query-scene` | 待测 |
| 打开/保存/关闭场景 | `scene:open-scene` / `save-scene` / `close-scene` | 待测 |
| 撤销事务 | `scene:begin-operation` / `end-operation` / `cancel-operation` | 待测 |
| 撤销 | `scene:undo` | 待测 |
| 资源查询 | `asset-db:query-assets` / `query-asset-info` | 待测 |
| 资源刷新 | `asset-db:refresh-asset` | 待测 |
| 创建场景 | `asset-db:create-asset` | 待测 |
| 预览 | `preview:start` / `stop` / `query-preview-url` | 待测 |
| 控制台广播 | `console:log` / `console:warn` / `console:error` | 待测 |
| scene 脚本注册字段 | package.json `contributions.scene.script` | 待测 |
| 生命周期钩子 | main 导出 `onload` / `unload`（代码同时导出了 `onunload`/`load` 别名） | 待测 |

## 实测记录

- 测试机器：
- Cocos Creator 版本（精确到小版本）：
- 日期：
- 结果 / 修正记录：
