# Arch · Plugins / 插件宿主（提案）

> **状态：P0 已实现，P1/P2 持续中。**
> 已落地：manifest 发现、utilityProcess 加载、命令、事件、插件私有 storage、Settings → 插件、内置 Notes、folder 安装/启用/禁用/卸载。
> 尚未落地：Executor 注册、Agent tools/MCP、sandbox UI view、zip 安装/签名/市场。
> 第一个 first-party 插件是 [`PLUGIN-notes.md`](PLUGIN-notes.md)（Obsidian-like Notes）。

---

## 1. 边界：Harness 插件 ≠ dsh 插件

| | dsh 插件 | Harness 插件（本文） |
|---|---|---|
| 运行位置 | dsh 进程内 | Electron 主进程 + utilityProcess |
| 依赖 | Cordis profile / plugin bundle | Harness manifest / Host API |
| 能做什么 | Agent 工具、skill、模型路由、工作流 | 任务导入、命令、事件 hook、执行器、面板、通知 |
| 能否加 UI | 不能直接影响 Harness UI | 可以（P2 sandbox view） |
| 版本 | 跟 dsh 绑定 | 跟 Cockpit API 绑定 |

**原则：**

1. dsh 继续只当执行层，不把 Cordis 插件树搬进 Harness；
2. Harness 插件不能修改 dsh 内部；
3. 给 Agent 加工具优先通过 **MCP**，而不是让插件直接进入 dsh；
4. 两套插件的安装、权限、升级、审计分开。

---

## 2. 目标与非目标

### 目标

- 插件能注册 **命令**，出现在命令面板；
- 插件能监听 **只读事件**（run/todo/mission）；
- 插件能注册 **Executor**（claude / codex / 自定义 ACP）；
- 插件能通过受控 API 读写任务、项目文件、HTTP、secret；
- 插件能提供 **UI view**（P2，sandbox）；
- 插件崩溃不影响主窗口；
- 安装/启用/禁用/卸载可管理；
- 权限可见、可审计；
- 有稳定的 `apiVersion` 与插件 SDK 类型。

### 非目标

- 第一版不做插件市场；
- 第一版不做任意 Obsidian/Cordis 插件兼容；
- 不把插件代码加载进 renderer 主 React 树；
- 不允许插件直接访问 SQLite / Electron API / `store.state`；
- 不支持插件热更新到正在运行的 run 中间。

---

## 3. 插件类型

| 类型 | 能力 | 阶段 |
|---|---|---|
| **Command / Integration** | 命令、事件、HTTP、项目文件、通知、任务导入 | P0 |
| **Executor** | 注册新的 Agent CLI / ACP 适配器 | P1 |
| **UI View** | 全页或 side panel，sandbox iframe | P2 |

一个插件可以同时是多种类型；manifest 的 `contributes` 决定。

---

## 4. 运行时架构

```text
┌──────────────── Renderer ────────────────┐
│ Settings → 插件                           │
│ PluginView (iframe sandbox, P2)           │
└──────────────────┬───────────────────────┘
                   │ IPC
┌──────────────────▼───────────────────────┐
│ Electron Main                             │
│  PluginHost                               │
│   ├─ manifest 校验 / 版本 / 权限           │
│   ├─ enable / disable / install / remove   │
│   ├─ CommandRegistry                      │
│   ├─ EventBus                             │
│   ├─ ExecutorRegistry                     │
│   └─ RPC / utilityProcess 管理             │
│                                           │
│  Services                                  │
│   todos / runs / missions / agents / events│
│  SQLite / plugin_kv / plugin_secrets       │
└──────────────────┬───────────────────────┘
                   │ MessagePort / RPC
┌──────────────────▼───────────────────────┐
│ Plugin Runtime（每个插件一个 utilityProcess）│
│  activate(ctx)                            │
│   ctx.commands / events / todos / runs     │
│   ctx.fs / net / storage / settings        │
│   ctx.executors / tools / notify / log     │
└──────────────────────────────────────────┘
```

### 为什么用 utilityProcess

- 插件崩溃/死循环不拖垮主窗口；
- 插件可以随时 disable/kill；
- 后续可加超时、内存限制、日志隔离；
- 比 `vm` 更接近真实插件运行环境，又比独立 app 轻。

> 注意：Node 插件仍是**受信代码**。权限系统主要防误用和审计，不是完整 OS 沙箱。安装时必须明确提示。

---

## 5. 插件目录

```text
userData/plugins/
  ai.cockpit.notes/
    plugin.json
    dist/main.mjs
    dist/ui/index.html       # 可选
    data/                    # 插件私有数据
    logs/
resources/plugins/           # 内置插件，只读
  ai.cockpit.notes/
```

优先级：

1. userData 插件覆盖同名内置插件；
2. 内置插件不可卸载，只能禁用；
3. dev 模式可额外扫描仓库 `plugins-dev/`。

---

## 6. Manifest

```json
{
  "id": "com.example.run-notifier",
  "name": "Run Notifier",
  "version": "0.1.0",
  "apiVersion": 1,
  "engines": { "cockpit": ">=0.2.0" },
  "main": "dist/main.mjs",
  "activation": ["onStartup", "onCommand:notifier.test", "onRun:completed"],
  "permissions": ["state:read", "notify", "net:https"],
  "contributes": {
    "commands": [
      { "id": "notifier.test", "title": "发送测试通知" }
    ],
    "events": ["run.completed", "run.failed"],
    "settings": [
      { "key": "webhook", "type": "string", "title": "Webhook URL" }
    ],
    "executors": [],
    "views": []
  }
}
```

### 字段规则

| 字段 | 说明 |
|---|---|
| `id` | reverse-DNS，全局唯一 |
| `apiVersion` | Host API 主版本；不兼容直接拒绝 |
| `engines.cockpit` | semver 范围 |
| `main` | 插件入口（ESM） |
| `activation` | 懒激活事件；`onStartup` 表示应用启动即加载 |
| `permissions` | 安装/启用时展示并强制 |
| `contributes.commands` | 命令面板 |
| `contributes.events` | 允许订阅的事件 |
| `contributes.executors` | 执行器声明（P1） |
| `contributes.views` | UI view（P2） |

### 校验

- manifest JSON schema；
- 不得包含 `..`、绝对路径、symlink 逃逸；
- `main` 必须在插件目录内；
- 未声明的事件不能订阅；
- 未声明的权限不能调用；
- 不兼容的 `apiVersion` / `engines` 不允许启用。

---

## 7. 生命周期

```text
discovered → validated → installed(disabled) → enabled → activated
                                                  │
                                                  ├─ deactivate
                                                  └─ crash → disabled / backoff
```

### 激活

- `onStartup`：应用启动后加载；
- `onCommand:<id>`：第一次执行命令时加载；
- `onRun:completed` / `onEvent:<name>`：第一次事件命中时加载；
- `onView:<id>`：打开插件 view 时加载。

### 失败处理

- activate 抛错 → 插件标记 failed，记录日志，不自动反复重启；
- 运行中崩溃 → 重启最多 N 次，指数退避；
- 连续失败 → 自动禁用并在插件页提示；
- RPC 超时 → 拒绝本次调用，不阻塞主进程；
- deactivate 超时 → 强制 kill。

### 日志

- 每个插件独立 `logs/runtime.log`；
- 主进程只记录生命周期、权限拒绝、崩溃摘要；
- 插件日志按大小轮转；
- 插件页可打开日志目录。

---

## 8. Host API

第一版只给受控服务，不给原始 store / DB。

```ts
export interface PluginContext {
  manifest: PluginManifest;
  log: PluginLogger;

  commands: {
    register(id: string, handler: (args?: unknown) => Promise<unknown>): () => void;
  };

  events: {
    on(event: PluginEventName, handler: (payload: unknown) => void): () => void;
  };

  settings: {
    get<T = unknown>(key: string): Promise<T>;
    set(key: string, value: unknown): Promise<void>;
  };

  storage: {
    get<T = unknown>(key: string): Promise<T | null>;
    set(key: string, value: unknown): Promise<void>;
    delete(key: string): Promise<void>;
    /** 插件私有 SQLite（data/ 下），用于 FTS/索引等结构化数据 */
    openSqlite(name: string): Promise<PluginSqlite>;
  };

  todos: {
    list(filter?: TodoFilter): Promise<TodoView[]>;
    get(id: string): Promise<TodoView | null>;
    create(input: CreateTodoInput): Promise<TodoView>;
    update(id: string, patch: UpdateTodoInput): Promise<TodoView>;
  };

  runs: {
    list(filter?: RunFilter): Promise<RunView[]>;
    get(id: string): Promise<RunView | null>;
    stop(runId: string): Promise<void>;
  };

  missions: {
    list(filter?: MissionFilter): Promise<MissionView[]>;
    get(id: string): Promise<MissionView | null>;
    finish(id: string, summary: string): Promise<void>;
  };

  fs: {
    readProjectFile(rel: string): Promise<string>;
    writeProjectFile(rel: string, text: string): Promise<void>;
    /** 用户显式选择的 vault；与项目根分开授权 */
    vault: {
      root(): Promise<string>;
      read(rel: string): Promise<string>;
      write(rel: string, text: string): Promise<void>;
      list(rel: string): Promise<FsEntry[]>;
    };
  };

  net: {
    fetchJson(url: string, init?: RequestInit): Promise<unknown>;
  };

  executors: {
    register(adapter: ExecutorAdapter): () => void;
  };

  ui: {
    registerView(view: PluginViewContribution): () => void;
  };

  tools: {
    register(tool: AgentTool): () => void;   // 通过 MCP 暴露给 Agent
  };

  chat: {
    draft(input: { text: string; context?: PluginContextBlock }): Promise<void>;
  };

  links: {
    attach(todoId: string, link: ExternalLink): Promise<void>;
    list(todoId: string): Promise<ExternalLink[]>;
  };

  secrets: {
    get(key: string): Promise<string | null>;
    set(key: string, value: string): Promise<void>;
    delete(key: string): Promise<void>;
  };

  notify(message: string, options?: { level?: "info" | "warn" | "error" }): void;
}

export interface PluginViewContribution {
  id: string;
  title: string;
  location: "main" | "settings" | "sidebar";
  entry: string;
  icon?: string;
}

export interface AgentTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  handler(input: unknown, signal?: AbortSignal): Promise<unknown>;
}

export interface ExternalLink {
  kind: string;
  ref: string;
  title?: string;
}

export interface PluginSqlite {
  exec(sql: string, params?: unknown[]): Promise<void>;
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>;
  close(): Promise<void>;
}

export interface ExecutorAdapter {
  id: string;
  label: string;
  kind: "acp" | "native";
  probe(): Promise<{ available: boolean; version?: string }>;
  start(input: RunInput): Promise<RunHandle>;
  steer?(handle: RunHandle, text: string): Promise<void>;
  cancel(handle: RunHandle): Promise<void>;
}
```

### 能力边界

- `todos/runs/missions` 返回 **detached view**，不是可变 store 对象；
- 写操作必须经过 Host service，写事件、审计、broadcast；
- `fs` 只接受项目相对路径，`realpath` 后必须在项目根内；
- `net` 只允许 HTTPS（本地 dev 可配置例外）；
- `secrets` 用 Electron `safeStorage` 加密；
- 插件不能访问其他插件 storage/secrets；
- Node utilityProcess 仍然可以 `require` 原生模块；因此权限是 **API 层的受信边界**，不是完整 OS 沙箱。安装插件即表示信任它。

---

## 9. 权限

```text
state:read          读取 todos / runs / missions
tasks:write         创建/修改任务
runs:dispatch       启动/停止 run
fs:project          项目内文件读写
fs:vault            用户选择的 vault 文件读写（Notes）
storage:sqlite      插件私有 SQLite
net:https            HTTPS 请求
spawn               启动子进程
secrets:read        读取插件自己的 secret
notify              发通知
ui:view             注册 UI 面板（P2）
agent:tools         向 Agent 暴露工具
```

规则：

- 安装时展示全部权限；
- 启用时再次确认高风险权限（`spawn` / `fs:project` / `secrets:read`）；
- 运行时每次敏感调用检查；
- 拒绝时返回结构化错误，插件不得静默绕过；
- 权限变更后需要重新确认；
- 所有敏感调用写 audit event。

---

## 10. 事件

P0 只读，不允许同步修改核心状态。

```text
app.ready
todo.created
todo.updated
todo.confirmed
run.queued
run.started
run.completed
run.failed
mission.created
mission.finished
message.created
```

规则：

- 事件 payload 是 detached view；
- 监听必须节流/异步，不阻塞主流程；
- `terminal.output` 不进入 P0；如需要，单独权限 + 采样/节流；
- 插件不能通过事件修改 run/todo，只能调用命令/API；
- 事件失败不影响主流程，只记录日志。

---

## 11. Executor 插件

当前 `EXECUTORS` 是硬编码的，这是最重要的插件化点。

### 目标

- 插件可以注册 `claude` / `codex` / 自定义 ACP；
- Chat 的 Agent 选择器出现新执行器；
- 与 dsh 相同的 run/steer/cancel/usage 语义。

### 接口

```ts
interface ExecutorAdapter {
  id: string;
  label: string;
  kind: "acp" | "native";
  probe(): Promise<{ available: boolean; version?: string }>;
  start(input: {
    runId: string;
    todo: TodoView;
    agent: AgentView;
    cwd: string;
    prompt: string;
    signal: AbortSignal;
    onEvent(event: ExecutorEvent): void;
    onPermission(request: PermissionRequest): Promise<PermissionDecision>;
  }): Promise<RunHandle>;
  steer?(handle: RunHandle, text: string): Promise<void>;
  cancel(handle: RunHandle): Promise<void>;
}
```

### 约束

- Executor 不能直接写 DB；
- 通过 `onEvent` 上报 message/tool/usage；
- 通过 `onPermission` 请求审批；
- `probe()` 结果进入 Agent 能力矩阵；
- 失败要有分类（auth / rate_limit / timeout / other）；
- 插件禁用后，已绑定该执行器的 Agent 标记“执行器不可用”。

---

## 12. UI 插件

### P2 才做

- `views` 只支持 `settings.section` / `main` / `sidebar`；
- view 是 **sandbox iframe**；
- 不允许直接访问 renderer DOM / React / `window.harness`；
- 通过 `postMessage` RPC 调用 Host API；
- 插件 UI 不能读 Node / 文件系统；需要数据必须走 iframe RPC 到 main。

```html
<iframe
  sandbox="allow-scripts allow-forms"
  src="plugin://ai.cockpit.notes/ui/index.html"
/>
```

### 安全

- `allow-same-origin` 不给；
- CSP 限制；
- 不加载远程脚本；
- 弹窗/下载需用户手势；
- view 崩溃不影响主窗口。

---

## 13. 数据模型

主库只存插件元数据，不存插件业务数据：

```sql
plugins (
  id TEXT PRIMARY KEY,
  version TEXT,
  path TEXT,
  enabled INTEGER,
  builtin INTEGER,
  manifest TEXT,
  permissions TEXT,
  installed_at INTEGER,
  last_error TEXT,
  last_run_at INTEGER
)

plugin_kv (
  plugin_id TEXT,
  key TEXT,
  value TEXT,
  updated_at INTEGER,
  PRIMARY KEY (plugin_id, key)
)

plugin_secrets (
  plugin_id TEXT,
  key TEXT,
  value BLOB,
  updated_at INTEGER,
  PRIMARY KEY (plugin_id, key)
)

todo_links (
  id TEXT PRIMARY KEY,
  todo_id TEXT,
  plugin_id TEXT,
  kind TEXT,
  ref TEXT,
  title TEXT,
  created_at INTEGER
)
```

- 插件自己的业务索引（如 Notes 的 `notes.db`）放在 `userData/plugins/<id>/data/`；
- Host 不读取插件私有 DB；
- `todo_links` 是通用的外部引用，GitHub/Linear/Notes 共用。

---

## 14. 安装与分发

### 格式

第一版实现 **文件夹安装**；zip / 签名 / 版本回滚是后续。

```text
my-plugin/
  plugin.json
  main.mjs
  assets/
```

### 安装流程

1. 选择一个包含 `plugin.json` 的目录；
2. 校验 manifest / apiVersion / engines；
3. 展示权限；
4. 复制到 `userData/plugins/<id>`；
5. 先禁用；
6. 用户启用后加载；
7. 失败保留错误信息；版本回滚后续实现。

### 规则

- 不在运行时 `npm install`；
- 插件必须自带依赖；
- 路径穿越/zip slip 防护；
- 可选 SHA256 / 签名（P1）；
- 第一版只支持本地安装，不做市场；
- 内置插件只读、不可卸载。

---

## 15. 安全模型

必须写清楚：

> **Harness 插件是受信代码，不是不可信沙箱。** 安装插件等于允许它在你的用户权限下运行。

防护：

- 安装时权限确认；
- utilityProcess 隔离 + 崩溃隔离；
- Host API 路径/权限检查；
- secrets 单独命名空间；
- 不加载 renderer 主树；
- UI iframe sandbox；
- 日志脱敏；
- 不自动更新；
- 高风险 `spawn` 单独确认；
- 插件目录不允许 symlink 逃逸。

---

## 16. 代码落点

```text
electron/
  plugins/
    host.mjs                 # 生命周期 / 权限 / RPC
    manifest.mjs             # schema / semver / 路径校验
    runtime.mjs              # utilityProcess 入口
    executor-registry.mjs
    plugin-db.mjs
  services/
    todos.mjs
    runs.mjs
    missions.mjs
    agents.mjs
    events.mjs
src/
  components/Plugins.tsx     # 设置 → 插件
  components/PluginView.tsx  # P2 iframe
  types/plugin.ts
scripts/
  verify-plugins.mjs
```

> 需要先把 `electron/main.mjs` 的领域逻辑拆成 services；否则 Plugin API 会直接绑死在 2000 行主文件上。

---

## 17. 分期

### P0：基础插件（5～7 天）

- manifest 校验 / 版本
- 本地目录/zip 安装
- enable / disable / remove
- utilityProcess 加载
- 命令注册
- 只读事件
- storage / settings
- Settings → 插件页
- 日志 / 崩溃隔离
- 示例 `run-notifier`

**验收：** 安装示例插件 → 命令出现在命令面板 → run 完成后发通知；插件崩溃不拖垮 App。

### P1：集成能力（1～2 周）

- 权限系统
- Executor registry
- `todos.create/update`
- `net` / `fs:project`
- secrets
- 插件包校验
- 内置插件

**验收：** mock executor 插件能从 Chat 启动 run、上报消息、取消。

### P2：UI 插件（2～4 周）

- sandbox iframe
- settings/sidebar/main slot
- 插件 SDK types
- 签名/市场
- 升级/回滚

---

## 18. 验证

```sh
npm run typecheck
node scripts/verify-plugins.mjs
npm run build
```

覆盖：

- manifest 非法 / 版本不兼容
- 未授权 API 拒绝
- 插件崩溃隔离
- 禁用后命令消失
- Executor 启动/停止
- 插件存储隔离
- zip slip / 路径穿越
- 插件卸载无残留命令
- 事件节流

---

## 19. 示例插件

### `run-notifier`

manifest：

```json
{
  "id": "com.example.run-notifier",
  "apiVersion": 1,
  "permissions": ["state:read", "notify", "net:https"],
  "activation": ["onRun:completed"],
  "contributes": {
    "events": ["run.completed"],
    "commands": [{ "id": "notifier.test", "title": "发送测试通知" }]
  }
}
```

入口：

```js
export async function activate(ctx) {
  ctx.events.on("run.completed", async ({ run, todo }) => {
    const url = await ctx.settings.get("webhook");
    if (url) await ctx.net.fetchJson(url, { method: "POST", body: JSON.stringify({ run, todo }) });
    ctx.notify(`run ${run.id} 完成`);
  });

  ctx.commands.register("notifier.test", async () => {
    ctx.notify("Notifier 工作正常");
  });
}
```

### `notes`（first-party）

见 [`PLUGIN-notes.md`](PLUGIN-notes.md)。

---

## 20. 已实现（P0）

```text
electron/plugins/host.mjs       # 发现 / 生命周期 / RPC / 权限 / 命令
electron/plugins/runtime.mjs    # utilityProcess 入口 + PluginContext
plugins/notes/plugin.json       # 第一个内置插件
plugins/notes/main.mjs          # vault 索引 / API / commands / mission event
src/components/Notes.tsx        # first-party Obsidian-like view
src/components/Settings.tsx     # 设置 → 插件
```

已实现：

- 内置插件扫描、userData 插件安装目录
- manifest / apiVersion / 目录路径校验
- utilityProcess 启动 / 停止 / 崩溃隔离
- 命令注册与命令面板触发
- 只读事件（当前接入了 run.completed / run.failed / mission.finished）
- 插件 settings / storage
- `todos.create/update`、`links.attach/list`
- `fs.pickDirectory`、`ui.openView`、`chat.draft`、`notify`
- Notes 插件：vault 索引、文件树、预览/编辑、搜索、backlinks、Daily Note、创建任务、发送到 Chat

当前限制：

- 插件 UI 只实现了 first-party Notes 的原生 React 页面；第三方 iframe view 尚未开放
- Executor 注册 / Agent tools / MCP 尚未接入
- 安装只支持目录；zip / 签名 / 市场未做
- 权限是 API 层检查；utilityProcess 不是 OS 沙箱

## 21. 待拍板

1. 第一版只做本地受信插件，还是直接做市场？
2. Executor 插件是否优先于 UI 插件？
3. 是否允许插件 `spawn` 子进程？
4. 插件 UI 是否必须 iframe，还是 first-party 可以先内置 React？
5. 插件包是否需要签名，还是 SHA256 + 权限确认即可？
6. dsh 插件是否单独作为 Agent 扩展，不混入 Harness 插件？

**建议：** 先做 P0 命令/事件/执行器，本地受信插件；UI 插件和市场上线前不要碰。
