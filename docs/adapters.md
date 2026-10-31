# 工具适配记录

本文件记录各工具入口的实际观察、支持状态和待补验证。快速矩阵见 `adapters/README.md`；路径配置以 `adapters/targets.json` 为准。

## 当前观察（2026-10-26）

| 工具 | 配置根 | 入口文件 | 入口现状 | 技能目录现状 | 启用 |
|---|---|---|---|---|---|
| Qoder CN | `~/.qoder-cn` | `AGENTS.md` | 不存在 | 不存在 | 是 |
| Trae CN | `~/.trae-cn` | `user_rules/00-ai-workbench.md` | 不存在 | 不存在 | 是 |
| CodeBuddy CN | `~/.codebuddy` | `rules/00-ai-workbench.mdc` | 不存在 | 不存在 | 是 |
| QwenWork CN | `~/.qwenworkcn` | `AGENTS.md`（备选 `rules.md`） | 不存在 | 存在 | 是 |
| WorkBuddy | `~/.workbuddy` | `rules.md`（备选 `AGENTS.md`） | 不存在 | 存在 | 是 |
| Claude Code | `~/.claude` | `CLAUDE.md` | 不存在 | 不存在 | 否（预留） |
| Codex CLI | `~/.codex` | `AGENTS.md` | 配置根不存在 | 不存在 | 否（预留） |

证据强度：

- 配置根存在、入口/技能目录是否存在：本机文件系统观察。
- Qoder 用户级 `AGENTS.md`、CodeBuddy `.mdc`、Claude/Codex 路径：官方文档或社区资料，尚未在本机验证加载。
- QwenWork/WorkBuddy 全局入口文件名：未确认；当前使用主路径 + 备选路径的探测逻辑，部署前必须实测。
- Qoder/Trae/CodeBuddy 技能目录当前不存在；以后接入技能时由部署流程创建或报告，不要把“目录不存在”当成“不支持”。

## 启动方式

| 工具 | 写入策略 | 说明 |
|---|---|---|
| Qoder CN | `block-append` | 入口不存在则新建；存在则追加工作台块 |
| Trae CN | `separate-file` | 新增独立规则文件，不碰现有 `user_rules` |
| CodeBuddy CN | `separate-file` | 新增独立 `.mdc`，带 frontmatter |
| QwenWork CN | `block-append` | 入口候选：`AGENTS.md` → `rules.md` |
| WorkBuddy | `block-append` | 入口候选：`rules.md` → `AGENTS.md` |
| Claude Code | `block-append` | 预留；确认安装并启用后再部署 |
| Codex CLI | `block-append` | 预留；确认安装并启用后再部署 |

## 新增工具

1. 在 `adapters/targets.json` 增加条目：
   - `id`、`name`、`configRoot`。
   - `entry.path`、`entry.alternatives`、`entry.format`、`entry.strategy`。
   - `skillsDir`、`skillsStatus`、`status`、`enabled`、`notes`。
2. 判断是否需要 `src/core/targets/<tool>.mjs`：
   - 标准 Markdown 追加块或独立文件：暂不需要专门代码。
   - 需要特殊 frontmatter、路径选择、编码或校验：才加适配模块。
3. 更新 `adapters/README.md` 和本文件。
4. 运行 `detect`、`deploy --dry-run`、`node --test`。
5. 部署能力实现后，实际写入并用新会话验证；通过前状态保持 `documented` 或 `unverified`。

## 实测记录

| 日期 | 工具/版本 | 动作 | 结果 | 证据 |
|---|---|---|---|---|
| 待补 | Qoder CN | 用户级入口加载 | 待实测 | 部署后新会话抽检 |
| 待补 | Trae CN | `user_rules` 新文件加载 | 待实测 | 部署后新会话抽检 |
| 待补 | CodeBuddy CN | `.mdc` frontmatter 识别 | 待实测 | 部署后新会话抽检 |
| 待补 | QwenWork CN | 全局入口文件名 | 待实测 | 部署后新会话抽检 |
| 待补 | WorkBuddy | 全局入口文件名 | 待实测 | 部署后新会话抽检 |
| 待补 | 各已安装工具 | `skills/<name>` junction 加载 | 待实测 | 首次 `deploy --apply` 后抽检 |

## 已知限制

- 用户级入口没有统一标准，必须按工具分别写入；`C:\Users\<用户>\AGENTS.md` 不是全工具通用入口。
- 项目级 `AGENTS.md` 只作为可选增强，默认不对任何项目挂载。
- 工具升级可能改变路径或加载规则；升级后先运行 `detect` 与 `doctor`。
- `deploy` 默认只预演，`--apply` 才写外部文件；截至目前尚未对真实 AI 工具目录执行过 apply，所有“入口现状”仍是部署前状态。技能 junction 只在临时沙箱验证过创建、幂等与冲突保护。
