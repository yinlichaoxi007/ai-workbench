# AI 工作台

把跨 AI 工具通用的规则、技能和机器信息维护在一处，再按各工具认可的入口一键分发。

## 当前阶段

P0 / P1 前期：

- 已建立真源仓库、规则、机器档案模板、目标注册表和入口模板；本机档案只在本地保存，不入库。
- 已实现 `build`、`detect`、`deploy --dry-run`、`status`、`doctor`。
- 已实现内容维护：`content lint`、`content new-rule`、`content new-skill`，并内置受保护的 `aiwb` 技能。
- **尚未向任何 AI 工具目录写入文件**；`deploy --apply`、GUI、技能 junction、项目挂载在后续阶段实现。

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
| `content/` | 通用规则、技能、入口模板 | 是 |
| `machines/` | 机器档案模板；本机档案 `machines/<主机名>.md` 不入库 | 模板是，本机档案否 |
| `adapters/` | 各工具入口路径与支持状态 | 是 |
| `src/core/` | CLI 与 GUI 共用的业务核心 | 是 |
| `src/cli/` | 命令行入口 | 是 |
| `src/gui/` | 本地 Web GUI（后续阶段） | 是 |
| `launchers/` | Windows 启动器 | 是 |
| `dev/` | 开发、打包、路径检查脚本 | 是 |
| `tests/` | 单元、集成、对等性测试 | 是 |
| `docs/` | 设计、支持矩阵、维护、迁移 | 是 |
| `local/` | 本地开发维护产生的文档、脚本与草稿 | 否 |
| `dist/` | 构建产物 | 否 |
| `state/` | 部署状态、备份、日志、锁 | 否 |

## 安全边界

- 只改 `content/`、`machines/`、`adapters/` 和工具代码；不接管各 AI 工具独有规则、技能、插件、人设和记忆。
- 部署只追加带标记的块，写前备份，失败只报告，不覆盖用户原有内容。
- `content/` 不写本机绝对路径；机器差异一律放 `machines/<主机名>.md`，该文件只在本地保存，禁止提交。
- 仓库不保存密钥、令牌、账号凭据。
- 不自动提交 git。提交说明使用中文。

## 维护入口

- 修改通用规则：`content new-rule <slug>` 或直接改 `content/rules/` → `content lint` → `build` → `deploy` → `doctor`。
- 修改本机路径或项目清单：改 `machines/<主机名>.md`（不入库）→ 同上。
- 新增工具：改 `adapters/targets.json`，并在 `src/core/targets/` 补该工具的特有行为。
- 新增技能：`content new-skill <name> --description "触发场景"`，再补正文；`build` 会自动生成技能索引。
- 内置技能 `aiwb` 受 `content lint` 保护，不能删除或取消 `builtin`；调整时通过仓库修改。
