# 变更记录

## 未发布

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
