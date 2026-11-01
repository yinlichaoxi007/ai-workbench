# 新机器迁移

## 前置条件

- Git。
- Node.js 20 或更新版本（CLI 与 GUI 共用）。
- 目标机器上已安装要接入的 AI 工具。
- Git 私库地址：待填写。填入后更新本节和 `README.md`。

## 迁移步骤

1. 克隆仓库到项目父级目录：

   ```powershell
   git clone <私库地址> <仓库路径>
   ```

   如果目标机器的项目父级不是 `<项目父级>`，先确认实际路径，再决定是否使用其他位置。

2. 复制机器档案模板，文件名使用 `os.hostname()` 的结果：

   ```powershell
   Copy-Item machines\_template.md machines\<新主机名>.md
   ```

3. 填写机器档案：
   - 系统、Shell、Node、Git 等运行时。
   - 项目父级、参考资料目录、桌面交付路径。
   - 全局工作台路径。
   - 项目清单和构建/测试命令。
   - 本机特有注意事项。

4. 首次部署。先预演，再写入：

   ```powershell
   node src/cli/main.mjs build
   node src/cli/main.mjs detect
   node src/cli/main.mjs deploy --dry-run
   node src/cli/main.mjs deploy --apply
   ```

   `deploy --apply` 会按机器档案创建全局工作台的 `todo/`、`scripts/`、`notes/`、`_tmp/`，把 `content/scripts/` 安装为 `<全局工作台>/scripts/ai-workbench` junction，并写入各已安装工具的入口。只想安装全局工作台时，单独运行 `node scripts/install-global.mjs --apply`。

5. 检查部署结果：

   ```powershell
   node src/cli/main.mjs status
   node src/cli/main.mjs doctor
   ```

6. 部署后在每个工具中新开会话抽检：
   - 资料目录、项目父级和全局工作台路径是否正确。
   - 注释规范、删除规则、能否自动提交是否答对。
   - 技能索引是否与 `content/skills/` 一致。

## 不随仓库迁移的内容

- `machines/<主机名>.md`：机器档案只在本机保存，已 gitignore；新机器按模板重新填写。
- 全局工作台及其 `todo/`、`scripts/`、`notes/`、`_tmp/`：机器本地目录，不在仓库内；新机器填写机器档案后，由 `deploy --apply` 或 `scripts/install-global.mjs --apply` 重建目录和 `<全局工作台>/scripts/ai-workbench` junction。
- 各代码项目中的 `local/` 与 `_tmp/`：当事人资料和临时内容，不随仓库迁移。
- `dist/`：新机器重新 `build`。
- `state/`：部署状态、备份、锁；每台机器独立生成，备份不随仓库迁移。
- 各工具目录中的入口副本：新机器重新部署。
- 项目挂载块：新机器 `scan` 后逐个 `attach` 重新生成；旧机器的挂载记录与 `state/project-backups/` 不迁移。
- 密钥、令牌、账号凭据：不入库，单独配置。

## 从旧机器带过来的注意事项

- 不要把旧机器的 `state/deploy-state.json` 直接复制到新机器；入口路径和文件哈希不同，会造成误判。
- 机器档案按主机名区分；同一台机器重装系统后，如果主机名不变，可以复用并更新档案。
- 如果新机器是 Windows 且用户目录使用链接/junction，不要把链接布局写进 `content/`，只写在机器档案里。
- 中文路径需要正确加引号；仓库自身建议放在 ASCII 路径下。

## 离线迁移

离线打包脚本尚未实现。当前可用 Git 私库或手工打包，但不要包含 `dist/`、`state/`、备份和日志。
