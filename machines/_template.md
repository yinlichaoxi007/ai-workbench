---
host: REPLACE_ME
backupRetention: 10
guiPort: 0
---

# REPLACE_ME 机器档案

复制本文件为 `machines/<主机名>.md`，再填写下面的内容。主机名必须与 `os.hostname()` 一致。

可让 AI 工具按仓库 `AGENTS.md` 的“首次初始化（新机器）”和 `docs/onboarding.md` 生成候选档案；AI 只提供候选值与依据，路径、工具启用和版本要求由本机确认后再写入，部署方式（CLI/GUI）也由用户选择。

## 机器环境

- 系统：
- Shell：
- Node.js：
- npm：
- Git：
- 其他运行时：

## 路径

- 项目父级：
- 工作参考资料：
- 个人资料：
- 学习资料：
- 其他资料：
- 工作计划总结：
- 桌面交付：
- 工作台仓库：
- 全局工作台：

## 项目清单

| 名称 | 路径 | 技术栈 | 构建/测试 | 备注 |
|---|---|---|---|---|
| 示例 | X:\projects\example | 待补 | 待补 | 待补 |

## 设置

可选。用 `aiwb settings set` 修改时自动写入；路径值支持 `${NAME}` 与 `%NAME%`，`env` 优先于进程环境变量。

```json
{
  "env": {},
  "tools": {},
  "customTools": {}
}
```

- `env.<名称>`：本机环境变量，供工具路径展开使用；安装目录不在标准位置时，可用 `AIWB_TRAE_CN_HOME`、`AIWB_CODEBUDDY_HOME`、`AIWB_WORKBUDDY_HOME` 指向安装根目录供版本探测。
- `tools.<工具 id>`：可设 `enabled`、`version`、`configRoot`、`entryPath`、`skillsDir`；显式 `entryPath` 会关闭备选入口回退。
- `customTools.<工具 id>`：登记未内置的工具，必填 `name`、`configRoot`、`entryPath`；可设 `strategy`、`format`、`skillsDir`、`frontmatter`、`version`、`enabled`。定义只在本机生效，部署前先在设置页修复解析问题。
- `version`：可选版本要求，留空表示不核对；支持精确版本、比较范围（如 `>=3.3,<4`）、`||` 多候选和英文括号，逗号表示同时满足且优先于 `||`。填写后部署、合并与恢复会先核对实际版本，不符或无法检测时阻止。

## 本机特有注意事项

- 暂无。
