# StreeFight

原创 2D 单机格斗游戏。纯 Canvas 绘制，无外部素材、无联网需求，用 Electron 打包成 Windows 11 安装程序。

## 玩法

- 单人 vs CPU（简单 / 普通 / 困难）或本地双人对战
- 三局两胜，每局 60 秒
- 按住「后」（远离对手的方向）防御；蹲下或跳跃可以躲开气功波
- 气功波消耗 35 点能量，命中和被打都会涨能量

| 动作 | P1 | P2 |
| --- | --- | --- |
| 移动 | A / D | ← / → |
| 跳 / 蹲 | W / S | ↑ / ↓ |
| 拳 | J | `,` 或 小键盘 1 |
| 腿 | K | `.` 或 小键盘 2 |
| 气功波 | L | `/` 或 小键盘 3 |

Esc 暂停，F11 全屏。

## 安装包（Windows 11）

推送到 `main` 或打 `v*` 标签后，GitHub Actions 会自动构建三个安装包：

| 文件 | 适用 |
| --- | --- |
| `StreeFight Setup 1.0.0-x64.exe`（文件名含 x64） | Intel / AMD 64 位 |
| `StreeFight Setup 1.0.0-arm64.exe`（文件名含 arm64） | ARM64（如骁龙 X） |
| `StreeFight Setup 1.0.0.exe` | 通用包，同时含两种架构，安装时自动选择 |

- 推送到 `main`：在 Actions 页面对应运行记录的 Artifacts 里下载
- 打标签（如 `git tag v1.0.0 && git push --tags`）：安装包会附在 Release 页面

安装包没有代码签名，首次运行时 Windows SmartScreen 会提示，点「更多信息 → 仍要运行」。

## 本地开发

```bash
npm install
npm start          # 运行游戏
npm run dist       # 在 Windows 上构建全部安装包，输出到 dist/
```

也可以直接用浏览器打开 `src/index.html` 试玩。
