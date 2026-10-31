# AI 工作台

把跨 AI 工具通用的规则、技能和机器信息维护在一处，再按各工具认可的入口一键分发。

## 当前阶段

P1：

- 已建立真源仓库、规则、机器档案模板、目标注册表和入口模板；本机档案只在本地保存，不入库。
- 已实现 `build`、`detect`、`deploy`、`status`、`doctor`，以及内容维护 `content lint` / `new-rule` / `new-skill`。
- `deploy` 默认只预演；`--apply` 才写外部入口和全局工作台，写入前备份、临时文件加原子替换、写后校验、失败回滚，并记录到 `state/`。
- **尚未对真实 AI 工具目录执行过 `deploy --apply`**；GUI、技能 junction、项目挂载仍待后续阶段。全局工作台也可单独用 `scripts/install-global.mjs` 安装。

设计细节见 [docs/design.md](docs/design.md)。

## 快速开始

首次使用先按 `machines/_template.md` 创建本机档案 `machines/<主机名>.md`（该文件不入库），再执行：

```powershell
# 生成入口内容与清单
node src/cli/main.mjs build

# 查看本机各工具入口状态
node src/cli/main.mjs detect

# 只预演，不写任何外部文件
node src/cli/main.mjs deploy --dry-run

# 确认预演结果后执行：写各工具入口、创建全局工作台目录与脚本 junction
node src/cli/main.mjs deploy --apply

# 只安装全局工作台目录与脚本 junction（不碰工具入口）
node scripts/install-global.mjs --apply

# 查看部署状态
node src/cli/main.mjs status

# 检查动作注册表与基础环境
node src/cli/main.mjs doctor --parity

# 校验规则与技能
node src/cli/main.mjs content lint
```

也可以使用启动器：

```powershell
launchers\aiwb.cmd build
launchers\aiwb.cmd deploy --dry-run
```

## 目录

| 目录 | 用途 | 是否入库 |
|---|---|---|
| `content/` | 通用规则、技能、入口模板、可部署脚本 | 是 |
| `machines/` | 机器档案模板；本机档案 `machines/<主机名>.md` 不入库 | 模板是，本机档案否 |
| `adapters/` | 各工具入口路径与支持状态 | 是 |
| `src/core/` | CLI 与 GUI 共用的业务核心 | 是 |
| `src/cli/` | 命令行入口 | 是 |
| `src/gui/` | 本地 Web GUI（后续阶段） | 是 |
| `launchers/` | Windows 启动器 | 是 |
| `scripts/` | 本仓库自身的维护、部署、校验、打包脚本，不部署 | 是 |
| `tests/` | 单元、集成、对等性测试 | 是 |
| `docs/` | 设计、支持矩阵、维护、迁移 | 是 |
| `local/` | 本地开发维护产生的文档、脚本与草稿 | 否 |
| `dist/` | 构建产物 | 否 |
| `state/` | 部署状态、写前备份、并发锁 | 否 |

## 资料分层

资料和脚本按“可复用 vs 一次性、随代码走 vs 只给当事人”分层存放，完整规则见 [content/rules/04-storage.md](content/rules/04-storage.md)。

- 本仓库：可部署内容放 `content/`，自身维护脚本放 `scripts/`；本机草稿放 `local`，一次性产物放 `_tmp`，两者均忽略。
- 全局工作台：`todo`（跨会话待办）、`scripts`（跨项目脚本）、`notes`（长期问题库）、`_tmp`（临时区）；具体路径见机器档案的“全局工作台”。
- 代码项目：共享文档与脚本进 `docs`、`scripts`、`tools`；当事人资料进 `local`；临时内容进 `_tmp`。项目不建 TODO 文档。
- 部署：各 AI 工具根只写入口和技能 junction；`content/scripts/` 以 junction 安装到 `<全局工作台>/scripts/ai-workbench`；规则、技能和脚本都不复制到工具根。

## 安全边界

- 只改 `content/`、`machines/`、`adapters/` 和工具代码；不接管各 AI 工具独有规则、技能、插件、人设和记忆。
- 部署只追加带标记的块或写独立文件；写前备份到 `state/backups/`，原子替换并做写后校验，失败用备份恢复；块被手改或已有非工作台文件时只报告，不覆盖。
- `deploy --apply` 同时负责全局工作台目录与脚本 junction；存在冲突时整体不写。写入期间用 `state/locks/deploy.lock` 阻止并发部署。
- 脚本不进各 AI 工具根；全局调用走 `<全局工作台>/scripts/ai-workbench`，本机专用脚本放其同级目录。
- `content/` 不写本机绝对路径；机器差异一律放 `machines/<主机名>.md`，该文件只在本地保存，禁止提交。
- 仓库不保存密钥、令牌、账号凭据。
- 不自动提交 git。提交说明使用中文。

## 维护入口

- 修改通用规则：`content new-rule <slug>` 或直接改 `content/rules/` → `content lint` → `build` → `deploy --dry-run` → `deploy --apply` → `doctor`。
- 修改本机路径或项目清单：改 `machines/<主机名>.md`（不入库）→ 同上。
- 新增工具：改 `adapters/targets.json`，并在 `src/core/targets/` 补该工具的特有行为。
- 新增技能：`content new-skill <name> --description "触发场景"`，再补正文；`build` 会自动生成技能索引。
- 新增可部署脚本：放 `content/scripts/`（零依赖 Node 脚本）→ `node scripts/install-global.mjs` 预演 → 需要时 `--apply`。本仓库自身脚本仍放 `scripts/`，不部署。
- 内置技能 `aiwb` 受 `content lint` 保护，不能删除或取消 `builtin`；调整时通过仓库修改。
