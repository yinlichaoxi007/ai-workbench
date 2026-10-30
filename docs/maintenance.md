# 日常维护

## 常用命令

```powershell
node src/cli/main.mjs build
node src/cli/main.mjs build --check
node src/cli/main.mjs detect
node src/cli/main.mjs deploy --dry-run
node src/cli/main.mjs status
node src/cli/main.mjs doctor
node src/cli/main.mjs doctor --parity
node src/cli/main.mjs content lint
node src/cli/main.mjs content new-rule <slug> --title "标题"
node src/cli/main.mjs content new-skill <name> --description "触发场景"
```

也可以使用 `launchers\aiwb.cmd <命令>`。

## 新增或修改规则

1. 新增规则运行 `content new-rule <slug> --title "标题"`：自动取下一个两位编号，并在 `00-index.md` 的阅读顺序和文件职责表登记。
2. 也可以手工新建 `content/rules/<编号>-<短横线名称>.md`，但要同时补 `00-index.md`，否则 `content lint` 会报错。
3. 修改规则只改 `content/rules/` 下的正文，不要改各 AI 工具目录中的入口副本。
4. 只有“每次都必须遵守”的条目才同步到 `content/templates/entry-essentials.md`；入口不放规则全文。
5. 运行 `content lint`，确认命名、编号、索引和路径合规。
6. 运行 `build`，检查 `dist/ENTRY.md` 的索引和最小铁律。
7. 运行 `deploy --dry-run`，确认将影响的工具和动作。
8. `deploy --apply` 在当前阶段尚未实现；在实现并通过测试前，不要手工把入口文件复制到工具目录。
9. 后续实现 apply 后，部署完运行 `status` 与 `doctor`，再用各工具新会话抽检。

## 新增或修改技能

1. 新增运行 `content new-skill <name> --description "触发场景"`；名称只能用小写字母、数字和短横线。
2. 每个技能一个目录：`content/skills/<name>/SKILL.md`，可带 `scripts/`、`references/` 等资源。
3. `SKILL.md` 的 frontmatter 必须有 `name` 和 `description`，且 `name` 与目录名一致；`description` 写清什么时候使用。
4. 正文不要写本机盘符绝对路径；需要仓库位置时，引用全局入口中的“工作台索引”。
5. 运行 `content lint`；`build` 会自动扫描技能并生成入口技能索引，不需要手工登记。
6. 技能 junction 尚未实现；在此之前，AI 可按入口索引中的路径直接读取正文。
7. 内置技能 `aiwb` 不能删除，也不能取消 `builtin: true`；需要调整时修改文件，再重新 lint、build、deploy。

## 修改机器路径或项目清单

1. 只改 `machines/<主机名>.md`；该文件含本机隐私信息，已被 gitignore，不要提交。
2. 重新 `build` 与 `deploy --dry-run`。
3. 如果项目清单新增了仓库，补全技术栈和构建/测试命令，避免写“待补”后忘记。

## 新增或修改工具入口

1. 改 `adapters/targets.json`：路径、格式、写入策略、启用状态、证据状态。
2. 只有出现该工具特有的读写行为时，才在 `src/core/targets/<tool>.mjs` 增加适配代码；通用逻辑不硬编码工具路径。
3. 更新 `adapters/README.md` 与 `docs/adapters.md`。
4. 先 `detect`，再 `deploy --dry-run`；写入能力和实测记录完成前，状态不要标成 `verified`。
5. 运行 `node --test --test-concurrency=1 "tests/**/*.test.mjs" "tests/*.test.mjs"` 和 `doctor --parity`。

## 冲突与漂移

- `manual`：入口文件不是 UTF-8、块标记损坏、块被手工修改、已有同名非工作台文件，或缺少状态记录且内容不一致。不要强行覆盖，先看 `deploy --dry-run` 的原因列。
- `drift`：入口块哈希与状态记录不一致。优先确认是谁改的；后续用合并页或备份恢复处理，不要直接再 deploy 覆盖。
- `stale`：源内容已更新但入口还是旧版本。重新部署即可。
- `missing`：状态记录存在但入口文件不在；确认是否被工具升级或用户删除。
- `unmanaged`：工具目录已有文件但没有工作台块；部署只会追加，不会改写原内容。

## 当前未实现的能力

- `deploy --apply`：写入、备份、原子替换、状态记录。
- `backup list` / `backup restore` / `uninstall`。
- 技能 junction。
- 项目挂载 `attach` / `detach`。
- GUI、冲突合并页、诊断包。
- Git 私库与自动提交（本工具不会自动提交）。

在这些能力实现前，`deploy --dry-run` 只用于检查动作清单，不产生外部写入。

## 工具升级后

1. 运行 `detect`，确认配置根、入口路径和技能目录是否仍存在。
2. 运行 `status` 与 `doctor`，检查入口是否失效或漂移。
3. 新开一个会话抽检入口是否被加载；未加载时先查工具设置和路径，不要直接假定规则生效。

## 发布与备份

- 版本号写 `VERSION` 与 `package.json`，变更写 `CHANGELOG.md`。
- `dist/`、`state/`、备份和日志不入库。
- 不把本机绝对路径、密钥、令牌写进 `content/`。
- 备份与回滚能力实现前，改动外部入口前先手工备份；当前阶段没有 apply，正常使用不会写外部文件。
