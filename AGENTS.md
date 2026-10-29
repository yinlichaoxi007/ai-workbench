# AI 工作台仓库维护规则

本文件只在本仓库内工作或维护本工作台时生效。各 AI 工具的运行入口由 `content/` 和 `machines/` 构建生成。

## 修改边界

- 通用规则只改 `content/rules/`；机器差异只改 `machines/<主机名>.md`；工具入口配置只改 `adapters/targets.json`。
- 不在 `content/` 写本机绝对路径、密钥、令牌或账号凭据。
- 不修改各 AI 工具目录中的现有规则、技能、插件、人设和记忆；外部写入只能通过部署命令完成。
- 本仓库只存跨工具公共内容；工具专属规则和技能不进入本仓库。
- 内置技能 `content/skills/aiwb/` 受 `content lint` 保护；不得删除或取消 `builtin: true`，调整必须走仓库。
- `local/` 只放本地开发维护产生的文档与脚本，整体被 gitignore；要长期保留的内容放 `docs/` 或 `dev/`。
- 不自动执行 `git commit` / `git push`；需要提交时先说明范围，提交说明使用中文。

## 代码约束

- 运行时零 npm 依赖，只使用 Node 内置模块；Node 版本要求见 `package.json`。
- CLI 与 GUI 共用 `src/core/`；新增能力必须同时登记 CLI 与 GUI 元数据，保证功能对等。
- 入口内容由 `build` 生成；不手改 `dist/`。
- 写外部文件必须做到：先备份、只追加带标记的块、临时文件加原子替换、写后校验、失败可回滚。
- 不删除用户原有内容；合并失败只报告，不半写。

## 验证要求

- 改代码后运行 `npm test`（内部为 `node --test "tests/**/*.test.mjs" "tests/*.test.mjs"`）。
- 改规则或技能后运行 `node src/cli/main.mjs content lint`；`doctor` 也会执行同一套校验。
- 改入口内容后运行 `node src/cli/main.mjs build` 和 `node src/cli/main.mjs deploy --dry-run`，核对动作清单。
- 改工具适配后至少跑一次 `node src/cli/main.mjs doctor --parity`，并在真实工具中抽检。
- 测试临时文件结束后清理到回收站。

## 文档同步

- 改目录结构、命令、入口路径或支持状态时，同步更新 `README.md` 与 `docs/`。
- 设计文档以 `docs/design.md` 为准；`local/docs/` 下的调研与交付稿是本地副本，不入库。
- 新增待实测项时，在 `adapters/README.md` 标注证据强度，不把推断写成事实。
