---
host: REPLACE_ME
backupRetention: 10
guiPort: 0
---

# REPLACE_ME 机器档案

复制本文件为 `machines/<主机名>.md`，再填写下面的内容。主机名必须与 `os.hostname()` 一致。

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

- `env.<名称>`：本机环境变量，供工具路径展开使用。
- `tools.<工具 id>`：可设 `enabled`、`configRoot`、`entryPath`、`skillsDir`；显式 `entryPath` 会关闭备选入口回退。
- `customTools.<工具 id>`：登记未内置的工具，必填 `name`、`configRoot`、`entryPath`；可设 `strategy`、`format`、`skillsDir`、`frontmatter`、`enabled`。定义只在本机生效，部署前先在设置页修复解析问题。

## 本机特有注意事项

- 暂无。
