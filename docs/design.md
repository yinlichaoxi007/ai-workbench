# AI 工作台：多 AI 工具通用规则与技能分发 —— 设计与落地要点

- 文档版本：v0.19（WorkBuddy 账号级记忆路径）
- 日期：2026-11-03
- 真源仓库：`<仓库路径>`
- 适用机器：<主机名>（Windows 10 x64）
- 当前状态：P0 骨架、内容维护与编辑、全局工作台安装、`deploy --apply`、`merge`、`uninstall`、`backup list/create/prune/restore`、`scan/attach/detach`、`settings show/set/unset`（含工具版本要求与自定义工具）、WorkBuddy 用户记忆注入、GUI 总览/部署/合并/项目/内容/备份/设置与技能 junction 已落地；**真实工具目录已对 Trae CN 与 WorkBuddy 执行过 apply**

结论强度标注：

| 标记 | 含义 |
|---|---|
| `[实测]` | 本机命令、文件或注册表已核实 |
| `[文档]` | 官方文档或社区资料一致，尚未在本机实际加载验证 |
| `[待实测]` | 部署阶段必须逐项验证，不能当成既成事实 |
| `[待确认]` | 需要用户拍板 |
| `[不做]` | 明确排除 |

## v0.19 WorkBuddy 账号级记忆路径（2026-11-03）

- 修正 v0.18 的入口假设：WorkBuddy 实际注入的是账号目录 `~/.workbuddy/user-<uid>-<企业或个人>/MEMORY.md`，设备根 `~/.workbuddy/MEMORY.md` 只是未绑定账号时的回落位置。应用包内的 `userStorageDirName` 与运行日志均指向账号目录 `[实测]`。
- 目标注册表新增 `entry.accountDir`：`snapshot` 指向 `storage/skeleton/account-snapshot.json`，`path` 使用 `user-{uid}-{scope}/MEMORY.md` 占位符。加载目标时读取快照 `primary` 的 `uid` 与 `enterpriseId` 动态生成路径，不硬编码任何账号标识。
- 快照判定与 WorkBuddy 保持一致：文件不存在、结构非法、超过 4096 字节或 `savedAt` 超过 30 天时视为未绑定，回落到 `entry.path`；`uid`、企业标识必须是安全目录段，解析结果必须留在配置根内，否则同样回落。
- 解析结果新增 `entryPathSource`（`account` / `device-root` / `override` / `default` / `alternative`）与 `entryPathProblem`；`detect`、`deploy`、`status`、`merge`、`settings show` 与 CLI/GUI 展示回落原因。拆分文件仍为配置根相对的 `memory/ai-workbench-global-rules.md`，不随账号目录移动。
- 未登录一律不写设备根：回落时检查配置根下是否已存在匹配 `user-{uid}-{scope}` 模式的目录，用于区分提示（已有账号目录 = 疑似已登出；没有 = 未检测到已登录账号），但两种回落都把目标记为需人工并拒绝写入设备根，`deploy` 退出码 2。登录是使用前提，设备根记忆只在未登录时可能被读取，写入会随登录后注入通道切到账号目录而失效；确需固定入口时用 `tools.workbuddy.entryPath` 显式覆盖。
- 旧版本写在设备根的区块不会自动迁移：先 `uninstall --tool workbuddy` 清理旧块，再部署到账号目录。
- 测试覆盖个人/企业目录、空白企业标识、阈值边界、缺失/非法/超限/过期快照、危险目录段、越界路径、疑似登出阻止与放行、配置校验，以及沙箱内账号路径的部署、幂等、状态与卸载。

## v0.18 WorkBuddy 记忆注入（2026-11-03）

- 新增写入策略 `memory-block`：WorkBuddy 用户级入口改到 `~/.workbuddy/MEMORY.md`，把工作台内容包在 `<!-- USER-GLOBAL-RULES:BEGIN -->` / `<!-- USER-GLOBAL-RULES:END -->` 之间写入；该文件每个会话自动注入，写入的区块等同自定义指令生效。区块外记忆保持原样，不接管、不改写。
- 预算共享：注入上限 4000 字符，目标线 3400，区块预算 600。区块与全文合计都在目标线内才内联；合计超过目标线时只保留钩子，正文放 `~/.workbuddy/memory/ai-workbench-global-rules.md`。超过注入上限时，置顶钩子仍可写入并给出警告；非置顶放置直接阻止。
- 字符数按 Unicode 码点（`Array.from(text).length`）计算，不做 LF 归一；写入前后都复算。`MEMORY.md` 保持原编码、BOM 与换行，拆分文件固定 UTF-8 无 BOM + LF。
- 标记写入前断言全文件最多一组首尾标记且顺序正确；标记重复、残缺或块被手改时停止写入并报告，不覆盖。
- 双文件事务：先写拆分文件，再写入口；任一步失败同时回滚两边。写后校验字节哈希、BOM、CRLF、唯一块、块哈希与字符数。
- 状态记录新增 `memoryMode`、`splitFilePath`、`splitFileHash`；`status` / `doctor` 对拆分文件缺失或漂移给出 `missing-split` / `drift-split`。`doctor` 还核对记忆入口文件字符数，超过 `injectLimit` 时报告为待处理并提示精简区块外旧记忆，不阻止部署。`uninstall` 移除区块，并删除本工作台生成且未改动的拆分文件。记忆目标不支持 `merge` 手工合并；需要调整时改 `content/rules/` 后重新部署。
- 备份同时保存入口与拆分文件（动作 `manual-split`）；拆分文件备份不能单独恢复入口，`backup restore` 明确拒绝并提示改用入口备份。
- CLI 与 GUI 都展示记忆注入模式、区块字符数、合计/上限、拆分文件与预算提醒；另显示不含空白字符、文件字节与估算字数供工具对照，预算判断仍用含空白码点数。部署汇总新增“插入”。`strategy` 在 CLI 中显示为“记忆注入”。
- 验证方式：写入后开新会话问“当前生效的自定义指令有哪些”，能复述即注入成功；仅目录或文件存在不算通过。
- 测试覆盖码点计数、顶部/末尾插入与还原、inline 与 hook 选择、超上限警告与阻止、重复标记、内容更新、非法预算、CRLF/BOM 保持、双文件回滚、预演后拆分文件变化拒绝、状态漂移、卸载还原与 CLI 端到端。

## v0.3 P0 落地记录（2026-10-26）

真源仓库已建立：`<仓库路径>`。本次只写仓库和 `dist/`，未向任何 AI 工具目录写入。

已实现：

- 目录骨架、通用规则、机器档案、目标注册表和入口模板已落位。
- 7 个工具的入口注册：Qoder CN、Trae CN、CodeBuddy CN、QwenWork CN、WorkBuddy 启用；Claude Code、Codex 标为预留未启用。
- Node 零依赖核心与 CLI：`build`、`detect`、`deploy --dry-run`、`status`、`doctor`。
- 测试 35 项全部通过；`build --check` 为最新；`deploy --dry-run` 结果为 5 个新建、0 个需人工、2 个预留；`doctor --parity` 的注册表元数据通过，GUI 运行时标记为 P2 待实现。

与 v0.2 蓝图的差异：

- `adapters/targets.json` 使用 `entry.strategy`（`block-append` / `separate-file`）和 `enabled`，取代示例中的 `mode: single-file`。
- 当时 `deploy` 只做预演，`--apply` 明确拒绝；该能力已在 v0.6 实现备份、原子写、状态和锁。
- `doctor --parity` 在 GUI 运行时不存在时返回“待实现”，不冒充通过。
- 2026-10-26 复查：Qoder/Trae/CodeBuddy 的用户级 skills 目录不存在；QwenWork/WorkBuddy 的 skills 目录存在。首次接入技能时创建并实测。

## v0.4 内容维护与内置技能（2026-10-29）

- 新增 `aiwb content lint`：校验规则文件名、编号、索引登记和失效引用；校验技能 frontmatter、name 与目录一致、description、重名和内置标记；禁止 `content/` 出现盘符绝对路径。已接入 `doctor`。
- 新增 `aiwb content new-rule <slug>`：自动取下一个两位编号，生成规则骨架，并登记 `00-index.md` 的阅读顺序和文件职责表。
- 新增 `aiwb content new-skill <name> --description "触发场景"`：生成 `content/skills/<name>/SKILL.md` 骨架和 frontmatter。
- 新增内置技能 `aiwb`（`builtin: true`）：说明工作台维护命令、先读文档和安全边界；`content lint` 要求它存在且不得取消 builtin。
- 测试从 36 项增加到 50 项；仍未向任何 AI 工具目录写入文件。

## v0.5 资料分层与脚本部署（2026-10-31）

- 新增 `content/rules/04-storage.md`，统一项目 `local/`、`_tmp/`、全局工作台和个人资料的分层规则。
- 仓库维护脚本由 `dev/` 迁到 `scripts/`；`scripts/` 只服务本仓库，不部署。
- 新增 `content/scripts/` 作为可部署脚本源；新增 `scripts/install-global.mjs`，按机器档案创建全局工作台目录，并把脚本源安装为 `scripts/ai-workbench` junction。
- 机器档案新增“全局工作台”路径，入口同步输出。
- 仍未向 AI 工具目录写入文件；全局工作台安装脚本默认只预演，`--apply` 才写入，遇冲突不半写。

## v0.6 部署执行链路（2026-10-31）

- `deploy` 默认预演；`--apply` 才写外部文件，且与 `--dry-run` 互斥。
- 写入链路：并发锁 → 全局工作台冲突检查与安装 → 逐目标写前备份 → 临时文件加原子替换 → 写后字节与块哈希校验 → 失败恢复备份或清理新建文件 → 写 `state/deploy-state.json`。
- 每次写入前记录 `state/backups/<工具>/<时间戳>/`；`fileHash` 用于检测预演后文件被改动，发现变化即拒绝写入。
- 块哈希统一按块内正文（去除尾部换行）计算，保证 `build`、状态记录与 `findBlock` 口径一致。
- `status` 与 `doctor` 增加全局工作台检查（目录、脚本 junction、冲突）。
- 测试增加到 71 项；`deploy --apply` 只在临时沙箱验证，未写真实工具目录。

## v0.7 备份查看与恢复（2026-10-31）

- 新增 `backup list [--tool <id>]`：扫描 `state/backups/<工具>/<时间戳>/manifest.json`，列出动作、入口、时间与文件完整性。
- 新增 `backup restore <工具 id> <时间戳>`：默认预演，`--apply` 才写。
- 恢复前先把当前入口备份为 `restore-safety`；恢复后校验字节哈希，失败用恢复前备份回滚。
- 入口在部署后被修改或缺少部署记录时阻止恢复，确认覆盖才加 `--force`；入口目录不存在时也阻止。
- 恢复后按恢复内容是否含工作台块更新状态记录：无块则清除，有块则记为待更新，可再次 `deploy --apply`。
- 测试增加到 75 项，均在临时沙箱执行。

## v0.8 本地 GUI（2026-10-31）

- 新增 `gui` 命令：启动只监听 `127.0.0.1` 的本地页面，默认随机端口，输出带一次性启动令牌的完整地址。
- 页面提供总览（机器、构建、部署记录、工具入口、全局工作台）、体检、部署预演与执行、备份列表与恢复；项目页在 v0.13 补齐，冲突合并、内容编辑和诊断包仍未包含。
- GUI 与 CLI 调用同一动作核心；服务端只放行已登记的动作和参数，`build` 仅允许 `--check`，`content` 仅允许 `lint`，`backup` 仅允许 `list` / `create` / `prune` / `restore`；写入动作必须由页面提交 `confirm: true`。
- 安全约束：启动令牌校验、64 KB 请求体上限、CSP `default-src 'self'`、无外部资源和内联脚本、无任意 shell；空闲 30 分钟自动退出。
- 部署执行、备份恢复仍走原有锁、备份、原子写、写后校验与回滚链路；测试中所有写入尝试都被拒绝，未写真实工具目录。
- 浏览器实测：总览与体检通过；部署预演显示 5 个新建、2 个预留，确认框未勾选时执行按钮禁用；备份页在无备份时显示空态。

## v0.9 技能 junction（2026-10-31）

- 新增 `src/core/lib/skills-junction.mjs`：扫描 `content/skills/`，为每个已启用、已安装且登记了 `skillsDir` 的工具规划 `skills/<name>` junction。
- 写入规则：技能目录不存在时按计划创建；目标不存在时创建 junction；已指向本仓库时无变化；同名真实目录（用户自建技能）或指向别处的 junction 报告冲突并保持原样。
- `deploy` 的预演与执行结果都包含技能明细；`--tool` 只处理指定工具。入口写入失败或全局工作台冲突时，技能 junction 标记为未执行。
- 技能冲突不阻塞入口写入；存在技能写入失败时 `deploy --apply` 退出码为 1，并在结果中给出失败数。
- `doctor` 新增“技能 junction”检查：冲突为失败，待创建为待处理，其余为通过。
- CLI 与 GUI 部署页展示技能 junction 明细；帮助文案不再提示 GUI 待实现。
- 单元与沙箱集成测试覆盖目录创建、幂等、同名用户目录、异向链接和无技能场景；仍未对真实工具目录执行 apply。

## v0.10 主动备份（2026-10-31）

- 新增 `backup create [--tool <id>]`：扫描注册工具的当前入口，存在则写入 `state/backups/<工具>/<时间戳>/`，manifest 动作记为 `manual`；入口不存在只报告“无入口”，不生成空备份。
- 主动备份只读取入口、写本地 `state/backups/`，不改外部文件，也不更新部署状态；生成的备份可直接由 `backup restore` 恢复。
- `backup list` 与恢复流程无需改动；CLI 与 GUI 备份页展示创建结果、备份路径和失败项。
- GUI 备份页新增“立即备份”，调用同一动作；服务端仍要求页面提交确认。
- 补沙箱集成测试，覆盖无入口、按工具备份、重复备份、恢复预演与 GUI 未确认拒绝。

## v0.11 备份保留清理（2026-10-31）

- 新增 `backup prune [--tool <id>] [--keep <n>]`：按工具保留最近 N 份备份，默认只预演，`--apply` 才删除超出部分。
- N 优先取 `--keep`，其次取机器档案 `backupRetention`，缺省 10；每工具最近一份始终保留。
- 只处理 `state/backups/` 下已注册工具的目录；无效清单与未注册工具只报告，不删除。
- GUI 备份页新增“清理旧备份”，展示将删除项与保留份数，勾选确认后执行；服务端仍要求 `confirm: true`。
- 补沙箱集成测试，覆盖机器档案份数、`--keep` 覆盖、预演不删、`--apply` 删除、无效清单跳过、未注册工具跳过与部署锁。

## v0.12 卸载入口（2026-10-31）

- 新增 `uninstall [--tool <id>]`：默认预演，`--apply` 才写入；不带 `--tool` 时处理全部注册工具，并移除全局脚本 junction。
- 入口只移除带标记的工作台块；工作台创建且部署后未改动的入口文件整体删除。改动前写 `uninstall-safety` 备份，写后校验块已消失，失败从备份回滚。
- 技能 junction 只移除指向本仓库 `content/skills/<name>` 的链接；用户同名目录与异向链接保留；内置技能正文不删除。
- 全量卸载移除 `<全局工作台>/scripts/ai-workbench` junction，保留全局工作台目录与用户数据。
- 块哈希不一致或缺少部署记录时阻止，`--force` 只移除块并保留文件；入口在预演后变化时拒绝执行；写入遵守部署锁并清理对应部署状态。
- CLI 与 GUI 部署页提供预演/执行；GUI 执行前需勾选确认。
- 沙箱集成测试覆盖块移除、文件删除、手改 `--force`、无记录 `--force`、用户技能保留、全量卸载、部署锁与参数错误。

## v0.13 项目挂载（2026-11-01）

- 新增 `scan [--root <项目父级>]`：只读扫描机器档案“项目父级”下的直接 git 仓库和“项目清单”，报告已挂载、指针待更新、块被手改、块缺失、入口缺失、有块无记录、入口已跟踪、未挂载等状态，并区分项目是否为 git 仓库与入口是否已写入本地忽略。
- 新增 `attach <项目路径> [--mode auto|local|append]`：默认预演，`--apply` 才写入。`auto` 写 `AGENTS.md`，`local` 写 `AGENTS.local.md`，`append` 允许对已跟踪的 `AGENTS.md` 创建、追加或更新工作台块。
- 新建或追加前先规划块与 exclude：未跟踪入口写入后把 `/AGENTS.md` 或 `/AGENTS.local.md` 加入 `.git/info/exclude`；目标入口已跟踪时 `auto`/`local` 阻止写入：`AGENTS.md` 被跟踪时，可改用 `AGENTS.local.md` 未被跟踪的 `local`，或显式 `--mode append`；目标文件自身被跟踪时只有 `append` 放行。
- 已挂载项目改用写另一个入口文件的模式（`AGENTS.md` 与 `AGENTS.local.md` 之间）时阻止，并提示先 `detach` 再 `attach`，避免旧入口失去记录；`auto` 与 `append` 共用 `AGENTS.md`，可直接切换。
- 写入链路复用锁、写前备份、原子写、字节与块哈希校验和失败回滚；项目备份单独放 `state/project-backups/project-<哈希>/`，不混入工具入口备份列表；成功后在 `state/deploy-state.json` 的 `projects` 记录方式、入口、块哈希与 exclude。
- 新增 `detach <项目路径>`：默认预演，`--apply` 才移除。只删除工作台创建、块未手改且移除后为空的文件；其他情况移除工作台块并保留文件。没有记录或块与记录不一致时阻止，`--force` 只移除块、不删除文件。
- 预演与执行之间入口发生变化时拒绝写入；`doctor` 新增项目挂载检查：入口缺失、块缺失、块被手改、块标记异常计为失败，指针待更新、exclude 行缺失、入口已被 git 跟踪计为待处理。
- GUI 新增项目页：只读扫描、手动输入每页条数（下拉可选预设）与分页、表格区域单独滚动；每行“操作”打开弹层，选择挂载方式并执行挂载/取消挂载预演与确认执行；服务端只接受机器档案允许范围内的项目绝对路径，写入仍需页面确认。
- 沙箱集成测试覆盖新建、追加、幂等、已跟踪阻止、local/append、文件删除、无记录 `--force`、手改阻止、部署锁、doctor 与 GUI 路径白名单。

## v0.14 冲突合并（2026-11-01）

- 新增 `merge <工具 id>`：默认预演，输出工作台块状态、当前块哈希、部署记录块哈希、构建内容哈希、完整建议结果与阻止原因；`--preview` 显式表示只预演。
- 写入用 `--apply --content-file <路径>` 提交完整合并结果。校验只允许改工作台块内正文：块已存在时块外前缀逐字不变、后缀保持或只多一个分隔换行；块不存在时只能追加到文件末尾，独立文件按 frontmatter 模板新建。
- 写入前重新构建并校验提交结果，可选校验预演的入口文件哈希与构建哈希；通过后获取部署锁、备份、原子写入、校验写后字节与块哈希，失败用备份回滚。
- 状态记录 `action: "manual-merge"`、`manualMerge: true`、实际写入的块哈希和当前构建内容哈希；内容未变时 `status` / `doctor` 不报漂移，后续部署不覆盖手工结果。
- GUI 新增合并页：目标只列已启用且已安装的工具，左栏现有入口、中栏工作台内容只读，右栏编辑完整结果；先校验结果，再勾选确认写入。服务端拒绝 `contentFile`，合并内容只能由页面提交。
- 单元测试覆盖追加、替换、块外前后缀拒绝、标记损坏、独立文件 frontmatter 与换行保留；CLI 与 GUI 集成测试覆盖未确认、块外改动、过期哈希、写入后前缀不变与状态记录。
- 真实浏览器核对通过：三栏内容互不相同、只读列不可编辑，块外改动会被校验拦截；应用后块外前缀与后缀字节不变、CRLF 换行保留，状态记录为手工合并，写入后不再提示与部署记录不一致。

## v0.17 工具版本要求与入口核对（2026-11-02）

- 设置新增可选版本要求：内置工具用 `tools.<id>.version`，自定义工具用 `customTools.<id>.version`。留空表示不核对；版本要求解析为表达式树，支持精确版本、比较条件（`<`、`>`、`<=`、`>=`、`<>`）、逗号（AND，优先级高于 `||`）、`||`（OR）与英文括号。单次最多 20 个条件、括号最多 20 层；非法语法、换行、非字符串或超量会记为设置问题并阻止写入。
- 表达式保存时去掉多余空格与可省括号，保留必要括号；精确与 `<>` 条件按忽略大小写、去掉前导 `v` 的字符串比较，范围条件按数字分段比较，缺失段补 0，预发布版本低于同版本正式版，构建信息不参与比较。检测值为非数字版本时，精确/`<>` 仍可核对，范围条件按无法核对处理并阻止。
- 目标注册表加载时归一化版本要求，并读取检测到的实际版本：内置工具按 `adapters/targets.json` 的 `versionProbe` 读取应用状态或安装清单，支持配置根变量替换、多个候选路径、`field` 与可选的 `detailField`；自定义工具在配置目录内按通用文件列表探测。读取失败、字段缺失或文件损坏只记录原因，不中断目标加载。
- 版本核对结果分为未设置、匹配、不符、无法检测与要求无效。`detect`、`status`、`settings show`、`deploy`、`merge`、`backup restore` 与 GUI 设置卡片都展示要求、检测值和来源。
- 阻断范围：`deploy` 预演与执行对版本阻止的目标返回 `version-blocked`，不写该目标并继续其他目标，CLI 退出码为 2；`merge` 在预演和写入前都核对，未通过则阻止；`backup restore` 预演标出阻止并支持 `--force` 覆盖；技能 junction 跳过版本阻止的工具；`uninstall` 不受版本要求影响，避免版本变化后无法清理。
- 内置工具覆盖与自定义工具的版本要求只存在本机机器档案，不写入仓库级注册表。`ai-env-clone` 已声明的支持版本只作为填写参考，仓库不写死具体版本；支持版本随工具升级变化，实际要求由本机按需填写。该仓库未覆盖的工具需自行确认。
- 入口支持判断不以“路径是否存在”单独成立：Trae 设置中的“导入 AGENTS.md”只作用于工作区根目录，不是用户级入口；QwenWork 用户级入口为 `awareness/main/AGENTS.md`；WorkBuddy 用户级只加载人设与记忆文件，AGENTS.md 仅项目级支持（v0.18 起改为记忆注入）。以上均以应用包、初始化模板或实际设置项为准，证据强度见 `docs/adapters.md`。
- 测试覆盖版本归一化与非法值、内置与自定义探测、匹配/不符/未知、部署跳过、合并阻止、恢复阻止与 `--force`、技能 junction 跳过、设置写入与 GUI 展示及接口拦截。
- 真实浏览器核对通过（临时沙箱，不写真实工具目录）：设置页顶部说明与工具卡片提示展示精确版本、比较范围、`||` 多候选、逗号优先于 `||`、英文括号分组与 `<>`；Qoder 卡片检测到 0.4.11，输入 `>=1.0,(<1.5 || >=3.0)` 后预演保留该表达式，未勾选时“写入设置”禁用，确认写入后卡片显示“要求 >=1.0,(<1.5 || >=3.0)，检测 0.4.11（不符）”，总览显示“版本阻止 1 个目标”；输入缺少条件的 `>=1.0,(<1.5 || )` 时预演报错且确认区保持隐藏；部署下拉标记“（版本阻止）”，预演汇总显示“版本阻止 1”，入口动作与技能 junction 给出具体原因；合并页同样显示版本核对未通过。

## v0.16 自定义工具与页面说明（2026-11-01）

- 机器档案 `## 设置` 新增 `customTools`：按 id 登记工作台尚未内置支持的工具，字段为 `name`、`configRoot`、`entryPath`、`strategy`（`block-append` / `separate-file`）、`format`（`markdown` / `mdc`）、`skillsDir`、`frontmatter`、`enabled`。`name`、`configRoot`、`entryPath` 必填；id 只能用小写字母、数字和短横线，且不能与内置目标重复。路径必须是绝对路径或 `~` 开头，并支持环境变量展开。
- 自定义工具由 `loadTargets` 合并在内置工具之后，沿用同一套目标结构，参与 `detect`、`deploy`、`status`、`doctor`、`merge`、`backup`、`uninstall` 与技能 junction。配置目录不存在不阻止部署：入口与技能目录按填写路径创建父目录后写入；缺省技能目录时不建立 junction。
- `settings set/unset customTools.<id>.<字段>=<值>` 修改定义，`customTools.<id>=null` 删除整个工具。删除仍留有部署记录的工具会生成阻止问题，需先在部署页或 CLI 卸载；内置 id 冲突会作为问题阻止写入，但删除冲突定义仍可执行以修复档案。
- GUI 设置页新增“自定义工具”区：页面顶部“添加自定义工具”按钮打开弹层，填写必填项与可选字段后加入列表，加入后先是未保存卡片；已有工具可编辑或标记删除；标记删除后卡片刻线提示，可撤销。所有增删改与原有设置合并进同一份预演，确认后按同一安全写入链路备份并写回机器档案。保存成功后刷新部署与合并的目标下拉，新增工具以“（自定义）”标注并可单独选择。
- 部署页与合并页的目标选择在进入页面及设置写入后重新拉取 `detect`，避免自定义工具新增或删除后残留旧选项；当前选择失效时清空对应预演状态。
- 六个页面顶部统一增加说明块：概述页面作用，并用“执行结果”单独说明写入后产生什么、对部署与使用的影响；设置、部署、合并页明确写出自定义工具的接入方式。
- 单元测试覆盖自定义工具解析、必填项、路径与 id 校验、序列化与删除；目标注册表测试覆盖合并、配置目录缺失、内置冲突与非法定义；CLI 与 GUI 集成测试覆盖注册、单独部署、入口与 junction 创建、删除阻止、卸载后删除与下拉联动。
- 真实浏览器核对通过：设置页顶部“添加自定义工具”按钮打开弹层，填写并加入未保存卡片，预演后写入机器档案；部署页下拉出现“（自定义）”，预演显示新建入口与 junction，确认后创建文件；总览显示正常，合并页列出该工具；有部署记录时删除被阻止并给出先卸载提示，卸载后再删成功且下拉同步移除。

## v0.15 本机设置（2026-11-01）

- 新增 `settings show`：读取机器档案 frontmatter 与 `## 设置` JSON 块，报告备份保留份数、GUI 端口、环境变量、工具覆盖及各目标解析后的路径；解析问题逐项列出，不抛异常。
- 新增 `settings set <键>=<值>` 与 `settings unset <键>`：支持 `backupRetention`、`guiPort`、`env.<名称>`、`tools.<id>.enabled/configRoot/entryPath/skillsDir`；默认只预演，`--apply` 才写机器档案，`--expected-hash` 校验预演后的文件未被改动。
- 环境变量与路径：设置中的 `env` 优先于进程环境变量，Windows 下名称不区分大小写；路径支持 `${NAME}` 与 `%NAME%`，引用未定义变量时报告并阻止写入。
- 工具覆盖接入目标注册表：`enabled: false` 跳过该工具，`configRoot` / `entryPath` / `skillsDir` 覆盖注册表路径；显式 `entryPath` 关闭备选入口回退。
- 联动：`backup prune` 未指定 `--keep` 时取 `backupRetention`；`gui` 未指定 `--port` 时取 `guiPort`（0 为随机）；`detect` 输出设置来源；`doctor` 增加“本机设置”检查。
- 安全写入：写前备份到 `state/settings-backups/<时间戳>/` 并记录变更清单，使用部署锁、原子替换、写后哈希与解析校验，失败回滚；保留 BOM、CRLF 与设置节以外的正文和未知 JSON 字段。
- GUI 新增设置页：表单编辑保留份数、端口、环境变量和工具覆盖，预演后显示变更表，勾选确认并按预演哈希写回；服务端只接受 `show/set/unset` 和受限的 `changes` 键值对象。
- 测试覆盖解析、默认值、非法值、CRLF/BOM、正文保留、过期哈希、未定义变量、部署锁、GUI 白名单与确认。
- 真实浏览器核对通过：设置页加载当前值与 7 个工具；添加环境变量和入口覆盖后预演列出 4 项变更，未勾选时写入按钮禁用；确认后写入并回显备份，刷新后新值仍在；删除被入口覆盖引用的环境变量时，预演标出未定义变量并隐藏写入按钮。

## v0.17 内容编辑（2026-11-01）

- 新增 `content list` 与 `content read <rule|skill> <名称>`：列出规则、技能、标题、索引与内置标记，读取正文与文件哈希；只读。
- 新增 `content save <rule|skill> <名称> --content-file <路径> [--apply] [--expected-hash <哈希>]`：默认只预演，按提交正文运行内容校验，不写文件；`--apply` 要求读取时的完整 SHA-256，写前在部署锁内复核，写入后校验磁盘内容并重建 `dist/`，失败恢复原文件与构建。
- `content lint` 增加 `overrides` 选项，可校验尚未写入的正文；CLI 预演、GUI 校验和写前检查复用同一套规则。
- 编辑范围仅限现有 `content/rules/<两位编号>-<名称>.md` 与 `content/skills/<名称>/SKILL.md`；名称按固定正则校验，不提供删除、改名或任意路径写入。
- `new-rule` / `new-skill` 增加 `--build`：创建后立即重建构建；构建失败时删除新文件、恢复 `00-index.md` 原内容并重建原构建。
- GUI 新增内容页：左侧列出规则与技能，右侧编辑正文；先校验并预演保存，勾选确认后写入并重建构建。新建规则/技能弹层先预演文件名、模板与索引登记，确认后创建并自动打开。服务端只放行 `lint/list/read/save/new-rule/new-skill`，拒绝 `contentFile`，保存必须带读取时的哈希。
- 单元、CLI 与 GUI 集成测试覆盖预演不写、校验阻止、过期哈希、内置技能保护、写后构建、保存失败回滚、创建后构建与创建回滚；真实浏览器核对内容页加载、脏状态、预演确认、保存重建、新建规则/技能与内置技能拦截。

## v0.1 → v0.2 变更摘要

1. 顶层目录重组：`content/`（可部署源）+ `machines/`（机器覆盖）+ `adapters/`（目标配置）+ `src/`（工具代码）+ `launchers/`（用户入口）+ `scripts/`（维护脚本）+ `tests/` + `docs/` + `dist/`（构建产物）+ `state/`（本地状态）。
2. 机器相关内容从通用规则中拆出：`04-environment`、`05-paths`、`06-projects` 移入 `machines/<主机名>.md`，保证换机器时只改机器档案。
3. 明确四类物：**部署源**、**构建产物**、**外部部署物**、**运行状态**；每类的位置、生成者、是否入库、生命周期都有边界。
4. CLI、GUI、开发脚本、测试、文档各自独立目录，共用 `src/core` 业务核心。
5. 运行时零 npm 依赖：只使用 Node 内置模块；合并页使用原生三栏编辑器，不引入外部前端库。
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
| Trae CN | `~/.trae-cn` | `~/.trae-cn/user_rules/*.md` | `~/.trae-cn/skills/`（待验证） | 全局规则目录 `[实测]`；设置中的“导入 AGENTS.md”只导入工作区根目录，不是用户级入口 `[实测]`；2026-10-26 复查 skills 目录不存在 |
| CodeBuddy CN | `~/.codebuddy` | `~/.codebuddy/rules/*.mdc` | `~/.codebuddy/skills/`（待验证） | 规则目录 `[实测]`；2026-10-26 复查 skills 目录不存在 |
| QwenWork CN | `~/.qwenworkcn` | `~/.qwenworkcn/awareness/main/AGENTS.md` | `~/.qwenworkcn/skills/` | 包内加载路径与初始化模板确认 `[实测]`；配置根下的 `AGENTS.md`、`rules.md` 不自动加载；技能目录 `[实测]`；加载待新会话实测 |
| WorkBuddy | `~/.workbuddy` | `~/.workbuddy/user-<uid>-<企业或个人>/MEMORY.md`（快照失效回落设备根 `~/.workbuddy/MEMORY.md`，此时工作台不写入；带标记区块 + 拆分文件） | `~/.workbuddy/skills/` | 用户级实际注入账号目录 `MEMORY.md` `[实测]`；账号目录按 `storage/skeleton/account-snapshot.json` 动态解析；工作台只写带标记区块，正文超预算时放 `memory/ai-workbench-global-rules.md`；项目级接受 `AGENTS.md` `[实测]`；技能目录 `[实测]` |
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
| WorkBuddy `BOOTSTRAP.md` / `USER.md` / `SOUL.md` / `MEMORY.md` `[实测]` | WorkBuddy 自身的人设、用户档案、长期记忆 | 人设文件不接管；`MEMORY.md` 只写入带标记区块，区块外记忆保持原样，区块与既有记忆共用注入额度 |
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
| 全局工作台 | `<全局工作台>`（`todo/`、`scripts/`、`notes/`、`_tmp/`；`scripts/ai-workbench` 为仓库脚本 junction） | 用户确认；机器本地，不入库 |
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
| Trae CN | `~/.trae-cn/user_rules/*.md` | 全局只认 user_rules；设置中的“导入 AGENTS.md”只导入工作区根目录 `[实测]`；AGENTS.md 项目级需开关 `[文档]` |
| CodeBuddy | `~/.codebuddy/rules/*.mdc` | `.mdc` 格式 `[文档]` + 目录 `[实测]` |
| WorkBuddy | `~/.workbuddy/user-<uid>-<企业或个人>/MEMORY.md` 带标记区块（快照失效回落设备根） | 用户级实际注入账号目录 `MEMORY.md` `[实测]`；工作台注入带标记区块，正文超预算时放拆分文件；项目级接受 AGENTS.md `[实测]`；技能目录 `[实测]` |
| QwenWork | `~/.qwenworkcn/awareness/main/AGENTS.md` | 启动时加载该入口，包内路径与初始化模板已确认 `[实测]`；配置根下的 AGENTS.md/rules.md 不自动加载；技能目录 `[实测]` |
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
│  外部部署物（写到工具根/全局工作台/项目，不入库）   │
│  用户级入口 · 技能 junction · 脚本 junction · 项目挂载块 │
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
│  launchers（用户入口） scripts（本仓库维护脚本）  │
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
├─ .gitignore                         [入库] dist/、state/、local/、_tmp/、node_modules/、*.log
├─ .editorconfig                      [入库] UTF-8、缩进、换行约定
│
├─ content\                           [入库] 可部署源：跨机器通用的内容
│  ├─ rules\
│  │  ├─ 00-index.md                 规则总索引与阅读顺序
│  │  ├─ 01-communication.md         沟通与协作偏好
│  │  ├─ 02-workflow.md              工作流程铁律
│  │  ├─ 03-coding.md                编码、注释、提交规范
│  │  └─ 04-storage.md               资料、脚本、待办与临时目录的存放规则
│  ├─ skills\
│  │  ├─ aiwb\SKILL.md               内置技能：工作台维护命令与边界（builtin）
│  │  └─ work-summary\SKILL.md       自研技能：个人工作梳理的取数口径与交付格式
│  ├─ scripts\                       可部署脚本：安装为全局工作台 scripts/ai-workbench
│  │  └─ README.md                   命名、调用与职责约定
│  └─ templates\
│     ├─ entry-header.md             入口生成头模板
│     ├─ entry-essentials.md         入口里的 5 条最小铁律
│     ├─ entry-index.md              入口里的仓库/技能索引模板
│     ├─ project-block.md            项目挂载块模板
│     └─ codebuddy-frontmatter.md    CodeBuddy .mdc frontmatter 模板
│
├─ machines\                          [入库] 机器档案模板；本机档案 gitignore
│  └─ _template.md                   新机器模板（本机档案 machines/<主机名>.md 不入库）
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
│  │     ├─ merge-engine.mjs         只追加合并与块哈希
│  │     ├─ memory-block.mjs        用户记忆区块、预算、钩子与拆分文件
│  │     ├─ merge-entry.mjs          冲突合并规划、块外校验与重建
│  │     ├─ global-workbench.mjs     全局工作台目录与脚本 junction 规划
│  │     ├─ deploy-writer.mjs        入口写入、写后校验与回滚
│  │     ├─ junction.mjs             junction 管理
│  │     ├─ backup.mjs               备份与恢复
│  │     ├─ state.mjs                部署状态读写
│  │     ├─ lock.mjs                 并发锁
│  │     ├─ operation-log.mjs         操作日志追加、读取与字段白名单
│  │     ├─ zip.mjs                  零依赖 store-only ZIP 生成
│  │     ├─ fs-safe.mjs              原子写、权限、文件锁
│  │     ├─ hash.mjs                 内容哈希
│  │     ├─ time.mjs                 本地时间与备份时间戳
│  │     └─ encoding.mjs             BOM/UTF-8/UTF-16/GBK 检测
│  ├─ cli\                           命令行表现层
│  │  ├─ main.mjs                    入口与命令分发
│  │  ├─ args.mjs                    参数解析
│  │  └─ render.mjs                  人类可读/JSON 输出
│  └─ gui\                           本地 GUI
│     ├─ server.mjs                  127.0.0.1 + token + 静态服务 + 动作白名单
│     └─ web\                        前端静态资源
│        ├─ index.html               总览 / 部署 / 合并 / 项目 / 内容 / 设置 / 备份 / 历史 / 诊断
│        ├─ app.js                   页面交互与 API 调用
│        └─ style.css                面板、表格、三栏编辑器与确认区样式
│
├─ launchers\                         [入库] 用户启动入口（只做转发，不含逻辑）
│  ├─ aiwb.cmd                       CLI：node src/cli/main.mjs %*
│  ├─ aiwb-gui.cmd                   GUI：node src/cli/main.mjs gui --open
│  └─ README.md                      双击说明、桌面快捷方式建议
│
├─ scripts\                           [入库] 本仓库自身维护与部署辅助脚本；不部署
│  ├─ install-global.mjs             单独安装全局工作台目录与脚本 junction
│  └─ check-paths.mjs                检查 README/docs 与代码路径是否一致
│
├─ local\                             [本地] 本机草稿与不入库资料，gitignore
├─ _tmp\                              [本地] 一次性脚本与临时产物，gitignore
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
├─ dist\                              [生成] 构建产物，gitignore
│  ├─ ENTRY.md                       本次部署内容（含机器覆盖）
│  └─ manifest.json                  源文件哈希、生成时间、机器、技能列表
│
└─ state\                             [本地] 运行状态，gitignore
   ├─ deploy-state.json              各目标/项目的部署状态
   ├─ backups\<tool>\<timestamp>\    写前备份 + manifest
   ├─ logs\deploy-YYYYMM.jsonl       操作日志
   ├─ diagnostics\diagnose-<时间>    诊断目录与可选 zip
   └─ locks\deploy.lock              并发锁
```

### 4.3 外部部署物

这些不在仓库内，由 `deploy` / `attach` 写到工具根、全局工作台或项目目录：

| 部署物 | 位置 | 生成者 | 更新方式 | 卸载 |
|---|---|---|---|---|
| 用户级入口文件/块 | 各工具配置根 | `deploy` | 重新 deploy，块内替换 | `uninstall` |
| 记忆拆分文件 | `~/.workbuddy/memory/ai-workbench-global-rules.md` | `deploy`（仅钩子模式） | 重新 deploy，整体替换 | `uninstall` |
| 技能 junction | 各工具 skills 目录 | `deploy` | 重新 deploy | `uninstall` |
| 工作台脚本 junction | `<全局工作台>\scripts\ai-workbench` | `deploy` / `scripts/install-global.mjs` | 重新部署 | `uninstall` |
| 项目挂载块 | 项目根 `AGENTS.md` | `attach` | 重新 attach | `detach` |
| `.git/info/exclude` 行 | 项目 `.git/info/exclude` | `attach` | 重新 attach | `detach` |
| 部署状态 | `state/deploy-state.json` | `deploy` / `attach` | 自动 | 保留 |
| 备份 | `state/backups/` | `deploy` / `backup create` | 自动或手动 | `backup prune` 按保留策略清理 |
| 设置写前备份 | `state/settings-backups/` | `settings` | 自动 | 保留 |

`uninstall --tool <id>` 处理该工具的入口与技能 junction；不带 `--tool` 的全量卸载还移除全局脚本 junction，但不删除全局工作台目录与用户数据。项目挂载块与 exclude 行由后续 `detach` 处理。

全局工作台 `<全局工作台>` 只接收一类部署物：`scripts/ai-workbench` 是仓库 `content/scripts/` 的 junction，供各工具的 AI 和手工全局调用。规则与技能正文不复制到全局工作台，AI 通过入口中的路径按需读取。全局工作台的 `todo/`、`notes/`、`_tmp/` 和 `scripts/` 下的本机子目录由本机维护，不随仓库迁移。

### 4.4 四类物的边界

| 类别 | 位置 | 是否入库 | 允许放什么 | 禁止放什么 |
|---|---|---|---|---|
| 部署源 | `content/` | 是 | 通用规则、技能、模板 | 本机绝对路径、密钥、机器专属内容 |
| 机器覆盖 | `machines/` | 模板是；本机档案否 | 机器环境、路径、项目清单、本机设置 | 跨机器通用规则、密钥 |
| 目标配置 | `adapters/` | 是 | 工具入口路径、格式、支持状态 | 业务逻辑（逻辑在 `src/core/targets/`） |
| 工具代码 | `src/`、`launchers/` | 是 | 代码、启动器 | 生成内容、运行时状态 |
| 维护脚本 | `scripts/` | 是 | 本仓库自身的维护、部署、校验、打包脚本 | 可部署脚本、一次性脚本、生成内容 |
| 可部署脚本 | `content/scripts/` | 是 | 供全局调用的通用脚本 | 本仓库自用脚本、一次性脚本 |
| 本机资料 | `local/`、`_tmp/` | 否 | 本机草稿、不入库资料、一次性脚本与产物 | 需要共享或长期保留的内容 |
| 构建产物 | `dist/` | 否 | 入口内容、manifest | 手工编辑的内容 |
| 外部部署物 | 工具根/全局工作台/项目目录 | 不适用 | 工作台块、独立入口文件、junction | 用户原有内容 |
| 运行状态 | `state/` | 否 | 状态、备份、日志、锁 | 需要跨机同步的内容 |
| 文档/测试 | `docs/`、`tests/` | 是 | 设计、支持矩阵、runbook、测试 | 真实凭据、运行日志 |

边界规则：

1. `content/` 不出现本机绝对路径；所有路径类内容放 `machines/`。
2. `machines/` 不出现跨机器通用规则；通用规则放 `content/rules/`。
3. `src/core/` 不硬编码工具路径；一律读 `adapters/targets.json` 和机器档案。
4. `dist/` 只由 `build` 生成，任何人工修改都会被下一次构建覆盖。
5. `state/` 永不入库；备份不随仓库迁移。
6. `launchers/` 只做转发，不写业务逻辑。
7. `scripts/` 只放本仓库自身脚本，不部署；要安装到全局工作台的脚本放 `content/scripts/`。
8. 工具特有规则/技能不进入本仓库；本仓库只存跨工具公共内容。
9. `local/`、`_tmp/` 不入库；创建前先写忽略规则，`_tmp/` 可整目录清理。
10. 全局工作台的 `scripts/ai-workbench` 只链接 `content/scripts/`；本机专用脚本放其同级目录，不放进 junction。

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
          │  7. install-global：创建全局工作台目录与 scripts/ai-workbench junction
          │  8. skills：为每个技能创建或复用各工具 skills/<name> junction
          ▼
外部部署物：用户级入口 + 技能 junction + 全局脚本 junction
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
- 运行时零 npm 依赖：只用 Node 内置模块；前端不引入第三方库或 CDN。
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
- GUI 服务端按注册表映射动作白名单，页面通过 `POST /api/run` 调用同一核心；当前页面布局固定，尚未按 `gui.form` 动态渲染。
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
| QwenWork | `~/.qwenworkcn/awareness/main/AGENTS.md` | Markdown | 新建；已有则追加块 | 路径 `[实测]`；加载 `[待实测]` |
| WorkBuddy | `~/.workbuddy/user-<uid>-<企业或个人>/MEMORY.md` + `~/.workbuddy/memory/ai-workbench-global-rules.md`（快照失效时解析回落设备根，但不写入） | Markdown（无 BOM、LF） | 在账号记忆文件顶部写入带标记区块；超预算时只留钩子，正文放拆分文件；项目级 `AGENTS.md` 仍经项目挂载写入 | 账号路径与注入机制 `[实测]`；加载待新会话复述验证 |
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

版本要求是可选的部署前置条件：在机器档案的 `tools.<id>.version` 或 `customTools.<id>.version` 填写后，部署预演与执行会先核对实际版本。核对不符或无法检测时该目标标记为 `version-blocked`，不写入口也不建 junction，其余目标继续；合并与备份恢复直接阻止，恢复可用 `--force` 覆盖。留空表示不核对，卸载始终放行。

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
3. `preview`：逐目标列出动作（新建 / 追加 / 更新块 / 跳过 / 需人工合并）和原因；无 `--tool` 时同时预演全局工作台目录与脚本 junction，并规划各工具的技能 junction。
4. `lock`：`--apply` 获取 `state/locks/deploy.lock`；已有未超时锁时拒绝，超时锁按陈旧锁接管。
5. `backup`：全局工作台冲突时不写任何内容；否则安装缺失目录与 junction，逐目标写入前备份到 `state/backups/<工具>/<时间戳>/`，记录 manifest。
6. `write`：只追加或写入独立文件；临时文件 + 原子替换，沿用原编码与 BOM。
7. `verify`：校验写后字节与块哈希；失败立即用备份恢复，新建文件则清理，并停止后续目标。
8. `state`：更新 `state/deploy-state.json`，记录动作、哈希、备份路径、时间。
9. `skills`：入口写入完成后，创建缺失的技能目录与 junction；同名真实目录或异向链接保持原样并计入冲突。
10. `report`：输出部署矩阵、技能 junction 明细和需人工处理的清单。

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

手工合并（`merge`）：

- 用于部署因“块被手改”而停下，或用户需要在块内保留人工调整时。`merge <工具 id>` 默认只预演，给出 `suggested` 完整结果、块状态、当前块哈希、部署记录块哈希、工作台内容哈希与冲突原因。
- 写入只接受完整合并结果（CLI `--content-file`，GUI 编辑器提交）。校验要求恰好一个工作台块、块内正文非空、块标记合法；当前块已存在时，块前原文必须逐字一致，块后只允许保留原后缀或增加一个分隔换行；当前没有块时只能追加到文件末尾或按独立文件规则新建。
- 写前重新构建并校验提交结果，可选校验预演时的入口文件哈希与构建哈希；通过后备份、原子写入、校验写后字节与块哈希，失败用备份回滚。
- 状态记录 `action: "manual-merge"`、`manualMerge: true`、实际写入的块哈希和当前构建内容哈希；因此后续内容未变时 `status` / `doctor` 仍显示正常，重新部署也不会覆盖手工合并结果。

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
- 实现：`src/core/lib/skills-junction.mjs` 生成计划；`deploy --apply` 在入口写入后执行，`doctor` 复用同一计划检查。技能冲突不阻塞入口写入，但会保留原内容并在结果中报告。

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
- 项目已有且已跟踪 → 默认不追加；列出冲突，让用户选：跳过 / 手动合并 / 改用 `AGENTS.local.md`（该文件也须未跟踪；Qoder 支持，其他工具不一定）/ 显式选 `append` 写入已跟踪文件。
- 只对用户勾选的项目生效；默认一个都不挂。
- `detach` 只删除工作台块；若文件是工作台创建且无其他内容，才删除整个文件。
- 不能可靠拦截“AI 工具打开工作区”事件；替代方案：全局入口加一条软提醒（首次在新项目工作且无 AGENTS.md 时询问是否挂载），GUI 打开期间扫描 `<项目父级>` 新目录并提示“未挂载”，但不自动写。

### 5.7 记忆注入（WorkBuddy）

- 适用原因：WorkBuddy 用户级不自动加载 `AGENTS.md`，只把账号目录 `user-<uid>-<企业或个人>/MEMORY.md` 等记忆/人设文件注入每个会话；设备根 `~/.workbuddy/MEMORY.md` 用于未绑定账号。工作台把入口内容包在专用标记内写入记忆文件，区块外内容保持原样。
- 路径解析：`entry.accountDir` 指定账号快照 `storage/skeleton/account-snapshot.json` 与路径模板 `user-{uid}-{scope}/MEMORY.md`。读取快照 `primary` 的 `uid` 生成账号目录，`scope` 取 `enterpriseId`（去空白）或 `personal`；快照缺失、结构非法、超过 4096 字节或保存超过 30 天时回落到 `entry.path`，与 WorkBuddy 的未绑定行为一致。账号标识不写入仓库、文档或测试。
- 标记：

  ```markdown
  <!-- USER-GLOBAL-RULES:BEGIN -->
  ...工作台钩子或完整内容...
  <!-- USER-GLOBAL-RULES:END -->
  ```

- 预算：`injectLimit` 4000、`targetLimit` 3400、`blockBudget` 600，由 `targets.json` 的 `entry.budget` 配置。区块与全文合计都在目标线内才内联；超过目标线只写钩子，正文放拆分文件；超过注入上限时，`placement: top` 的钩子仍写入并警告，其他放置方式阻止。区块文本超过 `blockBudget` 时同样转钩子。
- 默认 `placement: top`，让钩子在注入截断时优先保留。移除区块时只去掉标记、区块正文和插入时增加的那一个换行，可精确还原原文。
- 写入前断言首尾标记全文件最多一组且顺序正确；标记重复、残缺、块被手改或部署记录缺失时停止。写入保持入口原有 BOM、编码与换行；拆分文件固定 UTF-8 无 BOM + LF。
- 字符数按 Unicode 码点计算，不做换行归一，写入前后都复算；CLI/GUI 展示区块字符、全文合计与上限。另显示不含空白字符、写入后文件字节和估算字数（汉字按字、其他文字按词），只用于和编辑器或工具对照，预算判断仍用含空白码点数。
- 双文件事务：先写拆分文件，再写入口；任一步失败同时回滚两边。拆分文件路径相对配置根，不能包含 `..`，且禁止与入口或配置的 `entry.path` 相同；账号目录变化时拆分文件位置保持不变。
- 状态记录 `memoryMode`（`inline` / `hook`）、`splitFilePath`、`splitFileHash`；`status` / `doctor` 报告 `missing-split`、`drift-split`。`uninstall` 移除区块和本工作台生成且未改动的拆分文件。
- 记忆目标不支持 `merge` 手工合并：需要人工调整时改 `content/rules/` 并重新部署，避免在会被注入截断的文件里维护长正文。

---

## 六、内容规划

### 6.1 通用规则（`content/rules/`）

| 文件 | 内容 | 主要来源 |
|---|---|---|
| `00-index.md` | 规则总索引、阅读顺序、机器档案入口 | 汇总 |
| `01-communication.md` | 中文、结论先行、含糊先问、多方案给优缺点、观察与推断分开、不能验证要直说 | 个人记忆 + Trae 规则 |
| `02-workflow.md` | 先读代码、动手前确认、禁止自行提交、中文提交、删除走回收站、临时文件清理、改完编译+实际验证、测试回归 | 桌面 AGENTS.md + Trae 规则 |
| `03-coding.md` | 中文注释、只写必要注释、函数注释四要素、不随意删旧注释、优先复用；按语言给格式 | Trae 规则 + 通用实践 |
| `04-storage.md` | 资料与脚本分层、项目 `local/` 与 `_tmp/`、全局工作台与脚本 junction、可部署脚本与仓库自身脚本的区分、清理方式 | 本次约定 |

注释格式建议：

| 语言 | 格式 |
|---|---|
| C# | XML 文档注释：`<summary>`、`<param>`、`<returns>`、`<remarks>` |
| C/C++ | Doxygen：`@brief`、`@param`、`@return`、`@note` |
| Python | docstring：摘要、Args、Returns、Raises、Notes |
| JavaScript/TypeScript | JSDoc：`@param`、`@returns`、`@remarks` |
| SQL | `--` 行注释；必要处说明参数与结果 |

### 6.2 机器档案（`machines/<主机名>.md`）

存放**所有与这台机器相关的差异**，不放进通用规则。该文件只在本机保存，已被 gitignore，不进仓库：

- frontmatter：`host`、`backupRetention`、`guiPort` 等本机设置。
- 机器环境：Windows 版本、Shell、盘符空间、用户目录链接布局、真实桌面、git 身份。
- 路径：项目父级、资料目录、工作计划总结目录、全局工作台、Qoder 工作区、桌面交付路径。
- 设置（可选）：`## 设置` 下的 `json` 代码块，保存环境变量、工具覆盖与自定义工具。
- 项目清单：名称、路径、技术栈、构建/测试命令、备注。
- 本机特有注意事项。

`machines/<主机名>.md` 示例：

````markdown
---
host: <主机名>
backupRetention: 10
guiPort: 0
---

## 机器环境
- <系统版本>；Shell 为 <Shell>
- <用户目录> 链接到 <实际位置>（如无链接则不写）
- 真实桌面：<桌面路径>

## 路径
- 项目父级：<路径>
- 工作参考资料：<路径>
- 个人资料：<路径>
- 学习资料：<路径>
- 其他资料：<路径>
- 工作计划总结：<路径>
- 桌面交付：<路径>
- 工作台仓库：<路径>
- 全局工作台：<路径>

## 设置

```json
{
  "env": {
    "<变量名>": "<值>"
  },
  "tools": {
    "<工具 id>": {
      "enabled": true,
      "configRoot": "${<变量名>}/<配置目录>",
      "entryPath": "${<变量名>}/<入口文件>",
      "skillsDir": "${<变量名>}/skills"
    }
  }
}
```

## 项目清单
| 名称 | 路径 | 技术栈 | 构建/测试 | 备注 |
|---|---|---|---|---|
| <项目名> | <项目路径> | <技术栈> | <命令> | <备注> |
````

`machines/<主机名>.md` 含本机路径、项目清单等隐私信息，只在本机保存：该文件加入 `.gitignore`，不进入仓库，也不随仓库分发。`machines/_template.md` 用于新机器；`deploy` 未找到当前主机档案时生成模板并要求填写。

#### 6.2.1 本机设置

设置由 `src/core/lib/settings.mjs` 解析，`settings show` 查看，`settings set` / `settings unset` 修改：

| 设置 | 位置 | 规则 |
|---|---|---|
| 备份保留 | frontmatter `backupRetention` | 大于 0 的整数，默认 10；`backup prune` 在没有 `--keep` 时使用，每工具最近一份始终保留 |
| GUI 端口 | frontmatter `guiPort` | 0–65535 的整数，默认 0（随机）；`gui` 没有 `--port` 时使用，显式 `--port` 优先 |
| 环境变量 | `## 设置` 的 `env` | 名称到字符串值；供工具路径展开使用，优先级高于进程环境变量；Windows 下名称不区分大小写 |
| 工具覆盖 | `## 设置` 的 `tools` | 按工具 id 设置 `enabled`、`version`、`configRoot`、`entryPath`、`skillsDir`；显式 `entryPath` 关闭备选入口回退 |
| 自定义工具 | `## 设置` 的 `customTools` | 按 id 登记未内置的工具：`name`、`configRoot`、`entryPath`、`strategy`、`format`、`skillsDir`、`frontmatter`、`version`、`enabled`；前三项必填，id 不能与内置目标重复 |

- 版本要求可选，留空表示不核对，`unset` 删除要求；支持精确版本、比较条件、逗号（AND，优先级高于 `||`）、`||`（OR）与英文括号，单次最多 20 个条件、括号最多 20 层。比较条件按数字分段比较，缺段补 0，可带预发布与构建信息；检测值无法按数字解析时按无法核对处理。非法语法、换行、非字符串或超量会记为设置问题并阻止写入。
- 自定义工具与内置目标使用同一结构，由 `loadTargets` 合并；配置目录缺失不阻止部署，入口与技能目录会按路径创建父目录。删除仍有部署记录的工具会被阻止，需先卸载。

- 路径值支持 `${NAME}` 与 `%NAME%`；引用未定义的变量、未知工具 id、未知字段、类型错误或 JSON 损坏都会记为 `issues`。`show` 报告问题；`set` / `unset` 默认因问题阻止写入，确认无误时可用 `--force` 强制写入（写后仍保留 `issues` 提示）。
- `settings set` / `unset` 默认只预演；`--apply` 才写机器档案。写入前校验预演时的文件哈希，写入前备份到 `state/settings-backups/<时间戳>/` 并附 `manifest.json`，写入使用部署锁与原子替换，写后校验字节和解析结果，失败回滚。只改 frontmatter 目标键与 `## 设置` 节，保留其余正文、未知 JSON 字段、BOM 和换行风格。
- 环境变量、工具覆盖与版本要求只在本机生效，不进入 `content/`；`detect`、`deploy`、`merge`、`backup restore`、`backup prune`、`gui`、`doctor` 读取同一份设置。
- 内置工具的版本探测规则登记在 `adapters/targets.json` 的 `versionProbe`，由 `{configRoot}`、环境变量与安装目录组成候选路径；自定义工具在配置目录内按 `.status.json`、`.app-status.json`、`product.json`、`resources/...` 等文件通用探测。检测只读，不修改工具目录；读取失败只报告原因。

### 6.3 技能（`content/skills/`）

- 每个技能一个目录：`content/skills/<name>/SKILL.md`，可带 `scripts/`、`references/` 等资源。
- 技能自带脚本随技能目录一起部署、入库；要安装到全局工作台的通用脚本放 `content/scripts/`，本仓库自身维护脚本放 `scripts/`（不部署），跨项目本机脚本放全局工作台 `scripts/` 的其他子目录。
- `SKILL.md` 必须有 `name`、`description`，且 `name` 与目录名一致；描述写清触发场景。
- 新建：`aiwb content new-skill <name> --description "触发场景"`；`build` 自动扫描并生成入口技能索引，不需要手工登记。
- 校验：`aiwb content lint` 检查 frontmatter、重名、名称格式、盘符绝对路径；`doctor` 复用同一套检查。
- 正文不写本机盘符绝对路径；需要仓库位置时，引用全局入口中的“工作台索引”。
- 内置技能 `aiwb` 标记 `builtin: true`，说明工作台维护命令与禁止事项。`content lint` 要求它存在且不得取消 builtin；后续 `uninstall` 和 GUI 删除动作也必须跳过内置技能。要调整只能改仓库文件，再 lint/build/deploy。
- 厂商技能只在 `adapters/README.md` 登记，不复制、不改写。
- 自研业务技能从 `work-summary`（个人工作梳理）开始；`aiwb` 是工作台自身的内置技能，不计入业务技能。

### 6.4 模板（`content/templates/`）

| 文件 | 用途 |
|---|---|
| `entry-header.md` | 生成头：来源、时间、哈希、勿手改 |
| `entry-essentials.md` | 入口内 5 条最小铁律 |
| `entry-index.md` | 仓库索引与技能索引的框架 |
| `project-block.md` | 项目挂载块 |
| `codebuddy-frontmatter.md` | CodeBuddy `.mdc` frontmatter |

模板中不写死本机路径；路径由 `entry-builder` 从机器档案注入。

### 6.5 可部署脚本（`content/scripts/`）

- 放需要跨工具、跨项目全局调用的工作台脚本；只服务本仓库的维护、部署、校验、打包脚本放 `scripts/`，不部署。
- 每个脚本使用 Node.js 内置模块，零 npm 依赖，可独立执行；顶部注释写清用途、参数、输出和退出码。
- `deploy --apply`（或单独的 `scripts/install-global.mjs`）把整个目录以 junction 安装到 `<全局工作台>/scripts/ai-workbench`，不复制；`content/scripts/` 是唯一正文，junction 实时生效。
- 本机专用脚本放 `<全局工作台>/scripts/` 下的其他子目录，不放进 junction，避免混进仓库。
- 新增或修改后运行 `node scripts/install-global.mjs` 预演，确认链接未漂移，并跑相关测试。

---

## 七、CLI 设计

### 7.1 命令表

| 命令 | 作用 | 关键参数 |
|---|---|---|
| `aiwb detect` | 探测工具与路径 | `--json` |
| `aiwb build` | 合成 `dist/ENTRY.md` | `--check` |
| `aiwb content` | 校验、列出、读取、编辑内容与生成规则/技能骨架 | `lint` / `list` / `read <rule\|skill> <名称>` / `save <rule\|skill> <名称> --content-file <路径>` / `new-rule <slug>` / `new-skill <name> --description "..."` / `--apply` / `--expected-hash <哈希>` / `--build` / `--dry-run` |
| `aiwb deploy` | 部署入口 | `--dry-run` / `--apply` / `--tool <id>` |
| `aiwb status` | 部署状态矩阵 | `--json` |
| `aiwb doctor` | 健康检查/漂移检测 | `--fix` / `--parity` / `--json` |
| `aiwb merge <target>` | 冲突合并 | `--preview` / `--apply --content-file <path>` |
| `aiwb backup list` | 列出备份 | `--tool <id>` / `--json` |
| `aiwb backup create` | 主动备份当前入口 | `--tool <id>` / `--json` |
| `aiwb backup prune` | 按保留份数清理旧备份 | `--tool <id>` / `--keep <n>` / `--apply` / `--json` |
| `aiwb backup restore <工具 id> <时间戳>` | 恢复入口备份 | `--apply` / `--force` / `--json` |
| `aiwb uninstall` | 卸载工作台入口 | `--tool <id>` / `--apply` / `--force` / `--json`；项目卸载用 `detach` |
| `aiwb scan` | 扫描项目仓库（只读） | `--root <项目父级>` / `--json` |
| `aiwb attach <path>` | 项目挂载 | `--mode auto/local/append` / `--apply` / `--dry-run` / `--json` |
| `aiwb detach <path>` | 取消项目挂载 | `--apply` / `--force` / `--json` |
| `aiwb settings show` | 查看本机设置 | `--json` |
| `aiwb settings set <键>=<值>` | 修改本机设置 | `--apply` / `--force` / `--expected-hash <哈希>` / `--json` |
| `aiwb settings unset <键>` | 删除设置或覆盖 | `--apply` / `--force` / `--expected-hash <哈希>` / `--json` |
| `aiwb log` | 操作历史 | `--limit <n>` / `--json` |
| `aiwb diagnose` | 诊断包 | `--zip` / `--json` |
| `aiwb gui` | 启动本地 GUI | `--port <0-65535>` / `--open` / `--json` |

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
    "check-paths": "node scripts/check-paths.mjs",
    "test": "node --test --test-concurrency=1 \"tests/**/*.test.mjs\" \"tests/*.test.mjs\"",
    "gui": "node src/cli/main.mjs gui --open"
  }
}
```

运行时零依赖；`devDependencies` 仅在重新构建 CodeMirror 预构建产物时需要。

---

## 八、GUI 设计

### 8.1 选型

**本地 Web GUI：Node 后端 + 浏览器；冲突合并页使用原生三栏编辑器。**

| 方案 | 运行时 | 差异/合并体验 | 体积/安装 | 结论 |
|---|---|---|---|---|
| 本地 Web（Node + 浏览器） | Node（本机已装） | 三栏对照，块内可编辑 | 无安装、秒开 | **采用** |
| Electron | Node + Chromium | 强 | 200MB+，需打包 | 不采用 |
| Tauri | Rust + WebView2 | 强 | 需 Rust 工具链 | 不采用 |
| WPF/WinForms | .NET 10 | 合并 UI 需自建，弱 | 中等 | 不采用 |
| .NET + 本地 Web | .NET 10 | 强 | 需发布 exe | 备选 |
| VS Code 扩展 | 依赖 IDE | 强 | 依附工具 | 只作补充 |

选择理由：

- 需求核心是冲突对比和人工合并，三栏并列足以看清原文、构建结果和待写入内容。
- 不引入 Electron 体积；以后若要桌面壳，可包同一套 Web UI。
- 浏览器打开即用，不常驻大进程。
- 前端只用原生 HTML/CSS/JS，不加载任何外部资源；合并页的三栏编辑、校验和确认由页面脚本完成，离线可用，也不需要额外构建步骤。

### 8.2 页面

| 页面 | 功能 | 当前状态 |
|---|---|---|
| 总览 | 工具矩阵、入口状态、全局工作台、构建与部署记录、一键体检 | 已实现 |
| 部署 | 选择工具、预演、逐项动作与原因、确认后执行；含入口与技能 junction 明细 | 已实现；备份查看在独立页 |
| 冲突合并 | 三栏：现有文件 / 工作台内容 / 合并结果（可编辑）；预览、校验、确认后写入；回滚走备份页 | 已实现 |
| 项目挂载 | 扫描 `<项目父级>`，列出仓库、挂载状态、git 状态；选择项目后预演、确认 attach/detach | 已实现；逐个项目操作，不提供批量执行 |
| 内容维护 | 浏览现有规则与技能，编辑正文、校验、预演保存、新建规则/技能；保存后重建构建 | 已实现；只读写现有规则与技能的 `SKILL.md`，不提供删除、改名、机器档案编辑或 git 提交 |
| 备份与回滚 | 主动备份、备份列表、单文件恢复、清理旧备份 | 主动备份、列表、预演、清理、恢复已实现 |
| 历史 | 操作记录、部署与项目记录、待处理漂移/缺失项；条数可选 20/50/100/200 | 已实现；只读，不提供清理或删除日志 |
| 设置 | 备份保留数、GUI 端口、环境变量、工具路径覆盖与停用、版本要求、自定义工具；预演、确认后写回机器档案 | 已实现 |
| 诊断 | 读取状态、哈希、体检与操作日志；确认后生成诊断目录与 zip，并列出包内文件与打包问题 | 已实现；只写 `state/diagnostics/`，不读取机器档案正文、环境变量值或内容正文 |

### 8.3 与 CLI 的功能对等

| 能力 | CLI | GUI |
|---|---|---|
| 工具探测/环境检查 | `detect` | 总览页一键扫描 |
| 部署预演/执行 | `deploy --dry-run/--apply` | 部署页 |
| 单工具重部署 | `deploy --tool` | 工具行按钮 |
| 冲突合并 | `merge` | 三栏合并页 |
| 健康检查/修复 | `doctor --fix` | 总览页状态 + 一键修复 |
| 卸载/回滚 | `uninstall` / `backup restore` | 部署页“卸载工作台”、备份页 |
| 项目挂载 | `scan` / `attach` / `detach` | 项目页：扫描、分页、逐项弹层预演、确认执行 |
| 内容维护 | `content lint/new-rule/new-skill` | 内容页：新建、编辑、校验、保存后 build |
| 状态/日志 | `status` / `log` | 总览/历史页 |
| 设置 | `settings show/set/unset` | 设置页：查看、预演、确认后写回；版本要求与自定义工具增删改 |
| 诊断包 | `diagnose --zip` | 诊断页按钮 |
| 等价命令 | — | 每个操作显示对应 CLI 命令 |

- GUI 必须覆盖 CLI 的全部交互型能力；CLI 保留自动化专用能力（`--json`、管道、CI 退出码、无人值守批处理、debug 日志）。
- 当前 GUI 已接：总览的 `status` / `detect`、体检 `doctor`、部署 `deploy`（含 `--tool` 与预演/执行）、冲突合并 `merge`、卸载 `uninstall`（含 `--force` 与确认）、项目 `scan/attach/detach`、内容 `content list/read/save/new-rule/new-skill`、备份 `backup list/create/prune/restore`、历史 `log`、诊断 `diagnose`、设置 `settings show/set`；页面底部显示对应 CLI 命令。
- 项目页列出 Git 仓库、入口跟踪和本地忽略三列；本地忽略指 `.git/info/exclude` 中的入口行，只在本机生效、不会提交，也不改 `.gitignore`。每行“操作”打开弹层选择方式并预演，列表支持手动输入或下拉选择每页数量和分页，表格区域单独滚动。
- 合并页只列出已启用且已安装的工具；未选择目标工具时“加载预演”保持禁用。加载预演后，左栏现有入口与中栏工作台内容只读，右栏编辑合并结果。编辑后需点“校验结果”，校验通过才出现确认勾选与写入按钮；离开合并页或再次编辑会清空确认状态。结果与建议一致时“按建议重置结果”保持禁用。GUI 不接受 `contentFile`，合并内容只能由页面提交。
- 设置页加载 `settings show`，用表单编辑保留份数、GUI 端口、环境变量、工具覆盖、版本要求和自定义工具；顶部“添加自定义工具”按钮打开弹层填写字段并加入未保存卡片。内置工具与自定义工具都提供“版本要求（可选）”输入，留空表示不核对，卡片底部显示当前检测版本与核对结果。页面加载后未修改时“预演修改”与“放弃修改”保持禁用，任一设置、环境变量或自定义工具卡片发生变化后才启用；放弃修改从机器档案重新加载并丢弃页面改动。点“预演”显示变更表，勾选确认后带预演哈希写回。页面只提交已知设置键，离开页面或继续编辑会清空确认状态。自定义工具卡片可继续编辑或标记删除；删除仍在部署记录中的工具会被预演标出并阻止。
- 部署、合并与备份恢复页面展示版本核对结果：部署预演与执行对版本阻止的目标给出原因，合并下拉对版本阻止的工具追加标记，恢复页在版本核对未通过时要求勾选强制覆盖。
- 部署页对记忆注入目标显示模式（内联/钩子）、区块字符数、全文合计/注入上限、不含空白字符、文件字节、估算字数、拆分文件路径与预算提醒；合并页不列出记忆注入目标，避免对会被注入截断的文件做手工合并。
- 部署页与合并页进入时重新读取 `detect` 填充目标下拉，设置写入成功后也会刷新；新增工具标注“（自定义）”，删除后旧选项和失效预演被清除。各页顶部用说明块写清页面作用与执行结果。
- 内容页左侧列出规则与技能，右侧加载正文；未选择文件时编辑器与“放弃修改”“校验并预演保存”禁用。编辑后显示“未保存”，预览通过才出现勾选确认与“保存内容”；继续编辑或离开页面会清空确认状态。保存成功后自动重建 `dist/` 并刷新列表，内置技能标记不可移除。新建规则/技能弹层先以 `dryRun` 预演文件名、模板与索引登记，勾选确认后才创建并重建构建，随后自动打开新文件。
- 历史页并行读取 `log` 与 `status`：上半部分显示日志目录、文件数、条数与最近部署时间，下面分“操作记录”“部署与项目记录”“待处理漂移”三块；操作记录按写入顺序倒序，展示动作、来源、目标、结果与备份，损坏行单独列出。条数下拉取 20/50/100/200，页面只读，所有按钮都不触发写入。
- 诊断页并行读取 `status`、`log` 与 `doctor`，展示构建哈希、部署状态、体检计数、工具入口与哈希、机器档案/全局工作台/项目路径和日志文件；刷新只读。生成按钮默认禁用，勾选确认后提交 `diagnose` 的 `zip: true`；服务端只接受 zip 生成并拒绝 `apply` / `dryRun`。结果列出诊断目录、zip、包内文件与大小、体检与部署摘要，以及打包时各段落的读取错误。
- `doctor --parity` 保证注册表层面不缺项。
- GUI 不提供任意 shell 终端，避免绕过安全规则。

### 8.4 安全约束

- 只监听 `127.0.0.1`，默认随机端口，启动时生成一次性 token；页面地址和 API 请求都必须携带 token。
- 服务端只放行动作白名单和固定参数；`build` 仅允许 `--check`，`backup` 仅允许 `list` / `create` / `prune` / `restore`，`deploy` / `merge` / `content save` / `attach` / `detach` / `settings` 不允许同时出现 apply 与 dryRun。`merge` 与 `content` 都拒绝 `contentFile`，内容只能由页面提交。
- 内容页只允许 `content lint/list/read/save/new-rule/new-skill`，且只能命中现有 `content/rules/<两位编号>-<名称>.md` 与 `content/skills/<名称>/SKILL.md`；名称按固定正则校验，不允许删除、改名或写其他路径。保存必须提交读取时的完整 SHA-256，服务端在预览和写入前分别复核；写入后重新校验磁盘内容并重建构建，任一步失败恢复原文件与构建。
- `settings` 只接受 `show` / `set` / `unset`；`changes` 必须是键值对象，只允许字符串、数字、布尔值和 `null`，最多 200 项，键名按设置模型校验（含 `customTools.<id>.<字段>`）；`expectedFileHash` 必须是完整 SHA-256。查看设置不接收 `changes` 或 `apply`。
- `attach` / `detach` 只接受机器档案允许范围内的项目绝对路径（项目父级直接子仓库或项目清单），GUI 的 `scan` 不接收自定义根目录。
- `diagnose` 只写 `state/diagnostics/`；GUI 仅允许 `zip: true`，不接受 `apply` / `dryRun`，且必须由页面确认。诊断包不读取机器档案正文、环境变量值、规则/技能/入口正文或令牌，但会包含本机绝对路径与主机名，README 中写明发送前需自行复核。
- 写入动作必须由页面提交 `confirm: true`，并走与 CLI 相同的核心；除上述项目路径外，GUI 不提供任意路径读写或 shell。
- 请求体上限 64 KB；响应带 CSP `default-src 'self'`，不使用外部 CDN 或内联脚本。
- 空闲 30 分钟自动退出。
- 日志不记录令牌、密钥、文件正文。
- 同一时间只允许一个写操作：`state/locks/deploy.lock`。

### 8.5 MVP 实现（v0.8）

- `src/gui/server.mjs`：原生 `node:http` 服务，提供 `/`、`/app.js`、`/style.css`、`POST /api/run` 和 `GET /api/ping`；`RUNNERS` 白名单映射到 `src/core/actions/`。
- `src/core/actions/gui.mjs` 负责启动服务、拼接带 token 的地址、可选打开浏览器；CLI 等待服务关闭后退出。
- 前端页面：总览（状态卡片、工具入口、全局工作台、体检结果）、部署（工具选择、预演、确认后执行；入口与技能 junction 明细；卸载工作台预演、`--force` 与确认后执行）、合并（三栏对照、结果校验、确认后写入）、项目（扫描、分页、逐项弹层预演与确认执行）、内容（列表、读取、编辑、校验预演、确认后保存并重建构建；新建规则/技能弹层）、备份（立即备份、清理旧备份、列表、恢复预演、`--force` 与确认后执行）、设置（保留份数、GUI 端口、环境变量、工具覆盖；预演、确认后写回）。没有可执行内容时对应按钮保持禁用，例如设置未修改、合并未选目标、内容未选择文件、备份列表为空；禁用按钮不显示悬停高亮。所有动态文本经 HTML 转义。
- 启动命令：`aiwb gui [--port <0-65535>] [--open] [--json]`；`--json` 输出 `{ok, url, port}` 供脚本读取。

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
      "action": "create-file",
      "blockHash": "sha256:...",
      "fileHash": "sha256:...",
      "contentHash": "sha256:...",
      "backup": "state/backups/qoder-cn/20261026-130000/",
      "deployedAt": "2026-10-26T13:00:00+08:00"
    }
  },
  "projects": {
    "<项目路径>": {
      "mode": "auto",
      "file": "AGENTS.md",
      "action": "create-file",
      "blockHash": "sha256:...",
      "excludeAdded": true,
      "attachedAt": "2026-10-26T13:10:00+08:00"
    }
  }
}
```

`action` 取值为 `create-file`、`append-block`、`insert-block`、`update-block`、`unchanged`、`manual-merge`；新建文件时 `backup` 为 `null`。手工合并记录额外带 `manualMerge: true`，`blockHash` 是实际写入的块哈希，`contentHash` 是当时的构建内容哈希。记忆注入目标额外记录 `memoryMode`（`inline` / `hook`）与 `splitFilePath`、`splitFileHash`；内联模式不记录拆分文件。项目记录沿用同一 `action` 口径，首次挂载后保持不变，detach 用它判断文件是否由工作台创建。

### 9.3 备份、日志与锁

- 备份：`state/backups/<tool>/<timestamp>/<原文件名>`，附 `manifest.json`（原路径、原哈希、动作、时间）。记忆注入目标同时备份入口与该工具的拆分文件，拆分文件动作记为 `manual-split`；拆分文件备份不能单独恢复入口，`backup restore` 会拒绝并提示改用入口备份。
- 主动备份：`backup create [--tool <id>]` 读取当前入口，存在则写入备份目录，`manifest.action` 记为 `manual`；入口不存在只报告“无入口”。只写本地备份，不改外部文件或部署记录，执行时获取部署锁。
- 查看与恢复：`backup list` 只读；`backup restore` 默认预演，`--apply` 恢复。恢复前再备份当前入口，写后校验；手改或缺部署记录时阻止，`--force` 才覆盖。
- 保留策略：`backup prune` 默认预演，`--apply` 才删除；份数优先取 `--keep`，其次取机器档案 `backupRetention`，缺省 10；每目标最近一份始终保留。只处理已注册工具的备份目录，无效清单与未注册工具只报告，不删除。执行时获取部署锁。
- 项目备份：`state/project-backups/project-<项目路径哈希>/<timestamp>/<原文件名>`，附 `manifest.json`；在修改或删除项目入口前写入，保持按项目隔离，不进入 `backup list` 的工具备份列表。
- 设置备份：`state/settings-backups/<timestamp>/<原文件名>`，附 `manifest.json`（原路径、原哈希、设置变更列表、时间）；只在 `settings set/unset --apply` 写机器档案前生成，不进入 `backup list` 的工具备份列表。备份目录与其他 `state/` 内容一样不入库。
- 日志：`state/logs/deploy-YYYYMM.jsonl`，按月追加，每行一条 JSON。记录时间、动作、来源（`cli`/`gui`）、工具、目标、结果、备份路径与受限 `detail`；只写白名单字段，拒绝 `content`/`text`/`body`/`token`/`secret` 等键，明细键数与字符串长度有上限。部署、卸载、合并、备份创建/清理/恢复、项目挂载/取消挂载、内容保存/新建与本机设置写入会记录，预演与无变化不记录。追加失败只返回错误，不影响已完成的写入。
- 日志读取：`log` 按月份文件名升序读入、按写入顺序倒序返回，默认 50 条、上限 1000 条；损坏行与缺字段记录跳过并列出文件与行号。`log` 同时附带 `deploy-state.json` 中的部署与项目记录，但状态记录缺失不影响退出码。
- 诊断包：`diagnose` 把 `status`、`doctor`、`log`、部署记录与路径清单写入 `state/diagnostics/diagnose-<时间>/`，含 `README.md`、`summary.json`、`status.json`、`doctor.json`、`log.json` 与 `paths.json`；`--zip` 另生成同名 zip，条目以目录名开头。状态、体检、日志或部署记录某一段读取失败时，错误写入该段与 `issues`，不阻止其余文件生成；目录或 zip 写入失败才整体报错并清理已建目录。目录与 zip 同名冲突时追加序号，不覆盖旧诊断包。
- 诊断包不读取机器档案正文、环境变量值、规则/技能/入口正文或访问令牌；包含主机名、绝对路径、构建与入口哈希、部署与日志元数据和体检结果。诊断包不写操作日志，与 `build` 一致。
- 锁：`state/locks/deploy.lock`，CLI/GUI 写操作前获取；含 PID 和时间，超过 30 分钟视为陈旧锁。项目 `attach` / `detach` 与部署共用同一把锁。
- `state/` 整体 gitignore；备份不随仓库迁移。

### 9.4 doctor 检查项

- 入口文件是否存在、是否包含工作台块、块哈希是否与状态一致。
- 记忆注入目标：拆分文件是否存在、哈希是否与状态一致；缺失或漂移分别计为 `missing-split` / `drift-split`。
- 记忆注入目标：入口文件字符数是否超过配置的 `injectLimit`；超限计为待处理并提示精简区块外旧记忆，不阻止部署。明细附带不含空白字符、文件字节与估算字数供编辑器或工具对照。没有 `entry.budget` 的工具不参与该检查。
- 入口文件是否有外部改动（文件哈希变化）。
- junction 是否失效/指向别处。
- 技能 junction：每个 `content/skills/<name>` 是否已接入已安装工具的技能目录；同名真实目录或异向链接计为失败，待创建计为待处理。
- `dist/ENTRY.md` 是否比入口新（需要重新部署）。
- 技能索引与实际 `content/skills/` 是否一致。
- 规则命名、编号、索引登记、失效引用，技能 frontmatter、重名、内置技能是否存在（与 `content lint` 同源）。
- `doctor --parity`：CLI 动作与 GUI 元数据是否对齐。
- 项目挂载：文件是否存在、块哈希、exclude 行是否存在、项目是否已跟踪该文件。
- 本机设置：frontmatter 与 `## 设置` JSON 的解析问题、路径引用未定义环境变量、未知工具 id、版本要求格式、自定义工具定义与 id 冲突；有问题时计为失败并列出具体键，通过时报告自定义工具数量。版本要求已填写但检测不到版本时在 `detect`、`status` 与部署结果中提示，不作为设置文件损坏。
- 机器档案是否存在；目标路径是否随工具升级失效。
- `scripts/check-paths`：README/docs 中的路径是否仍存在。

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
5. `aiwb deploy --dry-run` 查看动作，确认后 `aiwb deploy --apply`；它会按“全局工作台”创建 `todo/`、`scripts/`、`notes/`、`_tmp/` 和 `scripts/ai-workbench` junction，并写入各工具入口。只想安装全局工作台时运行 `node scripts/install-global.mjs --apply`。
6. `aiwb status` 与 `aiwb doctor` 确认状态和全局工作台检查。
7. 对需要的项目运行 `aiwb scan` 查看状态，再逐个执行 `aiwb attach <项目路径>` 预演，确认后加 `--apply`。
8. 各工具新开会话抽检。

### 10.2 日常维护

- 改通用规则：只改 `content/rules/` → `content lint` → 经用户确认后本地提交（中文说明）→ `aiwb build` → `aiwb deploy --dry-run` → `aiwb deploy --apply` → `aiwb doctor`。
- 改机器路径/项目清单：只改 `machines/<主机名>.md` → 同上；改“全局工作台”后重新运行 `aiwb deploy --apply`（或 `node scripts/install-global.mjs --apply`）。
- 新增可部署脚本：放 `content/scripts/` → `aiwb deploy --dry-run` 或 `node scripts/install-global.mjs` 预演 → 提交；junction 实时生效，新增文件不需要重新安装。
- 新增/修改工具入口：改 `adapters/targets.json` 和 `src/core/targets/<tool>.mjs` → 跑集成测试 → `deploy --dry-run` → `deploy --apply`。
- 新增规则：`aiwb content new-rule <slug>`（自动编号并登记 `00-index.md`）→ 补正文 → `content lint` → build → deploy。
- 新增技能：`aiwb content new-skill <name> --description "触发场景"` → 补正文 → `content lint` → build → deploy（自动更新索引并创建或复用技能 junction）。
- 删除技能：先确认链接指向本仓库，再从各工具技能目录移除该技能 junction（`uninstall` 只提供整体清理，不按技能删除），然后删 `content/skills/` 目录并重新 `deploy`；内置技能 `aiwb` 不允许删除；不要直接删用户目录里的真实技能。
- 工具升级后：`aiwb detect` + `doctor`，检查入口路径是否失效。
- 每月或换机后：`doctor` + 各工具抽检一次。
- 新项目：`scan` 后按需 `attach`，不自动挂载。
- 修改 GUI：直接编辑 `src/gui/web/` 下的 HTML、CSS 与脚本；页面不引入第三方前端库或外部资源。

### 10.3 迁移与备份

- 主渠道：Git 私库（地址待提供）。
- 辅助：可把工作台目录加入 <备份工具> 的备份条目（可选，待确认）。
- 不入库：`dist/`、`state/`、`local/`、`_tmp/`、全局工作台、项目 `local/` 与 `_tmp/`、备份、日志、密钥、机器令牌。
- 机器差异：`machines/` 每台一份；不要把某台机器的绝对路径写进 `content/`。
- 项目挂载块含绝对路径；换机后由 deploy/attach 重写。
- 离线迁移：`scripts/package.mjs` 生成 zip（含源码和文档，不含 state/dist）。

### 10.4 卸载

- `aiwb uninstall [--tool <id>]`：默认预演，`--apply` 才移除。带 `--tool` 只处理该工具的入口与技能 junction；不带 `--tool` 处理全部注册工具，并移除全局脚本 junction。
- 入口只移除带标记的工作台块；工作台创建且部署后未改动的独立文件整体删除；记忆注入目标同时删除本工作台生成且未改动的拆分文件；改动前写 `uninstall-safety` 备份，写后校验，失败从备份回滚。
- 块被手改或没有部署记录时阻止；`--force` 只移除块，不删除文件。
- 技能 junction 只在链接确实指向本仓库 `content/skills/<name>` 时移除；同名真实目录或异向链接视为冲突并保留。内置技能内容不从仓库删除。
- 不删除全局工作台目录、用户数据、备份或仓库本身；项目挂载由 `detach` 单独处理。

---

## 十一、落地阶段与验收

### 11.1 阶段

| 阶段 | 内容 | 退出条件 |
|---|---|---|
| P0 | 建仓库骨架：`content/`、`machines/`、`adapters/`、`src/`、`launchers/`、`scripts/`、`tests/`、`docs/`；写 `rules/*`、`<主机名>.md`、`targets.json` | 不写任何工具目录；本地可生成 `dist/ENTRY.md` |
| P1 | `src/core` + CLI：detect/build/deploy/doctor/status；先接 Qoder CN | DryRun 清单正确；Qoder 新会话实测通过 |
| P2 | GUI MVP：总览、部署、冲突合并；动作注册表 + parity | 浏览器实测通过；GUI 与 CLI 结果一致 |
| P3 | 备份保留策略、技能 junction、卸载、项目挂载、设置、版本要求与自定义工具 | attach/detach 可逆；备份可按策略清理；自定义工具可单独部署；版本要求能阻止不符目标；git 状态干净 |
| P4 | 接入其余已装工具；Git 私库；新机演练 | 各工具抽检通过；clone+deploy 可复现 |

P1 的写入链路已实现并在临时沙箱通过测试；Trae CN 已完成真实部署，Qoder CN 写入与实测待用户确认后执行。P2 的 GUI MVP（总览、部署、备份、体检、冲突合并）已实现；冲突合并页通过真实浏览器核对，三栏对比、块外改动拦截、应用后块外字节不变均符合预期。P3 的技能 junction、备份保留清理、卸载、项目挂载、设置、版本要求与自定义工具已实现并通过沙箱测试；设置页与自定义工具注册、部署、删除阻止另经真实浏览器核对；版本字段与拦截逻辑的浏览器核对见 8.3 节。

### 11.2 验收标准

1. 任一已接入工具新开会话，不给背景，能答对：资料目录、项目父级、注释规范、能否自动提交、有哪些技能。
2. 让它说明“删除测试文件”的流程，必须包含“先确认 + 回收站”。
3. 改一条规则 → build → deploy --apply → 各入口哈希一致；doctor 能报出人为改副本的漂移。
4. GUI 部署矩阵与 `state` 一致；冲突页能显示三栏并成功应用；应用后原文件前缀字节不变。
5. `doctor --parity` 通过，无 CLI/GUI 功能缺项。
6. 项目挂载只影响选中的项目；新建的 `AGENTS.md` 不出现在 git 状态中；detach 后恢复原状，工作台创建的空文件被删除。
7. 新机器 clone + deploy + 抽检可在 10 分钟内完成（不含安装工具）。
8. 现有 Trae 3 条规则、Qoder `test.md`、CodeBuddy `test.mdc` 未被修改。
9. `scripts/check-paths` 通过：README/docs 中不存在失效路径。
10. `node scripts/install-global.mjs` 预演通过；`scripts/ai-workbench` 指向 `content/scripts/`，重复执行为“无变化”。
11. `deploy --apply` 重复执行幂等：首次写入、再次无变化；手改块后不覆盖；全局冲突时零写入；每次覆盖写入都有备份且失败可恢复。
12. 自定义工具在设置页登记后出现在部署与合并目标中，可单独预演和部署；配置目录不存在时仍能创建入口与技能 junction；仍有部署记录时删除被阻止，卸载后删除成功且目标下拉同步移除。
13. 填写版本要求且实际版本不符或无法检测时，部署跳过该目标并继续其他目标，合并与恢复阻止，恢复可 `--force`；版本匹配或留空时不拦截。GUI 设置卡片与部署、合并、恢复页面显示要求、检测值和核对结果。

### 11.3 抽检口令

- “不看任何文件，告诉我：①资料目录 ②项目父级 ③注释规范 ④能不能自己提交 ⑤有哪些技能。”
- “读一下安全删除规则，说明你会怎么删一个测试文件。”
- “这个项目的构建命令是什么？”（验证机器档案的项目清单）

---

## 十二、风险与待确认事项

### 12.1 风险

| 风险 | 影响 | 缓解 | 状态 |
|---|---|---|---|
| CodeBuddy 全局入口文件名与加载行为待确认 | 部署后不生效 | 部署后新会话实测；失败则用规则目录或手动口令兜底 | `[待实测]` |
| QwenWork 入口已确认但加载未抽检 | 部署后不生效 | 部署后新会话验证 `awareness/main/AGENTS.md` 被读取 | `[待实测]` |
| WorkBuddy 用户级不支持 AGENTS.md | 用户级部署无效果 | 改为向账号目录 `MEMORY.md`（未绑定回落设备根）注入带标记区块；超预算只留钩子；部署后开新会话复述验证 | 已实现，账号路径加载待实测 |
| WorkBuddy 账号快照缺失或过期 | 部署落到设备根，账号会话读不到 | 快照无效时不再写设备根：解析结果与提示照常给出，目标记为需人工并阻止部署，先登录 WorkBuddy；按配置根下有无账号目录区分“疑似已登出”与“未检测到已登录账号” | 已实现 |
| Trae 设置中的“导入 AGENTS.md”被误当作用户级入口 | 规则不生效 | 该选项只导入工作区根目录；用户级仍写 `user_rules` | `[实测]` |
| Trae/CodeBuddy 用户级技能目录未确认 | 技能 junction 无效 | 部署时实测；不认则靠入口索引按需读取 | `[待实测]` |
| 工具版本升级改路径或格式 | 入口写入不支持的位置或失效 | 在设置中填写版本要求；部署、合并与恢复前核对，不匹配或未知时阻止 | 已实现 |
| Claude Code 未安装，AGENTS.md 支持随版本 | 入口可能不生效 | 装后实测；默认按 CLAUDE.md 处理 | `[文档]` |
| 项目挂载污染 git | 误提交个人规则 | 默认关闭；新建文件写 `.git/info/exclude`；已跟踪文件默认不改 | 已实现 |
| Node 依赖 | 新机器无 Node 时 CLI/GUI 不可用 | 启动器检测并提示安装；备选 PowerShell 核心（待定） | `[待确认]` |
| 全局入口过长 | 占用上下文 | 控制在 40–80 行；细节按需读取 | 已设计 |
| 工具升级改路径 | 入口失效 | doctor 检测；adapters 表维护；可填写版本要求提前拦截 | 已实现 |
| 中文路径 | 部分脚本兼容差 | 仓库用 ASCII 路径；目标路径加引号 | 已设计 |
| 本地 GUI 服务被滥用 | 读取/修改配置 | 仅 127.0.0.1、token、动作与参数白名单、默认只读、写入确认、空闲退出 | MVP 已实现 |
| CLI/GUI 同时写 | 状态/文件冲突 | `state/locks/deploy.lock` + 陈旧锁处理 | 已设计 |
| 备份占用空间 | D 盘增长 | 默认保留 10 份；可清理 | 已实现 |
| 现有规则与工作台规则重复/冲突 | 双重规则、行为矛盾 | 不自动删；部署后逐条确认再精简 | 已设计 |
| 文档与代码路径漂移 | 维护时找不到文件 | `scripts/check-paths.mjs` 检查 | 已设计 |

### 12.2 待确认

1. ~~核心是否统一用 Node 实现~~：已决策采用 Node，并在 P0 实施。
2. ~~项目挂载是否按“默认关闭、只写本地不入库、已跟踪文件默认只报告”执行~~：已按此实现，已跟踪文件默认阻止，`--mode append` 才显式追加。
3. Git 私库地址（Gitee/GitHub 私有仓库），待提供。
4. ~~GUI 是否使用 CodeMirror MergeView~~：已改为原生三栏编辑器，不引入前端依赖。
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
| 2026-10-26 | GUI 选型 | 本地 Web（Node + 浏览器） | 无安装、启动快，CLI 与 GUI 共用核心 |
| 2026-10-26 | 项目挂载 | 可选、用户确认、默认关闭、只写本地 | 避免污染仓库和团队项目 |
| 2026-10-26 | 项目结构 | `content/` + `machines/` + `adapters/` + `src/` + `launchers/` + `scripts/` + `tests/` + `docs/` + `dist/` + `state/` | 部署源、构建产物、外部部署物、运行状态分离 |
| 2026-10-26 | 机器内容 | 环境/路径/项目清单放 `machines/`，不进 `content/rules/` | 换机器只改机器档案 |
| 2026-10-26 | 运行时依赖 | 零 npm 运行时依赖；前端只用原生 HTML/CSS/JS | 迁移简单、离线可用 |
| 2026-10-31 | 脚本分层 | 本仓库自身脚本放 `scripts/`，不部署；可部署通用脚本放 `content/scripts/`，安装为全局工作台 `scripts/ai-workbench` junction | `content/` 是可部署源；AI 工具根不放脚本 |
| 2026-10-31 | 部署执行 | 默认预演，`--apply` 才写；写前备份、原子写、写后校验、失败恢复、并发锁、状态记录 | 可回滚，避免半写入 |
| 2026-10-31 | 块哈希口径 | 按块内正文去除尾部换行后计算，`build`、状态和 `findBlock` 共用 | 避免部署后误报漂移 |
| 2026-10-31 | 备份恢复 | 默认预演，恢复前再备份当前入口；手改或缺记录时阻止，`--force` 才覆盖 | 恢复本身可逆，不覆盖未知修改 |
| 2026-10-31 | GUI MVP 范围 | 先落地总览、部署、备份与体检；冲突合并、项目挂载等随后续阶段补 | 先把常用操作跑通，避免一次铺开 |
| 2026-10-31 | 技能 junction | `deploy` 创建或复用；同名真实目录或异向链接只报告、不覆盖；技能冲突不阻塞入口写入 | 技能目录属于用户，部署只增不改 |
| 2026-11-01 | 项目入口写入 | 默认 `auto` 写 `AGENTS.md`；已跟踪文件阻止，`local` / `append` 显式选择；未跟踪文件加入 `.git/info/exclude` | 不污染版本库，方式由用户明确选择 |
| 2026-11-01 | 项目取消挂载 | 缺记录或块哈希不一致时阻止，`--force` 只移除块；只有工作台创建且移除后为空的文件才删除 | 无法确认归属的文件不删除 |
| 2026-11-01 | 冲突合并编辑方式 | 原生三栏 textarea，右栏编辑完整结果；服务端校验块外内容并重建入口 | 不引入前端依赖也能看清三栏；重建保证块外字节不被编辑器改写 |
| 2026-11-01 | 本机设置存放 | 保留份数与端口放机器档案 frontmatter，环境变量、工具覆盖与自定义工具放 `## 设置` 的 JSON 块；统一由 `settings` 修改 | 机器差异集中在一处，仍可手工查看与迁移，不引入独立配置文件 |
| 2026-11-01 | 设置写入安全 | 默认预演，校验预演文件哈希；写前备份到 `state/settings-backups/`，原子写入并写后再解析，失败回滚；只改目标键与设置节 | 本机档案含隐私且手工维护，写入必须可回滚且不破坏其余正文 |
| 2026-11-01 | 自定义工具存放 | 定义放机器档案 `## 设置` 的 `customTools`，不写注册表、不入库；目标注册表加载时合并，沿用同一部署链路 | 单机临时接入不应改变仓库级支持矩阵，也不应引入第二份配置文件 |
| 2026-11-01 | 自定义工具删除 | 仍有部署记录时阻止删除，要求先卸载；内置 id 冲突的定义仍可删除以修复档案 | 避免工具定义消失后入口失去管理，同时保留修复错误配置的路径 |
| 2026-11-01 | 操作日志格式 | 按 `state/logs/deploy-YYYYMM.jsonl` 月度追加 JSONL；只写白名单字段并过滤正文类键；读取按文件与写入倒序，坏行单列报告 | 需要跨 CLI/GUI 留痕又不能泄露用户正文或令牌；追加失败不应让已完成的写入被判为失败 |
| 2026-11-01 | 诊断包格式 | 目录含 README、summary、status、doctor、log、paths 六个文件；`--zip` 生成同内容 store-only ZIP；分段读取失败只记录不中断 | 排障需要完整现场又不能因某一段损坏就交不出包；零依赖 ZIP 足够传输与归档，也避免引入运行时依赖 |
| 2026-11-01 | 诊断包脱敏边界 | 不读机器档案正文、环境变量值、规则/技能/入口正文与令牌；保留主机名、绝对路径、哈希和日志元数据 | 路径与哈希是定位入口问题的关键；正文和凭据不属于诊断必需信息，README 提示发送前复核 |
| 2026-11-02 | 版本要求语义 | 内置与自定义工具都可选填版本要求；留空不核对，支持精确版本、比较条件、逗号（AND，优先级高于 `||`）、`||`（OR）与英文括号；不符或无法检测时部署跳过、合并与恢复阻止 | 避免把工作台入口写到不支持的版本路径；默认留空保证已有配置不被强制拦截 |
| 2026-11-02 | 版本表达式优先级 | 逗号（AND）高于 `||`（OR），英文括号可显式分组并支持嵌套；无运算符为精确匹配 | 与常见布尔运算优先级一致，便于同时表达特定版本和版本范围 |
| 2026-11-02 | 版本拦截范围 | 部署按目标跳过并继续其他目标，CLI 用退出码 2；恢复允许 `--force`；卸载不拦截；技能 junction 跳过 | 单个工具的版本不符不应拖垮整批部署；但用户已确认恢复或需要清理时仍要保留出口 |
| 2026-11-02 | 版本信息来源 | 内置工具探测规则放 `adapters/targets.json`，自定义工具通用探测配置目录；不在仓库写死具体支持版本 | 安装布局随工具升级变化；本机实际版本与要求属于机器差异，只存在机器档案 |
| 2026-11-02 | 入口支持判断证据 | 以应用包、初始化模板和实际设置项为准，不只看路径是否存在；Trae 导入选项仅工作区级，WorkBuddy 用户级只加载记忆/人设 | 路径存在不等于会被加载；避免把项目级能力误当用户级入口 |
| 2026-11-03 | WorkBuddy 用户级部署 | 改为 `MEMORY.md` 记忆注入：专用首尾标记包裹区块，默认置顶；区块与全文共用注入额度，超目标线只留钩子，正文放拆分文件 | 用户级 AGENTS.md 不自动加载；记忆文件每会话注入，写入区块即可当自定义指令生效，也能脚本化增删 |
| 2026-11-03 | 记忆注入写入纪律 | 保持入口原编码/BOM/换行，拆分文件固定 UTF-8 无 BOM + LF；按码点计数不做换行归一；标记必须全文件唯一；双文件事务失败同回滚 | 记忆文件被工具反复写回，形态一旦漂移会污染既有内容；字符数是注入预算的唯一口径 |
| 2026-11-03 | 超预算处理 | 超过目标线转钩子；超过注入上限时置顶钩子仍写入并警告，非置顶阻止；不允许手工合并记忆区块 | 钩子置顶才有机会进入注入窗口；长正文留在会被截断的文件里无法维护，应回到 `content/rules/` |
| 2026-11-03 | WorkBuddy 账号路径 | 从账号快照动态解析 `user-<uid>-<企业或个人>/MEMORY.md`，不硬编码账号标识；快照无效或超过 30 天按应用规则回落设备根，并在预演与状态中提示 | 注入通道按账号隔离；硬编码会随登录账号变化而失效，静默回落则会让用户误以为规则已生效 |
| 2026-11-03 | 未登录不写设备根 | 快照无效时部署一律按需人工阻止，无论配置根下有无账号目录；设备根只作解析展示 | 登录是使用前提，设备根记忆只在未绑定期间可能被读取，写入会随登录失效；宁可阻止让用户先登录，固定入口走 `entryPath` 覆盖 |

---

## 十四、下一步

1. 经用户确认后，对 Qoder CN 执行 `deploy --apply`，用新会话实测入口加载。
2. 通过后逐项验证 Trae、CodeBuddy 的真实入口加载；QwenWork 抽检 `awareness/main/AGENTS.md` 是否被读取；WorkBuddy 先清理设备根旧区块，再确认预演解析到账号目录并执行 `deploy --tool workbuddy --apply`，开新会话问“当前生效的自定义指令有哪些”，能复述才算注入成功。
3. 按 `ai-env-clone` 的支持版本与本机实际版本，为本机工具填写版本要求并验证拦截与放行。
4. P4：Git 私库、新机器 clone + deploy 演练、其余工具接入。

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
| 外部部署物 | 写到工具配置根、全局工作台或项目目录的入口块、独立文件、junction |
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

- 不接管/不修改各工具独有规则、技能、插件、人设文件；WorkBuddy 记忆文件只写带标记区块，区块外内容不改。
- 不复制厂商技能进仓库。
- 不自动给所有项目挂载 `AGENTS.md`。
- 默认不修改已跟踪的项目 `AGENTS.md`；只有用户显式选择 `append` 才写入，并由用户决定是否提交。
- 不在仓库保存密钥、令牌、账号凭据。
- 不把 `C:\Users\<用户>\AGENTS.md` 当作全工具通用入口。
- 不提供 GUI 任意 shell 终端。
- 不自动提交 git（CLI/GUI 都只给按钮/命令，由用户执行）。
- 不在 `content/` 写本机绝对路径；不在 `machines/` 写跨机器通用规则。
