# Engram-Enhanced

[English README](README.md)

> **来源声明 / Attribution**：本项目基于 [BaiYingNing/Engram](https://github.com/BaiYingNing/Engram)（原项目 `Engram`，MIT License）的 v1.2.0 增强而来，感谢原作者 [@BaiYingNing (Byinne)](https://github.com/BaiYingNing) 的优秀工作。词库数据同样来源于原项目所使用的 [KyleBing/english-vocabulary](https://github.com/KyleBing/english-vocabulary)。本项目遵循原项目的 MIT 许可证继续开源。

Engram 是一个面向高频、高强度英语单词学习场景的桌面背词应用。它采用轻量化的 Electron 架构，使用本地 SQLite 保存学习进度，并将分组学习与间隔复习调度结合在一起。

## 相对上游的增强内容

在原项目基础上，本仓库做了以下增强与修复：

- **网页版**：新增 `static/web-api.js` 浏览器适配层（IndexedDB 存进度 + 静态词书懒加载），无需 Electron 即可在浏览器使用；`scripts/build-web.js` 构建静态站点，`deploy-web.cmd` 一键部署到 Cloudflare Pages
- **移动端自适应**：手机访问自动切换为单手友好布局（底部固定评分栏 + 常驻发音按钮 + 顶栏统计横向滑动条）
- **学习计时器**：倒计时 / 到点闹钟 / 正计时三模式，到点本地蜂鸣 + 桌面通知 + 标题闪烁提醒，计时状态跨刷新保留
- **音频强制单声源**：令牌校验机制保证任意时刻只有一个声音，切词自动截断上一词发音，快速连点/切口音不再叠音
- **修复批次推进卡死**：批次完成判定改以答题计数为准，不再因丢失的 reviewed 标志导致"下一词"永久禁用（会自动治愈历史坏状态）
- **稳定性**：SQLite 增加 `busy_timeout`，应用启用单实例锁，避免双开争抢写锁导致打分失败
- **数据互通**：浏览器版单词 ID 与桌面版数据库全量对齐，桌面备份可直接导入网页版继续学习

## 项目简介

Engram 的设计目标不是游戏化激励，而是提供一个更直接、更低干扰的学习流程。当前版本内置多套词书，支持本地进度记录、到期复习、学习统计、例句展示、发音播放，以及可分发的 Windows 桌面应用形态。

## 功能特点

- 分组式学习流程，可混合新词与到期复习词
- 三档反馈：`unknown`、`vague`、`known`
- 基于本地 SQLite 的间隔复习调度
- 内置 CET4、CET6、考研词汇、雅思词汇、托福词汇
- 单词卡片支持展示源词库例句
- 支持英音 / 美音播放，优先使用词库音频，失败时回退到系统 TTS
- 支持每日 0 点或 5 点刷新学习日
- 含日历和图表的学习统计面板
- 深色 / 浅色主题
- 无需后端服务的本地桌面应用体验

## 功能截图

### 主学习界面

![主学习界面](<docs/image/Main study view.png>)

### 统计面板

![统计面板](<docs/image/Statistics dashboard.png>)

### 设置面板

![设置面板](<docs/image/Settings panel.png>)

## 技术栈

- Electron
- HTML
- CSS
- JavaScript
- SQLite（通过 Node.js 内置 `node:sqlite`）
- electron-builder

## 本地运行

### 安装依赖

```powershell
npm install
```

### 重建本地数据库

```powershell
npm run rebuild-db
```

### 启动应用

```powershell
npm start
```

## 打包方式

构建 Windows 发布产物：

```powershell
npm run dist
```

当前构建配置会生成：

- Windows 安装包
- Windows zip 压缩包

## 数据来源说明

本项目包含用于构建本地 SQLite 数据库的词库 JSON 数据。

致谢：

- 词库数据来源于 [KyleBing/english-vocabulary](https://github.com/KyleBing/english-vocabulary)

## 文档

- 英文 README：[README.md](README.md)
- 项目说明：[docs/about.md](docs/about.md)
- 学习说明：[docs/guide.md](docs/guide.md)

## 许可证说明

本项目采用 MIT License 开源，详见 [LICENSE](LICENSE)。

## 免责声明

- 本项目用于学习和个人效率提升场景。
- 内置词库数据仍应遵循其原始来源的条款与署名要求。
- 本项目不对适用性、正确性或持续可用性提供任何保证。
