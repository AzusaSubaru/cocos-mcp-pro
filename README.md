# cocos-mcp-pro

开源、跨 AI 客户端（TRAE / Cursor / Claude Code / Cline）的 **Cocos Creator 3.8+ 社区 MCP 服务器**，让 AI 能直接操控编辑器：查询节点树、搭建 UI、挂脚本连引用、校验场景、启动预览并回收运行时日志与截图。

> 状态：**阶段 0（真机 Spike）脚手架已完成**。MCP Server 与编辑器扩展已可构建运行，编辑器内部消息正在真实 Cocos 3.8 项目上逐项验证（见 [docs/spike-checklist.md](docs/spike-checklist.md)）。

## 架构

```
AI 客户端 ──stdio / Streamable HTTP──▶ MCP Server（独立 Node 进程）
                                          │ HTTP 127.0.0.1:<随机端口> + Bearer Token
                                          ▼
                          Cocos 扩展 main 进程（资源/项目/预览/诊断）
                                          │ scene:execute-scene-script
                                          ▼
                          Cocos 扩展 scene 脚本（节点/组件/构建/校验）
```

- 扩展启动后把 `{port, token, cocosVersion}` 写入项目 `temp/.cocos-mcp.json`，Server 自动发现；
- 仅绑定 127.0.0.1，每会话随机 token，跨域预检拒绝，`execute_script` 类能力默认不开放。

## 仓库结构

| 包 | 说明 |
|---|---|
| `packages/shared` | build_scene JSON schema、RPC 协议、错误码 |
| `packages/cocos-extension` | Cocos Creator 编辑器扩展（main + scene 脚本），零运行时依赖，esbuild 预编译 |
| `packages/mcp-server` | MCP 服务器（npm 包 `cocos-mcp-pro`），内置扩展副本（`vendor/`）与 `init` 命令 |

## 快速开始（开发版）

前置：Node.js 18+、pnpm（`npm i -g pnpm`）。

```bash
pnpm install
pnpm run build
```

### 1. 把扩展装进 Cocos 项目

```bash
node packages/mcp-server/dist/index.js init "D:/你的Cocos项目"
```

然后在 Cocos Creator 中：**扩展 → 扩展管理器 → 项目（已安装）**，启用 `cocos-mcp-bridge`（首次启用建议刷新一次编辑器）。

### 2. 真机自检

```bash
node packages/mcp-server/dist/index.js selftest --project "D:/你的Cocos项目"
```

自检会探测 main/scene 两侧的编辑器消息与 API，输出 ✓/✗ 清单。任何 ✗ 都是适配层 `packages/cocos-extension/src/adapter/messages.ts` 的修正依据。

### 3. 在 AI 客户端接入

TRAE / Claude Code / Cline（stdio）：

```json
{
  "mcpServers": {
    "cocos-mcp-pro": {
      "command": "node",
      "args": ["D:/cocosmcp/packages/mcp-server/dist/index.js"],
      "env": { "COCOS_MCP_PROJECT": "D:/你的Cocos项目" }
    }
  }
}
```

Cursor（Streamable HTTP）：先运行 `node dist/index.js --http --port 9118`，再在客户端填 `http://127.0.0.1:9118/mcp`。

### 4. 预览日志/截图（可选）

需要 Playwright Chromium：

```bash
pnpm --filter cocos-mcp-pro exec playwright install chromium
# 国内网络：
# $env:PLAYWRIGHT_DOWNLOAD_HOST="https://cdn.npmmirror.com/binaries/playwright"
```

## 已实现工具（45）

场景：`scene_list/open/save/current/hierarchy/undo`、`spike_selftest`
节点：`node_find/get_info/create/delete/rename/set_transform`
组件：`component_add/remove/list/get_property/set_property/set_spriteframe/set_color/set_content_size`、`composite_setup_widget`
复合：`composite_create_label/create_sprite/create_button/attach_script/batch_set/build_hierarchy`
资源：`asset_list/search/create_folder/create_script/create_scene/refresh`
编辑器：`editor_get_project_info/preview_run/preview_stop/preview_logs/diagnostics`、`view_screenshot_game`
校验：`validate_references/layout/overlap/full_audit`
构建：`builder_build_scene`（幂等、事务、失败回滚、可选自动保存）

知识库资源：`cocos://knowledge/coordinate-system.md`、`cocos://knowledge/ui-rules.md`。

## 开发命令

```bash
pnpm run build       # 构建全部包
pnpm run typecheck   # 类型检查
pnpm run test        # 单测（shared schema）
node packages/mcp-server/tests/stdio-smoke.mjs   # MCP 协议冒烟测试
```

## 设计文档

完整设计（工具规划、build_scene schema、路线图、风险登记册）：[docs/cocos-mcp-design.md](docs/cocos-mcp-design.md)。

## 法律

MIT License。本项目是**社区项目**，与厦门雅基软件（Cocos 官方）无隶属关系；Cocos、Cocos Creator 为其商标。
