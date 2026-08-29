# 唱机 — Local Music Player

本地 FLAC 播放器。默认读取 `~/Desktop/music-resources`，支持单曲循环、歌手循环、随机播放、快进快退和倍速。

## 开始

双击 **唱机.app**（桌面或 `~/Applications`）即可启动。第一次会打包界面并打开浏览器；从程序坞退出唱机时会关掉后台服务。

若还没有这个图标：

```bash
npm run install-app
```

开发调试仍可用：

```bash
npm install
npm run dev
```

浏览器打开 [http://localhost:5173](http://localhost:5173)。生产模式启动是 [http://localhost:8787](http://localhost:8787)。

曲库目录可改 `config.json` 里的 `musicDir`，或启动时设置环境变量：

```bash
MUSIC_DIR="/path/to/music" npm run dev
```

改完目录后点界面上的「重新扫描」。

## 播放

- **单曲循环** / **歌手循环** / **随机播放** / **全部循环**：点播放条右侧的模式按钮切换
- **快进 / 快退 10 秒**：播放键两边的箭头，或键盘 `←` / `→`（Shift 为 30 秒）
- **倍速**：`0.5x`–`2x`，点击倍速按钮循环，悬停可选精确值
- 进度条可拖动；音量滑杆在右下角
- **为你推荐**：本地机器学习（逻辑回归 + Item2Vec + 内容近邻）。完播、跳过和「喜欢」都会写入 `data/listens.json` 并立刻重训
- **智能推荐**播放模式：切到下一首时由模型挑选

## 快捷键

| 键 | 功能 |
| --- | --- |
| Space | 播放 / 暂停 |
| ← / → | 快退 / 快进 10 秒 |
| Shift + ← / → | 30 秒 |
| N / P | 下一首 / 上一首 |
| ↑ / ↓ | 音量 |
| M | 静音 |

Safari、Chrome、Firefox 均可直接播放 FLAC。文件名可以是哈希，播放器会读 Vorbis 标签里的曲名、歌手和专辑。
