# AI 工作台

把跨 AI 工具通用的规则、技能和机器信息维护在一处，再按各工具认可的入口一键分发。

## 当前阶段

P1 部署、P2 GUI 主流程（含冲突合并与内容编辑）、P3 的技能 junction、备份保留清理、卸载、项目挂载与设置（含自定义工具）已落地：

- 已建立真源仓库、规则、机器档案模板、目标注册表和入口模板；本机档案只在本地保存，不入库。
- 已实现 `build`、`detect`、`deploy`、`status`、`doctor`、`merge`、`uninstall`，内容维护 `content lint` / `list` / `read` / `save` / `new-rule` / `new-skill`，备份查看、主动备份、保留清理与恢复 `backup list` / `backup create` / `backup prune` / `backup restore`，以及本机设置 `settings show` / `settings set` / `settings unset`。
- `content save` 默认只预演：按提交正文校验，`--apply` 要求读取时的完整 SHA-256，写前复核、写后校验并重建 `dist/`，失败恢复原文件与构建。编辑范围仅限现有规则和技能的 `SKILL.md`；`new-rule` / `new-skill` 加 `--build` 会在创建后立即重建，失败回滚新文件与索引。
- `deploy` 默认只预演；`--apply` 才写外部入口和全局工作台，写入前备份、临时文件加原子替换、写后校验、失败回滚，并记录到 `state/`。
- `deploy` 同时把 `content/skills/<name>` 以 junction 接入各已安装工具的技能目录：目录缺失时创建，已指向本仓库时无变化，真实目录或指向别处的链接只报告冲突，不覆盖。
- `backup create [--tool <id>]` 主动把当前存在的入口文件备份到 `state/backups/`，只读取入口，不改动工具目录；GUI 备份页提供“立即备份”。
- `backup prune [--tool <id>] [--keep <n>]` 按每工具保留份数清理旧备份，默认只预演，`--apply` 才删除；份数默认取机器档案 `backupRetention`，最近一份始终保留。
- `backup restore` 默认只预演；`--apply` 才恢复，恢复前会再备份当前入口；入口在部署后被修改时拒绝，需 `--force` 才覆盖。
- `merge <工具 id>` 为入口生成合并结果：有工作台块时替换块内内容，没有块时追加或新建；默认只预演，`--apply --content-file <路径>` 才写入。只接受块内正文的修改，块外原文改动会被校验拒绝；写入前备份，写后校验块哈希，失败回滚，并在状态中记为手工合并。
- `uninstall [--tool <id>]` 移除入口中的工作台块或工作台创建的文件，并清理指向本仓库的技能 junction；不带 `--tool` 时同时移除全局脚本 junction。默认只预演，`--apply` 才写入，保留用户内容、全局工作台目录与备份。
- `scan` 只读扫描“项目父级”下的 git 仓库与项目清单，区分项目是否为 git 仓库、入口文件是否在 git 索引中、入口是否已写入本机 `.git/info/exclude`；`attach <项目路径>` 向项目入口写入工作台指针块并按需加入 `.git/info/exclude`，默认预演，`--apply` 才写入；`detach` 只移除工作台块，工作台创建且已空的文件才删除。已跟踪文件默认不改：`--mode local` 改为写未跟踪的 `AGENTS.local.md`，或显式 `--mode append` 写入已跟踪的 `AGENTS.md`。已挂载项目改用另一个入口文件需先 `detach` 再 `attach`；`auto` 与 `append` 共用 `AGENTS.md`，可直接切换。
- `settings show` 查看机器档案中的备份保留份数、GUI 端口、环境变量、工具覆盖与自定义工具；`settings set <键>=<值>` / `settings unset <键>` 修改这些设置，默认只预演，`--apply` 才写回。设置中的 `env` 优先于进程环境变量，路径值支持 `${NAME}` 与 `%NAME%` 展开；工具覆盖可停用目标或改写配置根、入口路径与技能目录。
- `customTools.<id>` 登记工作台尚未内置支持的工具，可设显示名称、配置根、入口、写入方式（追加块/独立文件）、格式、技能目录、frontmatter 与启用状态。自定义工具并入部署、合并、备份、卸载、状态与体检，在部署页可单独选择；即使配置目录不存在，部署也会按填写的入口与技能路径创建父目录后写入。仍有部署记录的自定义工具不能直接删除，需先卸载。
- `gui` 启动只监听 `127.0.0.1` 的本地页面，提供总览、体检、部署与卸载预演/执行、三栏冲突合并、规则与技能的内容编辑、项目扫描与挂载/取消挂载、备份创建/清理/查看/恢复，以及本机设置查看、预演与写回；内容页先校验并预演保存，勾选确认后写入并重建构建，新建规则/技能弹层先预演模板再创建；设置页顶部可用“添加自定义工具”打开弹层登记新工具，部署与合并的目标下拉会同步列出新增工具。各页顶部说明该页作用与执行结果。合并页展示现有入口、工作台内容与可编辑结果，未选择目标工具时“加载预演”禁用，校验通过并勾选确认后才能写入。设置页未修改时“预演修改”和“放弃修改”禁用；内容页未选择文件时编辑与保存按钮禁用；备份列表为空时“清理旧备份”禁用；禁用按钮不显示悬停高亮。项目页按每行“操作”打开弹层，选择方式、预演并确认执行，列表支持手动输入或下拉选择每页数量和分页、表格区域单独滚动。写操作必须由页面显式发起，部署、合并、内容保存、内容新建、卸载、项目写入、清理、恢复与设置写入还需勾选确认，服务空闲 30 分钟自动退出。
- **尚未对真实 AI 工具目录执行过 `deploy --apply`**。全局工作台也可单独用 `scripts/install-global.mjs` 安装。

设计细节见 [docs/design.md](docs/design.md)。

## 快速开始

首次使用先按 `machines/_template.md` 创建本机档案 `machines/<主机名>.md`（该文件不入库），再执行：

```powershell
# 生成入口内容与清单
node src/cli/main.mjs build

# 查看本机各工具入口状态
node src/cli/main.mjs detect

# 只预演，不写任何外部文件
node src/cli/main.mjs deploy --dry-run

# 确认预演结果后执行：写各工具入口、创建全局工作台与技能 junction
node src/cli/main.mjs deploy --apply

# 只安装全局工作台目录与脚本 junction（不碰工具入口）
node scripts/install-global.mjs --apply

# 查看部署状态
node src/cli/main.mjs status

# 主动备份当前入口（只写本地 state/backups，不改工具目录）
node src/cli/main.mjs backup create

# 查看备份；清理与恢复默认只预演，确认后加 --apply
node src/cli/main.mjs backup list
node src/cli/main.mjs backup prune --keep 10
node src/cli/main.mjs backup restore <工具 id> <时间戳>

# 冲突合并预演；按 --json 输出中的 suggested 编辑块内正文
node src/cli/main.mjs merge <工具 id>

# 合并写入：--content-file 指向完整的合并结果，确认后再加 --apply
node src/cli/main.mjs merge <工具 id> --apply --content-file <合并结果路径>

# 卸载预演；--tool 只处理一个工具，确认后加 --apply
node src/cli/main.mjs uninstall --tool <工具 id>

# 扫描项目仓库；挂载/取消挂载默认只预演，确认后加 --apply
node src/cli/main.mjs scan
node src/cli/main.mjs attach <项目路径> --mode auto
node src/cli/main.mjs detach <项目路径>

# 查看本机设置；修改默认只预演，确认后加 --apply
node src/cli/main.mjs settings show
node src/cli/main.mjs settings set backupRetention=10 guiPort=0

# 登记尚未内置的工具；必填 name、configRoot、entryPath，其余字段可省略
node src/cli/main.mjs settings set customTools.<工具 id>.name=<显示名称> customTools.<工具 id>.configRoot=<配置目录> customTools.<工具 id>.entryPath=<入口文件>

# 检查动作注册表与基础环境
node src/cli/main.mjs doctor --parity

# 打开本地 GUI（总览、体检、部署、合并、项目、内容、备份、设置）
node src/cli/main.mjs gui --open

# 校验、读取和保存内容；保存默认只预演，--apply 才写入并重建构建
node src/cli/main.mjs content lint
node src/cli/main.mjs content list
node src/cli/main.mjs content read rule <规则名称>
node src/cli/main.mjs content save rule <规则名称> --content-file <正文文件路径>
node src/cli/main.mjs content save rule <规则名称> --content-file <正文文件路径> --expected-hash <读取时的哈希> --apply

# 新建内容并立即重建构建
node src/cli/main.mjs content new-rule <slug> --title "标题" --build
node src/cli/main.mjs content new-skill <name> --description "触发场景" --build
```

也可以使用启动器：

```powershell
launchers\aiwb.cmd build
launchers\aiwb.cmd deploy --dry-run
launchers\aiwb-gui.cmd
```

## 目录

| 目录 | 用途 | 是否入库 |
|---|---|---|
| `content/` | 通用规则、技能、入口模板、可部署脚本 | 是 |
| `machines/` | 机器档案模板；本机档案 `machines/<主机名>.md` 不入库 | 模板是，本机档案否 |
| `adapters/` | 各工具入口路径与支持状态 | 是 |
| `src/core/` | CLI 与 GUI 共用的业务核心 | 是 |
| `src/cli/` | 命令行入口 | 是 |
| `src/gui/` | 本地 Web GUI：服务端与静态页面 | 是 |
| `launchers/` | Windows 启动器 | 是 |
| `scripts/` | 本仓库自身的维护、部署、校验、打包脚本，不部署 | 是 |
| `tests/` | 单元、集成、对等性测试 | 是 |
| `docs/` | 设计、支持矩阵、维护、迁移 | 是 |
| `local/` | 本地开发维护产生的文档、脚本与草稿 | 否 |
| `dist/` | 构建产物 | 否 |
| `state/` | 部署状态、写前备份、并发锁 | 否 |

## 资料分层

资料和脚本按“可复用 vs 一次性、随代码走 vs 只给当事人”分层存放，完整规则见 [content/rules/04-storage.md](content/rules/04-storage.md)。

- 本仓库：可部署内容放 `content/`，自身维护脚本放 `scripts/`；本机草稿放 `local`，一次性产物放 `_tmp`，两者均忽略。
- 全局工作台：`todo`（跨会话待办）、`scripts`（跨项目脚本）、`notes`（长期问题库）、`_tmp`（临时区）；具体路径见机器档案的“全局工作台”。
- 代码项目：共享文档与脚本进 `docs`、`scripts`、`tools`；当事人资料进 `local`；临时内容进 `_tmp`。项目不建 TODO 文档。
- 部署：各 AI 工具根只写入口和技能 junction；`content/scripts/` 以 junction 安装到 `<全局工作台>/scripts/ai-workbench`；规则、技能和脚本都不复制到工具根。

## 安全边界

- 只改 `content/`、`machines/`、`adapters/` 和工具代码；不接管各 AI 工具独有规则、技能、插件、人设和记忆。
- 部署只追加带标记的块或写独立文件；写前备份到 `state/backups/`，原子替换并做写后校验，失败用备份恢复；块被手改或已有非工作台文件时只报告，不覆盖。
- `backup create` 只读取当前入口并写本地 `state/backups/`，不改外部文件，也不写部署记录。
- `backup prune` 默认只预演；`--apply` 只删除 `state/backups/` 中超出保留份数的旧备份，保留份数取 `--keep` 或机器档案 `backupRetention`，每工具最近一份始终保留。
- `backup restore` 恢复前再备份当前入口；入口在部署后被修改或缺少部署记录时阻止，`--force` 才覆盖。
- `uninstall` 只删除带工作台标记的块、工作台创建且未改动的入口文件和指向本仓库的 junction；入口改动后或缺少部署记录时阻止，`--force` 才移除块并保留文件。卸载前备份入口，保留全局工作台目录、用户技能与 `state/backups/`。
- `merge` 只允许改工作台块内的正文，校验工作台块标记、前缀与后缀；块外改动、标记损坏或编码不可读时阻止写入。写前备份，写后校验字节与块哈希，失败回滚；状态记为 `manual-merge`，后续部署不会覆盖手工结果。GUI 不读取任意文件，合并内容由页面编辑器提交。
- `attach` / `detach` 只改选中的项目根入口：默认写 `AGENTS.md`，未跟踪时加入 `.git/info/exclude`；已跟踪文件默认阻止：`--mode local` 改为写 `AGENTS.local.md`（该文件也须未跟踪），`--mode append` 才向已跟踪文件写入。已挂载项目改用另一个入口文件（`AGENTS.md` 与 `AGENTS.local.md` 之间）时阻止，需先 `detach` 再 `attach`；`auto` 与 `append` 共用 `AGENTS.md`，可直接切换。修改前备份到 `state/project-backups/`，与工具入口备份分开；没有记录或块被手改时 `detach` 阻止，`--force` 只移除块、不删除文件。
- `deploy --apply` 同时负责全局工作台目录、脚本 junction 与各工具技能 junction；全局工作台冲突时整体不写，技能同名路径冲突时保留原内容。写入期间用 `state/locks/deploy.lock` 阻止并发部署。
- `settings` 只写本机机器档案，不改各工具目录、部署状态或备份；修改前备份到 `state/settings-backups/`，校验预演文件哈希、写后字节与解析结果，失败回滚。路径覆盖引用未定义环境变量时只报告并阻止写入。自定义工具定义同样只存在本机档案；仍有部署记录时阻止删除，避免入口失去管理。
- GUI 只监听 `127.0.0.1` 并带启动令牌；页面不加载外部资源，不提供任意 shell；`build` 仅允许 `--check`；内容页只读写现有规则文件与技能的 `SKILL.md`，保存必须提交读取时的哈希并在页面勾选确认，服务端拒绝 `contentFile`；项目挂载只接受机器档案允许范围内的绝对路径，设置页只接受已知设置项，写入动作必须带界面确认。
- 脚本不进各 AI 工具根；全局调用走 `<全局工作台>/scripts/ai-workbench`，本机专用脚本放其同级目录。
- `content/` 不写本机绝对路径；机器差异一律放 `machines/<主机名>.md`，该文件只在本地保存，禁止提交。
- 仓库不保存密钥、令牌、账号凭据。
- 不自动提交 git。提交说明使用中文，并按变更单元合并提交。

## 维护入口

- 修改通用规则：`content new-rule <slug>` 或直接改 `content/rules/` → `content lint` → `build` → `deploy --dry-run` → `deploy --apply` → `doctor`。
- 编辑内容：GUI 内容页选择文件后修改，先“校验并预演保存”，勾选确认后写入并自动重建构建；CLI 走 `content read` → `content save` 预演 → 带 `--expected-hash` 的 `--apply`。只支持现有规则与技能的 `SKILL.md`，不支持删除或改名。
- 回滚入口：`backup list` 找到时间戳 → `backup restore <工具 id> <时间戳>` 预演 → 确认后加 `--apply`。
- 手改入口冲突：`merge <工具 id>` 预演 → 在结果中只编辑工作台块正文 → 用 `--apply --content-file` 或 GUI 合并页写入；块外内容改不了，需要保留的规则不要删。
- 卸载工作台：`uninstall [--tool <id>]` 预演 → 确认后加 `--apply`；入口有手改或无部署记录时先核对，再加 `--force`。
- 项目挂载：`scan` 查看状态 → `attach <项目路径>` 预演 → 确认后加 `--apply`；取消时 `detach <项目路径>` 预演 → 确认后加 `--apply`，无记录或手改块需先核对再加 `--force`。
- 修改本机路径或项目清单：改 `machines/<主机名>.md`（不入库）→ 同上。
- 修改本机设置：`settings show` 查看 → `settings set <键>=<值>` 预演 → 确认后加 `--apply`；`settings unset <键>` 删除覆盖。GUI 设置页走同一流程，内容越界或路径变量未定义时阻止写入。
- 接入未内置的工具：在 GUI 设置页顶部点“添加自定义工具”，在弹层中填写并加入列表，再预演、确认写入；或 `settings set customTools.<id>.<字段>=<值>` 预演 → 确认写入。之后在部署页单独预演并部署。字段与校验见 [docs/maintenance.md](docs/maintenance.md#本机设置)。
- 新增工具：要成为仓库级默认支持时改 `adapters/targets.json`，并在 `src/core/targets/` 补该工具的特有行为；只在本机使用则登记为自定义工具。
- 新增技能：`content new-skill <name> --description "触发场景"`，再补正文；也可在 GUI 内容页点“新建技能”先预演再创建。`build` 会自动生成技能索引，`deploy --apply` 会创建或复用各工具的技能 junction。
- 新增可部署脚本：放 `content/scripts/`（零依赖 Node 脚本）→ `node scripts/install-global.mjs` 预演 → 需要时 `--apply`。本仓库自身脚本仍放 `scripts/`，不部署。
- 日常操作也可用 `node src/cli/main.mjs gui --open`：总览与体检只读，部署、合并、内容保存、恢复和设置默认先预演，执行前需在界面勾选确认。
- 内置技能 `aiwb` 受 `content lint` 保护，不能删除或取消 `builtin`；调整时通过仓库修改。
