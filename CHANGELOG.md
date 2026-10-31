# 变更记录

## 未发布

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
