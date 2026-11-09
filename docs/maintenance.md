# 日常维护

## 常用命令

```powershell
node src/cli/main.mjs build
node src/cli/main.mjs build --check
node src/cli/main.mjs detect
node src/cli/main.mjs deploy --dry-run
node src/cli/main.mjs deploy --apply
node src/cli/main.mjs uninstall --tool <工具 id>
node src/cli/main.mjs uninstall --tool <工具 id> --apply
node src/cli/main.mjs uninstall
node src/cli/main.mjs backup create
node src/cli/main.mjs backup create --tool <工具 id>
node src/cli/main.mjs backup list
node src/cli/main.mjs backup prune
node src/cli/main.mjs backup prune --keep 5 --apply
node src/cli/main.mjs backup restore <工具 id> <时间戳>
node src/cli/main.mjs settings show
node src/cli/main.mjs settings set backupRetention=10 guiPort=0
node src/cli/main.mjs settings unset env.<变量名>
node src/cli/main.mjs status
node src/cli/main.mjs log --limit 20
node src/cli/main.mjs diagnose --zip
node src/cli/main.mjs doctor
node src/cli/main.mjs doctor --parity
node src/cli/main.mjs content lint
node src/cli/main.mjs content list
node src/cli/main.mjs content read rule <规则名称>
node src/cli/main.mjs content save rule <规则名称> --content-file <正文文件路径>
node src/cli/main.mjs content save rule <规则名称> --content-file <正文文件路径> --expected-hash <读取时的哈希> --apply
node src/cli/main.mjs content new-rule <slug> --title "标题" --build
node src/cli/main.mjs content new-skill <name> --description "触发场景" --build
node src/cli/main.mjs gui --open
node src/cli/main.mjs gui --port 4599 --json
node scripts/install-global.mjs
node scripts/install-global.mjs --apply
```

也可以使用 `launchers\aiwb.cmd <命令>`。

## 首次初始化（新机器）

1. 优先让支持项目指令的 AI 工具打开仓库并说明“初始化本机档案”，按 `AGENTS.md` 的“首次初始化（新机器）”和 `docs/onboarding.md` 执行：AI 先讲解本机档案、写入范围与部署方式，展示初始化/部署待办清单，再只读盘点 → 生成候选档案 → 逐项确认 → 写入 → 校验 → 选择部署方式（CLI/GUI） → 复核部署预演 → 首次部署 → 验收与后续指导。首次初始化时 `aiwb` 技能尚未部署，不要等它自动触发。
2. AI 能探测的项（主机名、已安装工具、版本、入口存在性）自动填候选并注明依据；版本值按注册表直接读取，写入后再用 `detect` 复核。生成时替换模板中的 `REPLACE_ME`、删除示例项目行；项目父级、全局工作台、资料目录和工具启用取舍由用户确认。版本要求默认留空，不照抄其他机器。
3. 确认后创建 `machines/<主机名>.md`（不入库），运行 `settings show --json` 检查 `available`、`writable` 与 `issues`，再运行 `build`、`detect --json`。
4. 部署前先让用户选择 CLI 或 GUI，不默认直接走 CLI：CLI 由 AI 运行 `node src/cli/main.mjs deploy --dry-run`（也可用 `launchers\aiwb.cmd deploy --dry-run`），用户看过预演并明确确认后才执行 `deploy --apply`；GUI 由用户运行 `node src/cli/main.mjs gui --open`（或 `launchers\aiwb-gui.cmd`），在“部署”页选择目标、预演、核对后勾选确认并点“执行部署”，AI 不代替点击。随后运行 `status`、`doctor`，并用各工具新会话抽检入口加载，再按 `docs/onboarding.md` 给出维护、回滚、设置和项目挂载指导。CLI 与 GUI 都可直接用 Node 命令或对应启动器，按用户习惯选择。
5. 手工方式：复制 `machines/_template.md` 为 `machines/<主机名>.md`，至少填写“项目父级”和“全局工作台”，再按上面的校验与部署步骤执行。
6. 完整的开场讲解、待办清单、分组确认、失败处理和部署后指导见 `docs/onboarding.md`；`AGENTS.md` 只保留硬约束和阅读入口。

## 新增或修改规则

1. 新增规则运行 `content new-rule <slug> --title "标题"`：自动取下一个两位编号，并在 `00-index.md` 的阅读顺序和文件职责表登记。
2. 也可以手工新建 `content/rules/<编号>-<短横线名称>.md`，但要同时补 `00-index.md`，否则 `content lint` 会报错。
3. 修改规则只改 `content/rules/` 下的正文，不要改各 AI 工具目录中的入口副本。
4. 只有“每次都必须遵守”的条目才同步到 `content/templates/entry-essentials.md`；入口不放规则全文。
5. 运行 `content lint`，确认命名、编号、索引和路径合规。
6. 运行 `build`，检查 `dist/ENTRY.md` 的索引和最小铁律。
7. 运行 `deploy --dry-run`，确认将影响的工具和动作；有 `manual` 时先处理原因。
8. 运行 `deploy --apply`；写入前自动备份，失败会回滚当前文件并停止后续目标。
9. 部署完运行 `status` 与 `doctor`，再用各工具新会话抽检。

## 新增或修改技能

1. 新增运行 `content new-skill <name> --description "触发场景"`；名称只能用小写字母、数字和短横线。
2. 每个技能一个目录：`content/skills/<name>/SKILL.md`，可带 `scripts/`、`references/` 等资源。
3. `SKILL.md` 的 frontmatter 必须有 `name` 和 `description`，且 `name` 与目录名一致；`description` 写清什么时候使用。
4. 正文不要写本机盘符绝对路径；需要仓库位置时，引用全局入口中的“工作台索引”。
5. 运行 `content lint`；`build` 会自动扫描技能并生成入口技能索引，不需要手工登记。
6. `deploy --apply` 会把技能目录以 junction 接入各已安装工具的技能目录；目录不存在时创建，已接入时无变化。同名真实目录或指向别处的链接只报告冲突，不覆盖；先处理冲突再继续。
7. 内置技能 `aiwb` 不能删除，也不能取消 `builtin: true`；需要调整时修改文件，再重新 lint、build、deploy。

## 编辑现有内容

1. 列出可编辑项：`content list` 显示规则与技能的名称、标题、文件、索引和内置标记；`content read <rule|skill> <名称>` 读取正文与文件哈希。
2. 修改后用 `content save <rule|skill> <名称> --content-file <路径>` 预演：只按提交正文运行内容校验，不写文件。
3. 预演通过后，带 `--expected-hash <读取时的哈希>` 与 `--apply` 写入。服务端会复核文件未被其他程序改动，写后再次校验并重建 `dist/`；任一步失败恢复原文件与构建。
4. 只支持现有规则文件和技能的 `SKILL.md`；不支持删除、改名、迁移或编辑机器档案。内置技能不能去掉 `builtin: true`。
5. GUI 内容页提供同一流程：选择文件 → 编辑 → “校验并预演保存” → 勾选确认 → “保存内容”。保存成功后自动重建构建并刷新列表，无需再手工运行 `build`。

## 资料与脚本存放

1. 按 `content/rules/04-storage.md` 判断资料层级和是否入库。
2. 本仓库自身的维护、部署、校验、打包脚本放 `scripts/`，不部署；一次性脚本和产物放 `_tmp/`，不放仓库根目录。
3. 要部署到全局工作台的通用脚本放 `content/scripts/`，由 `deploy --apply` 或 `node scripts/install-global.mjs --apply` 安装为 `<全局工作台>/scripts/ai-workbench` junction；junction 实时链接仓库，不要在里面新建本机专用脚本。
4. 技能自带脚本放 `content/skills/<技能名>/scripts/`，随技能目录部署。
5. 全局工作台与项目 `local/`、`_tmp/` 不在仓库内；`_tmp/` 清理前确认，放入回收站。

## 修改机器路径或项目清单

1. 只改 `machines/<主机名>.md`；该文件含本机隐私信息，已被 gitignore，不要提交。
2. 重新 `build` 与 `deploy --dry-run`；改“全局工作台”后再运行 `deploy --apply` 重建目录与脚本 junction。
3. 如果项目清单新增了仓库，补全技术栈和构建/测试命令，避免写“待补”后忘记。

## 新增或修改工具入口

1. 改 `adapters/targets.json`：路径、格式、写入策略、启用状态、证据状态。
2. 只有出现该工具特有的读写行为时，才在 `src/core/targets/<tool>.mjs` 增加适配代码；通用逻辑不硬编码工具路径。
3. 更新 `adapters/README.md` 与 `docs/adapters.md`。
4. 先 `detect`，再 `deploy --dry-run`；写入能力和实测记录完成前，状态不要标成 `verified`。
5. 运行 `node --test --test-concurrency=1 "tests/**/*.test.mjs" "tests/*.test.mjs"` 和 `doctor --parity`。

## 冲突与漂移

- `manual`：入口文件不是 UTF-8、块标记损坏、块被手工修改、已有同名非工作台文件，或缺少状态记录且内容不一致。不要强行覆盖，先看 `deploy --dry-run` 的原因列。
- `drift`：入口块哈希与状态记录不一致。优先确认是谁改的；确认要覆盖后，用 `backup list` 找到部署前备份，`backup restore <工具 id> <时间戳>` 预演，确认后加 `--apply` 恢复，再重新部署。`deploy --apply` 不会直接覆盖手改块。
- `stale`：源内容已更新但入口还是旧版本。重新部署即可。
- `missing`：状态记录存在但入口文件不在；确认是否被工具升级或用户删除。
- `missing-split` / `drift-split`：记忆注入目标的拆分文件不存在或哈希与部署记录不一致。先确认是否手工移动或改写了拆分文件；恢复入口备份不会补回拆分文件，需要重新 `deploy --apply`。
- `unmanaged`：工具目录已有文件但没有工作台块；部署只会追加，不会改写原内容。
- 技能 junction 冲突：同名路径是真实目录（可能是用户自建技能）或链接指向别处。部署保持原样，先确认归属；不要手工删除或替换用户技能。

## 部署执行与回滚

1. 先 `deploy --dry-run`，重点看 `manual`、全局工作台冲突与技能 junction 冲突；全局工作台冲突时 `--apply` 整体不写，技能冲突只保留原样并跳过该项。
2. `deploy --apply` 会先校验全局工作台，再逐目标写入；每个入口写入前备份到 `state/backups/<工具>/<时间戳>/`，并写 `manifest.json`。
3. 写入使用临时文件加原子替换，写后校验文件字节与块哈希；校验失败立即恢复备份并停止后续目标，已成功的写入和状态记录保留。WorkBuddy 记忆注入先写拆分文件、再写入口，任一步失败同时回滚两边；入口保持原 BOM 与换行，拆分文件固定 UTF-8 无 BOM + LF。WorkBuddy 的入口按账号快照动态解析到 `user-<uid>-<企业或个人>/MEMORY.md`；预演会显示解析结果，快照缺失、非法或超过 30 天时解析回落到设备根 `MEMORY.md` 并提示原因，但工作台不会写入设备根，该目标按需人工阻止（配置根下已有账号目录视为疑似已登出，否则视为未检测到已登录账号），先启动 WorkBuddy 登录后再部署。
4. 入口写入完成后，按计划创建技能目录与 junction；同名路径是真实目录或指向别处时不覆盖，按输出清单人工处理。技能写入失败时命令返回非零，但已完成的入口写入保留。
5. 写入期间持有 `state/locks/deploy.lock`；异常退出留下的锁超过 30 分钟可按陈旧锁处理。确认没有部署进程时，也可手工删除该锁文件。
6. 全局工作台存在冲突、入口编码不可读、块被手改、同名非工作台文件时，不写入，按输出清单人工处理。
7. 需要回滚时用 `backup list [--tool <id>]` 找到备份时间戳；`backup restore <工具 id> <时间戳>` 默认预演，确认后加 `--apply`。恢复前会先把当前入口备份一份；入口在部署后被修改、缺少部署记录或版本核对未通过时阻止，确认覆盖才加 `--force`。
8. 恢复后若原入口没有工作台块，状态记录会被清除；若仍有块，则记为待更新，可再次 `deploy --apply` 回到当前版本。
9. WorkBuddy 切换账号或账号快照过期后，入口路径会随快照变化。先启动 WorkBuddy 刷新账号，再运行预演确认新路径；快照无效时部署被阻止（疑似已登出或未检测到登录），登录后即放行。旧版本留在设备根 `MEMORY.md` 的区块不会自动迁移，先运行 `uninstall --tool workbuddy` 清理旧区块，再部署到账号目录。

## 本地 GUI

1. 运行 `node src/cli/main.mjs gui --open` 打开页面；需要固定端口时加 `--port <端口>`，`--json` 只输出地址与端口。
2. 页面只监听 `127.0.0.1`，地址中的 `token` 不能去掉；换端口或重启后用新地址，旧地址失效。
3. 总览与体检只读；部署、卸载、内容保存、清理和恢复先预演，执行按钮要在页面勾选确认后才可用。备份页的“立即备份”会把当前存在的入口写入本地 `state/backups/`，不改工具目录。没有可执行内容时对应按钮保持禁用：设置页未修改、合并页未选目标、内容页未选择文件、备份列表为空时，预演、重置、保存与清理按钮不会响应点击；禁用按钮也不显示悬停高亮。失败、待处理与冲突项旁提供“定位”按钮：体检、部署预演/执行、合并阻止、设置问题、内容校验、历史漂移和诊断异常项会跳到对应页面，需要时自动预演并滚动高亮目标；入口路径或版本问题进入设置页对应字段，需人工合并的入口进入合并页，缺失或待更新项进入部署页。GUI 无法安全删除或打开外部路径，技能 junction 冲突、全局工作台冲突与卸载冲突项提供“复制路径”。GUI 不提供任意 shell，也不允许任意路径读写。
4. 部署页的“卸载预演”按上方目标工具选择范围；“全部”与 CLI 的全量卸载一致，会同时移除全局脚本 junction。存在手改块时，预演会显示 `--force` 选项，勾选后才允许移除。
5. 项目页只扫描机器档案“项目父级”下的 git 仓库和项目清单，不接受自定义根目录；点每行“操作”打开弹层，选择挂载方式后预演挂载或取消挂载，勾选确认后才执行。列表支持手动输入或下拉选择每页数量和分页，表格区域单独滚动。列标题与挂载方式选项的悬停说明写明入口被 git 跟踪时的处理：auto 阻止写入，append 写入并进入 git 变更，local 改写 AGENTS.local.md；弹层内随所选方式显示对应说明。GUI 只允许机器档案范围内的项目绝对路径。
6. 设置页加载当前设置，可改备份保留份数、GUI 端口、环境变量、工具覆盖、版本要求与自定义工具；内置工具和自定义工具都有“版本要求（可选）”输入，留空表示不核对，卡片底部显示当前检测版本与核对结果。页面加载后未修改时“预演修改”与“放弃修改”保持禁用，改动任一字段或卡片后才启用。“预演”显示逐项变更，勾选确认后才写回机器档案；“放弃修改”从机器档案重新加载，丢弃页面改动。页面只提交已知设置键，路径变量未定义、版本要求非法或值越界时预演会标出问题并拒绝写入。
7. 设置页顶部“添加自定义工具”按钮打开弹层，填写 id、显示名称、配置目录、入口、写入方式、格式、技能目录、frontmatter、版本要求与启用状态后点“加入列表”，会成为未保存卡片；已有工具可继续编辑或标记删除。标记删除后卡片刻线并禁用输入，可点“撤销删除”恢复。新增和修改都要经“预演修改”并确认写入；保存成功后会刷新部署与合并的目标下拉。
8. 内容页左侧列出规则与技能，选择后加载正文；未选择文件时编辑框、“放弃修改”和“校验并预演保存”禁用。修改后显示“未保存”，点“校验并预演保存”只预演、不写文件；通过后勾选确认才能“保存内容”，保存成功会重建构建并刷新列表。继续编辑或离开页面会清空预演结果与确认状态；“放弃修改”从已加载内容恢复。新建规则/技能弹层先预演文件名、模板和索引登记，勾选确认后创建并重建构建，随后自动打开新文件。
9. 历史页并行读取 `log` 与 `status`：上方显示日志目录、文件数、条数与最近部署时间，下面分操作记录、部署与项目记录、待处理漂移三块；可切换每页 20/50/100/200 条。历史页只读，不提供写入、删除或清理日志的按钮；日志损坏行会单独列出，不影响其余记录阅读。
10. 诊断页读取 `status`、`log` 与 `doctor`，先展示构建哈希、部署状态、入口哈希、路径和日志概况；刷新只读，“生成诊断包”默认禁用，勾选确认后生成 `state/diagnostics/` 下的目录与 zip，并在页面列出包内文件、大小和打包问题。服务端只接受 `zip: true`，拒绝 `apply`/`dryRun`。
11. GUI 的 `build` 只允许 `--check`；CLI 的 `aiwb gui` 在启动前会自动重建过期或缺失的构建产物，构建失败时保留错误并继续启动 GUI。写入构建产物、编辑任意文件或删除内容仍回到 CLI/文件系统。内容接口只接受现有规则与技能的 `SKILL.md`，拒绝 `contentFile`，保存必须带读取时的哈希。历史接口只接受 `limit`，拒绝 `apply`/`dryRun`。诊断接口只写 `state/diagnostics/`，不读取任意路径。
12. 服务空闲 30 分钟自动退出；也可以回到启动它的终端按 `Ctrl+C`。关闭后重新启动会产生新 token。
13. 备份页在没有备份时显示空态，“清理旧备份”同时保持禁用；“立即备份”随时可生成新备份；“清理旧备份”在有备份时先显示将删除项与保留份数，勾选确认后才删除；恢复前会再备份当前入口，规则与 `backup restore` 相同。

## 操作历史

- `log [--limit <n>] [--json]` 读取 `state/logs/deploy-YYYYMM.jsonl`，默认最近 50 条，上限 1000 条；`--json` 返回操作记录、部署记录、项目记录与损坏行信息。
- 记录字段：时间、动作、来源（`cli` 或 `gui`）、工具、目标、结果、备份路径与受限明细。日志只写白名单字段，`content`、`text`、`body`、`token`、`secret` 等键会被丢弃，明细字符串有长度上限；不保存文件正文或令牌。
- 会记录的动作：部署、卸载、合并、备份创建/清理/恢复、项目挂载/取消挂载、内容保存/新建、本机设置写入。预演、无变化以及被阻止但未写入的动作不记录。
- 日志只追加、按月分文件，不随仓库迁移，也不会被 `git` 提交。追加失败只在结果中返回错误，不影响已经完成的写入；排查磁盘或权限问题后，下次操作会继续追加。
- 日志不提供自动清理；需要归档时先复制 `state/logs/` 下的目标月份文件，再按本机留存策略处理。日志缺失或被手工改写不会改变部署状态，状态以 `state/deploy-state.json` 为准。
- GUI 历史页走同一读取接口，只读；条数切换只影响显示，不会修改日志。

## 诊断包

- `diagnose` 生成诊断目录到 `state/diagnostics/diagnose-<时间>/`，包含 `README.md`、`summary.json`、`status.json`、`doctor.json`、`log.json` 与 `paths.json`；加 `--zip` 另生成同名 zip，条目以诊断目录名开头。目录或 zip 重名时追加序号，不覆盖旧包。
- 包内记录构建与入口哈希、部署与项目记录、体检结果、最近 1000 条操作日志、工具/技能/全局工作台/项目路径及存在状态。`status`、`doctor`、`log` 或部署记录某一段读取失败时，错误写入该段与 `issues`，其余文件照常生成；目录或 zip 写入失败才整体报错。
- 不读取机器档案正文、环境变量值、规则/技能/入口正文或访问令牌；但包含主机名、本机绝对路径、哈希和日志元数据。发给他人前打开 `README.md` 复核，不要直接公开。
- `diagnose` 只写本机 `state/diagnostics/`，不改部署状态、备份或外部工具目录，也不写操作日志。GUI 诊断页走同一核心：刷新只读，勾选确认后生成 zip。

## 主动备份

- `backup create [--tool <id>]` 读取当前已存在的入口文件，写入 `state/backups/<工具>/<时间戳>/`，manifest 动作记为 `manual`。记忆注入目标同时备份入口与拆分文件，拆分文件动作记为 `manual-split`。
- 入口不存在时记为“无入口”，不生成空备份。
- 不改动工具目录，也不更新部署状态；生成的备份可直接用 `backup restore` 恢复。拆分文件备份不能单独恢复入口，恢复入口请选入口备份。
- GUI 备份页的“立即备份”调用同一逻辑，备份范围为全部已存在的入口。

## 清理旧备份

- `backup prune [--tool <id>] [--keep <n>]` 按工具保留最近 N 份备份，超出的旧备份列为“将删除”；默认只预演，加 `--apply` 才删除。
- N 优先取 `--keep`，其次取机器档案 frontmatter 的 `backupRetention`，都没有时为 10。
- 每工具最近一份始终保留；无效清单和未注册工具目录只报告，不删除。
- GUI 备份页的“清理旧备份”走同一逻辑，预演后需要在页面勾选确认才能执行。

## 卸载工作台

- `uninstall [--tool <id>]` 默认只预演，`--apply` 才写入；不带 `--tool` 时处理全部注册工具。
- 入口处理：有工作台块时移除块并保留块外内容；入口是工作台创建且部署后未改动的文件时删除整个文件。WorkBuddy 记忆注入只移除带标记区块，并删除本工作台生成且未改动的拆分文件。每次改动前都把当前入口备份为 `uninstall-safety`。
- 技能 junction：只移除指向本仓库 `content/skills/<name>` 的链接；同名真实目录和指向别处的链接保持原样。内置技能 `aiwb` 的链接可移除，但技能正文不删除。
- 全量卸载会移除 `<全局工作台>/scripts/ai-workbench` 脚本 junction（仅当它指向本仓库），保留全局工作台目录、`todo/`、`notes/`、`_tmp/` 和其他脚本。
- 状态清理：成功卸载的入口会从 `state/deploy-state.json` 删除记录；备份保留，可用 `backup list` 查看。
- 阻止条件：块标记损坏、入口不是可写文本、块哈希与部署记录不一致或缺少部署记录。确认内容后可加 `--force`；它只移除块并保留文件，不会删除改动过的文件。
- 写入期间持有部署锁；入口在预演后被改动时拒绝执行，需要重新预演。GUI 部署页提供同一流程，执行前需勾选确认。

## 项目挂载

- `scan [--root <项目父级>]` 列出机器档案“项目父级”下的 git 仓库和“项目清单”中的项目，报告挂载状态；只读，不写项目或状态文件。
- 扫描列表的“Git 仓库”表示项目自身是否为 git 工作区，“入口跟踪”表示入口文件是否在 git 索引中，“本地忽略”表示 `.git/info/exclude` 是否含入口行；非 git 项目不做入口跟踪判断。该忽略只在本机生效，不会提交，也不改 `.gitignore`。
- `attach <项目路径> [--mode auto|local|append]` 默认只预演，`--apply` 才写入；不带 `--mode` 时按 `auto`。
- 三种方式：`auto` 写 `AGENTS.md`，`local` 写 `AGENTS.local.md`，`append` 也写 `AGENTS.md` 但允许已跟踪文件。`auto` 与 `local` 遇到已跟踪入口会阻止，避免改动版本库内容；`local` 只有明确读取 `AGENTS.local.md` 的工具会生效，`append` 的改动会进入 git 变更，由用户决定是否提交。
- 已挂载项目改用写另一个文件的模式时，先 `detach` 再 `attach`；`attach` 不会自动迁移或清理旧入口。`auto` 与 `append` 都写 `AGENTS.md`，可直接切换。
- 入口写入带标记的工作台块，块内指向当前 `dist/ENTRY.md`；文件不存在时新建，已有工作台块时替换，块标记异常时只报告。
- 未跟踪入口且项目是 git 仓库时，把入口相对路径加入 `.git/info/exclude`；`.git` 为文件（工作树或子模块）时需人工处理，不自动改 exclude。
- 写入前备份到 `state/project-backups/project-<哈希>/<时间戳>/`，与工具入口备份分开；写入使用部署锁并做写后校验，失败回滚。
- `detach <项目路径>` 默认只预演，`--apply` 才移除工作台块；工作台创建且块外无内容时删除整个文件。缺记录或块哈希不一致时阻止，确认后加 `--force`；`--force` 只移除块，不删除文件。
- 状态记录在 `state/deploy-state.json` 的 `projects` 下，含方式、文件、动作、块哈希与 exclude 标记；`doctor` 检查缺失、漂移、块异常和 exclude 缺失。
- GUI 项目页只扫描机器档案范围内的候选，点每行“操作”打开弹层，选择方式、预演并勾选确认后才能挂载或取消挂载；不接受自定义扫描根目录。

## 冲突合并

- 适用场景：部署提示工作台块被手改、需要保留块内人工调整，或入口里还没有工作台块但想先看清将要写入的内容。
- `merge <工具 id>` 默认只预演，输出完整建议结果 `suggested`、块状态、当前块哈希、部署记录块哈希、工作台内容哈希和冲突原因；`--json` 中的 `suggested` 就是可编辑的合并结果。
- 写入：把完整的合并结果保存为文件，运行 `merge <工具 id> --apply --content-file <路径>`，确认预演后执行。GUI 合并页展示现有入口、工作台内容与可编辑结果；未选择目标工具时“加载预演”保持禁用，编辑后先“校验结果”，通过后勾选确认再写入；结果与建议一致时“按建议重置结果”保持禁用。
- 只能改工作台块内的正文。块已存在时，块前原文必须逐字一致，块后只允许保留原后缀或增加一个分隔换行；块标记损坏、块内为空、编码不可读或块外被改动都会阻止写入。
- 写入前重新构建并校验；通过后备份当前入口、原子写入、校验写后字节与块哈希，失败用备份回滚。状态记录为 `manual-merge`，后续内容未变时重复部署不会覆盖手工结果。
- 想撤销合并结果：用 `backup list` 找到写前的 `manual-merge` 备份，再用 `backup restore <工具 id> <时间戳>` 预演并恢复。
- 记忆注入目标（WorkBuddy）不支持 `merge`：它没有独立的工作台块可编辑，正文可能被注入额度截断。需要调整时改 `content/rules/`，重新 `build` 与 `deploy`。入口是账号目录还是设备根以部署预演解析结果为准，不要手工改写账号快照。

## 本机设置

- `settings show` 读取 `machines/<主机名>.md`：frontmatter 的 `backupRetention`（默认 10）和 `guiPort`（默认 0，随机端口），`## 设置` JSON 块中的 `env` 与 `tools`，以及各工具解析后的实际路径。
- `settings set backupRetention=10 guiPort=5088 env.<变量名>=<值> tools.<工具 id>.entryPath=<路径> tools.<工具 id>.version=<版本表达式>` 修改设置；`settings unset env.<变量名>`、`settings unset tools.<工具 id>.entryPath` 或 `settings unset tools.<工具 id>.version` 删除覆盖。默认只预演，确认后加 `--apply`。
- 路径值支持 `${NAME}` 和 `%NAME%`，设置里的 `env` 优先于进程环境变量；引用未定义变量、未知工具 id、未知字段或非法值会列入 `issues` 并阻止写入，确认无误时才加 `--force`。
- 版本要求可选，留空表示不核对；无运算符为精确匹配（忽略大小写与 `v` 前缀），比较条件支持 `<`、`>`、`<=`、`>=`、`<>`。逗号表示同时满足且优先级高于 `||`，`||` 表示任一满足，英文括号可改变优先级并支持嵌套；单次最多 20 个条件、括号最多 20 层。比较条件按数字分段比较，缺段补 0，可带 `-预发布` 与 `+构建信息`；检测值无法按数字解析时按无法核对处理。
- 填好版本要求后，部署预演与执行、合并、备份恢复和技能 junction 会先核对实际版本；不符或无法检测时部署跳过该目标并继续其他目标（CLI 退出码 2），合并与恢复阻止，恢复可加 `--force`，卸载不受影响。
- 写入前校验预演哈希，备份到 `state/settings-backups/<时间戳>/`，原子写入并做写后校验，失败回滚；只改目标设置键和 `## 设置` 节，保留其余正文、未知 JSON 字段、BOM 与 CRLF。
- 设置影响：`backup prune` 未指定 `--keep` 时取 `backupRetention`；`gui` 未指定 `--port` 时取 `guiPort`；`detect`、`deploy`、`merge`、`backup restore`、`doctor` 读取同一份设置。工具 `enabled: false` 会跳过该目标，路径覆盖直接作用于目标注册表，版本要求用于写入前的版本核对。
- GUI 设置页走同一流程：修改后先预演，确认后写回；页面只提交已知设置键，不读取任意文件。

### 自定义工具

- 适用场景：工具尚未纳入 `adapters/targets.json`，或只在本机临时接入，不想改动仓库级支持矩阵。定义只写本机机器档案，不入库。
- 字段：`name`、`configRoot`、`entryPath` 必填；`strategy` 取 `block-append`（默认）或 `separate-file`，`format` 取 `markdown`（默认）或 `mdc`，`skillsDir`、`frontmatter`、`version`、`enabled`（默认 true）可选。id 只能用小写字母、数字和短横线，不能与内置目标重复。
- 注册示例：`settings set customTools.<工具 id>.name=<显示名称> customTools.<工具 id>.configRoot=<配置目录> customTools.<工具 id>.entryPath=<入口文件>`，默认只预演，确认后加 `--apply`。之后 `settings set customTools.<工具 id>.skillsDir=<技能目录>` 可补技能 junction，`customTools.<工具 id>.version=<版本>` 可加版本要求。
- 版本要求语法同内置工具，留空表示不核对；自定义工具会在配置目录内探测 `.status.json`、`.app-status.json`、`product.json`、`resources/...` 等文件。填写后若探测不到版本或版本不符，部署会跳过该工具、合并与恢复会阻止。
- 删除：`settings unset customTools.<工具 id>` 预演并确认；若该工具仍有部署记录，预演会阻止并提示先 `uninstall --tool <工具 id>`。内置 id 冲突的错误定义仍可删除以修复档案。
- 部署：`deploy --tool <工具 id>` 可单独预演和执行。配置目录、入口父目录或技能目录不存在时会按填写路径创建；入口格式、frontmatter 与内置工具走同一套校验和备份链路。
- 检查：`settings show --json` 查看归一化后的定义，`detect` 与 `status` 会列出自定义工具，`doctor` 的本机设置检查会在定义非法时失败。
- 常见问题：路径必须是绝对路径或以 `~` 开头；引用未定义环境变量会阻止写入；删除工具后部署页仍显示旧选项时，重新进入部署页或刷新设置。

## 当前未实现的能力

- Git 私库与自动提交（本工具不会自动提交）。

`deploy --dry-run` 只检查动作清单，不产生外部写入；`deploy --apply` 才写入。`scripts/install-global.mjs` 保留为只安装全局工作台的独立入口。

## 工具升级后

1. 运行 `detect`，确认配置根、入口路径、技能目录与检测到的版本。
2. 运行 `status` 与 `doctor`，检查入口是否失效、漂移或版本阻止。
3. 新开一个会话抽检入口是否被加载；未加载时先查工具设置和路径，不要直接假定规则生效。WorkBuddy 问“当前生效的自定义指令有哪些”，能复述才算注入成功。
4. 版本升级后更新机器档案中的版本要求；探测不到新版本时先确认安装根目录，必要时在 `## 设置` 的 `env` 中定义对应的 `AIWB_*_HOME`，再调整或清空版本要求。
5. 工具升级若改变记忆注入上限，重新运行 `deploy --dry-run` 核对模式（内联/钩子）与字符数；上限调整后可在 `adapters/targets.json` 的 `entry.budget` 修改并从仓库重新构建。`doctor` 的“记忆注入”检查会报告入口文件超过 `injectLimit` 的目标，只提示不阻止部署；按提示精简区块外旧记忆即可。部署预演与体检会同时列出不含空白字符、文件字节与估算字数，供和编辑器或工具的字数/字符数显示对照，预算判断仍按含空白字符。

## 发布与备份

- 版本号写 `VERSION` 与 `package.json`，变更写 `CHANGELOG.md`。
- `dist/`、`state/`、备份和日志不入库。
- 不把本机绝对路径、密钥、令牌写进 `content/`。
- 备份与回滚：`deploy --apply` 自动写前备份，`backup create` 可主动生成快照，`backup prune` 可按机器档案份数清理旧备份；清理前先确认最近一份和可能需要恢复的备份仍在。
