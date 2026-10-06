# Engram-Enhanced

[中文说明](README.zh-CN.md)

> **Attribution / 来源声明**：This project is an enhanced fork of [BaiYingNing/Engram](https://github.com/BaiYingNing/Engram) (v1.2.0, MIT License). All credit for the original Engram goes to [@BaiYingNing (Byinne)](https://github.com/BaiYingNing); the vocabulary data originates from [KyleBing/english-vocabulary](https://github.com/KyleBing/english-vocabulary) as used by the upstream project. This fork remains open source under the same MIT license.

Engram is a desktop vocabulary trainer built for focused, high-volume English word study. It uses a lightweight Electron architecture, stores progress locally with SQLite, and combines batch-based study with spaced review scheduling.

## Enhancements over upstream

- **Web version**: browser adapter (`static/web-api.js`) backed by IndexedDB + lazy-loaded static word books, deployable to Cloudflare Pages with one command (`deploy-web.cmd`)
- **Mobile-adaptive layout**: phone-sized screens get a thumb-friendly UI (fixed bottom scoring bar, always-available speak button, swipeable stats strip)
- **Study timer**: countdown / alarm-at-clock-time / stopwatch modes with local beeps, desktop notifications, and title flashing
- **Enforced single-audio-voice**: a token mechanism guarantees only one sound at any moment; switching words cuts the previous pronunciation immediately
- **Fix: stuck batch progression**: batch completion now trusts the answered counter, so a lost `reviewed` flag can no longer permanently disable the "next" button (existing broken sessions self-heal)
- **Stability**: SQLite `busy_timeout` and a single-instance lock prevent double-launch write contention
- **Cross-compatible data**: web word IDs match the desktop database exactly, so desktop backups import cleanly into the web version

## Project Overview

Engram is designed for learners who want a fast, distraction-light workflow instead of a gamified memorization app. The current version ships with multiple built-in vocabulary books, local progress tracking, review scheduling, study statistics, contextual examples, pronunciation playback, and a packaged Windows desktop experience.

## Features

- Batch-based study flow with mixed new words and due reviews
- Three feedback levels: `unknown`, `vague`, `known`
- Spaced review intervals backed by local SQLite data
- Built-in vocabulary books for CET-4, CET-6, postgraduate entrance exam, IELTS, and TOEFL study
- Example sentences on word cards when source data is available
- UK / US pronunciation playback with dictionary audio first and system TTS fallback
- Optional study-day rollover at 00:00 or 05:00
- Statistics dashboard with calendar and chart views
- Light and dark themes
- Local desktop app experience with no backend service required

## Screenshots

### Main study view

![Main study view](<docs/image/Main study view.png>)

### Statistics dashboard

![Statistics dashboard](<docs/image/Statistics dashboard.png>)

### Settings panel

![Settings panel](<docs/image/Settings panel.png>)

## Tech Stack

- Electron
- HTML
- CSS
- JavaScript
- SQLite via Node.js built-in `node:sqlite`
- electron-builder

## Local Development

### Install dependencies

```powershell
npm install
```

### Rebuild the local database

```powershell
npm run rebuild-db
```

### Start the app

```powershell
npm start
```

## Packaging

Build Windows release artifacts:

```powershell
npm run dist
```

The release configuration is set up to generate:

- Windows installer package
- Windows zip package

## Data Source

This project includes vocabulary JSON data used to build the local SQLite database.

Acknowledgement:

- Vocabulary data is sourced from [KyleBing/english-vocabulary](https://github.com/KyleBing/english-vocabulary)

## Documentation

- Chinese README: [README.zh-CN.md](README.zh-CN.md)
- About the project: [docs/about.md](docs/about.md)
- Study guide: [docs/guide.md](docs/guide.md)

## License

This project is licensed under the MIT License. See the [LICENSE](LICENSE) file for details.

## Disclaimer

- This project is intended for learning and personal productivity purposes.
- The included vocabulary data remains subject to its original source terms and attribution requirements.
- No warranty is provided for fitness, correctness, or uninterrupted availability.
