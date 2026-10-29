# 启动器

- `aiwb.cmd`：转发到 `node src\cli\main.mjs`。
- `aiwb-gui.cmd`：预留 GUI 启动，当前会明确提示 GUI 尚未实现（P2）。

使用示例：

```powershell
launchers\aiwb.cmd build
launchers\aiwb.cmd detect
launchers\aiwb.cmd deploy --dry-run
launchers\aiwb.cmd status
launchers\aiwb.cmd doctor --parity
```

可以把 `launchers\aiwb.cmd` 所在目录加入 PATH，或创建桌面快捷方式。启动器只做转发，不写业务逻辑。
