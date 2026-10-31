# 启动器

- `aiwb.cmd`：转发到 `node src\cli\main.mjs`。
- `aiwb-gui.cmd`：启动本地 GUI 并打开浏览器，等价于 `aiwb gui --open`。

使用示例：

```powershell
launchers\aiwb.cmd build
launchers\aiwb.cmd detect
launchers\aiwb.cmd deploy --dry-run
launchers\aiwb.cmd status
launchers\aiwb.cmd doctor --parity
launchers\aiwb-gui.cmd
```

可以把 `launchers\aiwb.cmd` 所在目录加入 PATH，或创建桌面快捷方式。启动器只做转发，不写业务逻辑。
