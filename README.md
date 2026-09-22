# AI 纪要 · AI Minutes

React + TypeScript + Electron 编写的 macOS 会议 App。腾讯云实时分人转写，Codex 或 OpenAI 兼容 API 会后整理。

## 日常使用

1. 在“设置与连接 → 语音识别”填写腾讯 SecretId、SecretKey，自动获取 AppID 并测试连接。
2. 选择麦克风，新建会议、开始录音。快捷键可在设置中修改。
3. 在原文中划线，浮动气泡提供 **重点、待办、决策、疑问** 四类图标。选类型即保存，不必填备注；需要时展开备注框，完成或点击外部时保存。
4. 暂停／继续共用一个操作。点击或通过快捷键结束录制时，会先弹出确认，取消后继续录音。
5. 会后可回听、修改原文与人员姓名。点击“生成纪要”，得到结构化纪要、思维导图、待办及决策。

## 保存与自动关联

- 默认会议数据根目录：`~/.ai-minutes`，可在设置中修改。会议保存在其 `meetings/` 下。
- 切换根目录前需结束录制和整理。已有会议复制到新根目录，旧目录保留作为备份；不会覆盖目标中的同 ID 数据，也不允许把用户数据放进源码或 Git 仓库。
- 默认 Obsidian 库：`~/basic-memory`。可以选择其他现有库，库内会议目录默认“会议记录”。
- 每场会议自动建立入口页，录音、原文和分类批注自动关联；AI 结果生成后自动同步。无需点击导入按钮。
- 默认按“年 / 月 / 日期＋主题＋短 ID”组织。修改会议标题不改变已建立的目录，避免重复归档。
- 同一文件系统内，Obsidian 录音采用硬链接，录制中持续更新且不重复占用音频空间；跨文件系统时录制结束后复制录音。
- 同步失败时保留本地数据，并在会议页显示原因及重试入口。更改库路径后会自动关联已有会议。

典型 Obsidian 结构：

```text
会议记录/
  会议索引.md
  2026/09/2026-09-22 项目讨论 abc123/
    会议.md            # 元信息、录音、结论和资料导航
    录音.wav
    原文.md            # 时间戳和发言人，可被纪要引用
    重点批注.md         # 分类 callout 和备注
    纪要.md
    思维导图.md         # Mermaid
    待办.md
    决策.md
    会议数据.json
```

再次自动同步会更新这些由 App 生成的文件；需要保留独立手工编辑时，请另建笔记。删除 App 内会议会移入废纸篓，已经关联的 Obsidian 文件保留。

## 设置与密钥

设置界面尺寸固定，内容区内部滚动。支持识别配置、录音设备、全局快捷键、AI 整理、保存目录、Obsidian 库和外观。

腾讯及文字模型密钥使用 macOS 安全存储加密；界面只返回“已配置”，导出和源码不包含密钥。应用偏好及加密设置由 Electron 放在用户的 Application Support 目录中，会议数据遵循上方可配置根目录。

默认快捷键（macOS 上 CommandOrControl 即 ⌘）：

- 开始／结束：`CommandOrControl+Shift+R`
- 暂停／继续：`CommandOrControl+Shift+P`
- 新建会议：`CommandOrControl+Alt+N`

留空可禁用，保存时检测格式、重复和占用。快捷键会打开 App；结束录制与按钮使用相同的确认流程。

## 音频与整理

录音为 16 kHz / 16 bit / 单声道 WAV，约 115 MB／小时。支持导入音频、倍速回听、按原文定位、导出重点 MP3。导入与重点音频需要 FFmpeg，可配置其路径。

Codex 使用本机已有登录，通过 `codex exec` 只读整理输入，结果由 App 保存。选择 ChatGPT 登录时使用对应 Codex 额度；也可以配置自有文字模型 API。录音上传至配置的腾讯服务，原文及批注在会后提交给所选整理服务。

不人为限定会议长度。断线仍保留录音，自动重连并标记识别缺口；意外退出后恢复已写入数据。真实收音、说话人识别和网络延迟取决于现场条件。

## 开发与验证

Node.js 22+，macOS Apple Silicon。

```sh
npm ci
npm run build
npm start
npm test
npm run test:desktop
npm run dist
```

安装包输出到 `release/`。单元与桌面测试全部使用系统临时目录及合成资料，不读取用户会议库，不包含真实密钥。`AI_MINUTES_DATA_DIR` 仅供隔离测试使用；配置文件位于该目录，默认测试数据位于其 `data/` 子目录。

- `electron/main.cjs`：桌面生命周期、IPC、录音与整理调度。
- `electron/tencent.cjs`：腾讯签名、实时连接和说话人事件。
- `electron/obsidian.cjs`：自动关联、结构化页面、会议索引。
- `electron/storage.cjs`：保存根目录校验和迁移。
- `electron/shortcuts.cjs`：全局快捷键注册和校验。
- `src/SelectionBubble.tsx`：划线气泡、类型和可选备注。
- `src/main.tsx`、`src/styles.css`：React 界面和主题。

为兼容前一版本，保留原 bundle ID，显示名称为“AI 纪要”，英文名“AI Minutes”。升级时保留旧版用户数据。安装包未申请 Apple 公证，适合本机使用。
