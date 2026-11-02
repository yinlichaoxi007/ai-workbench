# 工具适配与支持矩阵

`targets.json` 只登记路径、格式和验证状态；工具特有行为放在 `src/core/targets/`，通用逻辑不硬编码工具路径。

## 支持矩阵

| 工具 | 用户级入口 | 写入方式 | 入口证据 | 技能目录证据 |
|---|---|---|---|---|
| Qoder CN | `~/.qoder-cn/AGENTS.md` | 追加工作台块 | 文档支持；配置根已实测；加载待实测 | 文档支持；2026-10-26 复查目录不存在 |
| Trae CN | `~/.trae-cn/user_rules/00-ai-workbench.md` | 新增独立文件 | 全局规则目录已实测；已真实部署，加载待抽检；设置中的“导入 AGENTS.md”仅工作区级 | 2026-10-26 复查目录不存在 |
| CodeBuddy CN | `~/.codebuddy/rules/00-ai-workbench.mdc` | 新增独立文件 | 规则目录已实测 | 2026-10-26 复查目录不存在 |
| QwenWork CN | `~/.qwenworkcn/awareness/main/AGENTS.md` | 追加工作台块 | 应用启动加载路径与初始化模板已实测；加载待抽检；配置根下 AGENTS.md/rules.md 不自动加载 | 技能目录已实测 |
| WorkBuddy | 用户级不部署；项目级 `AGENTS.md` | 仅项目挂载 | 用户级只加载记忆/人设文件；项目级接受 AGENTS.md 已实测 | 技能目录已实测 |
| Claude Code | `~/.claude/CLAUDE.md`（备选 `AGENTS.md`） | 追加工作台块 | 官方文档；配置根存在但 CLI 未安装 | 官方文档；目录不存在 |
| Codex CLI | `~/.codex/AGENTS.md` | 追加工作台块 | 官方文档；本机未安装 | 官方文档 |

## 本机路径覆盖

- 机器差异不写进 `targets.json`：在 `machines/<主机名>.md` 的 `## 设置` 中按工具 id 覆盖 `enabled`、`version`、`configRoot`、`entryPath`、`skillsDir`。
- `enabled: false` 让该工具跳过部署与探测；显式 `entryPath` 关闭备选入口回退，不再自动改选备选文件。
- 未纳入本注册表的工具可用 `customTools.<id>` 登记到同一份机器档案，必填 `name`、`configRoot`、`entryPath`，可设写入方式、格式、技能目录、frontmatter、版本要求与启用状态。自定义工具与内置工具一起进入部署链路，但只在本机生效，不改变下方支持矩阵；要成为仓库级支持再补 `targets.json` 与适配代码。
- 用 `aiwb settings show` 查看解析后的实际路径与版本核对结果；路径变量未定义、版本要求非法或工具 id 未知时设置会被标记问题并阻止写入。

## 版本要求与探测

- 内置与自定义工具都可选填版本要求，留空表示不核对；支持精确版本、比较条件、`||` 多候选与英文括号，逗号表示同时满足且优先于 `||`，忽略大小写与 `v` 前缀。
- 内置工具的探测来源登记在 `targets.json` 的 `versionProbe`，读取应用状态或安装清单；自定义工具在配置目录内通用探测。探测只读，失败只报告原因。安装目录不在标准位置时，在机器档案 `## 设置` 的 `env` 中定义 `AIWB_TRAE_CN_HOME`、`AIWB_CODEBUDDY_HOME`、`AIWB_WORKBUDDY_HOME` 指向安装根目录。
- 填写后，`deploy` 预演与执行、`merge`、`backup restore` 和技能 junction 会先核对；不符或无法检测时部署跳过该目标并继续其他目标（CLI 退出码 2），合并与恢复阻止，恢复可 `--force`。`uninstall` 不拦截。
- 支持版本会随工具升级变化，仓库不写死具体值；按本机实际版本和外部备份资料填写，具体版本只存在机器档案。

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
4. QwenWork：部署后确认 `awareness/main/AGENTS.md` 被新会话加载。
5. WorkBuddy：确认项目级 AGENTS.md 在挂载项目中被加载；用户级不部署。
6. Claude Code / Codex：安装后按预留路径实测。
7. 技能 junction：首次 `deploy --apply` 后确认各工具能识别 `skills/<name>`；不能识别时记录并依赖入口索引读取。
8. 版本探测：为已安装工具填写版本要求，分别验证匹配时放行、不符与无法检测时阻止；工具升级后重新核对。

## 实测记录写法

在对应工具行后补充：

```text
日期 | 工具版本 | 测试动作 | 结果 | 证据（截图/日志/文件路径）
```

未实测的项不要改成 `verified`；推断和文档结论分别标注。工具升级后重新跑 `aiwb detect` 与 `doctor`。

## 当前目录观察

2026-10-26 复查：Qoder CN、Trae CN、CodeBuddy CN 的用户级 skills 目录当前不存在；QwenWork CN、WorkBuddy 的 skills 目录存在。目录不存在不等于工具不支持技能，首次接入技能时由部署流程创建并实测。

2026-11-02 复查：Trae CN 已真实部署到 `user_rules`；QwenWork 用户级入口已确认为 `awareness/main/AGENTS.md`；WorkBuddy 用户级不加载 AGENTS.md，只保留项目级挂载；Qoder CN 与 CodeBuddy CN 仍未真实部署。
