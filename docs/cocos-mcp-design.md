# Cocos Creator MCP Server - 设计方案

> 本文档是给 AI 助手（豆包 / TRAE / Cursor / Claude 等）参考的实现方案，也是本项目的开发纲领。
> **2026-09-22 v2 修订**
>
> ：根据第一轮评审重构。核心变化：
> 明确扩展端是 
>
> **main + scene 两个引擎进程**
>
> ，补上 scene 脚本层；
> 区分两条 HTTP 通道，增加端口自动发现与本地安全（token）设计；
> build_scene 增加幂等、事务、回滚设计与 schema 版本号；
> 路线图增加
>
> **阶段 0 真机 Spike**
>
> ，先验证逆向 API 再铺工具量；
> 砍掉不切实际的承诺（Linux CI、一键安装、100 工具数量目标），改为以 "真机闭环可用" 为验收标准；
> 定位调整为
>
> **社区开源项目**
>
> （非官方）。

## 〇、第一原则：可用优先

这个项目不追求工具最多、架构最优雅，只追求一件事：**AI 在真实 Cocos Creator 3.8 项目里能稳定地把场景搭出来、跑起来、自己看到错误并修好。**



1. **闭环优先于覆盖面**：先打通 "读项目 → 搭场景 → 挂脚本连引用 → 校验 → 保存 → 预览 → 看日志 / 截图 → 修复" 完整闭环，再横向加工具。

2. **每个工具必须真机验证**：M1（首个可用版本）中的每个工具至少有一个在真实 Cocos 3.8 编辑器上跑通的测试记录，不允许 "代码写了但没在编辑器里试过" 的工具进入发布版。

3. **工具数量克制**：总数控制在 80 个以内。能用一个带完整 schema 的工具表达的，不拆三个工具（如 position/rotation/scale 合并为 `set_transform`）。

4. **失败必须让人看懂**：扩展没装、编辑器没开、场景没保存、类名不存在、UUID 解析失败，都要有结构化错误和中文修复提示，不允许裸异常。

5. **先垂直后水平**：用一个真实游戏项目（photographer-game）的三个场景做狗食验证，跑通后再谈覆盖 80% 编辑器操作。

## 一、项目定位

**项目名**：`cocos-mcp-pro`（暂定；开工前必须在 npm 核实名称可用性，备选 `cocos-creator-mcp-server`）

**一句话定位**：开源、跨 AI 客户端的 Cocos Creator 社区 MCP 服务器，让 AI 能直接操控 Cocos 编辑器搭建场景、管理资源、预览验证。

**法律定位**：本项目是**社区项目**，与厦门雅基软件（Cocos 官方）无隶属关系。Cocos、Cocos Creator 是其商标，README 中使用 "社区（community）" 表述，不使用 "官方补充 / 官方推荐" 字样；未来如获得官方授权再调整。

**与现有方案的差异（发版前需逐个实测核实，不做无法验证的攻击性对比）**：



| 维度   | 本项目的选择                                                      |
| ---- | ----------------------------------------------------------- |
| 协议   | 纯 MCP 标准协议（stdio 优先，Streamable HTTP 可选），不绑定任何 AI 客户端        |
| 开源   | MIT，扩展与 Server 全部开源                                         |
| 核心能力 | JSON 一键建场景（build\_scene）+ 场景校验（validate）+ 预览日志回流，形成 AI 自修闭环 |
| 文档   | 中文优先，含真实项目实战菜谱                                              |
| 工具规模 | 约 80 个，宁少勿滥，每个真机验证                                          |
| 兼容   | 明确声明测试过的 Cocos 3.8.x 小版本，不承诺未测版本                            |

> 竞品（官方商店版、harady-cocos-creator-mcp、cocos-meta-mcp、cocos-mcp 等）的工具数、更新时间、功能对比，只在发版前实测后写入 README；本设计文档不固化可能过时的对比数据。

## 二、总体架构

### 2.1 三进程模型（重要修正）

Cocos Creator 3.8 中，**main 进程碰不到场景节点**，节点与组件 API 只在 scene 脚本中可用。因此实际是三个执行环境：



```
┌───────────────────────────────────────────────┐

│  AI 客户端（TRAE / Cursor / Claude / Cline）  │

└───────────────┬───────────────────────────────┘

&#x20;               │ ① MCP 协议：stdio（默认）或 Streamable HTTP

&#x20;               ▼

┌───────────────────────────────────────────────┐

│  MCP Server（独立 Node 进程，TypeScript）      │

│  - MCP 协议层、工具 schema、参数校验           │

│  - 复合编排、build\_scene 解析、validate 规则   │

│  - 知识库 resources、错误双语化                │

│  - Playwright sidecar（预览截图/日志回流）     │

└───────────────┬───────────────────────────────┘

&#x20;               │ ② 控制通道：HTTP + Bearer Token

&#x20;               │    http://127.0.0.1:<随机端口>

&#x20;               ▼

┌───────────────────────────────────────────────┐

│  Cocos 扩展 main 进程（编辑器内，Node 环境）   │

│  - HTTP server、token 校验、端口发现文件       │

│  - asset-db / project / builder / preview 消息│

└───────────────┬───────────────────────────────┘

&#x20;               │ ③ Editor.Message: scene:execute-scene-script

&#x20;               ▼

┌───────────────────────────────────────────────┐

│  Cocos 扩展 scene 脚本（场景渲染进程，引擎环境）│

│  - require('cc')：节点树遍历、增删改、组件操作 │

│  - build\_scene 批量执行器、validate 几何计算   │

│  - 撤销事务包裹、失败回滚                      │

└───────────────────────────────────────────────┘
```

### 2.2 职责切分（修正 "扩展只做薄桥接" 的错误前提）



* **MCP Server 负责 "脑子"**：协议、schema、JSON 解析、参数校验、复合编排、知识库、diff、与 AI 的错误沟通。

* **扩展 main 负责 "资源与编辑器"**：资源数据库、项目信息、预览 / 构建、控制台、HTTP 服务。

* **扩展 scene 脚本负责 "引擎执行"**：所有节点 / 组件操作、批量构建、几何校验。build\_hierarchy/build\_scene 的 JSON 树**一次性下发给 scene 脚本执行**，不在 Server 端拆成几十次 HTTP 往返。

### 2.3 两条通道，端口不能混用



| 通道       | 用途                    | 端口                                            |
| -------- | --------------------- | --------------------------------------------- |
| ② 控制通道   | MCP Server → Cocos 扩展 | 扩展启动时**随机选取**，写入端口发现文件                        |
| ① MCP 传输 | AI 客户端 → MCP Server   | stdio 不占端口；Streamable HTTP 固定默认端口（如 9118，可配置） |

**默认推荐 stdio**：TRAE / Claude Code / Cline 均走 stdio，最稳定，不涉及 OAuth 与端口暴露；Streamable HTTP 仅为 Cursor 等显式需要 HTTP 的客户端提供（注意：旧的 HTTP+SSE 传输已被 MCP 规范废弃，必须实现 Streamable HTTP）。

### 2.4 端口发现与连接流程



1. 编辑器启动扩展，main 进程随机选可用端口监听，将以下信息写入**项目目录下** `temp/.cocos-mcp.json`（temp 目录默认被 gitignore）：



```
{

&#x20; "port": 52341,

&#x20; "token": "随机32字节hex",

&#x20; "pid": 12345,

&#x20; "cocosVersion": "3.8.6",

&#x20; "projectPath": "D:/photographer-game",

&#x20; "startedAt": "2026-09-22T10:00:00+08:00"

}
```



1. MCP Server 启动时按以下顺序定位项目：`--project` 参数 > `COCOS_MCP_PROJECT` 环境变量 > 当前工作目录（AI 客户端通常以项目根为 cwd 启动）。

2. 读取发现文件 → 对端口做健康检查（`GET /health` 带 token）→ 校验 pid 存活与 projectPath 一致。

3. 找不到文件 / 健康检查失败时，**不崩溃**，工具调用返回结构化错误：" 未检测到 Cocos 编辑器或桥接扩展未安装，是否已执行 `npx cocos-mcp-pro init`？"。

4. 同一项目多开编辑器为 v1.1 再支持（发现文件升级为 `temp/.cocos-mcp/ports-<pid>.json` 目录形式）；v1.0 检测到旧文件且健康检查失败时直接覆盖。

### 2.5 本地安全设计（必做，不是可选项）

控制通道具备等效本地代码执行能力（尤其 execute-script），裸奔 HTTP 等于给任意网页和本地进程留门：



1. **仅绑定 127.0.0.1**，不监听 0.0.0.0；

2. **每会话随机 token**：所有请求必须带 `Authorization: Bearer <token>`，token 只通过项目 temp 文件传递，不进日志；

3. **利用 CORS 预检拦截浏览器表单攻击**：自定义 Authorization 头会触发预检，服务端对跨域预检一律不放行；同时校验 `Origin`，非空且非本地的来源拒绝；

4. `execute_script`（任意场景脚本执行）通过扩展配置开关控制，**默认关闭**；

5. 控制通道只接受 JSON POST（`Content-Type: application/json`），拒绝其他类型；

6. README 安全章节如实说明：该扩展可操控你的项目文件，仅在受信任网络环境使用。

## 三、Cocos 扩展端设计（技术核心）

### 3.1 扩展内目录与注册



* `package.json`：


  * `main` 指向编译后的 main；

  * `contributions.scene.script` 注册 scene 脚本（3.8 的确切字段名以 Spike 实测为准）；

  * `contributions.messages` 声明生命周期钩子（onload 启 HTTP、onunload 关 HTTP）。

* scene 脚本通过 `exports.methods = { ... }` 暴露方法，由 main 进程调用：



```
// main 进程

await Editor.Message.request('scene', 'execute-scene-script', {

&#x20; name: '<扩展名>',

&#x20; method: 'buildHierarchy',

&#x20; args: \[jsonTree, options],

});
```

### 3.2 属性赋值的四种值编码（最大技术风险点）

`set_property` 看起来是一个工具，实际要正确处理四类值，Spike 阶段必须各跑通一个：



| 值类型       | 例子                                       | 编码方式                                                                                                                |
| --------- | ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| 基础值 / 枚举  | string, number, boolean, enum 数字         | 直接传值                                                                                                                |
| 引擎值类型     | Vec2 / Vec3 / Color / Size               | 传纯对象 `{x,y,z}` / `{r,g,b,a}`，scene 端构造                                                                              |
| 资源引用      | SpriteFrame、Prefab、AudioClip             | 传**资源 UUID**；SpriteFrame 注意是 texture 的**子资源 UUID**（asset-db 查 `subAssets` 中 type 为 `sprite-frame` 的条目），不是图片本身的 UUID |
| 节点 / 组件引用 | `@property(Node) btn`、`@property(Label)` | 传目标节点在场景中的 **UUID**；组件引用传组件所在节点 UUID + 组件类型                                                                         |

scene 端对每种目标属性先读 `CCClass` 属性类型再决定编码，类型不匹配时返回 "属性 X 期望 Node 引用，实际收到数字" 这类明确错误。

### 3.3 内置资源别名

AI 无法记住内置资源 UUID。扩展维护一张内置别名表（如 `default_sprite_splash`、`default_btn_normal` 等），scene 端将别名解析为引擎内置资源。别名表在 Spike 中从真机项目导出并固化，覆盖不到的返回可用内置资源列表。

### 3.4 用户脚本类名解析与引用连线（attach\_script）



1. 脚本资源通过 asset-db 定位；类名以源码中 `@ccclass('Xxx')` 装饰器为准，用正则 / 轻量解析提取，**不做完整 TS 编译**；

2. scene 端用 `cc.js.getClassByName(name)` 验证类已注册（脚本已编译），未注册则返回 "脚本未编译或存在编译错误"，并附带 `diagnostics` 结果；

3. 读类的属性装饰器元数据，得到每个 `@property` 的槽位类型（Node / Label / Sprite / 自定义组件 / 资源）；

4. 连线时按类型校验：槽位要 Node 不能传 SpriteFrame，槽位要 `SubjectController` 不能传无关节点。校验失败列出每个不匹配槽位，这是 validate\_references 的数据基础。

### 3.5 撤销事务与失败回滚



* build\_hierarchy /build\_scene/ 批量操作整体用场景操作事务包裹（`scene:begin-operation` / `end-operation`，确切消息名 Spike 验证），保证**一次构建 = 一次 Ctrl+Z**；

* 执行策略：先在一个临时隐藏父节点下构建整棵树 → 逐节点校验通过 → 挂载到目标位置并删除临时节点；

* 任一步失败：销毁临时父节点、`cancel-operation`（若存在）、返回失败发生在 JSON 树中的**节点路径与原因**，场景不留半成品。

### 3.6 上下文守卫

所有 scene 类工具执行前检查当前上下文：



* 当前是否有打开的场景（无则提示先 open）；

* 是否处于预制体编辑模式（prefab stage）。对场景级工具（open/save/build\_scene）在预制体模式下直接拒绝并提示退出；预制体工具仅在预制体模式或显式指定预制体资源时生效；

* 当前场景是否有未保存修改（破坏性操作前在返回结果中携带 dirty 标记与提示）。

### 3.7 预览与日志 / 截图回流（差异化闭环）



1. `preview_run` 通过编辑器预览消息启动浏览器预览，扩展返回预览 URL（含本地 token 参数）；

2. **MCP Server 端 Playwright sidecar** 连接该 URL：收集 `console.log`、`window.onerror`、未处理 Promise 错误、页面崩溃，通过 `preview_logs` 工具返回；`screenshot_game` 由 Playwright 截图（可靠，列入 M1）；

3. 脚本编译错误：扩展监听控制台 / 编译广播（确切频道名 Spike 验证），聚合为 `diagnostics` 工具，create\_script /attach\_script 后 AI 可立即自查；

4. 场景编辑器视图截图（`screenshot_scene`）依赖编辑器内部截图能力，**Spake 验证不可行则降级为只提供游戏预览截图**，不阻塞发布。

### 3.8 编辑器消息清单（Spike 核实表）

以下消息名为 3.x 已知 / 历史名称，**全部以 3.8 真机实测为准**，验证结果回填本表；所有消息调用收敛在扩展的适配层，版本差异只改一处：



| 能力                  | 拟用消息 / API                                                                                                         | 状态  |
| ------------------- | ------------------------------------------------------------------------------------------------------------------ | --- |
| 项目信息 / 编辑器版本        | `project:query-project-info`、`Editor.App.version`                                                                  | 待验证 |
| 打开 / 保存 / 关闭场景      | `scene:open-scene` / `save-scene` / `close-scene`                                                                  | 待验证 |
| 节点树查询               | scene 脚本内遍历 `director.getScene()`（最可靠）                                                                             | 待验证 |
| 节点 / 组件增删改          | `scene:create-node` / `create-component` / `set-property` / `delete-node` / `move-node`                            | 待验证 |
| 撤销事务                | `scene:begin-operation` / `end-operation` / `cancel-operation`                                                     | 待验证 |
| 资源查询 / 创建 / 导入 / 刷新 | `asset-db:query-assets` / `query-asset-info` / `create-asset` / `import-assets` / `refresh-asset` / `delete-asset` | 待验证 |
| 预览启停                | preview 相关消息（频道名待确认）                                                                                               | 待验证 |
| 构建                  | `builder:build` + 构建状态广播（长任务）                                                                                      | 待验证 |
| 控制台 / 编译诊断          | console 广播（频道名待确认）                                                                                                 | 待验证 |

> 这些是编辑器内部消息，无官方稳定性承诺。适配层按 Cocos 小版本号分流，README 只声明实测通过的版本。

## 四、MCP Server 设计

### 4.1 传输与部署



* stdio：`StdioServerTransport`，AI 客户端以子进程方式启动，默认模式；

* HTTP：`StreamableHTTPServerTransport`，独立子命令 `cocos-mcp-pro --http` 启动，端口可配；

* 两种传输共用同一套工具注册与控制通道客户端。

### 4.2 工具注解（annotations）

注册时声明 MCP 工具注解，让客户端能自动加确认 / 只读标识：



* 查询类（hierarchy /get\_info/list /search/validate /capture/logs）：`readOnlyHint: true`；

* 删除类（node\_delete /asset\_delete/prefab\_revert）：`destructiveHint: true`；

* 构建发布（editor\_build）：`destructiveHint` + 长任务模式（返回 taskId，配合 progress 查询 / 流式通知，不做普通请求 - 响应）。

### 4.3 统一错误结构



```
{

&#x20; "code": "SCRIPT\_CLASS\_NOT\_FOUND",

&#x20; "message\_zh": "脚本类 SubjectController 未注册，可能未编译或有编译错误",

&#x20; "message\_en": "Script class 'SubjectController' is not registered. It may be uncompiled or have compile errors.",

&#x20; "hint\_zh": "请先运行 cocos\_editor\_diagnostics 查看编译错误，或刷新资源数据库",

&#x20; "recoverable": true,

&#x20; "details": {}

}
```

### 4.4 知识库不做工具，做 resources + description 嵌入

原设计中 6 个 `cocos_knowledge_*` 工具取消（模型经常想不起来调用）：



* 坐标系、锚点、设计分辨率、常见布局模式等静态知识打包为 MCP resources（`cocos://knowledge/coordinate-system.md` 等）；

* **最关键的规则直接写进相关工具的 description**（模型必读），例如 set\_transform 里说明 UI 节点坐标相对父节点、Widget 与 position 的相互影响；

* 工具 description 以中文为主，关键引擎类名保留英文术语（如 UITransform、SpriteFrame、contentSize），便于跨语言模型匹配。

## 五、工具清单（按阶段标注）

阶段定义见第十一章。M1 = 首个可用版本必做（约 45 个，全部围绕搭建 - 预览 - 修复闭环）；M2 = v1.0 完整版；Later = v1.x 视需求。

### 5.1 场景管理 cocos\_scene



| 工具                           | 阶段 | 说明                         |
| ---------------------------- | -- | -------------------------- |
| `cocos_scene_list`           | M1 | 列出所有 .scene                |
| `cocos_scene_open`           | M1 | 打开场景（db:// 路径或 UUID）       |
| `cocos_scene_save`           | M1 | 保存当前场景                     |
| `cocos_scene_current`        | M1 | 当前场景名 + UUID + dirty 状态    |
| `cocos_scene_hierarchy`      | M1 | 节点树（深度限制、可选带组件摘要）          |
| `cocos_scene_undo`           | M1 | 撤销（事务失败时 AI 可主动回退）         |
| `cocos_scene_close`          | M2 | 关闭场景                       |
| `cocos_scene_execute_script` | M2 | 执行自定义场景脚本，**默认关闭**，需扩展配置开启 |

### 5.2 节点操作 cocos\_node（合并同类项后 12 → 11）



| 工具                             | 阶段 | 说明                                          |
| ------------------------------ | -- | ------------------------------------------- |
| `cocos_node_find`              | M1 | 按路径 / UUID / 名称查找                           |
| `cocos_node_create`            | M1 | 创建节点（父节点 + 名字 + 可选内置类型）                     |
| `cocos_node_delete`            | M1 | 删除节点（destructive）                           |
| `cocos_node_rename`            | M1 | 重命名                                         |
| `cocos_node_get_info`          | M1 | 完整信息（transform / 组件 / 子节点 / UUID）           |
| `cocos_node_set_transform`     | M1 | **合并** position/rotation/scale，字段可选，一次调用改多项 |
| `cocos_node_duplicate`         | M2 | 复制                                          |
| `cocos_node_move`              | M2 | 移动到新父节点（保持世界坐标可选），吸收 set\_parent            |
| `cocos_node_set_active`        | M2 | 激活状态                                        |
| `cocos_node_set_sibling_index` | M2 | 兄弟顺序                                        |
| `cocos_node_find_by_component` | M2 | 按组件类型查找                                     |

### 5.3 组件管理 cocos\_component



| 工具                                 | 阶段 | 说明                                       |
| ---------------------------------- | -- | ---------------------------------------- |
| `cocos_component_add`              | M1 | 按 cc 类名添加组件                              |
| `cocos_component_remove`           | M1 | 移除组件（destructive）                        |
| `cocos_component_list`             | M1 | 列出节点全部组件及启用状态                            |
| `cocos_component_get_property`     | M1 | 读属性（验证闭环用）                               |
| `cocos_component_set_property`     | M1 | 通用属性设置（四种值编码，见 3.2）                      |
| `cocos_component_set_spriteframe`  | M1 | 设置 SpriteFrame（内置别名或资源路径，自动解析子资源 UUID）   |
| `cocos_component_set_color`        | M1 | 设置 Color（含 Alpha，接受 #RRGGBB / #RRGGBBAA） |
| `cocos_component_set_content_size` | M1 | 设置 UITransform contentSize               |
| `cocos_component_configure_click`  | M2 | 配置 Button ClickEvent 绑定脚本方法              |

### 5.4 UI 复合操作 cocos\_composite（create\_image 并入 create\_sprite）



| 工具                                | 阶段 | 说明                                                         |
| --------------------------------- | -- | ---------------------------------------------------------- |
| `cocos_composite_create_label`    | M1 | 文本 + 字号 + 颜色 + 位置 + 尺寸                                     |
| `cocos_composite_create_sprite`   | M1 | SpriteFrame + Color + Size + 位置 + 九宫格参数（吸收原 create\_image） |
| `cocos_composite_create_button`   | M1 | Button 节点 + Label 子节点 + 尺寸 + 位置                            |
| `cocos_composite_setup_widget`    | M1 | 一次配置 Widget 四方向对齐与边距                                       |
| `cocos_composite_attach_script`   | M1 | 挂用户脚本 + 按类型校验并连接引用槽位                                       |
| `cocos_composite_batch_set`       | M1 | 一次调用对多节点设多属性（单事务）                                          |
| `cocos_composite_build_hierarchy` | M1 | 从 JSON 树一键建整棵节点树（幂等，见第六章）                                  |

### 5.5 资源管理 cocos\_asset



| 工具                                     | 阶段 | 说明                        |
| -------------------------------------- | -- | ------------------------- |
| `cocos_asset_list`                     | M1 | 列目录资源                     |
| `cocos_asset_search`                   | M1 | 按名称 / 类型搜索                |
| `cocos_asset_create_folder`            | M1 | 建文件夹                      |
| `cocos_asset_create_scene`             | M1 | 建场景文件                     |
| `cocos_asset_create_script`            | M1 | 建 .ts 脚本（带类名模板）           |
| `cocos_asset_refresh`                  | M1 | 刷新资源数据库                   |
| `cocos_asset_create_prefab`            | M2 | 从节点创建预制体资源                |
| `cocos_asset_copy` / `move` / `delete` | M2 | 复制 / 移动 / 删除（destructive） |
| `cocos_asset_import`                   | M2 | 导入外部文件                    |
| `cocos_asset_get_meta`                 | M2 | 读 .meta                   |

### 5.6 预制体 cocos\_prefab（整体 M2）

`instantiate` / `create_from_node` / `enter_edit` / `exit_edit` / `apply` / `revert` / `list` / `override` 共 8 个，均为 M2；实现时复用场景工具的上下文守卫。

### 5.7 编辑器控制 cocos\_editor（新增日志与诊断）



| 工具                                          | 阶段    | 说明                            |
| ------------------------------------------- | ----- | ----------------------------- |
| `cocos_editor_get_project_info`             | M1    | 路径 / Cocos 版本 / 项目名 / 设计分辨率   |
| `cocos_editor_preview_run`                  | M1    | 启动预览，返回预览 URL                 |
| `cocos_editor_preview_stop`                 | M1    | 停止预览                          |
| `cocos_editor_preview_logs`                 | M1    | **新增**：Playwright 回流的运行时日志与报错 |
| `cocos_editor_diagnostics`                  | M1    | **新增**：脚本编译错误 / 控制台错误聚合       |
| `cocos_editor_console_messages`             | M2    | 完整控制台历史                       |
| `cocos_editor_build`                        | M2    | 构建发布（长任务 + 进度查询，微信 / 抖音 / H5） |
| `cocos_editor_get_settings` / `set_setting` | M2    | 项目设置读写                        |
| `cocos_editor_refresh` / `open_panel`       | Later |                               |

### 5.8 视图控制 cocos\_view（收缩）



| 工具                                                   | 阶段    | 说明                                     |
| ---------------------------------------------------- | ----- | -------------------------------------- |
| `cocos_view_screenshot_game`                         | M1    | Playwright 游戏预览截图（可靠）                  |
| `cocos_view_focus_node`                              | M1    | 场景视图聚焦节点                               |
| `cocos_view_screenshot_scene`                        | M1\*  | 编辑器场景视图截图；\* 依赖 Spike 结论，不可行则转 M2 / 砍掉 |
| `cocos_view_toggle_2d_3d` / `set_gizmo` / `set_grid` | M2    |                                        |
| `cocos_view_set_reference_image` / `clear_reference` | Later | 设计稿叠层                                  |

### 5.9 场景校验 cocos\_validate



| 工具                          | 阶段 | 说明                                                                 |
| --------------------------- | -- | ------------------------------------------------------------------ |
| `cocos_validate_references` | M1 | 脚本槽位空引用检查（防运行时 NPE）                                                |
| `cocos_validate_layout`     | M1 | 节点是否超出设计分辨率（含 Widget 判定）                                           |
| `cocos_validate_overlap`    | M1 | 可交互节点世界 AABB 重叠检查（scene 端按 UITransform + 锚点 + scale + rotation 计算） |
| `cocos_validate_full_audit` | M1 | 汇总以上 + 报告 + 自动修复建议                                                 |
| `cocos_validate_hierarchy`  | M2 | 重名 / 层级过深 / 孤立节点                                                   |

### 5.10 场景快照 cocos\_capture（整体 M2）

`capture_scene_json` / `capture_node_json` 为 diff 与 patch 提供基础；M1 的幂等查询由 hierarchy 承担。

### 5.11 模板系统 cocos\_template（整体 Later，v1.x）

build\_scene 的 JSON 示例 + 菜谱已覆盖大部分模板价值，v1.0 不做模板 CRUD，避免维护两套建场景范式。

### 5.12 场景构建 cocos\_builder



| 工具                          | 阶段 | 说明                             |
| --------------------------- | -- | ------------------------------ |
| `cocos_builder_build_scene` | M1 | JSON → 完整场景，幂等 + 事务 + 回滚（见第六章） |
| `cocos_builder_diff_scenes` | M2 | 两个场景 JSON 差异                   |
| `cocos_builder_apply_patch` | M2 | JSON 补丁增量改场景                   |

**M1 合计约 45 个工具；M2 后总数控制在 80 个以内。**

## 六、build\_scene 详细设计（核心差异化能力）

### 6.1 输入 schema（v1）



```
{

&#x20; "schemaVersion": 1,

&#x20; "scene": "Shoot",

&#x20; "design": {"w": 720, "h": 1280, "fitWidth": true},

&#x20; "options": {

&#x20;   "onExists": "upsert",

&#x20;   "transaction": true,

&#x20;   "save": true

&#x20; },

&#x20; "root": {

&#x20;   "id": "canvas",

&#x20;   "name": "Canvas",

&#x20;   "components": \[

&#x20;     "Canvas",

&#x20;     {"type": "Widget", "align": "center"}

&#x20;   ],

&#x20;   "children": \[

&#x20;     {

&#x20;       "id": "background",

&#x20;       "name": "backgroundSprite",

&#x20;       "components": \[

&#x20;         {"type": "Sprite", "spriteFrame": "default\_sprite\_splash", "color": "#333333"}

&#x20;       ],

&#x20;       "contentSize": {"w": 720, "h": 1280},

&#x20;       "position": {"x": 0, "y": 0}

&#x20;     },

&#x20;     {

&#x20;       "id": "shutter",

&#x20;       "name": "shutterBtn",

&#x20;       "type": "Button",

&#x20;       "label": {"text": "拍摄", "fontSize": 30},

&#x20;       "position": {"x": 0, "y": -500},

&#x20;       "contentSize": {"w": 200, "h": 60}

&#x20;     },

&#x20;     {

&#x20;       "id": "score",

&#x20;       "name": "scoreLabel",

&#x20;       "type": "Label",

&#x20;       "text": "",

&#x20;       "fontSize": 28,

&#x20;       "position": {"x": 0, "y": 300}

&#x20;     }

&#x20;   ],

&#x20;   "script": {

&#x20;     "class": "ShootScene",

&#x20;     "refs": {

&#x20;       "shutterBtn": "shutter",

&#x20;       "scoreLabel": "score"

&#x20;     }

&#x20;   }

&#x20; }

}
```

约定：



* `schemaVersion`：必填，后续演进依据；Server 只接受已支持版本，否则报明确错误；

* `id`：树内稳定标识（不写入引擎），用于 refs 连线与**幂等寻址**；`name` 是场景中真实节点名；

* 组件允许字符串简写（`"Canvas"`）或对象写法（带参数）；

* `type: "Button" / "Label"` 为常用节点语法糖，等价于节点 + 对应组件 + 必要子节点；

* 资源字段接受内置别名、`db://` 路径或 UUID，由扩展统一解析；

* `refs` 的 key 是脚本 `@property` 名，value 是树内 id；连线前做槽位类型校验。

### 6.2 幂等行为（`onExists`）



* `upsert`（默认）：按 "父节点路径 + name / 已映射 id" 找到已有节点则更新，不重建、不产生重复节点；

* `skip`：已存在则跳过；

* `fail`：已存在则整体失败（用于要求干净场景的 CI 场景）；

* id → 节点 UUID 的映射在单次构建内建立；跨调用的持久映射方案（写入场景节点的扩展保留字段或附属 sidecar 文件）列入 M2，M1 以路径 + 名称寻址为主。

### 6.3 执行与回滚



1. Server 端做 schema 校验（类型、必填、id 唯一性、refs 指向存在），不通过直接返回，不触达编辑器；

2. 扩展 scene 端 begin-operation → 临时隐藏根节点下构建 → 全树校验（组件类存在、资源 UUID 解析成功、refs 类型匹配）→ 挂载 → end-operation；

3. 中途失败：销毁临时节点 + cancel-operation，返回错误节点的 id 路径；

4. `save: true` 时构建成功后自动保存场景；

5. 构建结果返回：创建 / 更新 / 跳过的节点计数、每个节点的最终 UUID、校验警告列表。

## 七、技术栈



| 层          | 技术                                                     | 版本 / 说明                                          |
| ---------- | ------------------------------------------------------ | ------------------------------------------------ |
| MCP Server | Node.js + TypeScript                                   | Node 18+，TS 5.x                                  |
| MCP SDK    | `@modelcontextprotocol/sdk`                            | 开工时锁定最新稳定版，用 Stdio + StreamableHTTP 两种 transport |
| Cocos 扩展   | TypeScript                                             | Cocos Creator 3.8+，交付编译后 dist，不要求用户装扩展依赖         |
| 预览 sidecar | Playwright（由 Server 包按需安装 / 延迟依赖）                      | 截图与运行时日志                                         |
| 测试         | Vitest（单测，mock 消息层）+ 真机 E2E 脚本（手动 / 自托管触发）             |                                                  |
| Lint / 格式  | ESLint + Prettier                                      |                                                  |
| 文档         | VitePress，中文优先                                         |                                                  |
| CI         | GitHub Actions：lint + typecheck + 单测（Ubuntu runner 即可） | 真机 E2E 仅 Windows/macOS，手动触发                      |
| 发布         | npm（Server 包）+ GitHub Releases（扩展 zip）+ 后续 Cocos 商店    |                                                  |

## 八、目录结构



```
cocos-mcp-pro/

├── README.md                      # 中文正文

├── README.en.md                   # 英文附录

├── LICENSE                        # MIT

├── CHANGELOG.md

├── package.json                   # pnpm workspaces 根

├── pnpm-workspace.yaml

├── .github/

│   ├── workflows/

│   │   ├── ci.yml                 # lint + typecheck + 单测

│   │   ├── e2e-windows.yml        # workflow\_dispatch 真机 E2E

│   │   ├── release.yml            # 发 npm + Release

│   │   └── docs.yml

│   └── ISSUE\_TEMPLATE/            # 中文 bug / feature 模板

├── packages/

│   ├── shared/                    # Server 与扩展共享的 schema、类型、错误码

│   │   ├── src/

│   │   │   ├── build-scene-schema.ts

│   │   │   ├── errors.ts

│   │   │   └── tool-annotations.ts

│   │   └── package.json

│   ├── mcp-server/                # npm 主包：cocos-mcp-pro

│   │   ├── src/

│   │   │   ├── index.ts           # CLI：--project / --http / init

│   │   │   ├── server.ts          # 工具注册

│   │   │   ├── transport/

│   │   │   │   ├── stdio.ts

│   │   │   │   └── streamable-http.ts

│   │   │   ├── client/

│   │   │   │   ├── discovery.ts   # 读 temp/.cocos-mcp.json + 健康检查

│   │   │   │   └── cocos-client.ts# 控制通道 HTTP 客户端（token）

│   │   │   ├── tools/             # 12 个工具模块（按第五章）

│   │   │   ├── preview/

│   │   │   │   └── playwright-driver.ts  # 预览截图/日志回流

│   │   │   ├── resources/         # 知识库 markdown（coordinate/ui-rules/...）

│   │   │   └── utils/             # 路径、颜色、参数校验

│   │   ├── tests/                 # Vitest 单测

│   │   └── package.json

│   └── cocos-extension/           # Cocos 编辑器扩展（随 Server 包分发）

│       ├── package.json           # contributions.scene.script 注册

│       ├── src/

│       │   ├── main.ts            # 生命周期：启/停 HTTP

│       │   ├── http-server.ts     # loopback + token + CORS 预检

│       │   ├── discovery.ts       # 写 temp/.cocos-mcp.json

│       │   ├── controllers/       # main 进程能力

│       │   │   ├── asset.ts       # asset-db 封装 + UUID/子资源解析

│       │   │   ├── project.ts

│       │   │   ├── preview.ts

│       │   │   ├── builder.ts

│       │   │   └── diagnostics.ts # 编译/控制台广播监听

│       │   ├── scene/

│       │   │   ├── scene.ts       # scene 脚本入口（exports.methods）

│       │   │   ├── hierarchy.ts   # 节点树遍历

│       │   │   ├── executor.ts    # build\_hierarchy 批量执行 + 事务/回滚

│       │   │   ├── properties.ts  # 四种值编码 + 类型校验

│       │   │   ├── scripts.ts     # ccclass 解析/注册校验/槽位连线

│       │   │   ├── builtin-assets.ts

│       │   │   └── validate.ts    # 几何校验（AABB/边界/重叠）

│       │   └── adapter/

│       │       └── messages-3.8.ts# 消息名适配层（按版本分流）

│       ├── dist/                  # 预编译产物

│       └── tests/e2e/             # 真机 E2E 脚本（手动触发）

├── docs/                          # VitePress

│   ├── guide/（install / configure / troubleshooting）

│   ├── tools/（每类工具一篇，自动从 schema 生成参数表）

│   ├── recipes/（菜单/拍摄/评图三个真实场景菜谱）

│   └── reference/（兼容性矩阵、消息适配表）

└── examples/

&#x20;   └── photographer-game/         # 狗食项目（或直接引用现有游戏工程）
```

## 九、测试与 CI（务实版本）

Cocos Creator 没有 Linux 编辑器、没有真正无头模式，"GitHub Actions 跑 100+ 真机 E2E" 不现实，分层处理：



| 层级     | 内容                                                  | 运行环境                                              |
| ------ | --------------------------------------------------- | ------------------------------------------------- |
| 单测     | schema 校验、颜色 / 路径工具、幂等寻址逻辑、错误码                      | CI，每次 PR，Ubuntu runner                            |
| 类型检查   | tsc --noEmit，两个包 + shared                           | CI                                                |
| 契约测试   | 用录制的编辑器响应固定样本，校验 Server 工具输入输出                      | CI                                                |
| 真机 E2E | 在真实 3.8.x 编辑器中执行：建场景 / 挂脚本 / 预览 / 校验，每个 M1 工具至少 1 条 | Windows/macOS，`workflow_dispatch` 手动触发或自托管 runner |
| 狗食验收   | photographer-game 三个场景由 AI 独立搭完                     | 每个里程碑人工执行并录屏 / GIF                                |

真机 E2E 脚本同时是贡献者本地回归工具：`npm run e2e -- --project D:/your-project`。

## 十、分发与安装（不夸大 "一键"）

### 10.1 两个部件分别分发



1. **MCP Server**：发 npm 包 `cocos-mcp-pro`，支持 `npx -y cocos-mcp-pro`；

2. **编辑器扩展**：无法通过 npx 直接装入 Cocos。提供初始化命令：



```
npx cocos-mcp-pro init          # 在当前 Cocos 项目根执行

\# 作用：将预编译扩展拷贝到 ./extensions/cocos-mcp-bridge/，

\# 输出"在编辑器 扩展管理器 中启用该扩展"的图文提示
```

扩展**随 Server npm 包内置预编译 dist**，用户不需要在扩展目录执行 npm install /build。后续可提交 Cocos 商店实现真正一键安装（审核周期与结果不可控，不作为 v1.0 依赖项）。

### 10.2 客户端配置（README 提供可复制片段）



* TRAE SOLO CN / Claude Code / Cline：stdio + `npx -y cocos-mcp-pro`，可带 `--project` 显式指定项目；

* Cursor：Streamable HTTP，先以 `npx cocos-mcp-pro --http` 启动 Server；

* 每个客户端配置必须在真机验证后才写进 README，不写没验证过的配置。

### 10.3 兼容性声明

README 维护兼容性矩阵：Cocos 版本 × 是否通过真机 E2E × 已知问题。未测版本标注 "未测试，欢迎反馈"，不写 "支持 3.8+" 这种无边界承诺。

## 十一、实现路线图

### 阶段 0：真机 Spike（3–5 天，不写产品代码，只回答 "能不能做"）

退出标准：以下 10 项在真实 Cocos 3.8.x 项目中全部跑通并记录代码片段：



1. 扩展加载，main 进程 HTTP server + token + `temp/.cocos-mcp.json` 发现文件可用；

2. scene 脚本注册成功，`execute-scene-script` 往返调用通过；

3. scene 脚本遍历 `director.getScene()` 拿到完整节点树；

4. 创建节点 / 添加组件 /set-property 各跑通一个；

5. 四种属性值编码各跑通一个（含 SpriteFrame **子资源 UUID**）；

6. 内置资源别名解析到正确资源；

7. 解析用户脚本 `@ccclass` 名、运行时验证类注册、连上一个 Node 类型槽位；

8. begin/end-operation 把多步操作合并为一次撤销（若消息不存在，验证替代方案：操作前快照回滚）；

9. 场景保存成功，重开编辑器内容还在；

10. 预览启动拿到 URL，Playwright 能截图并抓到 console 日志；场景视图截图可行性给出结论。

**Spike 任一项失败且无替代方案，先改设计再继续，不进入阶段 1。**

### 阶段 1：M1 可用闭环（约 2–3 周）

范围：第五章全部 M1 工具（约 45 个）+ build\_scene schema v1 + stdio 接入 TRAE。

**验收标准（全部满足才算 "真正可用"）**：



* [ ] photographer-game 的菜单、拍摄、评图三个场景，由 AI 通过 MCP 从零独立搭完（含脚本挂载与引用连线），人工不碰层级管理器；

* [ ] build\_scene 同一 JSON 连续执行 3 次，节点不重复、结果一致；

* [ ] 一次 build\_scene 可被一次 Ctrl+Z 完整撤销；构建失败场景不留半成品；

* [ ] 故意制造空引用 / 越界 / 重叠，validate 全部能检出并给出修复建议；

* [ ] AI 能通过 diagnostics /preview\_logs/screenshot 发现并修复至少 3 个真实运行时错误；

* [ ] 扩展未启动、编辑器未开、项目路径错误、脚本编译失败四类异常均返回中文可操作提示；

* [ ] 重启编辑器与 MCP Server 后自动重连恢复；

* [ ] 一个没参与开发的人照 README 在 10 分钟内配通 TRAE 并跑完一个示例（找人实测）。

### 阶段 2：M2 覆盖度（约 3–4 周）

预制体全套、资源增删改 / 导入、快照与 diff/patch、构建发布（长任务 + 进度）、节点高级操作、控制台历史、视图杂项、validate\_hierarchy、execute\_script（带开关）、跨调用 id 映射持久化。

### 阶段 3：发布打磨（约 1–2 周）



* 中文 VitePress 文档站 + 三篇实战菜谱（配 GIF）；

* CI 齐备（单测 / 类型检查 / 契约测试），真机 E2E 手册；

* npm 发布、GitHub Release（含扩展 zip）、CHANGELOG；

* README 竞品对比实测核实；兼容性矩阵；

* 提交 Cocos 商店（不阻塞发版）。

> 时间按兼职节奏估算，以验收清单为准，不按日历时间赶进度。

## 十二、开源规范

### 12.1 README 必备章节



1. 一句话介绍 + 演示 GIF（AI 搭场景全过程录屏）；

2. 能力边界与兼容性矩阵（实测 Cocos 版本）；

3. 安装扩展（`init` 命令 + 手动启用截图）；

4. AI 客户端配置（只放真机验证过的客户端）；

5. 5 分钟快速开始；

6. build\_scene /validate/ 日志回流三个核心能力说明；

7. 工具清单与文档站链接；

8. 安全说明（本地 token、execute\_script 默认关闭）；

9. 贡献指南（真机 E2E 怎么跑）；

10. License（MIT）与商标声明。

### 12.2 版本与发布



* semver；CHANGELOG 中文；tag：v1.0.0 /v1.1.0-beta.1；

* M1 完成后先发 0.1.0（标注 "在以下 Cocos 版本验证：…"），M2 完成后发 1.0.0；

* Issue 模板要求填写：Cocos 版本、AI 客户端、扩展日志、Server 日志、复现步骤。

### 12.3 贡献约定

中文优先；PR 必须含变更说明 + 测试方式；涉及新编辑器消息必须在对应 Cocos 版本真机验证并更新消息适配表与兼容性矩阵。

## 十三、风险登记册



| 风险                           | 影响                    | 对策                                                        |
| ---------------------------- | --------------------- | --------------------------------------------------------- |
| 编辑器内部消息在 3.8 小版本间变化          | 工具失效                  | 消息全部收敛到 adapter；兼容性矩阵；按版本分流；Spike 先行                      |
| begin/end-operation 不存在或行为不符 | 无法合并撤销                | Spike 验证；替代方案为操作前导出场景 JSON 快照，失败时恢复                       |
| 场景视图无可用截图 API                | screenshot\_scene 砍功能 | 降级为 Playwright 游戏预览截图兜底                                   |
| 预览 URL / 日志注入受编辑器限制          | 日志回流做不成               | Playwright 直连预览 URL 方案优先；失败则退化为引导用户提供控制台截图                |
| 大场景（数千节点）hierarchy 慢         | AI 上下文爆炸              | 深度限制 + 按子树查询；M2 再考虑缓存并监听场景变更广播失效（用户手改不会通知 Server，M1 不做缓存） |
| Cocos 商店审核不通过 / 周期长          | 无法一键安装                | 不依赖商店，`init` 拷贝预编译扩展为默认路径                                 |
| npm 包名被占                     | 改名                    | 开工前查重，备选 cocos-creator-mcp-server                         |
| 本地端口被恶意网页调用                  | 安全事故                  | loopback + 随机 token + CORS 预检拦截 + execute\_script 默认关闭    |

## 十四、立项清单（落地 todo）

### 阶段 0（Spike）



* [ ] npm 查重并确定包名，初始化 pnpm monorepo（shared /mcp-server/cocos-extension）

* [ ] 扩展骨架：package.json 注册（main + scene script）、HTTP server、token、发现文件、/health

* [ ] scene 脚本往返 demo + 节点树遍历

* [ ] 节点 / 组件 / 属性 demo，四种值编码与 SpriteFrame 子资源 UUID

* [ ] 用户脚本类名解析 + 槽位连线 demo

* [ ] 撤销事务验证（或快照回滚替代）

* [ ] 预览 + Playwright 截图 / 日志 demo；场景截图可行性结论

* [ ] 回填第 3.8 节消息核实表，确定适配层 API

### 阶段 1（M1）



* [ ] shared：build\_scene schema v1、错误码、工具注解

* [ ] MCP Server：stdio transport、发现与重连、45 个 M1 工具、resources 知识库

* [ ] 扩展：controllers + scene executor（事务 / 回滚 / 幂等）、diagnostics

* [ ] validate 四项 + full\_audit

* [ ] preview sidecar（截图 + 日志回流）

* [ ] `init` 安装命令

* [ ] 三个场景狗食验收（对照第十一章验收清单逐条勾）

* [ ] 找一位未参与开发的人做 10 分钟上手实测

* [ ] 中文 README 初稿 + 0.1.0 发布

### 阶段 2（M2）



* [ ] 预制体、资源高级操作、快照 /diff/patch、构建发布长任务

* [ ] execute\_script（配置开关）、HTTP transport、id 映射持久化

* [ ] 真机 E2E 补齐到每个工具一条

### 阶段 3（发布）



* [ ] VitePress 文档站 + 三篇菜谱（配 GIF）

* [ ] CI（lint/typecheck/ 单测 / 契约测试）+ 手动真机 E2E workflow

* [ ] npm 1.0.0 + GitHub Release + 兼容性矩阵

* [ ] Cocos 商店材料提交（不阻塞）