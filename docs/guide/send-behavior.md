# 发送行为

::: info
**注意**：该功能在 1.3.7 及后续版本中支持。
:::

将发送快捷键改为 `Ctrl+Enter`（macOS 下为 `⌘+Enter`），`Enter` 键变为换行，让你在撰写多行提示词时更加从容。

## 为什么需要这个功能

默认按下 `Enter` 即发送消息。这在编写较长的 prompt、粘贴多行代码、或需要精心排版时，经常导致误发——你只想换个行，消息却已经飞出去了。

开启后：

- **Enter** → 插入换行
- **Ctrl+Enter**（macOS: **⌘+Enter**） → 发送消息

Shift+Enter 和输入法组合输入保持网站自身的行为；如果附件仍在上传，Ctrl/⌘+Enter 会等待上传完成后再发送。

## 如何开启

1. 打开 Voyager 弹窗。
2. 在 **输入** → **Ctrl/Cmd+Enter 发送** 中将其开启。

## 其他网站

- **AI Studio** 的逻辑相反：开启 **AI Studio Enter 发送**，即可用 `Enter` 发送，并用 `Ctrl/⌘+Enter` 换行。
- **Claude、ChatGPT、DeepSeek、Kimi 和 Grok**：在该网站打开 Voyager 弹窗，在 **插件** 卡片里开启 **Ctrl/⌘+Enter 发送**。各网站的插件见[插件一览](/guide/plugins)。
- **Safari**：如果 Gemini 需要按两次回车才能发送，请开启 **修复 Safari 回车键**。

## 功能特点

- **零性能开销**：关闭时不监听任何键盘事件，不影响页面性能。
- **实时切换**：在设置中开关后立即生效，无需刷新页面。
