# obsidian-mcp-pro-localcompose

obsidian-mcp-pro **v4.0.1** 本地源码构建部署包（解决 LobeHub 连接器断联/工具 0 问题）。

## 背景：本包相对 npm `obsidian-mcp-pro@latest` 的四处源码修改

| 修改 | 文件/位置 | 作用 |
|:--|:--|:--|
| ① 错误消息 | `src/http-server.ts` 错误路径 | 400 消息追加 `(No valid session ID provided)`，让 LobeHub `listTools` 能识别 session 失效（为自愈铺路） |
| ② SSE 心跳（可配置） | `src/http-server.ts` GET handler | 按 `SSE_KEEPALIVE_INTERVAL_MS` 周期写 SSE 注释行 `:\n\n`，防止代理/NAT/反代静默超时掐断长连接。开关注：`SSE_KEEPALIVE_ENABLED`；**关闭时完全不启动心跳（不建 timer、不注册监听、不写字节），无任何副作用** |
| ③ Stateless 模式（可选） | `src/http-server.ts` POST/GET/DELETE | `STATELESS_MODE=true` 时每次请求独立创建 transport（`sessionIdGenerator: undefined`），无 sessionId、无长连接、无 GET SSE 流，**彻底免疫反代掐断断联**（与 Outline MCP 同款架构）；关闭（默认 `false`）则保留 stateful + SSE 心跳原逻辑。切换仅改环境变量、重启容器，**无副作用** |
| ④ 默认 frontmatter（可选） | `src/lib/frontmatter-defaults.ts`（新增）+ `create_note` / `append_to_note` / `prepend_to_note` | `OBSIDIAN_DEFAULT_FRONTMATTER` 配置一组固定 frontmatter 键，写入时作为**最底层、只补缺失**：已有键的值、顺序、注释、引号逐字节不动，缺失键追加到 YAML 块尾部（文本级插入，不重序列化）。`create_note` 额外写入服务端本地日期的 `created`；`append` / `prepend` 回填旧笔记时**不写** `created`。未设置该变量时行为与原来逐字节一致 |

> 注意：本包是从源码构建（`npm ci` + `npm run build`），入口为 `node build/index.js`，
> 不再走 `npm install -g obsidian-mcp-pro@latest`。

## 目录结构

```
obsidian-mcp-pro-localcompose/
├── Dockerfile            # 本地源码构建（npm ci + tsc）
├── docker-compose.yaml   # 测试环境（container_name: obsidian-mcp-pro-test，端口 3334）
├── entrypoint.sh         # 入口（等待 vault + node build/index.js）
├── .dockerignore
├── .env.example          # 复制为 .env 后填写
├── src/                  # 修改后的源码（含四处改动）
├── package.json / package-lock.json / tsconfig*.json ...
├── verify-sse.cjs        # SDK 验证脚本（工具列表 + 长连接稳定性）
└── README.md
```

## 环境变量（SSE 心跳）

| 变量 | 默认 | 说明 |
|:--|:--|:--|
| `SSE_KEEPALIVE_ENABLED` | `true` | `"true"` 开启 / `"false"` 关闭。**关闭时完全不启动心跳**：不创建 timer、不注册 close/finish 监听、不写任何字节，程序零副作用 |
| `SSE_KEEPALIVE_INTERVAL_MS` | `15000` | 心跳间隔毫秒。`<=0` 或非法值视为关闭心跳（等价 enabled=false） |

> 服务启动时会在日志打印心跳配置，例如 `SSE keep-alive enabled (interval=15000ms)` 或 `SSE keep-alive disabled`，便于调试确认。
> 想验证关闭路径：`docker compose run --rm -e SSE_KEEPALIVE_ENABLED=false ...` 或直接在 compose environment 里改。

## 环境变量（传输模式）

| 变量 | 默认 | 说明 |
|:--|:--|:--|
| `STATELESS_MODE` | `false` | `"true"` 启用无状态模式 / `"false"`（默认）使用 stateful + SSE 心跳。修改后需**重启容器**生效 |

两种模式对照：

| | stateful（`STATELESS_MODE=false`，默认） | stateless（`STATELESS_MODE=true`） |
|:--|:--|:--|
| session 管理 | ✅ `Mcp-Session-Id` + session 表 | ❌ 无 sessionId，每次请求独立 |
| 长连接 / GET SSE 流 | ✅ 支持（配合心跳保活） | ❌ GET/DELETE 返回 405 |
| SSE 心跳 | ✅ 生效（`SSE_KEEPALIVE_*` 控制） | 自动失效（无长连接，无需心跳） |
| 反代掐断断联 | 有风险（靠心跳缓解） | **彻底免疫**（治本，与 Outline MCP 同款） |
| 适用场景 | 兼容所有客户端 | LobeHub/反代场景优先，切换后需在 LobeHub 重新同步该 MCP |

> 无副作用保证：stateless 下 GET/DELETE 走 405 分支，不会误入 stateful 的 session/SSE/心跳逻辑；
> 心跳 timer 只存在于 stateful 的 GET SSE 流内，stateless 下不会创建；session 表不参与 stateless 请求。
> 单元测试已覆盖两种模式的开关切换（`src/__tests__/http-server.test.ts`）。

## 环境变量（默认 frontmatter）

`OBSIDIAN_DEFAULT_FRONTMATTER` 用 JSON 对象声明一组固定 frontmatter 键，让 `create_note` / `append_to_note` / `prepend_to_note` 写入的每一篇笔记都带一致的 frontmatter 骨架，不必在提示词里重复（Obsidian 模板不参与 MCP 写入路径）。

```json
{"tags":[],"status":"draft","aliases":[]}
```

合并规则——**只补缺失，绝不覆盖**：

| 场景 | 结果 |
|:--|:--|
| `create_note` 新建空笔记 | 写入完整默认块 + 自动 `created`（服务端本地日期 `YYYY-MM-DD`） |
| `create_note` 同时传了 `frontmatter` 参数 | 参数值优先，默认值只补参数没给的键 |
| 正文 / 旧笔记**已有** frontmatter | 只追加缺失键，已有键的值、顺序、注释、引号全部保留 |
| `append_to_note` / `prepend_to_note` 命中无 frontmatter 的旧笔记 | 补一个完整默认块（**不含** `created`，否则会把今天误当旧笔记的创建日） |
| 变量未设置 / 值非法（非 JSON、非对象） | 完全不介入，写入结果与未启用时**逐字节一致** |

> 在 JSON 里显式写 `created` 会覆盖自动戳，这是「不想要自动创建日期」的出口。
> 序列化器会给裸 `YYYY-MM-DD` 加引号（输出 `created: '2026-09-29'`），以保持字符串类型、避免被重新解析成 YAML 时间戳。
> 关键实现：补键走**文本级插入**（只往原 YAML 块尾部追加缺失行），不是整块重序列化——所以旧笔记的 YAML 注释与引号不会被 js-yaml 规范化掉。单测覆盖见 `src/__tests__/handlers/write.test.ts`。

## 部署步骤（宿主机 /docker 下执行）

```bash
# ① 把本目录拷到宿主机（假设已放到 /docker/obsidian-mcp-pro-localcompose）
cd /docker/obsidian-mcp-pro-localcompose

# ② 准备 .env（从 .env.example 复制并填写 VAULT_PATH / token）
cp .env.example .env
# 编辑 .env：VAULT_PATH 指向真实 vault 路径

# ③ 构建（首次需拉依赖，走 Dockerfile 内的 <你的代理地址> 代理）
docker compose -f docker-compose.yaml build

# ④ 替换容器（先停旧的，再起新的）
docker stop obsidian-mcp-pro-test && docker rm obsidian-mcp-pro-test
docker compose -f docker-compose.yaml up -d

# ⑤ 确认启动 + 看日志
docker logs obsidian-mcp-pro-test --tail 50
```

## 验证

```bash
# ① 容器内 SDK 验证（在 localcompose 目录，需要 @modelcontextprotocol/sdk）
#    默认验证 2 分钟；可传分钟数，如 10 分钟长连接
node verify-sse.cjs 2

# ② 确认心跳：观察 NPM access log，SSE 连接应每 15s 有一次请求/数据
#    （连接不再"维持一会后断"）
tail -f /docker/nginx-proxy-manager/data/logs/proxy-host-13_access.log

# ②b stateless 模式验证（STATELESS_MODE=true）：
#     初始化响应无 Mcp-Session-Id 头；GET /mcp 返回 405；多个客户端无 session 粘连。
#     可用 http-server 单测验证：npx vitest run src/__tests__/http-server.test.ts

# ③ 在 LobeHub 设置 → MCP 服务器 → 重新同步 obsidian 连接器
#    应恢复 41 工具，且长时间保持
#    （若切到 stateless，同样重新同步一次即可）
```

## 回滚

```bash
# 源码改动用 git 回滚
cd /docker/obsidian-mcp-pro && git checkout -- src/http-server.ts

# 容器回滚到 npm 版（原 Dockerfile）
docker stop obsidian-mcp-pro-test && docker rm obsidian-mcp-pro-test
# 用原来的 ob-mcp-pro-test/docker-compose.yaml 重新 up
```

## 备注

- 心跳间隔默认 15s（小于常见 idle timeout 60s/300s，留足余量）；可通过 `SSE_KEEPALIVE_INTERVAL_MS` 调整，例如调试时设 `5000` 加快观察、稳定后设回 `15000`
- 若完全不需要心跳（例如直连、无代理掐断场景），设 `SSE_KEEPALIVE_ENABLED=false` 即可，关闭路径无副作用
- 心跳为 SSE 注释行（`: ping` 格式），MCP SDK 客户端与浏览器 EventSource 均自动忽略
- **优先推荐 `STATELESS_MODE=true`**：省去 session/长连接/心跳全部状态，彻底免疫反代掐断，是治本方案。若遇到客户端兼容性问题再退回 stateful
- stateless 每次请求独立创建 transport + McpServer（SDK 官方要求"不可复用 stateless transport"），工具注册无 I/O 副作用；语义搜索 embedding 为惰性加载，无额外开销
- 构建需网络（依赖拉取），已配置 <你的代理地址> 代理；若代理不可用请调整 Dockerfile 的 ARG
- 应用验证通过后，如需同步主环境（ob-mcp-pro），按同样方式改造即可
