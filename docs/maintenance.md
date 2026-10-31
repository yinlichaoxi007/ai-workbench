# 日常维护

## 常用命令

```powershell
node src/cli/main.mjs build
node src/cli/main.mjs build --check
node src/cli/main.mjs detect
node src/cli/main.mjs deploy --dry-run
node src/cli/main.mjs deploy --apply
node src/cli/main.mjs backup list
node src/cli/main.mjs backup restore <工具 id> <时间戳>
node src/cli/main.mjs status
node src/cli/main.mjs doctor
node src/cli/main.mjs doctor --parity
node src/cli/main.mjs content lint
node src/cli/main.mjs content new-rule <slug> --title "标题"
node src/cli/main.mjs content new-skill <name> --description "触发场景"
node src/cli/main.mjs gui --open
node src/cli/main.mjs gui --port 4599 --json
node scripts/install-global.mjs
node scripts/install-global.mjs --apply
```

也可以使用 `launchers\aiwb.cmd <命令>`。

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
- `unmanaged`：工具目录已有文件但没有工作台块；部署只会追加，不会改写原内容。
- 技能 junction 冲突：同名路径是真实目录（可能是用户自建技能）或链接指向别处。部署保持原样，先确认归属；不要手工删除或替换用户技能。

## 部署执行与回滚

1. 先 `deploy --dry-run`，重点看 `manual`、全局工作台冲突与技能 junction 冲突；全局工作台冲突时 `--apply` 整体不写，技能冲突只保留原样并跳过该项。
2. `deploy --apply` 会先校验全局工作台，再逐目标写入；每个入口写入前备份到 `state/backups/<工具>/<时间戳>/`，并写 `manifest.json`。
3. 写入使用临时文件加原子替换，写后校验文件字节与块哈希；校验失败立即恢复备份并停止后续目标，已成功的写入和状态记录保留。
4. 入口写入完成后，按计划创建技能目录与 junction；同名路径是真实目录或指向别处时不覆盖，按输出清单人工处理。技能写入失败时命令返回非零，但已完成的入口写入保留。
5. 写入期间持有 `state/locks/deploy.lock`；异常退出留下的锁超过 30 分钟可按陈旧锁处理。确认没有部署进程时，也可手工删除该锁文件。
6. 全局工作台存在冲突、入口编码不可读、块被手改、同名非工作台文件时，不写入，按输出清单人工处理。
7. 需要回滚时用 `backup list [--tool <id>]` 找到备份时间戳；`backup restore <工具 id> <时间戳>` 默认预演，确认后加 `--apply`。恢复前会先把当前入口备份一份；入口在部署后被修改或缺少部署记录时阻止，确认覆盖才加 `--force`。
8. 恢复后若原入口没有工作台块，状态记录会被清除；若仍有块，则记为待更新，可再次 `deploy --apply` 回到当前版本。

## 本地 GUI

1. 运行 `node src/cli/main.mjs gui --open` 打开页面；需要固定端口时加 `--port <端口>`，`--json` 只输出地址与端口。
2. 页面只监听 `127.0.0.1`，地址中的 `token` 不能去掉；换端口或重启后用新地址，旧地址失效。
3. 总览与体检只读；部署和恢复先预演，执行按钮要在页面勾选确认后才可用。GUI 不提供任意 shell，也不允许任意路径读写。
4. GUI 的 `build` 只允许 `--check`，`content` 只允许 `lint`；需要写入构建产物或新建规则/技能时回到 CLI。
5. 服务空闲 30 分钟自动退出；也可以回到启动它的终端按 `Ctrl+C`。关闭后重新启动会产生新 token。
6. 备份页在没有备份时显示空态；恢复前会再备份当前入口，规则与 `backup restore` 相同。

## 当前未实现的能力

- `uninstall`，以及备份保留份数清理（当前只增不删）。
- 项目挂载 `attach` / `detach`。
- GUI 的冲突合并页、内容编辑页、项目页、历史、设置与诊断包；诊断包本身也尚未实现。
- Git 私库与自动提交（本工具不会自动提交）。

`deploy --dry-run` 只检查动作清单，不产生外部写入；`deploy --apply` 才写入。`scripts/install-global.mjs` 保留为只安装全局工作台的独立入口。

## 工具升级后

1. 运行 `detect`，确认配置根、入口路径和技能目录是否仍存在。
2. 运行 `status` 与 `doctor`，检查入口是否失效或漂移。
3. 新开一个会话抽检入口是否被加载；未加载时先查工具设置和路径，不要直接假定规则生效。

## 发布与备份

- 版本号写 `VERSION` 与 `package.json`，变更写 `CHANGELOG.md`。
- `dist/`、`state/`、备份和日志不入库。
- 不把本机绝对路径、密钥、令牌写进 `content/`。
- 备份与回滚：`deploy --apply` 自动写前备份；保留策略尚未实现，清理前先确认没有需要恢复的入口。
