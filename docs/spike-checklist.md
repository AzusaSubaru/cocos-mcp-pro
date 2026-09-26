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
| 1 | 扩展加载、HTTP + token、`temp/.cocos-mcp.json` | 文件存在，selftest 能连上 | ✓ 通过（端口/token 每次重启变化，脚本重读发现文件） |
| 2 | scene 脚本注册与 `execute-scene-script` 往返 | selftest scene 段有输出 | ✓ 通过 |
| 3 | 节点树遍历（含 UUID 字段） | `getHierarchy` 返回 Canvas 子树，节点带 uuid | ✓ 通过（节点 uuid 为压缩形式） |
| 4 | 创建节点 / 添加组件 / set-property | 层级管理器中真实出现节点与组件 | ✓ 通过（见下方消息核实表，消息必须在 scene 进程内发） |
| 5 | 四种值编码：Vec3 / Color / 资源 UUID（SpriteFrame 子资源）/ 节点引用 | 属性面板显示正确 | ✓ 通过（真机改色+换图+撤销重做验证） |
| 6 | 内置资源别名 `default_sprite_splash` / `default_btn_normal` | Sprite/Button 显示默认图 | ✓ 通过 |
| 7 | 用户脚本：`@ccclass` 解析、类注册校验、Node 槽位连线 | 脚本挂载成功，属性槽显示节点 | ✓ 通过（Node 槽→Title，组件槽→"确认"Label，预览运行时日志确认） |
| 8 | 撤销事务：一次 build_hierarchy = 一次 Ctrl+Z | 一次撤销整棵树消失；消息不存在则记录替代方案 | ✓ 通过（begin-recording auto:false 包裹，6 节点同生共死，原生菜单验证） |
| 9 | 保存场景，重开编辑器内容仍在 | 节点/组件持久化 | ✓ 通过（save-scene 落盘，重启后面板仍在） |
| 10 | 预览：拿到 URL，Playwright 截图 + console 日志；场景视图截图可行性结论 | screenshot_game 返回 PNG，preview_logs 有日志 | ✓ 通过（Playwright headless 截图正常、回收引擎日志、零页面错误；场景视图无截图 API，一律走浏览器预览） |

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
| 项目信息 | `project:query-project-info` | ✗ 不存在 → 读项目根 package.json + `Editor.App.version` |
| 场景查询 | `scene:query-scene` | ✗ 不存在 → `scene:query-current-scene`（返回场景 UUID） |
| 打开/保存/关闭场景 | `scene:open-scene` / `save-scene` / `close-scene` | ✓ 存在 |
| 撤销事务 | `scene:begin-operation` / `end-operation` / `cancel-operation` | ✗ 3.8.8 不存在 → `begin-recording` / `end-recording` / `cancel-recording` |
| 撤销 | `scene:undo` / `scene:redo` | ✓ 存在 |
| 资源查询 | `asset-db:query-assets` / `query-asset-info` | ✓ 存在（query-assets 收单对象 options，不接受位置字符串） |
| 资源刷新 | `asset-db:refresh-asset` | 待测 |
| 创建场景 | `asset-db:create-asset` | 待测 |
| 预览 | `preview:open` / `query-preview-url`（无 start/stop） | ✓ 实测通过；服务随编辑器生命周期 |
| 控制台广播 | `console:log` / `console:warn` / `console:error` | ✓ 监听已注册 |
| scene 脚本注册字段 | package.json `contributions.scene.script` | ✓ 生效 |
| 生命周期钩子 | main 导出 `onload` / `unload`（代码同时导出了 `onunload`/`load` 别名） | ✓ 生效 |

### 3.8.8 真机关键规律（踩坑记录）

1. **变更消息必须在 scene 进程内发送**：`create-component` / `set-property` 从 main 跨进程 rawMessage 调用会静默失败（返回 undefined/false）；scene 进程内 `Editor.Message.request('scene', ...)` 正常。scene 脚本已提供 `raw(name, ...args)` 透传。
2. **rawMessage 第三参数是参数数组**：`rawMessage(pkg, name, args[])`，漏包数组会把对象 spread 成位置参数，handler 收不到 options（表现为节点名被忽略、父节点失效）。
3. **节点 parent 只认压缩 UUID**（如 `fdQHPd/PdMZJVTvd2g4viv`），完整 36 位 UUID 实测失败。
4. **set-property 寻址**：`uuid` 传**节点** uuid，节点自身属性 `path: 'position'`，组件属性 `path: '__comps__.<组件索引>.<属性名>'`；dump 传 `{type, value}`。
5. **一次构建 = 一次撤销的正确姿势**：`begin-recording([目标uuids], {auto:false})` → 各 create-node/create-component/set-property（内部自动录制会合并进外层命令）→ `end-recording(id)`。
6. **死路**：direct 引擎 API（new Node/addChild/addComponent）不进撤销栈；`snapshot()` / 默认 auto recording 包裹 create-node 会导致新节点被销毁。
7. **资源引用**：`{__uuid__}` 占位对象不能直接赋给组件资源属性（setter 同步解引用即抛错），必须先 `assetManager.loadAny` 拿真实对象；SpriteFrame 子资源 UUID 带 `@f9941` 后缀。
8. **组件槽位连线**：组件类型属性（如 `@property({type: Label})`）的值是**目标组件实例自身的压缩 UUID**（运行时 `comp._id` / `comp.uuid`），不是节点 uuid；query-node dump 里内置组件的 `cid` 只是类型名（如 "cc.Label"），不能用作引用，必须从引擎 `targetNode.getComponent(type)._id` 取。
9. **预览**：3.8.8 无 `preview:start/stop`，打开用 `preview:open`，URL 用 `preview:query-preview-url`；场景视图没有截图 API，视觉核对一律走浏览器预览 + Playwright。

## 实测记录

- 测试机器：Windows 10 / Windows Server（西安）
- Cocos Creator 版本（精确到小版本）：**3.8.8**
- 日期：2026-09-23 ~ 2026-09-26
- 结果 / 修正记录：
  - selftest 首轮 6 项失败（消息名/参数形态差异），检索本机 app.asar 消息注册表后全部修正，第二轮起 **23 项全绿**。
  - UI 构建（面板+标题+两按钮，6 节点）真机成功，二次构建零 created（幂等），场景保存落盘。
  - 撤销攻克：确认 begin/end-operation 在 3.8.8 不存在；正确机制为 begin-recording({auto:false}) 消息事务；真机验证一次撤销整构建消失、重做完整恢复，用户原生菜单 Ctrl+Z / 编辑→重做均可用。
  - 用户脚本真机验证：SpikeController（Node 槽 + Label 组件槽）挂载零警告，一次撤销/重做整体生效；预览运行时日志 `[SpikeController] mounted, targetNode= Title targetLabel= 确认`。
  - 预览端到端：Playwright headless 截图 + console 回收全通。
  - **10 项验证点全部通过，阶段 0 Spike 完成。**
