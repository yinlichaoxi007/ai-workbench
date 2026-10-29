---
name: aiwb
description: 维护和使用本机 AI 工作台时使用；包括新增或修改通用规则、机器档案、技能，构建与部署各工具入口，检查部署状态和漂移。
builtin: true
---

# AI 工作台维护

本技能属于工作台自身，内置且受保护：不要删除目录，也不要把 `builtin` 改成 `false`。需要调整时通过仓库修改，并重新执行 `content lint`、`build` 和 `deploy`。

## 何时使用

- 用户要求修改跨工具通用规则、注释规范、提交规则或资料目录约定。
- 用户要求新增、修改技能，或把技能接入某个 AI 工具。
- 用户要求构建、部署、检查各工具入口是否生效或漂移。

## 先读

1. 工作台仓库根目录的 `AGENTS.md`：维护边界与验证要求。
2. `docs/maintenance.md`：日常操作和当前未实现能力。
3. `content/rules/00-index.md`：规则索引和生效顺序。

仓库位置见当前全局入口的“工作台索引”；不要凭记忆猜路径。

## 常用操作

- 校验内容：`aiwb content lint`。
- 新增规则：`aiwb content new-rule <slug> --title "标题"`，再补正文。
- 新增技能：`aiwb content new-skill <name> --description "触发场景"`，再补正文。
- 构建：`aiwb build`；只检查：`aiwb build --check`。
- 部署预演：`aiwb deploy --dry-run`。
- 状态与诊断：`aiwb status`、`aiwb doctor`。

## 约束

- 不手改 `dist/` 和各工具目录中的入口副本。
- 不删除或改写各工具自带的规则、技能、插件、人设和记忆。
- 不自动执行 `git commit` / `git push`；提交说明使用中文。
- 不把本机盘符绝对路径写进 `content/`。
- `deploy --apply` 实现前，不要手工复制入口文件到工具目录。
