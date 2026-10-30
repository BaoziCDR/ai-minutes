<div align="center">

# AI Minutes · AI 纪要

**A macOS meeting recorder with real-time speaker-separated transcription, AI-generated minutes, and automatic Obsidian archiving.**

**English** · [简体中文](README.zh-CN.md)

[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)
![Platform](https://img.shields.io/badge/platform-macOS%20(Apple%20Silicon)-lightgrey)
![Electron](https://img.shields.io/badge/Electron-40-47848F?logo=electron&logoColor=white)
![React](https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=black)
![TypeScript](https://img.shields.io/badge/TypeScript-5-3178C6?logo=typescript&logoColor=white)

</div>

---

## Table of Contents

- [Features](#features)
- [How It Works](#how-it-works)
- [Requirements](#requirements)
- [Quick Start](#quick-start)
- [Usage](#usage)
- [Data & Privacy](#data--privacy)
- [Obsidian Layout](#obsidian-layout)
- [Development](#development)
- [Project Structure](#project-structure)
- [FAQ](#faq)
- [Contributing](#contributing)
- [License](#license)

## Features

- 🎙️ **Real-time, speaker-separated transcription**: live captions with diarization via Tencent Cloud ASR.
- 🔌 **Multiple speech providers**: Tencent real-time ASR, Tencent file ASR, and any OpenAI-compatible `/audio/transcriptions` or `/chat/completions` endpoint, hosted over HTTPS or running on `localhost`.
- ⏺️ **Live or post-meeting mode**: transcribe while you record, or record first and transcribe when the meeting ends.
- ✍️ **Highlight annotations**: select transcript text and tag it as **Key point / To-do / Decision / Question** in one click; notes are optional.
- 🧠 **AI minutes**: generate structured minutes, a Mermaid mind map, to-dos and decisions with your local [Codex CLI](https://github.com/openai/codex) or any OpenAI-compatible chat model API.
- 🔍 **Independent audio review**: an optional second speech model re-listens to passages the AI flags as doubtful. Usage is capped, and the original transcript is never overwritten.
- 🗂️ **Automatic Obsidian sync**: every meeting gets a hub page, transcript, annotations and minutes, plus a running meeting index.
- 🛟 **Resilient recording**: 16 kHz WAV saved locally, automatic reconnection with recognition gaps marked, automatic recovery from stuck microphones, and crash recovery.
- 🎧 **Post-meeting editing**: waveform playback, variable speed, click-to-seek from the transcript, speaker renaming, MP3 export of highlights, and re-transcription with version history.
- ⌨️ **Global shortcuts**: start/stop, pause/resume and new meeting, all customizable.
- 🔐 **Encrypted credentials**: secrets are encrypted with macOS secure storage (Electron `safeStorage`), shown only as "configured" in the UI, and never included in exports.

## How It Works

```text
Microphone ──► AudioWorklet (16 kHz PCM) ──► local WAV
                                       │
                                       └──► Speech provider (Tencent / OpenAI-compatible) ──► diarized transcript
                                                                                          │
                                  Highlights (key point / to-do / decision / question) ◄──┤
                                                                                          ▼
                                     Codex CLI or chat model API ──► minutes · mind map · to-dos · decisions
                                                                                          │
                                                                                          ▼
                                                                          Obsidian vault (auto-sync)
```

## Requirements

| Dependency | Notes |
| --- | --- |
| macOS (Apple Silicon) | Only arm64 builds are provided |
| Node.js 22+ | Needed to build from source |
| Speech recognition | Tencent Cloud ASR SecretId / SecretKey, or any OpenAI-compatible transcription endpoint |
| AI summarization (either one) | A signed-in [Codex CLI](https://github.com/openai/codex) recent enough to support permission profiles, or an OpenAI-compatible chat model API |
| FFmpeg (optional) | Needed to import external audio and export highlight MP3s |
| Obsidian (optional) | Needed for automatic archiving |

## Quick Start

```bash
git clone https://github.com/BaoziCDR/ai-minutes.git
cd ai-minutes
npm ci
npm run build
npm start
```

To build a macOS app:

```bash
npm run dist
```

The installer is written to `release/`.

> [!NOTE]
> The app is not signed or notarized by Apple. If macOS says the app is "damaged" or from an unidentified developer, and you trust where it came from, remove the quarantine attribute:
>
> ```bash
> xattr -dr com.apple.quarantine "/Applications/AI 纪要.app"
> ```

## Usage

1. **Set up a speech provider**: open *Settings & Connections → Speech Providers*, add a connection with your credentials, and click *Test audio*. Under *Meeting transcription*, pick a model and choose live or post-meeting mode.
2. **Record**: choose a microphone, create a meeting and start recording.
3. **Annotate**: select transcript text and pick a tag from the floating bubble. It saves immediately, and a note is optional.
4. **Pause / stop**: pause and resume share one button. Stopping asks for confirmation first.
5. **Generate minutes**: after the meeting, review the audio, fix the transcript and speaker names, then click *Generate minutes*.

### Default Shortcuts

| Action | Shortcut |
| --- | --- |
| Start / stop recording | `⌘ ⇧ R` |
| Pause / resume | `⌘ ⇧ P` |
| New meeting | `⌘ ⌥ N` |

All shortcuts can be changed in Settings: click the field and press the new combination. `Esc` cancels and `Delete` clears it.

### Where Data Lives

| Content | Default location |
| --- | --- |
| Meetings | `~/.ai-minutes/meetings/` (the root folder can be changed in Settings) |
| Settings and encrypted credentials | `~/Library/Application Support/AI 纪要/` |
| Obsidian vault | `~/basic-memory`, using the `会议记录` folder inside it (both configurable) |

Recordings are 16 kHz / 16-bit / mono WAV, about 115 MB per hour.

## Data & Privacy

AI Minutes is local-first. **It has no backend of its own and collects no telemetry.** To transcribe and summarize, it sends some data to **third-party services that you configure yourself**:

| Data | Sent to |
| --- | --- |
| Meeting audio | Your configured speech provider (e.g. Tencent Cloud ASR, an OpenAI-compatible endpoint) |
| Transcript and highlights | Your chosen summarization service (Codex / chat model API) |
| Audio clips for review | Only the independent review model, and only if you configure one |

- Credentials are encrypted with macOS secure storage, and the renderer process only ever sees whether they are configured.
- Codex runs read-only with network access disabled. It can only see the input snapshot for the current task and never receives your speech provider credentials.
- Get consent from everyone in the meeting before you record, and follow local laws and your organization's policies.

## Obsidian Layout

The app writes these files with Chinese names:

```text
会议记录/                    # Meetings
  会议索引.md                # Meeting index
  2026/09/2026-09-22 Project sync abc123/
    会议.md                  # Hub: metadata, audio, conclusions, links
    录音.wav                 # Recording
    原文.md                  # Transcript with timestamps and speakers
    重点批注.md               # Highlights as callouts with notes
    纪要.md                  # Minutes
    思维导图.md               # Mind map (Mermaid)
    待办.md                  # To-dos
    决策.md                  # Decisions
    录音复核.md               # Audio review results
    会议数据.json             # Raw meeting data
```

When the vault is on the same filesystem, the recording is hard-linked, so it takes no extra space. The app regenerates these files on every sync, so put your own manual notes in separate files.

## Development

```bash
npm run dev            # Vite dev server only (renderer)
npm run build          # Type-check and build
npm start              # Launch Electron
npm test               # Unit tests (adapters, migration, budgets, versioning, sandbox)
npm run test:desktop   # E2E tests (UI, PCM recording pipeline, mock speech APIs)
npm run format         # Prettier
```

By default, tests use the system temp directory and synthetic data. They never touch your meeting library and need no real credentials. These optional environment variables run checks against real services:

| Variable | Effect |
| --- | --- |
| `AI_MINUTES_REAL_CLOUD=1` | Checks the cloud connection with your locally encrypted Tencent credentials and synthetic speech |
| `AI_MINUTES_REAL_MIC=1` | Records offline from the current microphone; no audio is uploaded |
| `AI_MINUTES_LIVE_CHECK=1` | Calls the providers configured in the installed app |
| `AI_MINUTES_DATA_DIR` | Isolated data directory, for tests only |

## Project Structure

```text
electron/
  main.cjs             # App lifecycle, IPC, recording and summarization orchestration
  tencent.cjs          # Tencent request signing, real-time stream, speaker events
  speech/              # Speech provider registry, runtime, async tasks, audio utilities
  summary.cjs          # AI minutes generation
  review.cjs           # Independent audio review
  obsidian.cjs         # Obsidian sync and meeting index
  storage.cjs          # Data root validation and migration
  shortcuts.cjs        # Global shortcuts
src/
  main.tsx             # React UI
  SelectionBubble.tsx  # Highlight bubble
  SpeechSettings.tsx   # Speech provider settings
  AudioReviewView.tsx  # Audio review view
  recorder.ts          # AudioWorklet recorder
public/pcm-worklet.js  # PCM capture worklet
tests/                 # Unit tests and Playwright Electron E2E tests
```

## FAQ

<details>
<summary><b>Does it run on Windows or Linux?</b></summary>

Not yet. Credential encryption, hard-link syncing and the packaging config are all macOS-specific. Pull requests for other platforms are welcome.
</details>

<details>
<summary><b>Can it run fully offline?</b></summary>

Yes. Point transcription at an OpenAI-compatible server on `localhost` (for example, a self-hosted Whisper), and use a local model API for summarization.
</details>

<details>
<summary><b>Is there a maximum meeting length?</b></summary>

No artificial limit. Audio is written to disk continuously, and after a network drop the app reconnects and marks the recognition gap in the transcript.
</details>

## Contributing

Issues and pull requests are welcome!

1. Fork the repo and create a branch: `git checkout -b feat/your-feature`
2. Run `npm test` and `npm run format` before committing
3. Open a pull request describing what changed and how you tested it

## License

Released under the [MIT License](LICENSE).

## Acknowledgements

[Electron](https://www.electronjs.org/) · [React](https://react.dev/) · [Vite](https://vite.dev/) · [Mermaid](https://mermaid.js.org/) · [Lucide](https://lucide.dev/) · [Tencent Cloud ASR](https://www.tencentcloud.com/products/asr) · [Codex CLI](https://github.com/openai/codex)
