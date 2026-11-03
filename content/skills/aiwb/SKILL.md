---
name: aiwb
description: 维护和使用本机 AI 工作台时使用；包括新机器首次初始化与部署引导、机器档案、通用规则与技能维护、构建部署、状态漂移、备份回滚和项目挂载。
builtin: true
---

# AI 工作台维护

本技能属于工作台自身，内置且受保护：不要删除目录，也不要把 `builtin` 改成 `false`。需要调整时通过仓库修改，并重新执行 `content lint`、`build` 和 `deploy --apply`。

## 何时使用

- 用户要求修改跨工具通用规则、注释规范、提交规则或资料目录约定。
- 用户要求新增、修改技能，或把技能接入某个 AI 工具。
- 用户要求构建、部署、检查各工具入口是否生效或漂移。
- 新机器首次克隆、本机档案缺失或缺少“项目父级/全局工作台”，需要初始化并首次部署；用户说“初始化本机”“配置工作台”或“开始部署”时进入首次初始化流程。

## 先读

1. 工作台仓库根目录的 `AGENTS.md`：维护边界、首次初始化契约与验证要求。
2. `docs/onboarding.md`：首次初始化的开场讲解、待办清单、分组确认、部署后指导与失败处理。
3. `docs/maintenance.md`：日常操作和当前未实现能力。
4. `content/rules/00-index.md`：规则索引和生效顺序。

仓库位置见当前全局入口的“工作台索引”；不要凭记忆猜路径。

## 常用操作

- 首次初始化：按仓库根目录 `AGENTS.md` 的“首次初始化（新机器）”和 `docs/onboarding.md` 执行。开场先讲解本机档案、写入范围、备份回滚、版本要求与首次部署前技能不可用，展示初始化/部署待办清单；再只读盘点并生成候选档案，逐项确认后才写入，运行 `build`、`detect --json`。之后询问用户选择 CLI 或 GUI 部署：CLI 由 AI 运行 `deploy --dry-run`，用户确认后再 `deploy --apply`；GUI 启动 `gui --open` 后指导用户在“部署”页选择目标、预演、勾选确认并点“执行部署”，AI 不代替用户点击。最后运行 `status`、`doctor` 并给出验收与后续维护指导。首次初始化时本技能尚未部署，不要等待它被自动发现。
- 校验内容：`aiwb content lint`。
- 查看与编辑：`aiwb content list` 列出规则与技能，`aiwb content read <rule|skill> <名称>` 读取正文与哈希；修改后用 `aiwb content save <rule|skill> <名称> --content-file <路径>` 预演，确认后加 `--expected-hash <读取时的哈希> --apply` 写入并重建构建。
- 新增规则：`aiwb content new-rule <slug> --title "标题"`，再补正文；加 `--build` 会立即重建构建。
- 新增技能：`aiwb content new-skill <name> --description "触发场景"`，再补正文；加 `--build` 会立即重建构建。
- 构建：`aiwb build`；只检查：`aiwb build --check`。
- 部署预演：`aiwb deploy --dry-run`，或在 GUI 部署页点“预演”；预演只读。
- 部署执行：`aiwb deploy --apply`，或在 GUI 部署页勾选确认后点“执行部署”；先看预演，确认后再写。入口写入后会创建或复用各工具的技能 junction。
- 记忆注入：WorkBuddy 用户级向账号记忆文件 `~/.workbuddy/user-<uid>-<企业或个人>/MEMORY.md` 顶部写入 `USER-GLOBAL-RULES:BEGIN/END` 标记区块，区块外记忆保持原样。账号目录按 `~/.workbuddy/storage/skeleton/account-snapshot.json` 动态解析；快照缺失、非法、超过 4096 字节或保存超过 30 天时解析回落到设备根 `~/.workbuddy/MEMORY.md`，但工作台不写入设备根，部署按需人工阻止（已有账号目录视为疑似已登出，否则视为未检测到登录），先启动 WorkBuddy 登录再部署。旧版本写在设备根的区块需先 `uninstall --tool workbuddy` 清理，再部署到账号目录。区块与全文合计在目标线内才内联；超过目标线只留钩子，正文写 `memory/ai-workbench-global-rules.md`；超过注入上限时置顶钩子仍写入并警告。入口保持原 BOM 与换行，拆分文件固定 UTF-8 无 BOM + LF，字符数按码点计算。部署预演与 `doctor` 另列不含空白字符、文件字节与字数估算，供和编辑器或工具显示对照，预算判断仍按含空白字符。`doctor` 的“记忆注入”检查会报告入口文件超过注入上限，按提示精简区块外旧记忆即可，不影响部署。部署后开新会话问“当前生效的自定义指令有哪些”，能复述才算成功。
- 手工合并：`aiwb merge <工具 id>` 先预演，按 `--json` 的 `suggested` 编辑工作台块内正文；写入前保存为文件并运行 `aiwb merge <工具 id> --apply --content-file <路径>`，确认后再执行。块外原文不能改，GUI 合并页提供同一流程。目标填写了版本要求且核对未通过时，合并会被阻止。记忆注入目标不支持手工合并，需改 `content/rules/` 后重新部署。
- 卸载入口：`aiwb uninstall [--tool <id>]` 先预演，确认后加 `--apply`；不带 `--tool` 会处理全部工具并移除全局脚本 junction。
- 扫描项目：`aiwb scan` 列出机器档案“项目父级”与“项目清单”中的项目及挂载状态；只读。
- 挂载项目：`aiwb attach <项目路径> [--mode auto|local|append]` 先预演，确认后加 `--apply`；`auto` 与 `append` 写 `AGENTS.md`，`local` 写 `AGENTS.local.md`。目标入口已被 git 跟踪时 `auto` 与 `local` 阻止写入，确认要改版本库后再用 `append`；未跟踪入口写入后加入 `.git/info/exclude`。
- 取消挂载：`aiwb detach <项目路径>` 先预演，确认后加 `--apply`；只移除工作台块，工作台创建且块外为空的文件才删除。
- 全局工作台与技能：`aiwb deploy --apply` 会一并安装全局工作台目录、脚本 junction 与技能 junction；也可单独运行 `node scripts/install-global.mjs --apply` 安装全局工作台。
- 主动备份：`aiwb backup create [--tool <id>]`；只读取现有入口并写本地 `state/backups/`，不改工具目录或部署状态。记忆注入目标同时备份入口与拆分文件，拆分文件备份不能单独恢复入口。
- 查看备份：`aiwb backup list [--tool <id>]`。
- 清理旧备份：`aiwb backup prune [--tool <id>] [--keep <n>]` 先预演，确认后加 `--apply`；份数取 `--keep` 或机器档案 `backupRetention`，每工具最近一份始终保留。
- 恢复入口：`aiwb backup restore <工具 id> <时间戳>` 先预演，确认后加 `--apply`；恢复前会再备份当前入口。版本核对未通过时会阻止，用户确认覆盖后再加 `--force`。
- 操作历史：`aiwb log [--limit <n>]` 读取 `state/logs/deploy-YYYYMM.jsonl` 与部署/项目记录，默认最近 50 条；只读，日志不含文件正文或令牌。
- 诊断包：`aiwb diagnose [--zip]` 把状态、构建与入口哈希、体检、日志和路径清单写到 `state/diagnostics/diagnose-<时间>/`，加 `--zip` 另生成压缩包；只写本机诊断目录，不改部署状态或工具目录，也不写操作日志。包内含本机路径与主机名，但不含机器档案正文、环境变量值、规则/技能/入口正文或令牌；发给他人前先打开包内 `README.md` 复核。
- 本机设置：`aiwb settings show` 查看；`aiwb settings set <键>=<值>` 或 `aiwb settings unset <键>` 修改，默认只预演，确认后加 `--apply`。支持 `backupRetention`、`guiPort`、`env.<名称>`、`tools.<id>.enabled/version/configRoot/entryPath/skillsDir` 与 `customTools.<id>.<字段>`；设置里的 `env` 优先于进程环境变量，路径支持 `${NAME}` 与 `%NAME%`。
- 版本要求：`tools.<id>.version` 或 `customTools.<id>.version` 可选，留空表示不核对；支持精确版本、比较条件（`<`、`>`、`<=`、`>=`、`<>`）、逗号（同时满足，优先级高于 `||`）、`||`（任一满足）与英文括号，忽略大小写与 `v` 前缀。比较条件按数字分段比较，检测值无法按数字解析时按无法核对阻止。填写后部署预演与执行、合并、备份恢复和技能 junction 会先核对实际版本；不符或无法检测时部署跳过该目标并继续其他目标（CLI 退出码 2），合并与恢复阻止，恢复可用 `--force`，卸载不受影响。安装目录不在标准位置时，在 `env` 中定义 `AIWB_TRAE_CN_HOME`、`AIWB_CODEBUDDY_HOME`、`AIWB_WORKBUDDY_HOME` 指向安装根目录。
- 自定义工具：工作台未内置的工具可用 `customTools.<id>` 登记，必填 `name`、`configRoot`、`entryPath`，可设 `strategy`、`format`、`skillsDir`、`frontmatter`、`version`、`enabled`。登记后可用 `deploy --tool <id>` 单独部署，配置目录不存在也会按路径创建父目录。仍有部署记录时不能删除定义，需先 `uninstall --tool <id>`。
- 本地界面：`aiwb gui [--open]`；总览和体检只读，历史页只读展示操作、部署、项目与漂移记录，诊断页刷新只读、勾选确认后生成诊断目录与 zip，内容页可列出、读取、编辑规则与技能，校验预演并确认后保存并重建构建，新建规则/技能弹层先预演模板；合并页提供三栏对照与结果校验，备份页可“立即备份”和“清理旧备份”，项目页按每行“操作”打开弹层并支持分页和手动输入每页条数（可从下拉选预设），设置页顶部可用“添加自定义工具”打开弹层登记新工具，并可预览、写回本机设置与增删改已有工具，部署与合并的目标下拉会同步新增工具；部署、合并、内容保存、内容新建、卸载、项目挂载、清理、恢复、诊断生成与设置写入需在页面勾选确认。未修改设置、未选合并目标、内容页未选文件、备份列表为空、合并结果与建议一致时，对应按钮保持禁用，不要绕过禁用状态或直接调用接口。
- 状态与诊断：`aiwb status`、`aiwb doctor`、`aiwb diagnose [--zip]`。

## 约束

- 不手改 `dist/` 和各工具目录中的入口副本。
- 不删除或改写各工具自带的规则、技能、插件和人设；WorkBuddy 记忆文件只写带标记区块，区块外内容不改。
- 不自动执行 `git commit` / `git push`；提交说明使用中文。
- 不把本机盘符绝对路径写进 `content/`。
- 真实工具目录写入前必须先预演并得到用户确认；不要手工复制入口文件。
- 部署会写前备份、失败回滚；块被手改或已有非工作台文件时只报告，不覆盖。
- 卸载入口默认只预演；只移除带标记的工作台块、工作台创建且未改动的入口文件、本工作台生成且未改动的记忆拆分文件，以及指向本仓库的 junction。块被手改或缺部署记录时需用户确认后才加 `--force`，且不会删除文件。
- 卸载不删除全局工作台目录、用户数据、备份或用户自建的技能。
- 项目挂载默认只预演；目标入口已跟踪时 `auto` 与 `local` 阻止写入，确认要改版本库后再用 `append`；`local` 只写 `AGENTS.local.md`，且该文件自身也须未被跟踪。已挂载项目改用写另一个入口文件（`AGENTS.md` 与 `AGENTS.local.md` 之间）的模式时，先 `detach` 再 `attach`。`detach` 缺记录或块漂移时需用户确认后才加 `--force`，且不会删除文件。
- 冲突合并只改工作台块内正文；块外前缀必须逐字不变，块后只允许保留原后缀或增加一个分隔换行。块标记损坏、块内为空或编码不可读时不要强行写入，先修正标记或从备份恢复。写入前需确认，写后会更新部署记录，不要再手工覆盖。记忆注入目标不支持合并，只通过重新部署更新；拆分文件缺失或漂移时先重新部署，不要手工补写。
- 不要手工改项目入口里的工作台块或 `.git/info/exclude`；挂载后用 `scan` 与 `doctor` 检查漂移。
- 技能 junction 由部署管理；同名真实目录或指向别处的链接只报告冲突，不手工删除或替换用户技能。
- 恢复入口默认只预演；入口在部署后被修改、缺少部署记录或版本核对未通过时不会恢复，需用户确认后才加 `--force`。
- 版本要求已填写时，不要绕过部署、合并或恢复的版本阻止；先确认工具实际版本与安装路径，或由用户明确决定留空版本要求。
- 清理旧备份默认只预演；未确认时不要加 `--apply`，不要清理未注册工具目录或清单不可用的备份。
- 本机设置默认只预演；不要为了跳过校验直接改机器档案里的路径，也不要在路径变量未定义时强行 `--force`。设置只写 `machines/<主机名>.md`，不改各工具目录、部署状态或备份。
- 自定义工具定义只存在本机机器档案；单机接入不要改 `adapters/targets.json`，要成为仓库级支持才走注册表与适配代码。删除前先卸载该工具，仍有部署记录时不要绕过阻止。
- GUI 只监听 `127.0.0.1`，不要修改成对外监听；不要绕过页面确认或直接调用 `/api/run` 执行写入。
- GUI 的内容接口只允许 `lint/list/read/save/new-rule/new-skill`，只读写现有规则文件与技能的 `SKILL.md`，保存必须带读取时的哈希；`merge` 不接受 `contentFile`。GUI 的 `build` 仍只允许 `--check`，写构建产物、删除内容或从文件读取合并结果回到 CLI。
- 操作日志只读、只追加；不要手工编辑或伪造日志记录。日志不保存文件正文、令牌或密钥，`log` 与 GUI 历史页都不会修改文件。
- 诊断包只写 `state/diagnostics/`；不要把它当作脱敏文件直接公开，包内有本机路径与主机名，发送前先打开包内 `README.md` 复核。不要为了补充信息手工塞入机器档案正文、环境变量值或内容正文。
- 内容文件被其他程序改动时，保存会被拒绝并要求重新加载；不要绕过哈希校验或直接覆盖文件。保存后自动重建构建，内置技能不能删除或取消 `builtin: true`。
