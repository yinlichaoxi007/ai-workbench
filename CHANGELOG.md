# 变更记录

## 未发布

- 新增 `backup create [--tool <id>]`：主动备份当前存在的入口文件到 `state/backups/`，只读取入口，不改工具目录或部署状态；manifest 动作记为 `manual`。
- GUI 备份页新增“立即备份”，展示已创建、无入口与失败项；服务端将 `backup create` 纳入写入确认。
- 补备份创建集成测试，覆盖无入口、按工具备份、重复备份、恢复预演、部署锁与 GUI 未确认拒绝。
- `deploy` 新增技能 junction：按 `content/skills/<name>` 在各已安装工具的技能目录创建 junction；目录缺失时按计划创建，已指向本仓库时无变化，真实目录或指向别处的链接只报告冲突并保留原样。
- CLI 与 GUI 的部署预演和执行结果展示技能 junction 明细；`doctor` 增加技能 junction 检查，冲突计为失败，待创建计为待处理。
- 新增技能 junction 单元测试与沙箱集成测试，覆盖目录创建、重复执行幂等、用户同名目录、异向链接与无技能场景。
- 新增 `gui` 命令与本地页面：总览、体检、部署预演/执行、备份列表/恢复；只监听 `127.0.0.1`，带启动令牌，空闲 30 分钟退出。
- GUI 服务端限制动作与参数：`build` 仅 `--check`、`content` 仅 `lint`、`backup` 仅 `list/restore`，写入必须由页面确认；页面不加载外部资源。
- 新增 GUI 集成测试，覆盖令牌校验、动作白名单、只读限制与写入确认；并用真实浏览器核对总览、部署预演和备份空态，未写真实工具目录。
- 新增 `backup list [--tool <id>]` 与 `backup restore <工具 id> <时间戳>`：默认预演，`--apply` 才恢复；恢复前再备份当前入口，手改或缺部署记录时阻止，`--force` 才覆盖。
- 新增备份恢复沙箱集成测试；测试总数 75 项。
- 实现 `deploy --apply` 安全写入：并发锁、写前备份、临时文件加原子替换、写后字节与块哈希校验、失败恢复备份、写入状态记录。
- `deploy` 预演与执行统一纳入全局工作台计划；全局冲突时整体不写；`--tool` 可只处理单个工具入口。
- 修正块哈希口径：`build`、状态记录和 `findBlock` 统一按块内正文计算，避免部署后误报漂移。
- `status` 与 `doctor` 增加全局工作台目录、脚本 junction 和冲突检查。
- 新增 `deploy-writer` 与锁的单元测试，扩充沙箱内的 apply 集成测试；测试总数 71 项。尚未对真实 AI 工具目录执行 apply。
- 新增 `content/rules/04-storage.md`：资料、脚本、待办与临时目录的分层存放规则。
- 维护脚本目录由 `dev/` 调整为 `scripts/`；一次性产物统一放 `_tmp/`。
- 机器档案新增“全局工作台”路径，入口同步输出。
- 新增 `content/scripts/` 作为可部署脚本源；新增 `scripts/install-global.mjs`，按机器档案创建全局工作台目录，并把脚本源安装为 `scripts/ai-workbench` junction。
- 明确 `scripts/` 只放本仓库自身维护脚本，不部署；AI 工具根只收入口和技能 junction，不放脚本。

## 0.1.0 - 2026-10-26

- 建立真源仓库骨架：`content/`、`machines/`、`adapters/`、`src/`、`launchers/`、`scripts/`、`tests/`、`docs/`。
- 写入通用规则：沟通偏好、工作流程、编码注释规范。
- 写入机器档案模板 `machines/_template.md`；本机档案不入库。
- 写入 7 个工具的入口注册表与支持状态。
- 实现 `build`、`detect`、`deploy --dry-run`、`status`、`doctor`。
- 尚未向任何 AI 工具目录写入文件。
