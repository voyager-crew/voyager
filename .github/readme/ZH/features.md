# ✨ 功能特性

## 🌌 通用核心 (Gemini & AI Studio)

- **📂 [文件夹管理](https://voyager.nagi.fun/guide/folders)**: 支持 **最多三级的文件夹层级**，并可拖拽整理对话。
  - **Gemini**: 支持 **多账号隔离模式** 及 **自定义文件夹颜色**。
- **💡 [提示词库](https://voyager.nagi.fun/guide/prompts)**: 跨平台同步提示词，支持 Gemini、AI Studio 及 [自定义网站](https://voyager.nagi.fun/guide/prompts#任何网站皆可用)。
- **☁️ [云同步](https://voyager.nagi.fun/guide/cloud-sync)**: 通过 Google Drive 同步文件夹和提示词，Safari 上还可使用 iCloud。
- **🗑️ [批量删除](https://voyager.nagi.fun/guide/batch-delete)**: 批量删除对话。
- **📐 [公式复制](https://voyager.nagi.fun/guide/formula-copy)**: 点击公式即可复制为 LaTeX、MathML（Word）或适用于 Notion 的公式。

## ✨ Gemini 专属增强

- **📍 [时间线导航](https://voyager.nagi.fun/guide/timeline)**: 可视化节点，瞬间跳转消息，星标重点，管理对话分支。
- **💾 [对话导出](https://voyager.nagi.fun/guide/export)**: 支持导出为 JSON、Markdown、PDF 或图片，并包含图片内容。
- **🧜‍♀️ [Mermaid 渲染](https://voyager.nagi.fun/guide/mermaid)**: 自动渲染流程图、时序图等 Mermaid 图表。
- **📝 [Markdown 渲染修复](https://voyager.nagi.fun/guide/markdown-fix)**: 自动修复 Gemini 注入 HTML 导致的 Markdown 加粗失效问题。
- **🍌 [Image Refinement](https://voyager.nagi.fun/guide/nanobanana)**: 自动去除 Gemini 生成图片的无损水印。
- **🔬 [Deep Research](https://voyager.nagi.fun/guide/deep-research)**: 一键提取 Deep Research 对话的思考过程和研究链接。
- **🛠️ 效率工具**:
  - **[引用回复](https://voyager.nagi.fun/guide/quote-reply)**: 选中对话文本即可一键引用回复。
  - **[防自动跳转](https://voyager.nagi.fun/guide/prevent-auto-scroll)**: 拦截每次发送新问题后页面强制滚动到底部的内置行为，找回丝滑体验。
  - **[输入框折叠](https://voyager.nagi.fun/guide/input-collapse)**: 输入框自动收纳，释放阅读空间。
  - **[默认模型](https://voyager.nagi.fun/guide/default-model)**: 为新对话设置默认选中的模型。

## 🔌 Claude, ChatGPT, DeepSeek & Kimi

通过 [Voyager 插件引擎](https://voyager.nagi.fun/guide/plugins)，这些功能让你的体验延伸到 Gemini 之外。在扩展弹窗中开启它们，并分别授权每个网站：

- **📍 时间线**: 在 ChatGPT、Claude 和 DeepSeek 上提供同样的时间线，支持星标消息和搜索；默认关闭，需手动开启。
- **📂 文件夹**: 在 ChatGPT、Claude、DeepSeek 和 Kimi 上把对话整理到文件夹中。ChatGPT 文件夹默认开启。
- **💾 导出**: 在 ChatGPT、Claude、DeepSeek 和 Kimi 上将对话导出为 Markdown、JSON、PDF 或图片。
- **📐 公式复制**: 在 Claude、ChatGPT 和 DeepSeek 上点击公式即可复制其 LaTeX。
- **⌨️ Vim 输入**: 在 Claude、ChatGPT 和 DeepSeek 的输入框中使用 Vim 风格的模态编辑和光标移动。
- **📖 舒适阅读宽度**: 调整 Claude、ChatGPT、DeepSeek 和 Kimi 的对话宽度，获得更好的阅读体验。
- **💬 日常小工具**: 在 Claude、ChatGPT、DeepSeek 和 Kimi 上提供引用回复、Ctrl/⌘+Enter 发送和草稿字数统计；在 Claude、DeepSeek 和 Kimi 上还提供草稿自动保存。
- **🈶 CJK 渲染修复**: 修复 Claude 上的中日韩字符渲染问题。
- **📜 代码不换行**: DeepSeek 上的长代码行改为横向滚动，缩进不会被折断。

## 🧩 任意站点，包括本地

在扩展弹窗里添加任意网站，Prompt Manager 就会跟到那里，本地应用也一样。下图是它运行在 `localhost:3080` 的 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 里：

<p align="center">
  <img src="../../../docs/public/assets/prompt-manager-deepseek-harness.png" alt="在 DeepSeek Harness 中运行的 Prompt Manager" width="720">
</p>

## 🎨 个性化体验

- **🌦️ 视觉特效**: 用 **飘雪**、**电影感雨滴** 或 **樱花飘落**，为 Voyager 运行的每个网站增加季节氛围。
- 在 Gemini / AI Studio 上，点击插件图标，打开 **页面版面** → **视觉特效**，再在该行下选择 `飘雪`、`樱花` 或 `雨滴`；关闭该开关即可关闭特效。在 Claude、ChatGPT、DeepSeek 和自定义网站上，同一行位于该网站的 **插件** 卡片中。
- 特效以轻量全屏覆盖层呈现，不会阻挡页面交互。
- 切换特效或关闭时，粒子会自然退场，不会突兀消失。
