# AI 工作台：多 AI 工具通用规则与技能分发 —— 设计与落地要点

- 文档版本：v0.4（加入内容维护与内置技能）
- 日期：2026-10-29
- 真源仓库：`<仓库路径>`
- 适用机器：<主机名>（Windows 10 x64）
- 当前状态：P0 骨架与内容维护工具已落地；**尚未向任何 AI 工具目录写入文件**

结论强度标注：

| 标记 | 含义 |
|---|---|
| `[实测]` | 本机命令、文件或注册表已核实 |
| `[文档]` | 官方文档或社区资料一致，尚未在本机实际加载验证 |
| `[待实测]` | 部署阶段必须逐项验证，不能当成既成事实 |
| `[待确认]` | 需要用户拍板 |
| `[不做]` | 明确排除 |

## v0.3 P0 落地记录（2026-10-26）

真源仓库已建立：`<仓库路径>`。本次只写仓库和 `dist/`，未向任何 AI 工具目录写入。

已实现：

- 目录骨架、通用规则、机器档案、目标注册表和入口模板已落位。
- 7 个工具的入口注册：Qoder CN、Trae CN、CodeBuddy CN、QwenWork CN、WorkBuddy 启用；Claude Code、Codex 标为预留未启用。
- Node 零依赖核心与 CLI：`build`、`detect`、`deploy --dry-run`、`status`、`doctor`。
- 测试 35 项全部通过；`build --check` 为最新；`deploy --dry-run` 结果为 5 个新建、0 个需人工、2 个预留；`doctor --parity` 的注册表元数据通过，GUI 运行时标记为 P2 待实现。

与 v0.2 蓝图的差异：

- `adapters/targets.json` 使用 `entry.strategy`（`block-append` / `separate-file`）和 `enabled`，取代示例中的 `mode: single-file`。
- `deploy` 目前只做预演；`--apply` 明确拒绝，等待 P1 实现备份、原子写、状态和锁。
- `doctor --parity` 在 GUI 运行时不存在时返回“待实现”，不冒充通过。
- 2026-10-26 复查：Qoder/Trae/CodeBuddy 的用户级 skills 目录不存在；QwenWork/WorkBuddy 的 skills 目录存在。首次接入技能时创建并实测。

## v0.4 内容维护与内置技能（2026-10-29）

- 新增 `aiwb content lint`：校验规则文件名、编号、索引登记和失效引用；校验技能 frontmatter、name 与目录一致、description、重名和内置标记；禁止 `content/` 出现盘符绝对路径。已接入 `doctor`。
- 新增 `aiwb content new-rule <slug>`：自动取下一个两位编号，生成规则骨架，并登记 `00-index.md` 的阅读顺序和文件职责表。
- 新增 `aiwb content new-skill <name> --description "触发场景"`：生成 `content/skills/<name>/SKILL.md` 骨架和 frontmatter。
- 新增内置技能 `aiwb`（`builtin: true`）：说明工作台维护命令、先读文档和安全边界；`content lint` 要求它存在且不得取消 builtin。
- 测试从 36 项增加到 50 项；仍未向任何 AI 工具目录写入文件。

## v0.1 → v0.2 变更摘要

1. 顶层目录重组：`content/`（可部署源）+ `machines/`（机器覆盖）+ `adapters/`（目标配置）+ `src/`（工具代码）+ `launchers/`（用户入口）+ `dev/`（开发脚本）+ `tests/` + `docs/` + `dist/`（构建产物）+ `state/`（本地状态）。
2. 机器相关内容从通用规则中拆出：`04-environment`、`05-paths`、`06-projects` 移入 `machines/<主机名>.md`，保证换机器时只改机器档案。
3. 明确四类物：**部署源**、**构建产物**、**外部部署物**、**运行状态**；每类的位置、生成者、是否入库、生命周期都有边界。
4. CLI、GUI、开发脚本、测试、文档各自独立目录，共用 `src/core` 业务核心。
5. 运行时零 npm 依赖：只使用 Node 内置模块；CodeMirror 合并视图预构建后入库。
6. 增加并发锁、构建清单、路径一致性检查，避免 CLI 和 GUI 同时写、避免文档与代码路径漂移。

---

## 一、目标与边界

### 1.1 要解决的问题

1. 每换一个 AI 工具或每开一个新会话，都要重复交代：参考资料在哪、项目放哪、注释规范、提交规则、删除规则、测试要求。
2. 通用要求目前散落在多个工具里：桌面 `AGENTS.md`、Trae 全局规则、Qoder/CodeBuddy 的测试规则、以及个人记忆，没有单一真源。
3. 各工具的技能目录、全局规则文件名和格式都不同，自研技能无法一次编写、处处使用。
4. 后续要维护、要换电脑、要在多台机器间迁移，不能靠手工复制。

### 1.2 设计目标

- **单一真源**：通用规则、技能、模板只在 `content/` 维护；机器差异只在 `machines/` 维护。
- **一键分发**：脚本把同一份内容部署到各工具认可的全局入口；技能目录用 junction 接入。
- **不破坏原有环境**：只新增或追加，备份、可回滚，绝不覆盖用户已有内容。
- **跨工具**：不为某一个工具定制通用规则；工具专属规则和技能保持原样、互不冲突。
- **可迁移**：Git 私库 + 新机器 `deploy` 即可恢复；机器差异单独存放。
- **可维护**：CLI 与 GUI 共用一套核心动作；改一处、部署多次；有漂移检测和功能对等检查。

### 1.3 明确不做

- 不搬厂商内置技能和市场技能（不可移植，也不属于个人资产）。
- 不复制参考资料正文进仓库（资料量大，只维护路径索引）。
- 不接管各工具独有的规则、技能、插件、人设文件。
- 不自动修改任何项目仓库；项目级入口必须用户确认后挂载。
- 不把密钥、令牌、账号凭据写入仓库。
- 不提供 GUI 任意 shell 终端。

---

## 二、本机现状

### 2.1 运行时与工具链 `[实测]`

本机的运行时版本、盘符剩余空间等具体值只记录在机器档案 `machines/<主机名>.md`，设计文档不重复保存。约束只有两条：Node.js 20 或更新版本；`node` 与 `git` 可直接在 PATH 中调用。

### 2.2 各 AI 工具配置根与入口

`~` 在本机实际指向 `C:\Users\<用户>`，该目录整体链接到 `<链接目标>` `[实测]`。

| 工具 | 用户配置根 | 全局入口 | 用户级技能目录 | 证据强度 |
|---|---|---|---|---|
| Qoder CN | `~/.qoder-cn` | `~/.qoder-cn/AGENTS.md` | `~/.qoder-cn/skills/` | 路径 `[文档]`；配置根存在 `[实测]`；2026-10-26 复查 skills 目录不存在；加载待实测 |
| Trae CN | `~/.trae-cn` | `~/.trae-cn/user_rules/*.md` | `~/.trae-cn/skills/`（待验证） | 全局规则目录 `[实测]`；2026-10-26 复查 skills 目录不存在 |
| CodeBuddy CN | `~/.codebuddy` | `~/.codebuddy/rules/*.mdc` | `~/.codebuddy/skills/`（待验证） | 规则目录 `[实测]`；2026-10-26 复查 skills 目录不存在 |
| QwenWork CN | `~/.qwenworkcn` | `AGENTS.md` 或 `rules.md`（待定） | `~/.qwenworkcn/skills/` | 技能目录 `[实测]`；全局入口 `[待实测]` |
| WorkBuddy | `~/.workbuddy` | `rules.md` 或 `AGENTS.md`（待定） | `~/.workbuddy/skills/` | 技能目录 `[实测]`；包内确认项目级接受 `AGENTS.md` `[实测]`；全局入口 `[待实测]` |
| Claude Code | `~/.claude` | `~/.claude/CLAUDE.md` | `~/.claude/skills/` | 配置根存在但 CLI 未安装 `[实测]`；预留未启用；路径 `[文档]` |
| Codex CLI | `~/.codex` | `~/.codex/AGENTS.md` | `~/.codex/skills/` | 未安装 `[实测]`；路径 `[文档]` |
| Lingma（旧） | `~/.lingma` | 无可靠全局入口 | — | `[不做]` |

补充：

- Qoder CN IDE 走 Lingma 目录的说法见社区资料 `[文档]`，本方案暂不接入；如后续常用，再单独评估。
- `C:\Users\<用户>\AppData\Roaming` 下还存在 `Trae CN`、`CodeBuddy CN`、`QwenWorkCN`、`WorkBuddy`、`CatPawAI` 等应用数据目录 `[实测]`，本方案只使用上表的用户配置根，不碰应用数据。

### 2.3 现有通用规则来源

| 来源 | 内容摘要 | 处理方式 |
|---|---|---|
| `<桌面交付路径>\AGENTS.md` `[实测]` | 改完必须重新编译和闭环测试；测试临时文件清理到回收站；删除前确认且进回收站；禁止自行提交、改动前先查未提交修改 | 合并进 `content/rules/02-workflow.md`、`03-coding.md` |
| `~/.trae-cn/user_rules/rule-1780225036863.md` `[实测]` | 改文件前确认；测试通过再结束；有疑问先讨论；多方案列优缺点 | 合并进 `01-communication.md`、`02-workflow.md` |
| `~/.trae-cn/user_rules/rule-1780225211160.md` `[实测]` | 中文注释；只写必要注释；中文提交说明；函数注释写清说明、参数、返回值、必要逻辑 | 合并进 `03-coding.md` |
| `~/.trae-cn/user_rules/rule-1784599542936.md` `[实测]` | 注释要求；不随意删旧注释；先确认；先读代码调研；写测试并回归；优先复用 | 合并进 `02-workflow.md`、`03-coding.md` |
| `~/.qoder-cn/rules/test.md` `[实测]` | “qoder cn 测试规则，忽略本规则”，测试残留 | 不合并、不修改、不作为入口 |
| `~/.codebuddy/rules/test.mdc` `[实测]` | “测试”，测试残留 | 不合并、不修改、不作为入口 |
| WorkBuddy `BOOTSTRAP.md` / `USER.md` / `SOUL.md` / `MEMORY.md` `[实测]` | WorkBuddy 自身的人设、用户档案、长期记忆 | 工具专属，不接管、不改写 |
| 个人记忆中的协作偏好 | 中文交流；结论先行；观察与推断分开；不把推断写成事实；不能验证要直说；改动范围盘查 | 合并进 `01-communication.md`、`02-workflow.md` |

### 2.4 技能现状

- 在 `<工作参考资料目录>` 和 `<Qoder 会话工作区>` 下按深度 6 搜索，**未发现个人自研的 `SKILL.md`** `[实测]`。
- 现有技能都是厂商内置或市场技能：
  - Qoder CN：内置技能与插件（better-harness、computer-use、qoder-create-plugin 等）`[实测]`
  - Trae CN：`builtin_skills`（code-review、debugger 等）及已安装插件（deep-research-assistant、lark、office-plugin、prd-authoring 等）`[实测]`
  - CodeBuddy：`skills-marketplace` 下数百个市场技能 `[实测]`
  - QwenWork：钉钉系列、docx/pdf/pptx、media-generation 等 `[实测]`
  - WorkBuddy：`~/.workbuddy/skills` 为空 `[实测]`
- 结论：这些技能不能当作跨工具公共资产，只登记、不复制。
- **决策：第一批自研技能先不做** `[已决策]`；先把规则和分发骨架跑通。

### 2.5 资料目录与项目目录

| 用途 | 路径 | 证据 |
|---|---|---|
| 项目公共父级 | `<项目父级>` | `[实测]`，一个父级下可放多个 git 仓库（含嵌套仓库）；具体清单见机器档案 |
| 工作参考资料 | `<工作参考资料目录>`（含 `参考资料`、`科研资料`） | `[实测]`；用户明确这是资料目录，不是项目父级 `[已决策]` |
| 个人资料 | `<个人资料目录>` | `[实测]` |
| 学习资料 | `<学习资料目录>` | `[实测]` |
| 其他资料 | `<其他资料目录>` | `[实测]` |
| 桌面交付 | `<桌面交付路径>` | 注册表 `User Shell Folders\Desktop` `[实测]` |
| Qoder 会话工作区 | `<Qoder 会话工作区>\<日期>\<id>` | `[实测]`，多为空目录，不是 git 仓库 |

补充观察：`<工作参考资料目录>` 下还发现 7 个旧 git 仓库 `[实测]`，但按用户口径不作为项目父级；是否迁入 `<项目父级>` 由用户另行决定，本方案不动。

### 2.6 机器特殊情况（写入机器档案，不写进通用规则）

1. `C:\Users\<用户>` 整体是链接，指向 `<链接目标>` `[实测]`。看到同一份数据在两个盘出现时，不要当重复数据、不要建议删除。备份/打包要去重链接根。
2. 真实桌面是 `<桌面交付路径>` `[实测]`。`C:\Users\<用户>\Desktop` 是迁移后遗留的独立旧目录，往里写文件用户在桌面上看不到；不要往那里写，也不要建议清理。
3. 全局 git 身份已配置；已推送历史不改写、不 force push。
4. C 盘空间紧张，仓库和生成物优先放 D 盘。

---

## 三、关键结论（设计依据）

### 3.1 “项目级 AGENTS.md 通用” ≠ “用户级 AGENTS.md 统一”

- `AGENTS.md` 是**仓库根目录**的事实标准，Codex、Qoder、Trae、Cursor、Copilot 等大多能读；Trae 桌面版需要在设置中开启“将 AGENTS.md 包含在上下文” `[文档]`。
- **用户级没有统一标准**：每个工具只认自己配置根下的入口，文件名和格式不同。

| 工具 | 用户级实际入口 | 说明 |
|---|---|---|
| Qoder CN | `~/.qoder-cn/AGENTS.md` | 支持用户级 AGENTS.md `[文档]` |
| Codex | `~/.codex/AGENTS.md` | `[文档]` |
| Trae CN | `~/.trae-cn/user_rules/*.md` | 全局只认 user_rules；AGENTS.md 是项目级且需开关 `[文档]` |
| CodeBuddy | `~/.codebuddy/rules/*.mdc` | `.mdc` 格式 `[文档]` + 目录 `[实测]` |
| WorkBuddy | 全局规则入口待实测 | 技能目录 `[实测]`；项目级接受 AGENTS.md `[实测]` |
| QwenWork | 用户级全局入口待实测 | 工作区接受 AGENTS.md/SOUL.md/MEMORY.md `[实测]`；技能目录 `[实测]` |
| Claude Code | `~/.claude/CLAUDE.md` | 是否原生读 AGENTS.md 随版本变化，未安装无法实测 `[文档]` |

- 把 `AGENTS.md` 放在 `C:\Users\<用户>\AGENTS.md`，上述工具不会自动把它当全局配置加载 `[文档]`；本机该文件也不存在 `[实测]`。
- 因此必须“一份源内容 → 按工具写各自入口”，不存在“一份文件放用户根就全工具生效”的捷径。

### 3.2 技能目录也不统一

- 可移植的是 `SKILL.md` 目录结构，不是“放到一个地方所有工具都能用”。
- 各工具有各自的用户级技能目录；部分工具还只认插件/市场技能。
- 因此：技能正文放 `content/skills/`，技能目录用 junction 接入；同时在全局入口生成技能索引，保证不认 SKILL.md 的工具也能按索引去读正文。

### 3.3 项目级入口只能作为可选增强

- 会弄脏 git 状态，可能被误提交到团队仓库。
- 已有 `AGENTS.md` 的项目，追加个人规则可能污染项目规范。
- 不同工具支持程度不同（Trae 需开关、Claude Code 主入口是 CLAUDE.md）。
- 结论：默认关闭，只对用户勾选的项目挂载，且默认本地不入库。

### 3.4 方案取舍

| 方案 | 结论 | 原因 |
|---|---|---|
| 单一真源 + 部署副本 | 采用 | 可靠、可校验、不依赖符号链接权限 |
| 规则文本用文件符号链接 | 不采用 | Windows 文件符号链接需开发者模式/管理员，编辑器另存可能断链 |
| 技能目录用 junction | 采用 | 无需管理员、实时生效、不占空间 |
| 每个工具各写一份 | 不采用 | 必然漂移，无法维护 |
| 把全局规则全文放进每个项目根 | 不采用 | 重复维护，污染项目仓库 |
| 通用规则里写死本机路径 | 不采用 | 换机器就失效；机器差异必须放 `machines/` |

---

## 四、项目结构与部署物

### 4.1 分层

```
┌──────────────────────────────────────────────┐
│  外部部署物（写到工具目录/项目目录，不入库）        │
│  用户级入口 · 技能 junction · 项目挂载块          │
└───────────────────────▲──────────────────────┘
                        │ deploy / attach
┌───────────────────────┴──────────────────────┐
│  构建产物：dist/（生成，不入库）                  │
│  ENTRY.md · manifest.json                      │
└───────────────────────▲──────────────────────┘
                        │ build
┌───────────────────────┴──────────────────────┐
│  部署源（入库，唯一真源）                         │
│  content/（通用规则/技能/模板）                  │
│  machines/（机器差异/路径/项目清单）              │
│  adapters/（各工具入口配置）                      │
└───────────────────────▲──────────────────────┘
                        │ 读取/执行
┌───────────────────────┴──────────────────────┐
│  工具代码（入库）                                │
│  src/core（共享核心） src/cli src/gui           │
│  launchers（用户入口） dev（开发脚本）            │
└──────────────────────────────────────────────┘

运行状态：state/（本地，不入库）—— 部署记录、备份、日志、锁
```

### 4.2 目录总览

标注：`[入库]` 进 Git；`[生成]` 构建产物，gitignore；`[本地]` 运行状态，gitignore；`[外部]` 写到工具/项目目录，不在仓库内。

```
<仓库路径>\
├─ README.md                          [入库] 使用说明：安装、部署、维护、迁移
├─ AGENTS.md                          [入库] 本仓库维护规则（只在本仓库工作时生效）
├─ CHANGELOG.md                       [入库]
├─ VERSION                            [入库] 语义化版本
├─ package.json                       [入库] type=module、scripts、engines、零运行时依赖
├─ .gitignore                         [入库] dist/、state/、node_modules/、*.log
├─ .editorconfig                      [入库] UTF-8、缩进、换行约定
│
├─ content\                           [入库] 可部署源：跨机器通用的内容
│  ├─ rules\
│  │  ├─ 00-index.md                 规则总索引与阅读顺序
│  │  ├─ 01-communication.md         沟通与协作偏好
│  │  ├─ 02-workflow.md              工作流程铁律
│  │  └─ 03-coding.md                编码、注释、提交规范
│  ├─ skills\
│  │  └─ aiwb\SKILL.md               内置技能：工作台维护命令与边界（builtin）
│  └─ templates\
│     ├─ entry-header.md             入口生成头模板
│     ├─ entry-essentials.md         入口里的 5 条最小铁律
│     ├─ entry-index.md              入口里的仓库/技能索引模板
│     ├─ project-block.md            项目挂载块模板
│     └─ codebuddy-frontmatter.md    CodeBuddy .mdc frontmatter 模板
│
├─ machines\                          [入库] 机器差异：每台机器一份
│  ├─ _template.md                   新机器模板
│  └─ <主机名>.md                   frontmatter 设置 + 机器环境/路径/项目清单
│
├─ adapters\                          [入库] 目标配置与支持说明
│  ├─ targets.json                   各工具入口路径、格式、合并方式、验证状态
│  └─ README.md                      支持矩阵、实测记录、待办
│
├─ src\                               [入库] 工具代码
│  ├─ core\                          共享业务核心（无 UI、无终端输出）
│  │  ├─ index.mjs                   核心导出
│  │  ├─ registry.mjs                动作注册表（CLI/GUI 共用）
│  │  ├─ actions\                    一个动作一个文件
│  │  │  ├─ detect.mjs
│  │  │  ├─ build.mjs
│  │  │  ├─ deploy.mjs
│  │  │  ├─ status.mjs
│  │  │  ├─ doctor.mjs
│  │  │  ├─ merge.mjs
│  │  │  ├─ backup.mjs
│  │  │  ├─ uninstall.mjs
│  │  │  ├─ scan-projects.mjs
│  │  │  ├─ attach.mjs
│  │  │  ├─ detach.mjs
│  │  │  ├─ content.mjs
│  │  │  ├─ log.mjs
│  │  │  └─ diagnose.mjs
│  │  ├─ targets\                    各工具特有行为（读写格式、回退候选）
│  │  │  ├─ index.mjs
│  │  │  ├─ qoder.mjs
│  │  │  ├─ trae.mjs
│  │  │  ├─ codebuddy.mjs
│  │  │  ├─ qwenwork.mjs
│  │  │  ├─ workbuddy.mjs
│  │  │  ├─ claude.mjs
│  │  │  └─ codex.mjs
│  │  ├─ project\                    项目扫描、挂载、exclude
│  │  │  ├─ scanner.mjs
│  │  │  ├─ attach.mjs
│  │  │  └─ exclude.mjs
│  │  └─ lib\                        通用基础设施
│  │     ├─ paths.mjs                路径展开、~ / 环境变量
│  │     ├─ machine.mjs              机器档案解析（frontmatter + 正文）
│  │     ├─ target-registry.mjs      targets.json 读取与校验
│  │     ├─ entry-builder.mjs        合成入口内容
│  │     ├─ skills-index.mjs         技能索引生成
│  │     ├─ content-checks.mjs       规则/技能结构校验与内置技能保护
│  │     ├─ scaffold.mjs             规则/技能骨架生成与索引登记
│  │     ├─ markdown-block.mjs       入口块标记与解析
│  │     ├─ merge-engine.mjs         只追加合并
│  │     ├─ junction.mjs             junction 管理
│  │     ├─ backup.mjs               备份、恢复、清理
│  │     ├─ state.mjs                部署状态读写
│  │     ├─ lock.mjs                 并发锁
│  │     ├─ log.mjs                  JSONL 日志
│  │     ├─ fs-safe.mjs              原子写、权限、文件锁
│  │     ├─ hash.mjs                 内容哈希
│  │     └─ encoding.mjs             BOM/UTF-8/UTF-16/GBK 检测
│  ├─ cli\                           命令行表现层
│  │  ├─ main.mjs                    入口与命令分发
│  │  ├─ args.mjs                    参数解析
│  │  └─ render.mjs                  人类可读/JSON 输出
│  └─ gui\                           图形界面
│     ├─ server.mjs                  127.0.0.1 + token + 静态服务
│     ├─ api.mjs                     HTTP API（只调用动作注册表）
│     └─ web\                        前端静态资源
│        ├─ index.html
│        ├─ app.js
│        ├─ styles.css
│        ├─ pages\                   总览/部署/合并/项目/内容/备份/历史/设置/诊断
│        ├─ components\              状态徽章、确认框、diff 视图
│        └─ vendor\codemirror-merge\ [入库] 预构建合并视图，离线可用
│
├─ launchers\                         [入库] 用户启动入口（只做转发，不含逻辑）
│  ├─ aiwb.cmd                       CLI：node src/cli/main.mjs %*
│  ├─ aiwb-gui.cmd                   GUI：node src/cli/main.mjs gui --open
│  └─ README.md                      双击说明、桌面快捷方式建议
│
├─ dev\                               [入库] 开发/发布辅助，不参与日常部署
│  ├─ build-vendor.mjs               重新构建 CodeMirror 预构建产物（仅升级时用）
│  ├─ package.mjs                    打包 zip（离线迁移/备份）
│  └─ check-paths.mjs                检查 README/docs 与代码路径是否一致
│
├─ tests\                             [入库]
│  ├─ unit\                          merge、encoding、fs-safe、junction、machine 等
│  ├─ integration\                   模拟各工具目录的部署/冲突测试
│  ├─ fixtures\                      样例入口文件（有/无 AGENTS.md、.mdc、已跟踪）
│  └─ parity.test.mjs                CLI/GUI 动作对等检查
│
├─ docs\                              [入库]
│  ├─ design.md                      本设计文档（仓库建立后以此为准）
│  ├─ adapters.md                    工具支持矩阵与实测记录
│  ├─ maintenance.md                 日常维护/排障 runbook
│  └─ migration.md                   新机器迁移步骤
│
├─ local\                             [本地] 开发维护产生的文档/脚本，gitignore
│  └─ docs\                          设计交付稿、调研笔记等本地副本
│
├─ dist\                              [生成] 构建产物，gitignore
│  ├─ ENTRY.md                       本次部署内容（含机器覆盖）
│  └─ manifest.json                  源文件哈希、生成时间、机器、技能列表
│
└─ state\                             [本地] 运行状态，gitignore
   ├─ deploy-state.json              各目标/项目的部署状态
   ├─ backups\<tool>\<timestamp>\    写前备份 + manifest
   ├─ logs\deploy-YYYYMM.jsonl       操作日志
   └─ locks\deploy.lock              并发锁
```

### 4.3 外部部署物

这些不在仓库内，由 `deploy` / `attach` 写到工具目录或项目目录：

| 部署物 | 位置 | 生成者 | 更新方式 | 卸载 |
|---|---|---|---|---|
| 用户级入口文件/块 | 各工具配置根 | `deploy` | 重新 deploy，块内替换 | `uninstall` |
| 技能 junction | 各工具 skills 目录 | `deploy` | 重新 deploy | `uninstall` |
| 项目挂载块 | 项目根 `AGENTS.md` | `attach` | 重新 attach | `detach` |
| `.git/info/exclude` 行 | 项目 `.git/info/exclude` | `attach` | 重新 attach | `detach` |
| 部署状态 | `state/deploy-state.json` | `deploy` / `attach` | 自动 | 保留 |
| 备份 | `state/backups/` | `deploy` | 自动 | 按保留策略清理 |

### 4.4 四类物的边界

| 类别 | 位置 | 是否入库 | 允许放什么 | 禁止放什么 |
|---|---|---|---|---|
| 部署源 | `content/` | 是 | 通用规则、技能、模板 | 本机绝对路径、密钥、机器专属内容 |
| 机器覆盖 | `machines/` | 是 | 机器环境、路径、项目清单、本机设置 | 跨机器通用规则、密钥 |
| 目标配置 | `adapters/` | 是 | 工具入口路径、格式、支持状态 | 业务逻辑（逻辑在 `src/core/targets/`） |
| 工具代码 | `src/`、`launchers/`、`dev/` | 是 | 代码、启动器、开发脚本 | 生成内容、运行时状态 |
| 构建产物 | `dist/` | 否 | 入口内容、manifest | 手工编辑的内容 |
| 外部部署物 | 工具/项目目录 | 不适用 | 工作台块、独立入口文件、junction | 用户原有内容 |
| 运行状态 | `state/` | 否 | 状态、备份、日志、锁 | 需要跨机同步的内容 |
| 文档/测试 | `docs/`、`tests/` | 是 | 设计、支持矩阵、runbook、测试 | 真实凭据、运行日志 |

边界规则：

1. `content/` 不出现本机绝对路径；所有路径类内容放 `machines/`。
2. `machines/` 不出现跨机器通用规则；通用规则放 `content/rules/`。
3. `src/core/` 不硬编码工具路径；一律读 `adapters/targets.json` 和机器档案。
4. `dist/` 只由 `build` 生成，任何人工修改都会被下一次构建覆盖。
5. `state/` 永不入库；备份不随仓库迁移。
6. `launchers/` 只做转发，不写业务逻辑。
7. `dev/` 不参与日常部署；只用于升级依赖、打包、校验。
8. 工具特有规则/技能不进入本仓库；本仓库只存跨工具公共内容。

### 4.5 部署流水线

```
编辑 content/ + machines/
          │
          ▼
   aiwb build
          │  读取 content/rules、content/skills、content/templates、machines/<host>.md
          ▼
dist/ENTRY.md + dist/manifest.json
          │
          ▼
   aiwb deploy [--dry-run|--apply]
          │  1. detect：工具是否存在、入口是否已有
          │  2. preview：列出新建/追加/更新/跳过/冲突
          │  3. backup：写入前备份
          │  4. merge：只追加或写独立文件
          │  5. verify：原前缀字节 + 块哈希
          │  6. record：state/deploy-state.json
          ▼
外部部署物：用户级入口 + 技能 junction
          │
          ▼
   aiwb attach（可选，用户勾选项目）
          │
          ▼
项目根 AGENTS.md 块 + .git/info/exclude
```

### 4.6 运行时决策（已确认）

采用 **核心统一用 Node.js 实现**：

- 理由：GUI 的差异对比需要 Web 组件；Node 本机已装；CLI 和 GUI 共用一套 `src/core/`，不会出现两套部署逻辑。
- `launchers/aiwb.cmd` 只是 `node src/cli/main.mjs` 的包装，使用体验不变。
- 运行时零 npm 依赖：只用 Node 内置模块；CodeMirror 预构建入库。
- 代价：每台机器需要 Node（本机已有；其他机器装一次 LTS）。若某台机器没有 Node，启动器给出明确安装提示，不自动安装。
- 备选：PowerShell 核心 + Node GUI 外壳。缺点是跨进程调用、逻辑重复、维护成本更高。
- 状态：`[已决策]`（P0 已实施）

### 4.7 动作注册表

所有可执行动作注册在 `src/core/registry.mjs`：

```js
{
  id: 'deploy',
  title: '部署入口',
  cli: { command: 'deploy', options: ['--dry-run', '--apply', '--tool'] },
  gui: { page: 'deploy', form: [...], confirm: true },
  dryRun: true,
  run: async (ctx, params) => { /* 唯一实现 */ }
}
```

- CLI 从注册表解析参数并执行。
- GUI 通过 `GET /api/actions` 获取元数据，动态渲染表单和按钮。
- 新增功能 = 注册一个动作，CLI 与 GUI 同时出现。
- `doctor --parity` 检查：每个动作必须同时有 CLI 和 GUI 描述，缺失即报错。

---

## 五、入口内容与部署

### 5.1 用户级入口矩阵

| 工具 | 部署目标 | 格式 | 合并方式 | 状态 |
|---|---|---|---|---|
| Qoder CN | `~/.qoder-cn/AGENTS.md` | Markdown | 新建；已有则追加块 | `[待实测]` |
| Trae CN | `~/.trae-cn/user_rules/00-ai-workbench.md` | Markdown | 新增独立文件，不碰现有规则 | `[待实测]` |
| CodeBuddy | `~/.codebuddy/rules/00-ai-workbench.mdc` | MDC + frontmatter | 新增独立文件；同名才合并 | `[待实测]` |
| QwenWork | `~/.qwenworkcn/AGENTS.md`（备选 `rules.md`） | Markdown | 新建；已有则追加块 | `[待实测]` |
| WorkBuddy | `~/.workbuddy/rules.md`（备选 `AGENTS.md`） | Markdown | 新建；已有则追加块 | `[待实测]` |
| Claude Code | `~/.claude/CLAUDE.md` | Markdown | 新建；已有则追加块 | 未安装，预留 |
| Codex | `~/.codex/AGENTS.md` | Markdown | 新建；已有则追加块 | 未安装，预留 |

CodeBuddy 新建文件的 frontmatter 参考现有格式：

```yaml
---
description: AI 工作台全局入口（由 ai-workbench 部署）
alwaysApply: true
enabled: true
---
```

### 5.2 入口内容结构

入口**不是**纯指针，也不是全部规则正文；目标是 40–80 行，保证不读仓库也能守住关键约束：

1. **生成头**：来源仓库、生成时间、内容哈希、勿手改提示。
2. **最小铁律**（5 条）：
   - 中文交流，结论先行；含糊先问。
   - 动手前先读代码/确认方案；多方案给优缺点。
   - 禁止自行提交；提交说明用中文。
   - 删除文件必须先确认并走回收站；临时文件测试后清理。
   - 改代码后必须编译并实际验证；不能验证要直说。
3. **仓库索引**：通用规则、机器档案、技能目录、项目清单的路径。
4. **技能索引**：从 `content/skills/*/SKILL.md` 自动生成，内置技能带“（内置）”标记。
5. **使用约定**：需要细节时读对应文件；项目规则优先；修改规则要改仓库后再 deploy。

示例骨架：

```markdown
<!-- 由 <仓库路径> 生成；请勿直接编辑本文件 -->
# 本机 AI 工作台入口

## 必须遵守
- 中文交流，先给结论；需求含糊先确认，不猜。
- 修改代码前先读相关代码并说明影响范围；有多个方案时列出优缺点。
- 禁止自行 git commit / push；提交说明使用中文。
- 删除文件必须先确认，放入回收站；测试临时文件在结束后清理。
- 改完代码必须编译并实际验证；无法验证要明确说明。

## 工作台索引
- 通用规则：<仓库路径>\content\rules\00-index.md
- 机器档案：<仓库路径>\machines\<主机名>.md
- 技能目录：<仓库路径>\content\skills\
- 项目清单：见机器档案的“项目清单”一节

## 技能
（暂无；以后由 build 自动生成）

## 约定
- 项目自身的 AGENTS.md / 规则优先于本文件。
- 修改工作台请改真源仓库，然后运行 aiwb deploy。
```

### 5.3 部署流程

1. `detect`：探测已安装工具、配置根、入口是否已存在、有无同名文件。
2. `build`：读取 `content/rules/*`、`content/templates/*`、`content/skills/*`、`machines/<主机名>.md`，合成 `dist/ENTRY.md` 和 `dist/manifest.json`。
3. `preview`：逐目标列出动作（新建 / 追加 / 更新块 / 跳过 / 需人工合并）和原因。
4. `backup`：写入前备份到 `state/backups/<工具>/<时间戳>/`，记录 manifest。
5. `write`：只追加或写入独立文件；临时文件 + 原子替换。
6. `verify`：校验原文件前缀字节完全一致、块哈希正确；失败立即用备份回滚。
7. `state`：更新 `state/deploy-state.json`，记录动作、哈希、备份路径、时间。
8. `report`：输出部署矩阵和需人工处理的清单。

### 5.4 合并六条硬规则

1. **先备份再写**：每个目标写入前备份，备份目录 gitignore。
2. **只追加**：不改写、不重排、不删除原有内容；工作台块用固定标记包裹，重复部署只更新块内内容。
3. **原子写入 + 写后校验**：先写临时文件，校验“原文件前缀字节一致、只多了工作台块”，再原子替换；失败回滚。
4. **块被手改就停手**：块内哈希与状态记录不一致时，不覆盖，只报告“需人工确认”。
5. **合并失败只报告，不半写**：编码不是 UTF-8、文件被锁/只读、frontmatter 损坏、目标不是纯文本 → 跳过，输出手工合并清单（目标路径、建议追加内容、备份路径）。
6. **不做语义合并**：现有规则与工作台铁律冲突（如允许自动提交）时，不猜、不删，列入“需人工确认”；重复条目只提示精简，不自动删除。

标记格式：

```markdown
<!-- AI-WORKBENCH:BEGIN -->
...工作台内容...
<!-- AI-WORKBENCH:END -->
```

### 5.5 技能目录接入

- `content/skills/<name>/` 是唯一正文。
- `deploy` 在各工具用户级技能目录创建 junction，例如：
  `~/.qoder-cn/skills/<name>` → `<仓库路径>\content\skills\<name>`
- 同名保护：
  - 目标不存在 → 创建 junction。
  - 已是指向本仓库的 junction → 保留/更新。
  - 是真实目录（用户自建技能）→ 跳过并报告，不覆盖。
  - 是指向别处的 junction → 报告，不替换。
- 不认 SKILL.md 的工具，靠入口里的技能索引 + “按需读取正文”兜底。

### 5.6 项目挂载（可选）

定义：把工作台入口挂到某个具体项目仓库的根目录，让 AI 打开该项目时自动看到工作台规则。别名：项目级入口、项目关联。

内容只放指针：

```markdown
<!-- AI-WORKBENCH:BEGIN -->
> 本机工作台：开始任务前请读取 <仓库路径>\dist\ENTRY.md（全局规则与技能索引）。
> 本文件其余内容为项目自身规则；冲突时以项目规则为准。
<!-- AI-WORKBENCH:END -->
```

规则：

- 项目无 `AGENTS.md` → 新建，并把 `/AGENTS.md` 追加到该仓库 `.git/info/exclude`（本地忽略，不提交）。
- 项目已有但未跟踪 → 预览后追加块，同样加入 exclude。
- 项目已有且已跟踪 → 默认不追加；列出冲突，让用户选：跳过 / 手动合并 / 改用 `AGENTS.local.md`（Qoder 支持，其他工具不一定）。
- 只对用户勾选的项目生效；默认一个都不挂。
- `detach` 只删除工作台块；若文件是工作台创建且无其他内容，才删除整个文件。
- 不能可靠拦截“AI 工具打开工作区”事件；替代方案：全局入口加一条软提醒（首次在新项目工作且无 AGENTS.md 时询问是否挂载），GUI 打开期间扫描 `<项目父级>` 新目录并提示“未挂载”，但不自动写。

---

## 六、内容规划

### 6.1 通用规则（`content/rules/`）

| 文件 | 内容 | 主要来源 |
|---|---|---|
| `00-index.md` | 规则总索引、阅读顺序、机器档案入口 | 汇总 |
| `01-communication.md` | 中文、结论先行、含糊先问、多方案给优缺点、观察与推断分开、不能验证要直说 | 个人记忆 + Trae 规则 |
| `02-workflow.md` | 先读代码、动手前确认、禁止自行提交、中文提交、删除走回收站、临时文件清理、改完编译+实际验证、测试回归 | 桌面 AGENTS.md + Trae 规则 |
| `03-coding.md` | 中文注释、只写必要注释、函数注释四要素、不随意删旧注释、优先复用；按语言给格式 | Trae 规则 + 通用实践 |

注释格式建议：

| 语言 | 格式 |
|---|---|
| C# | XML 文档注释：`<summary>`、`<param>`、`<returns>`、`<remarks>` |
| C/C++ | Doxygen：`@brief`、`@param`、`@return`、`@note` |
| Python | docstring：摘要、Args、Returns、Raises、Notes |
| JavaScript/TypeScript | JSDoc：`@param`、`@returns`、`@remarks` |
| SQL | `--` 行注释；必要处说明参数与结果 |

### 6.2 机器档案（`machines/<主机名>.md`）

存放**所有与这台机器相关的差异**，不放进通用规则：

- frontmatter：`host`、`backupRetention`、`guiPort` 等本机设置。
- 机器环境：Windows 版本、Shell、盘符空间、用户目录链接布局、真实桌面、git 身份。
- 路径：项目父级、资料目录、Qoder 工作区、桌面交付路径。
- 项目清单：名称、路径、技术栈、构建/测试命令、备注。
- 本机特有注意事项。

`machines/<主机名>.md` 示例：

```markdown
---
host: <主机名>
backupRetention: 10
guiPort: 0
---

## 机器环境
- Windows 10 x64；Shell 为 Git Bash
- C:\Users\<用户> 链接到 <链接目标>
- 真实桌面：<桌面交付路径>

## 路径
- 项目父级：<项目父级>
- 工作参考资料：<工作参考资料目录>
- 个人资料：<个人资料目录>
- 学习资料：<学习资料目录>
- 其他资料：<其他资料目录>

## 项目清单
| 名称 | 路径 | 技术栈 | 构建/测试 | 备注 |
|---|---|---|---|---|
| <备份工具> | <项目路径> | Python | 待补 | AI 环境迁移工具 |
| <项目名> | <项目路径> | C#/.NET | 待补 | <项目名> |
```

`machines/_template.md` 用于新机器；`deploy` 未找到当前主机档案时生成模板并要求填写。

### 6.3 技能（`content/skills/`）

- 每个技能一个目录：`content/skills/<name>/SKILL.md`，可带 `scripts/`、`references/` 等资源。
- `SKILL.md` 必须有 `name`、`description`，且 `name` 与目录名一致；描述写清触发场景。
- 新建：`aiwb content new-skill <name> --description "触发场景"`；`build` 自动扫描并生成入口技能索引，不需要手工登记。
- 校验：`aiwb content lint` 检查 frontmatter、重名、名称格式、盘符绝对路径；`doctor` 复用同一套检查。
- 正文不写本机盘符绝对路径；需要仓库位置时，引用全局入口中的“工作台索引”。
- 内置技能 `aiwb` 标记 `builtin: true`，说明工作台维护命令与禁止事项。`content lint` 要求它存在且不得取消 builtin；后续 `uninstall` 和 GUI 删除动作也必须跳过内置技能。要调整只能改仓库文件，再 lint/build/deploy。
- 厂商技能只在 `adapters/README.md` 登记，不复制、不改写。
- 第一批自研业务技能仍未开始；`aiwb` 是工作台自身的内置技能，不计入业务技能。

### 6.4 模板（`content/templates/`）

| 文件 | 用途 |
|---|---|
| `entry-header.md` | 生成头：来源、时间、哈希、勿手改 |
| `entry-essentials.md` | 入口内 5 条最小铁律 |
| `entry-index.md` | 仓库索引与技能索引的框架 |
| `project-block.md` | 项目挂载块 |
| `codebuddy-frontmatter.md` | CodeBuddy `.mdc` frontmatter |

模板中不写死本机路径；路径由 `entry-builder` 从机器档案注入。

---

## 七、CLI 设计

### 7.1 命令表

| 命令 | 作用 | 关键参数 |
|---|---|---|
| `aiwb detect` | 探测工具与路径 | `--json` |
| `aiwb build` | 合成 `dist/ENTRY.md` | `--check` |
| `aiwb content` | 校验内容、生成规则/技能骨架 | `lint` / `new-rule <slug>` / `new-skill <name> --description "..."` / `--dry-run` |
| `aiwb deploy` | 部署入口 | `--dry-run` / `--apply` / `--tool <id>` / `--projects` |
| `aiwb status` | 部署状态矩阵 | `--json` |
| `aiwb doctor` | 健康检查/漂移检测 | `--fix` / `--parity` / `--json` |
| `aiwb merge <target>` | 冲突合并 | `--preview` / `--apply --content-file <path>` |
| `aiwb backup list` | 列出备份 | `--tool <id>` |
| `aiwb backup restore <id>` | 恢复备份 | `--yes` |
| `aiwb uninstall` | 卸载工作台入口 | `--tool <id>` / `--project <path>` / `--yes` |
| `aiwb scan` | 扫描项目仓库 | `--root <项目父级>` |
| `aiwb attach <path>` | 项目挂载 | `--mode auto/local/append` |
| `aiwb detach <path>` | 取消项目挂载 | `--yes` |
| `aiwb log` | 操作历史 | `--limit N` |
| `aiwb diagnose` | 诊断包 | `--zip` |
| `aiwb gui` | 启动本地 GUI | `--port 0` |

### 7.2 输出约定

- 默认人类可读；`--json` 输出机器可读结果，供 GUI 和脚本使用。
- 退出码：0 成功；1 一般失败；2 需要人工处理（冲突/跳过）；3 环境不满足。
- 所有写操作默认先 dry-run 语义；`--apply` 才落盘。
- 每个动作输出“备份路径”和“可回滚方式”。

### 7.3 启动器与包配置

- `launchers/aiwb.cmd`：`node src\cli\main.mjs %*`
- `launchers/aiwb-gui.cmd`：`node src\cli\main.mjs gui --open`
- Node 不存在时：打印安装提示和 CLI 的替代路径，不自动安装。

`package.json` 要点：

```json
{
  "name": "ai-workbench",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "engines": { "node": ">=20" },
  "bin": { "aiwb": "src/cli/main.mjs" },
  "scripts": {
    "build": "node src/cli/main.mjs build",
    "deploy:dry": "node src/cli/main.mjs deploy --dry-run",
    "doctor": "node src/cli/main.mjs doctor",
    "parity": "node src/cli/main.mjs doctor --parity",
    "check-paths": "node dev/check-paths.mjs",
    "test": "node --test --test-concurrency=1 \"tests/**/*.test.mjs\" \"tests/*.test.mjs\"",
    "gui": "node src/cli/main.mjs gui --open"
  }
}
```

运行时零依赖；`devDependencies` 仅在重新构建 CodeMirror 预构建产物时需要。

---

## 八、GUI 设计

### 8.1 选型

**本地 Web GUI：Node 后端 + 浏览器 + CodeMirror 6 MergeView。**

| 方案 | 运行时 | 差异/合并体验 | 体积/安装 | 结论 |
|---|---|---|---|---|
| 本地 Web（Node + 浏览器） | Node（本机已装） | 强，MergeView | 无安装、秒开 | **采用** |
| Electron | Node + Chromium | 强 | 200MB+，需打包 | 不采用 |
| Tauri | Rust + WebView2 | 强 | 需 Rust 工具链 | 不采用 |
| WPF/WinForms | .NET 10 | 合并 UI 需自建，弱 | 中等 | 不采用 |
| .NET + 本地 Web | .NET 10 | 强 | 需发布 exe | 备选 |
| VS Code 扩展 | 依赖 IDE | 强 | 依附工具 | 只作补充 |

选择理由：

- 需求核心是冲突对比和人工合并，Web 生态有成熟的 MergeView。
- 不引入 Electron 体积；以后若要桌面壳，可包同一套 Web UI。
- 浏览器打开即用，不常驻大进程。
- CodeMirror 预构建产物入库，离线可用，不需要运行时 npm。

### 8.2 页面

| 页面 | 功能 |
|---|---|
| 总览 | 工具矩阵、入口状态、漂移/冲突/跳过、上次部署时间、一键体检 |
| 部署 | 预演、勾选工具、逐项动作与原因、执行、查看备份 |
| 冲突合并 | 三栏：现有文件 / 工作台内容 / 合并结果（可编辑）；预览、校验、应用、恢复备份 |
| 项目挂载 | 扫描 `<项目父级>`，列出仓库、挂载状态、git 状态、批量 attach/detach、预览 |
| 内容维护 | 浏览/编辑 `content/rules/`、`content/skills/`、`machines/`；新建规则/技能、校验、Markdown 预览、查看 git diff、手动提交 |
| 备份与回滚 | 备份列表、单文件恢复、清理旧备份 |
| 历史 | 操作日志、部署记录、drift 记录 |
| 设置 | 工具路径覆盖、入口注册、备份保留数、GUI 端口、环境变量 |
| 诊断 | 生成诊断 zip（状态、哈希、日志、路径清单；不含密钥） |

### 8.3 与 CLI 的功能对等

| 能力 | CLI | GUI |
|---|---|---|
| 工具探测/环境检查 | `detect` | 总览页一键扫描 |
| 部署预演/执行 | `deploy --dry-run/--apply` | 部署页 |
| 单工具重部署 | `deploy --tool` | 工具行按钮 |
| 冲突合并 | `merge` | 三栏合并页 |
| 健康检查/修复 | `doctor --fix` | 总览页状态 + 一键修复 |
| 卸载/回滚 | `uninstall` / `backup restore` | 备份页、工具行 |
| 项目挂载 | `scan` / `attach` / `detach` | 项目页 |
| 内容维护 | `content lint/new-rule/new-skill` | 内容页：新建、编辑、校验、保存后 build |
| 状态/日志 | `status` / `log` | 总览/历史页 |
| 设置 | 配置文件/环境变量 | 设置页 |
| 诊断包 | `diagnose --zip` | 诊断页按钮 |
| 等价命令 | — | 每个操作显示对应 CLI 命令 |

- GUI 必须覆盖 CLI 的全部交互型能力；CLI 保留自动化专用能力（`--json`、管道、CI 退出码、无人值守批处理、debug 日志）。
- `doctor --parity` 保证注册表层面不缺项。
- GUI 不提供任意 shell 终端，避免绕过安全规则。

### 8.4 安全约束

- 只监听 `127.0.0.1`，随机端口 + 启动 token。
- 文件 API 只允许 `adapters/targets.json` 注册的入口路径和仓库内容，不接受任意路径。
- 默认只读；写操作必须显式确认，走与 CLI 相同的核心。
- 写操作二次确认；卸载/回滚等破坏性操作要求输入确认词。
- 空闲 30 分钟自动退出。
- 不使用外部 CDN；CodeMirror 预构建产物入库。
- 日志不记录令牌、密钥、文件正文。
- 同一时间只允许一个写操作：`state/locks/deploy.lock`。

---

## 九、注册表与状态模型

### 9.1 `adapters/targets.json`

```json
{
  "version": 1,
  "tools": [
    {
      "id": "qoder-cn",
      "name": "Qoder CN",
      "configRoot": "~/.qoder-cn",
      "entry": {
        "path": "~/.qoder-cn/AGENTS.md",
        "format": "markdown",
        "mode": "single-file"
      },
      "skillsDir": "~/.qoder-cn/skills",
      "status": "documented",
      "notes": "用户级 AGENTS.md；加载需部署后实测"
    }
  ]
}
```

`status` 取值：`verified`（已实测）、`documented`（文档支持未实测）、`unverified`（社区资料）、`unsupported`（不接）。

### 9.2 `state/deploy-state.json`

```json
{
  "version": 1,
  "machine": "<主机名>",
  "lastRun": "2026-10-26T13:00:00+08:00",
  "targets": {
    "qoder-cn": {
      "entryPath": "C:\\Users\\<用户>\\.qoder-cn\\AGENTS.md",
      "action": "created",
      "blockHash": "sha256:...",
      "fileHash": "sha256:...",
      "backup": "state/backups/qoder-cn/20261026-130000/",
      "deployedAt": "2026-10-26T13:00:00+08:00"
    }
  },
  "projects": {
    "<项目路径>": {
      "mode": "created",
      "blockHash": "sha256:...",
      "excludeAdded": true,
      "attachedAt": "2026-10-26T13:10:00+08:00"
    }
  }
}
```

### 9.3 备份、日志与锁

- 备份：`state/backups/<tool>/<timestamp>/<原文件名>`，附 `manifest.json`（原路径、原哈希、动作）。
- 保留策略：每目标默认最近 10 份，可在机器档案中调整；永不自动删除最近一份。
- 日志：`state/logs/deploy-YYYYMM.jsonl`，记录动作、目标、结果、备份路径；不含文件正文和令牌。
- 锁：`state/locks/deploy.lock`，CLI/GUI 写操作前获取；含 PID 和时间，超时可判定为陈旧锁。
- `state/` 整体 gitignore；备份不随仓库迁移。

### 9.4 doctor 检查项

- 入口文件是否存在、是否包含工作台块、块哈希是否与状态一致。
- 入口文件是否有外部改动（文件哈希变化）。
- junction 是否失效/指向别处。
- `dist/ENTRY.md` 是否比入口新（需要重新部署）。
- 技能索引与实际 `content/skills/` 是否一致。
- 规则命名、编号、索引登记、失效引用，技能 frontmatter、重名、内置技能是否存在（与 `content lint` 同源）。
- `doctor --parity`：CLI 动作与 GUI 元数据是否对齐。
- 项目挂载：文件是否存在、块哈希、exclude 行是否存在、项目是否已跟踪该文件。
- 机器档案是否存在；目标路径是否随工具升级失效。
- `dev/check-paths`：README/docs 中的路径是否仍存在。

### 9.5 原子写与编码

- 统一按字节读写；检测 UTF-8 BOM、UTF-16、GBK。
- 非 UTF-8 目标不自动合并，报告手工处理。
- 保留原文件换行风格（CRLF/LF）。
- 写入流程：临时文件 → 校验 → 原子替换；失败用备份回滚。

---

## 十、迁移与维护

### 10.1 新机器

1. 安装 Git 和 Node.js LTS（GUI/CLI 需要）。
2. `git clone <私库地址> <仓库路径>`。
3. 运行 `aiwb detect`，确认工具与路径。
4. 复制 `machines/_template.md` 为 `machines/<新主机名>.md`，填写机器环境、路径、项目清单。
5. `aiwb deploy --dry-run` 查看动作，再 `--apply`。
6. 对需要的项目执行 `aiwb attach`。
7. 各工具新开会话抽检。

### 10.2 日常维护

- 改通用规则：只改 `content/rules/` → `content lint` → 本地提交（中文说明）→ `aiwb build` → `aiwb deploy` → `aiwb doctor`。
- 改机器路径/项目清单：只改 `machines/<主机名>.md` → 同上。
- 新增/修改工具入口：改 `adapters/targets.json` 和 `src/core/targets/<tool>.mjs` → 跑集成测试 → deploy。
- 新增规则：`aiwb content new-rule <slug>`（自动编号并登记 `00-index.md`）→ 补正文 → `content lint` → build → deploy。
- 新增技能：`aiwb content new-skill <name> --description "触发场景"` → 补正文 → `content lint` → build → deploy（自动建 junction 和索引）。
- 删除技能：先 `uninstall`/移除 junction，再删 `content/skills/` 目录；内置技能 `aiwb` 不允许删除；不要直接删用户目录里的真实技能。
- 工具升级后：`aiwb detect` + `doctor`，检查入口路径是否失效。
- 每月或换机后：`doctor` + 各工具抽检一次。
- 新项目：`scan` 后按需 `attach`，不自动挂载。
- 升级 CodeMirror：`dev/build-vendor.mjs` 重新生成并提交 `src/gui/web/vendor/`。

### 10.3 迁移与备份

- 主渠道：Git 私库（地址待提供）。
- 辅助：可把工作台目录加入 <备份工具> 的备份条目（可选，待确认）。
- 不入库：`dist/`、`state/`、备份、日志、密钥、机器令牌。
- 机器差异：`machines/` 每台一份；不要把某台机器的绝对路径写进 `content/`。
- 项目挂载块含绝对路径；换机后由 deploy/attach 重写。
- 离线迁移：`dev/package.mjs` 生成 zip（含源码和文档，不含 state/dist）。

### 10.4 卸载

- `aiwb uninstall --tool <id>`：删除该工具入口中的工作台块或工作台创建的文件；保留备份。
- `aiwb uninstall --project <path>`：只移除项目挂载块和 exclude 行。
- 不删除用户原有内容；不删除仓库本身。

---

## 十一、落地阶段与验收

### 11.1 阶段

| 阶段 | 内容 | 退出条件 |
|---|---|---|
| P0 | 建仓库骨架：`content/`、`machines/`、`adapters/`、`src/`、`launchers/`、`dev/`、`tests/`、`docs/`；写 `rules/*`、`<主机名>.md`、`targets.json` | 不写任何工具目录；本地可生成 `dist/ENTRY.md` |
| P1 | `src/core` + CLI：detect/build/deploy/doctor/status；先接 Qoder CN | DryRun 清单正确；Qoder 新会话实测通过 |
| P2 | GUI MVP：总览、部署、冲突合并；动作注册表 + parity | 浏览器实测通过；GUI 与 CLI 结果一致 |
| P3 | 项目挂载、备份/回滚、内容维护、设置 | attach/detach 可逆；git 状态干净 |
| P4 | 接入其余已装工具；Git 私库；新机演练 | 各工具抽检通过；clone+deploy 可复现 |

### 11.2 验收标准

1. 任一已接入工具新开会话，不给背景，能答对：资料目录、项目父级、注释规范、能否自动提交、有哪些技能。
2. 让它说明“删除测试文件”的流程，必须包含“先确认 + 回收站”。
3. 改一条规则 → build → deploy → 各入口哈希一致；doctor 能报出人为改副本的漂移。
4. GUI 部署矩阵与 `state` 一致；冲突页能显示三栏并成功应用；应用后原文件前缀字节不变。
5. `doctor --parity` 通过，无 CLI/GUI 功能缺项。
6. 项目挂载只影响勾选仓库；新建的 `AGENTS.md` 不出现在 git 状态中；detach 后恢复干净。
7. 新机器 clone + deploy + 抽检可在 10 分钟内完成（不含安装工具）。
8. 现有 Trae 3 条规则、Qoder `test.md`、CodeBuddy `test.mdc` 未被修改。
9. `dev/check-paths` 通过：README/docs 中不存在失效路径。

### 11.3 抽检口令

- “不看任何文件，告诉我：①资料目录 ②项目父级 ③注释规范 ④能不能自己提交 ⑤有哪些技能。”
- “读一下安全删除规则，说明你会怎么删一个测试文件。”
- “这个项目的构建命令是什么？”（验证机器档案的项目清单）

---

## 十二、风险与待确认事项

### 12.1 风险

| 风险 | 影响 | 缓解 | 状态 |
|---|---|---|---|
| QwenWork/WorkBuddy/CodeBuddy 全局入口文件名不确定 | 部署后不生效 | 逐项实测；失败则用工具规则目录或手动口令兜底 | `[待实测]` |
| Trae 桌面版 AGENTS.md 需开关 | 项目级挂载可能不生效 | 文档提示用户开启；用户级仍用 user_rules | `[文档]` |
| Trae/CodeBuddy 用户级技能目录未确认 | 技能 junction 无效 | 部署时实测；不认则靠入口索引按需读取 | `[待实测]` |
| Claude Code 未安装，AGENTS.md 支持随版本 | 入口可能不生效 | 装后实测；默认按 CLAUDE.md 处理 | `[文档]` |
| 项目挂载污染 git | 误提交个人规则 | 默认关闭；新建文件写 `.git/info/exclude`；已跟踪文件默认不改 | 已设计 |
| Node 依赖 | 新机器无 Node 时 CLI/GUI 不可用 | 启动器检测并提示安装；备选 PowerShell 核心（待定） | `[待确认]` |
| 全局入口过长 | 占用上下文 | 控制在 40–80 行；细节按需读取 | 已设计 |
| 工具升级改路径 | 入口失效 | doctor 检测；adapters 表维护 | 已设计 |
| 中文路径 | 部分脚本兼容差 | 仓库用 ASCII 路径；目标路径加引号 | 已设计 |
| 本地 GUI 服务被滥用 | 读取/修改配置 | 仅 127.0.0.1、token、路径白名单、默认只读、空闲退出 | 已设计 |
| CLI/GUI 同时写 | 状态/文件冲突 | `state/locks/deploy.lock` + 陈旧锁处理 | 已设计 |
| 备份占用空间 | D 盘增长 | 默认保留 10 份；可清理 | 已设计 |
| 现有规则与工作台规则重复/冲突 | 双重规则、行为矛盾 | 不自动删；部署后逐条确认再精简 | 已设计 |
| 文档与代码路径漂移 | 维护时找不到文件 | `dev/check-paths.mjs` 检查 | 已设计 |

### 12.2 待确认

1. ~~核心是否统一用 Node 实现~~：已决策采用 Node，并在 P0 实施。
2. 项目挂载是否按“默认关闭、只写本地不入库、已跟踪文件默认只报告”执行（P3 前确认）。
3. Git 私库地址（Gitee/GitHub 私有仓库），待提供。
4. GUI 的 CodeMirror 采用预构建入库（推荐）还是首次 npm 构建（P2 前确认）。
5. 是否需要额外放一份 `<项目父级>\AGENTS.md` 作为父级兜底（收益有限，很多工具读到 git 根就停止）。
6. 是否把工作台目录纳入 <备份工具> 备份（可选）。
7. 规则正文的最终措辞（当前为第一版草案，需要逐条确认）。

---

## 十三、已决策记录

| 日期 | 问题 | 决策 | 理由 |
|---|---|---|---|
| 2026-10-26 | 仓库位置 | `<仓库路径>` | 用户指定；`<项目父级>` 是所有本地项目仓库的公共父目录 |
| 2026-10-26 | 项目父级 | `<项目父级>` | 用户澄清；`<工作参考资料目录>` 只是参考资料，不适合作为仓库父级 |
| 2026-10-26 | 规则/技能同步 | 混合：规则文本生成副本，技能目录用 junction | 兼容性最好，不依赖开发者模式 |
| 2026-10-26 | 仓库内容边界 | 只放跨工具公共规则和技能；工具独有内容不碰 | 避免冲突，便于维护 |
| 2026-10-26 | 第一批自研技能 | 先不做 | 先把规则和分发骨架跑通 |
| 2026-10-26 | 跨机迁移 | Git 私库 | 有版本历史，换机 clone 即可 |
| 2026-10-26 | 部署方式 | 脚本一键写各工具用户级入口 | 单一真源，减少重复交代 |
| 2026-10-26 | 合并策略 | 只追加、备份、原子写、失败只报告 | 绝不破坏原有工具环境 |
| 2026-10-26 | GUI 定位 | 覆盖 CLI 的全部交互型能力，不只做查看器 | 否则 GUI 意义不大 |
| 2026-10-26 | GUI 选型 | 本地 Web（Node + 浏览器 + CodeMirror MergeView） | 差异/合并体验最好，体积最小 |
| 2026-10-26 | 项目挂载 | 可选、用户确认、默认关闭、只写本地 | 避免污染仓库和团队项目 |
| 2026-10-26 | 项目结构 | `content/` + `machines/` + `adapters/` + `src/` + `launchers/` + `dev/` + `tests/` + `docs/` + `dist/` + `state/` | 部署源、构建产物、外部部署物、运行状态分离 |
| 2026-10-26 | 机器内容 | 环境/路径/项目清单放 `machines/`，不进 `content/rules/` | 换机器只改机器档案 |
| 2026-10-26 | 运行时依赖 | 零 npm 运行时依赖；CodeMirror 预构建入库 | 迁移简单、离线可用 |

---

## 十四、下一步

1. P1：实现 `deploy --apply` 的安全写入链路（备份、临时文件 + 原子替换、原前缀字节校验、块哈希校验、并发锁、状态记录、失败回滚），先只接 Qoder CN。
2. 部署 Qoder CN，用新会话实测入口加载；通过后再逐项验证 Trae、CodeBuddy、QwenWork、WorkBuddy 的真实入口文件名。
3. P2：GUI MVP（总览、部署预演、冲突合并），用真实浏览器验证；补齐 `doctor --parity` 的运行时检查。
4. P3：项目挂载、备份/回滚、技能 junction、卸载、内容维护。
5. P4：Git 私库、新机器 clone + deploy 演练、其余工具接入。

---

## 附录 A：参考资料与依据

### A.1 本机证据

- 桌面路径：注册表 `HKCU\Software\Microsoft\Windows\CurrentVersion\Explorer\User Shell Folders\Desktop` = `<桌面交付路径>` `[实测]`
- 用户目录链接：`C:\Users\<用户>` → `<链接目标>` `[实测]`
- Trae 全局规则：`~/.trae-cn/user_rules/` 下 3 个文件 `[实测]`
- Qoder 规则：`~/.qoder-cn/rules/test.md` `[实测]`
- CodeBuddy 规则：`~/.codebuddy/rules/test.mdc` `[实测]`
- 技能目录：`~/.qwenworkcn/skills/`、`~/.workbuddy/skills/`、`~/.trae-cn/builtin_skills/`、`~/.codebuddy/skills-marketplace/` `[实测]`
- 工作区：`<Qoder 会话工作区>\<日期>\<id>` `[实测]`
- 项目仓库：`<项目父级>` 下 30+ 个 `.git`（maxdepth 3） `[实测]`
- 参考目录：`<工作参考资料目录>`、`<个人资料目录>`、`<学习资料目录>`、`<其他资料目录>` `[实测]`
- 运行时版本：Node <版本>、npm <版本>、PowerShell <版本>、.NET <版本>、Python <版本>、Git <版本> `[实测]`

### A.2 外部资料

- Qoder 用户级 Skills 路径与多工具路径对照：https://blog.csdn.net/weixin_63007863/article/details/168107195
- Qoder Rules 与 AGENTS.md 加载优先级：https://m.toutiao.com/article/7675273925344887338/
- Trae 官方规则文档（全局 user_rules）：https://docs.trae.cn/ide_rules?lang=zh
- Trae Skill 目录说明：https://m.blog.csdn.net/qq_37027335/article/details/161949102
- WorkBuddy Skill 目录优先级：https://m.blog.csdn.net/weixin_31100517/article/details/166822539
- 主流 Agent 配置加载机制横评：https://tendcode.com/subject/article/agent-config-mechanisms-guide/
- AGENTS.md 全局写法是单工具扩展，不是所有工具都认：https://blog.csdn.net/weixin_29046611/article/details/166615384
- AGENTS.md 落地维护指南（Qoder 支持用户级 AGENTS.md、Trae 需开关）：https://blog.csdn.net/forwujinwei/article/details/164423087

---

## 附录 B：术语

| 术语 | 含义 |
|---|---|
| 部署源 | `content/` + `machines/` + `adapters/` + `content/templates/`，构建入口的输入 |
| 构建产物 | `dist/ENTRY.md`、`dist/manifest.json`，由 build 生成，不入库 |
| 外部部署物 | 写到工具配置根/项目目录的入口块、独立文件、junction |
| 运行状态 | `state/` 下的部署记录、备份、日志、锁，不入库 |
| 用户级入口 | 各工具用户配置根下的全局规则文件，作用于该工具所有会话 |
| 项目级挂载 / 项目挂载 | 在指定项目仓库根目录放置工作台指针 `AGENTS.md`，只作用于该项目 |
| 入口块 | 用 `AI-WORKBENCH:BEGIN/END` 标记包裹的工作台内容，可幂等更新 |
| 漂移 | 入口文件被人工修改或工具改动，与仓库生成内容不一致 |
| 真源仓库 | `<仓库路径>`，规则/技能/机器档案的唯一维护位置 |
| 动作注册表 | `src/core/registry.mjs`，CLI 与 GUI 共用的功能定义，保证功能对等 |
| 目标注册表 | `adapters/targets.json`，记录各工具入口路径、格式、技能目录和验证状态 |
| 机器档案 | `machines/<主机名>.md`，记录该机器的路径、环境、项目清单和本机设置 |

---

## 附录 C：明确不做清单

- 不接管/不修改各工具独有规则、技能、插件、人设、记忆文件。
- 不复制厂商技能进仓库。
- 不自动给所有项目挂载 `AGENTS.md`。
- 不修改已跟踪的项目 `AGENTS.md`（只报告，由用户决定）。
- 不在仓库保存密钥、令牌、账号凭据。
- 不把 `C:\Users\<用户>\AGENTS.md` 当作全工具通用入口。
- 不提供 GUI 任意 shell 终端。
- 不自动提交 git（CLI/GUI 都只给按钮/命令，由用户执行）。
- 不在 `content/` 写本机绝对路径；不在 `machines/` 写跨机器通用规则。
