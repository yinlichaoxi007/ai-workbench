# 工具适配与支持矩阵

`targets.json` 只登记路径、格式和验证状态；工具特有行为放在 `src/core/targets/`，通用逻辑不硬编码工具路径。

## 支持矩阵

| 工具 | 用户级入口 | 写入方式 | 入口证据 | 技能目录证据 |
|---|---|---|---|---|
| Qoder CN | `~/.qoder-cn/AGENTS.md` | 追加工作台块 | 文档支持；配置根已实测；加载待实测 | 文档支持；2026-10-26 复查目录不存在 |
| Trae CN | `~/.trae-cn/user_rules/00-ai-workbench.md` | 新增独立文件 | 全局规则目录已实测 | 2026-10-26 复查目录不存在 |
| CodeBuddy CN | `~/.codebuddy/rules/00-ai-workbench.mdc` | 新增独立文件 | 规则目录已实测 | 2026-10-26 复查目录不存在 |
| QwenWork CN | `~/.qwenworkcn/AGENTS.md`（备选 `rules.md`） | 追加工作台块 | 全局入口待实测 | 技能目录已实测 |
| WorkBuddy | `~/.workbuddy/rules.md`（备选 `AGENTS.md`） | 追加工作台块 | 用户级入口待实测；项目级接受 AGENTS.md 已实测 | 技能目录已实测 |
| Claude Code | `~/.claude/CLAUDE.md`（备选 `AGENTS.md`） | 追加工作台块 | 官方文档；配置根存在但 CLI 未安装 | 官方文档；目录不存在 |
| Codex CLI | `~/.codex/AGENTS.md` | 追加工作台块 | 官方文档；本机未安装 | 官方文档 |

## 技能 junction 部署

- `deploy` 为已启用、已安装且登记了 `skillsDir` 的工具创建 `skills/<name>` junction，源为 `content/skills/<name>`。
- 技能目录不存在时按计划创建；同名真实目录或指向别处的链接视为冲突，保持原样并在结果中报告。
- `doctor` 会检查技能 junction；目录存在不等于工具能加载，首次部署后仍需新开工具会话实测。

## 证据强度

- `verified`：本机已实测加载或写入成功。
- `documented`：官方文档明确支持，尚未在本机验证加载。
- `unverified`：社区资料或目录存在，但入口文件名/加载行为未确认。
- `unsupported`：明确不接入。

## 实测待办

1. Qoder CN：部署后新开一个会话，确认入口被读取。
2. Trae CN：确认 `user_rules` 新文件被加载；确认用户级 skills 目录是否存在并生效。
3. CodeBuddy：确认 `.mdc` frontmatter 被识别；确认 skills 目录。
4. QwenWork：确认全局入口是 `AGENTS.md`、`rules.md` 还是其他文件；确认加载。
5. WorkBuddy：确认用户级入口文件名；确认加载。
6. Claude Code / Codex：安装后按预留路径实测。
7. 技能 junction：首次 `deploy --apply` 后确认各工具能识别 `skills/<name>`；不能识别时记录并依赖入口索引读取。

## 实测记录写法

在对应工具行后补充：

```text
日期 | 工具版本 | 测试动作 | 结果 | 证据（截图/日志/文件路径）
```

未实测的项不要改成 `verified`；推断和文档结论分别标注。工具升级后重新跑 `aiwb detect` 与 `doctor`。

## 当前目录观察

2026-10-26 复查：Qoder CN、Trae CN、CodeBuddy CN 的用户级 skills 目录当前不存在；QwenWork CN、WorkBuddy 的 skills 目录存在。目录不存在不等于工具不支持技能，首次接入技能时由部署流程创建并实测。
