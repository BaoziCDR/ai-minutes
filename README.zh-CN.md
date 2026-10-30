<div align="center">

# AI 纪要 · AI Minutes

**一款 macOS 会议记录 App：实时分人转写，会后由 AI 生成结构化纪要，并自动归档到 Obsidian。**

[English](README.md) · **简体中文**

[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)
![Platform](https://img.shields.io/badge/platform-macOS%20(Apple%20Silicon)-lightgrey)
![Electron](https://img.shields.io/badge/Electron-40-47848F?logo=electron&logoColor=white)
![React](https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=black)
![TypeScript](https://img.shields.io/badge/TypeScript-5-3178C6?logo=typescript&logoColor=white)

</div>

---

## 目录

- [功能特性](#功能特性)
- [工作流程](#工作流程)
- [环境要求](#环境要求)
- [快速开始](#快速开始)
- [使用说明](#使用说明)
- [数据与隐私](#数据与隐私)
- [Obsidian 归档结构](#obsidian-归档结构)
- [开发](#开发)
- [项目结构](#项目结构)
- [常见问题](#常见问题)
- [参与贡献](#参与贡献)
- [许可证](#许可证)

## 功能特性

- 🎙️ **实时分人转写**：接入腾讯云实时语音识别，边开会边出字幕，自动区分发言人。
- 🔌 **多种语音供应商**：支持腾讯实时识别、腾讯录音文件识别，以及 OpenAI 兼容的 `/audio/transcriptions` 和 `/chat/completions` 接口；可连接云端 HTTPS 服务或本地 `localhost` 服务。
- ⏺️ **实时 / 会后两种模式**：可以边录边转写，也可以先录音、结束后再整体转写。
- ✍️ **划线批注**：在原文中选中文字，一键标记为 **重点 / 待办 / 决策 / 疑问**，备注可选。
- 🧠 **AI 整理纪要**：通过本机 [Codex CLI](https://github.com/openai/codex) 或任意 OpenAI 兼容的文字模型 API，生成结构化纪要、Mermaid 思维导图、待办和决策。
- 🔍 **独立录音复核**：可另配一个语音模型，由 AI 挑出可疑片段回听核对；有用量上限，结果不覆盖原文。
- 🗂️ **自动同步 Obsidian**：每场会议自动生成入口页、原文、批注、纪要等笔记，并维护会议索引。
- 🛟 **稳健录音**：16 kHz WAV 本地落盘；断线自动重连并标记识别缺口；麦克风卡住时自动恢复；意外退出后可找回数据。
- 🎧 **会后编辑**：带波形的回放、倍速播放、点击原文跳转、修改发言人姓名、重点片段导出 MP3、重新转写并保留历史版本。
- ⌨️ **全局快捷键**：开始/结束、暂停/继续、新建会议，均可自定义。
- 🔐 **密钥安全**：密钥用 macOS 安全存储（Electron `safeStorage`）加密，界面只显示“已配置”，不会出现在导出文件中。

## 工作流程

```text
麦克风 ──► AudioWorklet (16 kHz PCM) ──► 本地 WAV
                                   │
                                   └──► 语音供应商（腾讯 / OpenAI 兼容）──► 分人原文
                                                                        │
                                       划线批注（重点/待办/决策/疑问）◄───┤
                                                                        ▼
                                   Codex CLI 或文字模型 API ──► 纪要 · 思维导图 · 待办 · 决策
                                                                        │
                                                                        ▼
                                                              Obsidian 库（自动同步）
```

## 环境要求

| 依赖 | 说明 |
| --- | --- |
| macOS（Apple Silicon） | 目前只提供 arm64 构建 |
| Node.js 22+ | 从源码构建时需要 |
| 语音识别账号 | 腾讯云 ASR 的 SecretId / SecretKey，或任意 OpenAI 兼容的转写接口 |
| AI 整理服务（二选一） | 已登录的 [Codex CLI](https://github.com/openai/codex)（需支持 permission profiles 的较新版本），或 OpenAI 兼容的文字模型 API |
| FFmpeg（可选） | 导入外部音频、导出重点 MP3 时需要 |
| Obsidian（可选） | 需要自动归档时使用 |

## 快速开始

```bash
git clone https://github.com/BaoziCDR/ai-minutes.git
cd ai-minutes
npm ci
npm run build
npm start
```

打包成 macOS 应用：

```bash
npm run dist
```

安装包输出到 `release/` 目录。

> [!NOTE]
> 安装包没有做 Apple 签名和公证。如果 macOS 提示“已损坏”或“无法验证开发者”，可在确认来源可信后移除隔离属性：
>
> ```bash
> xattr -dr com.apple.quarantine "/Applications/AI 纪要.app"
> ```

## 使用说明

1. **配置语音供应商**：打开“设置与连接 → 语音供应商”，添加连接并填写凭据，点“测试音频”确认可用。在“会议转写”中选择模型，以及实时或会后模式。
2. **开始录音**：选择麦克风，新建会议并开始录音。
3. **划线批注**：在原文中选中文字，在浮动气泡里选择类型，选完即保存，备注可选。
4. **暂停 / 结束**：暂停与继续是同一个按钮。结束录制前会弹出确认。
5. **整理纪要**：会后可以回听、修改原文和发言人，然后点击“生成纪要”。

### 默认快捷键

| 操作 | 快捷键 |
| --- | --- |
| 开始 / 结束录音 | `⌘ ⇧ R` |
| 暂停 / 继续 | `⌘ ⇧ P` |
| 新建会议 | `⌘ ⌥ N` |

快捷键都可在设置中修改：点击输入框后直接按下组合键即可，`Esc` 取消，`Delete` 清除。

### 存储位置

| 内容 | 默认位置 |
| --- | --- |
| 会议数据 | `~/.ai-minutes/meetings/`（根目录可在设置中修改） |
| 应用设置与加密后的密钥 | `~/Library/Application Support/AI 纪要/` |
| Obsidian 库 | `~/basic-memory`，库内目录默认为 `会议记录`（均可修改） |

录音为 16 kHz / 16 bit / 单声道 WAV，约 115 MB/小时。

## 数据与隐私

AI 纪要是本地优先的应用，**没有自建服务器，也不收集任何遥测数据**，但为完成转写和整理，部分数据会发送给**你自己配置的**第三方服务：

| 数据 | 发送给 |
| --- | --- |
| 会议音频 | 你配置的语音供应商（如腾讯云 ASR、OpenAI 兼容接口） |
| 原文与批注 | 你选择的 AI 整理服务（Codex / 文字模型 API） |
| 复核音频片段 | 仅在配置了独立复核模型时，发送给该模型 |

- 密钥用 macOS 安全存储加密，渲染进程只能看到“已配置”状态。
- Codex 以只读、禁止联网的方式运行，只能访问本次任务的输入快照，拿不到你的语音供应商密钥。
- 录音前请征得所有参会者同意，并遵守当地法律法规和所在组织的规定。

## Obsidian 归档结构

```text
会议记录/
  会议索引.md
  2026/09/2026-09-22 项目讨论 abc123/
    会议.md          # 元信息、录音、结论和资料导航
    录音.wav
    原文.md          # 带时间戳和发言人
    重点批注.md       # 分类 callout 和备注
    纪要.md
    思维导图.md       # Mermaid
    待办.md
    决策.md
    录音复核.md       # 独立复核的结果与差异
    会议数据.json
```

同一文件系统内，录音以硬链接方式同步，不额外占用空间。这些文件由 App 生成，再次同步时会被更新；需要手工整理的内容请另建笔记。

## 开发

```bash
npm run dev            # 仅启动 Vite 前端开发服务器
npm run build          # 类型检查并构建
npm start              # 启动 Electron
npm test               # 单元测试（适配器、迁移、额度、版本、沙箱）
npm run test:desktop   # 端到端测试（界面、PCM 录音流水线、模拟语音 API）
npm run format         # Prettier 格式化
```

测试默认使用系统临时目录和合成数据，不会读取你的会议库，也不需要真实密钥。以下环境变量用于可选的真实环境验证：

| 变量 | 作用 |
| --- | --- |
| `AI_MINUTES_REAL_CLOUD=1` | 用本机已加密的腾讯配置和合成语音验证云端连接 |
| `AI_MINUTES_REAL_MIC=1` | 用当前麦克风做离线录音测试，不上传音频 |
| `AI_MINUTES_LIVE_CHECK=1` | 对已安装应用中的已配置供应商做真实调用 |
| `AI_MINUTES_DATA_DIR` | 隔离的数据目录，仅供测试使用 |

## 项目结构

```text
electron/
  main.cjs             # 应用生命周期、IPC、录音与整理调度
  tencent.cjs          # 腾讯签名、实时连接和说话人事件
  speech/              # 语音供应商注册、运行时、异步任务、音频处理
  summary.cjs          # AI 纪要生成
  review.cjs           # 独立录音复核
  obsidian.cjs         # Obsidian 自动同步和会议索引
  storage.cjs          # 数据根目录校验与迁移
  shortcuts.cjs        # 全局快捷键
src/
  main.tsx             # React 界面
  SelectionBubble.tsx  # 划线批注气泡
  SpeechSettings.tsx   # 语音供应商设置
  AudioReviewView.tsx  # 录音复核视图
  recorder.ts          # AudioWorklet 录音
public/pcm-worklet.js  # PCM 采集 worklet
tests/                 # 单元测试与 Playwright Electron 端到端测试
```

## 常见问题

<details>
<summary><b>支持 Windows 或 Linux 吗？</b></summary>

暂不支持。密钥加密、硬链接同步和打包配置都是针对 macOS 设计的，欢迎提交 PR 移植。
</details>

<details>
<summary><b>能完全离线使用吗？</b></summary>

可以。把转写接口指向 `localhost` 上的 OpenAI 兼容服务（例如本地部署的 Whisper），整理也使用本地模型 API 即可。
</details>

<details>
<summary><b>会议时长有限制吗？</b></summary>

没有人为限制。录音持续写入本地，断线后自动重连，并在原文中标记识别缺口。
</details>

## 参与贡献

欢迎提交 Issue 和 Pull Request！

1. Fork 本仓库并新建分支：`git checkout -b feat/your-feature`
2. 提交前运行 `npm test` 和 `npm run format`
3. 提交 Pull Request，说明改动内容和测试方式

## 许可证

本项目基于 [MIT License](LICENSE) 开源。

## 致谢

[Electron](https://www.electronjs.org/) · [React](https://react.dev/) · [Vite](https://vite.dev/) · [Mermaid](https://mermaid.js.org/) · [Lucide](https://lucide.dev/) · [腾讯云语音识别](https://cloud.tencent.com/product/asr) · [Codex CLI](https://github.com/openai/codex)
