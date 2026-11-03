# 工具适配记录

本文件记录各工具入口的实际观察、支持状态和待补验证。快速矩阵见 `adapters/README.md`；路径配置以 `adapters/targets.json` 为准。

## 当前观察（2026-11-03）

| 工具 | 配置根 | 入口文件 | 入口现状 | 技能目录现状 | 启用 |
|---|---|---|---|---|---|
| Qoder CN | `~/.qoder-cn` | `AGENTS.md` | 不存在 | 不存在 | 是 |
| Trae CN | `~/.trae-cn` | `user_rules/00-ai-workbench.md` | 已部署 | 不存在 | 是 |
| CodeBuddy CN | `~/.codebuddy` | `rules/00-ai-workbench.mdc` | 不存在 | 不存在 | 是 |
| QwenWork CN | `~/.qwenworkcn` | `awareness/main/AGENTS.md` | 不存在 | 存在 | 是 |
| WorkBuddy | `~/.workbuddy` | `user-<uid>-<企业或个人>/MEMORY.md` + `memory/ai-workbench-global-rules.md`（未绑定回落设备根 `MEMORY.md`） | 存在 | 存在 | 是（记忆注入） |
| Claude Code | `~/.claude` | `CLAUDE.md` | 不存在 | 不存在 | 否（预留） |
| Codex CLI | `~/.codex` | `AGENTS.md` | 配置根不存在 | 不存在 | 否（预留） |

证据强度：

- 配置根存在、入口/技能目录是否存在：本机文件系统观察。Qoder 与 Trae 的入口已由工作台写入，加载行为仍需新会话抽检。
- Trae 设置中的“导入 AGENTS.md”（`AI.rules.import.IMPORT_AGENTS_MD`）只导入工作区根目录的 AGENTS.md，不是用户级入口；用户级仍为 `user_rules` `[实测]`。
- QwenWork 用户级入口由应用启动时加载 `awareness/main/AGENTS.md`，应用包内路径与初始化模板均已确认；配置根下的 `AGENTS.md`、`rules.md` 不自动加载 `[实测]`，加载行为待新会话抽检。
- WorkBuddy 用户级只自动加载 `MEMORY.md`、`SOUL.md`、`IDENTITY.md`、`USER.md` 等人设/记忆文件，AGENTS.md 仅项目级支持 `[实测]`。用户级记忆实际位于账号目录 `user-<uid>-<企业或个人>/MEMORY.md`（应用包内账号目录规则与运行日志均已确认）；工作台从 `storage/skeleton/account-snapshot.json` 的 `primary` 读取 `uid` 与 `enterpriseId` 动态生成路径，不硬编码账号标识。快照缺失、结构非法、超过 4096 字节或保存超过 30 天时，应用视为未绑定并回落到设备根 `MEMORY.md`；工作台同步回落解析结果但不再写入设备根，而是把该目标标记为需人工并阻止部署，按配置根下有无账号目录区分“疑似已登出”与“未检测到已登录账号”，先登录 WorkBuddy 再部署，确认要固定入口时用 `tools.workbuddy.entryPath` 显式覆盖。工作台在解析出的记忆文件写入 `USER-GLOBAL-RULES` 标记区块：区块与现有记忆共享每会话约 4000 字符注入额度，超出时只保留指向拆分文件的钩子 `[实测]`；写入保持原文件无 BOM 与 LF 形态，完整规则放 `memory/ai-workbench-global-rules.md`。
- Qoder 用户级 `AGENTS.md`、CodeBuddy `.mdc`、Claude/Codex 路径：官方文档或社区资料，尚未在本机验证加载。
- Qoder/Trae/CodeBuddy 技能目录当前不存在；以后接入技能时由部署流程创建或报告，不要把“目录不存在”当成“不支持”。

## 版本探测

内置工具在 `adapters/targets.json` 的 `versionProbe` 中登记候选路径与字段：

| 工具 | 探测来源 | 字段 | 备注 |
|---|---|---|---|
| Qoder CN | `{configRoot}/.qoder-app-status.json` | `version` | 应用状态文件 |
| Trae CN | 安装目录 `resources/app/product.json` | `appVersion` | 构建号 `tronBuildVersion` 作为详情 |
| CodeBuddy CN | 安装目录 `resources/app/product.json` | `version` | `genieVersion` 作为详情 |
| QwenWork CN | `{configRoot}/.status.json` | `version` | 应用状态文件 |
| WorkBuddy | 安装目录 `resources/install-manifest.json` | `appVersion` | manifest 的 `version` 是 schema 版本，不可用 |

- 候选路径支持 `{configRoot}`、`${NAME}`、`%NAME%` 与 `~` 展开；按顺序读取第一个可用字段。
- 安装目录不在 `%ProgramFiles%` 或 `%LOCALAPPDATA%/Programs` 时，在机器档案 `## 设置` 的 `env` 中定义 `AIWB_TRAE_CN_HOME`、`AIWB_CODEBUDDY_HOME`、`AIWB_WORKBUDDY_HOME` 指向安装根目录（含主程序 exe 的目录）；变量未定义只影响对应候选，不影响标准路径。
- 自定义工具没有注册表探测规则，在配置目录内按 `.status.json`、`.app-status.json`、`.<id>-app-status.json`、`product.json`、`resources/app/product.json`、`resources/install-manifest.json`、`resources/app/package.json`、`package.json` 通用探测。
- 探测只读；文件缺失、JSON 损坏或字段不存在只记录原因。版本要求留空时不核对；填写后支持精确版本、比较范围、`||` 多候选与英文括号，不符或无法检测会阻止部署、合并与恢复，卸载不受影响。
- 外部参照：`ai-env-clone` README 的实测版本为 Qoder CN 0.4.3、CodeBuddy CN 1.106.1（genie 4.12.0）、WorkBuddy 5.6.2、TraeCode CN 3.3.99（构建 2.3.82600）。这里只沿用其读取口径（应用状态、`product.json`、`install-manifest.json`），不把对方版本写成默认要求；默认仍留空，按本机实际版本填写。

## 启动方式

| 工具 | 写入策略 | 说明 |
|---|---|---|
| Qoder CN | `block-append` | 入口不存在则新建；存在则追加工作台块 |
| Trae CN | `separate-file` | 新增独立规则文件，不碰现有 `user_rules` |
| CodeBuddy CN | `separate-file` | 新增独立 `.mdc`，带 frontmatter |
| QwenWork CN | `block-append` | 写 `~/.qwenworkcn/awareness/main/AGENTS.md`，不加备选 |
| WorkBuddy | `memory-block` | 在账号记忆文件顶部写入 `USER-GLOBAL-RULES` 区块；快照失效时不写设备根，目标按需人工阻止，先登录再部署；区块加现有记忆超出预算时只写钩子，正文写 `memory/ai-workbench-global-rules.md`；不支持手工合并 |
| Claude Code | `block-append` | 预留；确认安装并启用后再部署 |
| Codex CLI | `block-append` | 预留；确认安装并启用后再部署 |

`memory-block` 的入口配置包含：

- `markers`：首尾注释标记，写入前校验全文件各出现一次且顺序正确。
- `placement`：`top` 或 `bottom`；超出注入上限时只有置顶允许继续并给出提醒。
- `budget`：`injectLimit`（每会话注入上限）、`targetLimit`（目标线）、`blockBudget`（区块字符预算），三者均为正整数且 `targetLimit` 不得大于 `injectLimit`。
- `splitFile`：相对配置根的拆分文件路径，不能指向入口自身，也不能包含 `..`。
- `accountDir`：可选；`snapshot` 为相对配置根的账号快照路径，`path` 为含 `{uid}` 与 `{scope}` 占位符的相对路径。按快照动态解析账号目录，快照无效时回落到 `entry.path`；只允许记忆注入目标使用。

## 新增工具

1. 在 `adapters/targets.json` 增加条目：
   - `id`、`name`、`configRoot`。
   - `entry.path`、`entry.alternatives`、`entry.format`、`entry.strategy`。
   - `skillsDir`、`skillsStatus`、`status`、`enabled`、`notes`。
   - `versionProbe`：可选；填 `label`、`paths`、`field`，需要额外构建号时加 `detailField`。
2. 判断是否需要 `src/core/targets/<tool>.mjs`：
   - 标准 Markdown 追加块或独立文件：暂不需要专门代码。
   - 需要特殊 frontmatter、路径选择、编码或校验：才加适配模块。
3. 更新 `adapters/README.md` 和本文件，写清入口证据与版本探测来源。
4. 运行 `detect`、`deploy --dry-run`、`node --test`。
5. 部署能力实现后，实际写入并用新会话验证；通过前状态保持 `documented` 或 `unverified`。

## 实测记录

| 日期 | 工具/版本 | 动作 | 结果 | 证据 |
|---|---|---|---|---|
| 待补 | Qoder CN | 用户级入口加载 | 待实测 | 部署后新会话抽检 |
| 待补 | Trae CN | `user_rules` 新文件加载 | 待实测 | 部署后新会话抽检 |
| 待补 | CodeBuddy CN | `.mdc` frontmatter 识别 | 待实测 | 部署后新会话抽检 |
| 待补 | QwenWork CN | `awareness/main/AGENTS.md` 加载 | 路径已确认，加载待实测 | 部署后新会话抽检 |
| 待补 | WorkBuddy | 用户记忆区块注入 | 沙箱已覆盖设备根与账号目录两种路径；账号目录真实写入与新会话复述待验证 | 部署后新会话问“当前生效的自定义指令有哪些”，能复述即成功 |
| 待补 | WorkBuddy | 项目级 AGENTS.md 加载 | 项目级入口可用 | 项目挂载后新会话抽检 |
| 待补 | 各已安装工具 | `skills/<name>` junction 加载 | 待实测 | 首次 `deploy --apply` 后抽检 |

## 已知限制

- 用户级入口没有统一标准，必须按工具分别写入；`C:\Users\<用户>\AGENTS.md` 不是全工具通用入口。
- 项目级 `AGENTS.md` 只作为可选增强，默认不对任何项目挂载。
- 工具升级可能改变路径或加载规则；升级后先运行 `detect` 与 `doctor`。可在机器档案中填写版本要求，让部署、合并与恢复在版本不符或无法检测时提前阻止。
- WorkBuddy 的记忆注入依赖账号目录 `MEMORY.md` 的自动加载与字符上限。切换账号后路径随快照变化；快照过期时先启动 WorkBuddy 刷新登录，再重新部署。快照无效（含疑似已登出）时部署被阻止，这是有意防护：设备根只在未登录时可能被读取，登录后注入走账号目录；确需固定入口时用 `tools.workbuddy.entryPath` 显式覆盖。区块写入后须用新会话提问验证；文件合计超过注入上限时只在置顶位置保留钩子，若工具改为从文件末尾截断，需要把 `placement` 调回 `top` 并重新核对。
- 旧版本曾把区块写入设备根 `MEMORY.md`。升级后该区块不会自动迁移；先运行 `uninstall --tool workbuddy` 清理旧区块，再部署到账号目录，避免两处残留。
- 记忆区块与拆分文件不支持 `merge` 手工合并；修改规则应改 `content/rules/` 后重新部署。拆分文件由工作台生成，手工修改会被部署与状态检查识别为漂移。
- 截至 2026-11-03，真实工具目录已对 Trae CN 与 WorkBuddy 执行过 `deploy --apply`；其余工具未执行，入口现状仍是部署前状态。
- 版本探测依赖安装目录与应用状态文件；便携版、绿色版或自定义安装位置可能探测不到。此时留空版本要求，或在机器档案 `## 设置` 的 `env` 中把对应的 `AIWB_*_HOME` 指向实际安装根目录。
- `deploy` 默认只预演，`--apply` 才写外部文件；目前 Trae CN 与 WorkBuddy 执行过真实部署，其余工具仍只有沙箱验证。技能 junction 的创建、幂等与冲突保护已在沙箱验证。
