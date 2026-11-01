---
name: aiwb
description: 维护和使用本机 AI 工作台时使用；包括新增或修改通用规则、机器档案、技能，构建与部署各工具入口，检查部署状态和漂移。
builtin: true
---

# AI 工作台维护

本技能属于工作台自身，内置且受保护：不要删除目录，也不要把 `builtin` 改成 `false`。需要调整时通过仓库修改，并重新执行 `content lint`、`build` 和 `deploy --apply`。

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
- 部署执行：`aiwb deploy --apply`；先看预演，确认后再写。入口写入后会创建或复用各工具的技能 junction。
- 卸载入口：`aiwb uninstall [--tool <id>]` 先预演，确认后加 `--apply`；不带 `--tool` 会处理全部工具并移除全局脚本 junction。
- 全局工作台与技能：`aiwb deploy --apply` 会一并安装全局工作台目录、脚本 junction 与技能 junction；也可单独运行 `node scripts/install-global.mjs --apply` 安装全局工作台。
- 主动备份：`aiwb backup create [--tool <id>]`；只读取现有入口并写本地 `state/backups/`，不改工具目录或部署状态。
- 查看备份：`aiwb backup list [--tool <id>]`。
- 清理旧备份：`aiwb backup prune [--tool <id>] [--keep <n>]` 先预演，确认后加 `--apply`；份数取 `--keep` 或机器档案 `backupRetention`，每工具最近一份始终保留。
- 恢复入口：`aiwb backup restore <工具 id> <时间戳>` 先预演，确认后加 `--apply`；恢复前会再备份当前入口。
- 本地界面：`aiwb gui [--open]`；总览和体检只读，备份页可“立即备份”和“清理旧备份”，部署、卸载、清理与恢复需在页面勾选确认。
- 状态与诊断：`aiwb status`、`aiwb doctor`。

## 约束

- 不手改 `dist/` 和各工具目录中的入口副本。
- 不删除或改写各工具自带的规则、技能、插件、人设和记忆。
- 不自动执行 `git commit` / `git push`；提交说明使用中文。
- 不把本机盘符绝对路径写进 `content/`。
- 真实工具目录写入前必须先预演并得到用户确认；不要手工复制入口文件。
- 部署会写前备份、失败回滚；块被手改或已有非工作台文件时只报告，不覆盖。
- 卸载默认只预演；只移除带标记的工作台块、工作台创建且未改动的入口文件，以及指向本仓库的 junction。块被手改或缺部署记录时需用户确认后才加 `--force`，且不会删除文件。
- 卸载不删除全局工作台目录、用户数据、备份或用户自建的技能；项目挂载暂不支持。
- 技能 junction 由部署管理；同名真实目录或指向别处的链接只报告冲突，不手工删除或替换用户技能。
- 恢复入口默认只预演；入口在部署后被修改或缺少部署记录时不会恢复，需用户确认后才加 `--force`。
- 清理旧备份默认只预演；未确认时不要加 `--apply`，不要清理未注册工具目录或清单不可用的备份。
- GUI 只监听 `127.0.0.1`，不要修改成对外监听；不要绕过页面确认或直接调用 `/api/run` 执行写入。
- GUI 的 `build` 只允许 `--check`、`content` 只允许 `lint`；写构建产物或新建内容回到 CLI。
