# 彻底自由

Voyager 导出功能可以把任何 Gemini、ChatGPT、Claude、DeepSeek 或 Kimi 对话下载为 Markdown、PDF、JSON 或图片文件。它会完整提取对话内容，包括代码块、图片和格式，让你为每一段 AI 对话都保留一份永久、可随身携带的副本。

数据被锁死，是最坏的体验。
我们信条很简单：你创造的，就是你的。

## 格式对比

| 特性     | Markdown                     | PDF                 | JSON             | 图片         |
| -------- | ---------------------------- | ------------------- | ---------------- | ------------ |
| 最适合   | 笔记应用（Obsidian、Notion） | 分享和打印          | 开发者、数据分析 | 在手机上分享 |
| 图片     | 嵌入                         | 完整包含            | Base64 编码      | 原位渲染     |
| 代码块   | 保留语法高亮                 | 视觉渲染            | 保留原始文本     | 视觉渲染     |
| 文件大小 | 最小                         | 最大                | 中等             | 较大         |
| 可搜索性 | 纯文本                       | 可用 PDF 阅读器搜索 | 可通过程序访问   | 不可搜索     |

## 带走一切

Voyager 帮你把数据从云端拽回手心。

### 格式随你选

- **Markdown**：给 Obsidian 或 Notion 用。干净清爽，并可嵌入图片。
- **PDF**：发给别人或打印。排版精美，图文并茂。
- **JSON**：给开发者。原始数据，怎么玩随你。
- **图片**：一张长 PNG，发手机上分享正合适。版式有窄、中、宽三种可选。

### 怎么导

1. 点击 **导出** 按钮（ChatGPT、Claude、DeepSeek、Kimi 与当前的 Gemini 布局）。它默认在页面右上角，可以拖到任意位置，每个网站分别记住；拖回默认位置附近会自动归位。在 Gemini 上，也可以从对话或回复的 ⋮ 菜单选择 **导出对话记录**；旧版 Gemini 布局则把鼠标悬停在 Gemini Logo 上，即可看到出现的 **导出图标**。
2. 选格式。
3. 拿走。

在 Claude、DeepSeek 和 Kimi 上，导出是一个默认关闭的插件：先在弹窗的 **插件** 里打开它。长对话由 Voyager 滚动一遍读全，读完后所有消息默认都已勾选，取消不要的即可；如果没能确认读到开头和结尾，会提示导出内容可能不完整。在 ChatGPT 上没能读到完整历史时，会提示向上滚动加载更早的消息后重试。切换到别的对话会中止导出，在 Claude 上开始生成新回复也会。

ChatGPT 对话里上传的文件，会在导出内容里以 `📎 文件名` 一行列出。

你的数据，听你的。

<div style="display: flex; gap: 20px; margin-top: 20px;">
  <div style="flex: 1; text-align: center;">
    <p><b>1. 找到导出</b></p>
    <img src="/assets/gemini-export-guide-1.png" alt="导出指南步骤 1" style="border-radius: 8px; box-shadow: 0 4px 12px rgba(0,0,0,0.1);"/>
  </div>
  <div style="flex: 1; text-align: center;">
    <p><b>2. 选格式</b></p>
    <img src="/assets/gemini-export-guide-2.png" alt="导出指南步骤 2" style="border-radius: 8px; box-shadow: 0 4px 12px rgba(0,0,0,0.1);"/>
  </div>
</div>

### Safari PDF 导出特别说明

在 Safari 上导出 PDF 步骤略有不同（需手动打印）：

1. 点击 **导出** 按钮，选择 PDF 格式。
2. **等待一秒左右**（让页面准备好打印样式）。
3. 按 `Command + P` 调出打印界面。
4. 在打印界面中选择 **"Save to PDF"**（或 "存储为 PDF"）。

<img src="/assets/safari-export-pdf.png" alt="Safari Export PDF" style="max-width: 100%; border-radius: 8px; box-shadow: 0 4px 12px rgba(0,0,0,0.1); margin-top: 20px;"/>

## 深度研究导出

Gemini 的深度研究模式会生成包含来源、思考步骤和引用的结构化报告。Voyager 可以导出这些会话，并完整保留其中的元数据：

1. 打开一段已完成的深度研究对话。
2. 打开报告的 **分享与导出** 菜单，选择 **保存报告**。
3. 选择格式。
4. 导出内容包括最终报告及其来源链接。如果还想保存思考过程，请参阅 [深度研究导出](/guide/deep-research)。

这对学术研究、竞品分析和技术文档很有用，因为你需要保留完整的推理链条和来源出处。

## 什么时候导出

- **知识归档**：在重要对话被埋进历史记录之前，先把它们保存下来。
- **团队分享**：把一次调试过程导出为 PDF，发给不使用 Gemini 的同事。
- **建立知识库**：以 Markdown 导出对话，并在 Obsidian 或 Notion 中整理。
- **数据分析**：用 JSON 导出，以编程方式分析对话模式或提取结构化数据。
- **合规与审计**：保留 AI 辅助决策的记录，形成审计追踪。

## 支持的平台

导出功能支持 Gemini 和 ChatGPT，覆盖 Chrome、Edge、Firefox、Safari、Opera 和 Brave。Claude、DeepSeek 和 Kimi 的导出是插件，默认关闭，在 **插件** 里打开。在 Safari 上，PDF 导出需要手动打印（点击导出后，再按 Command+P）；Markdown 和 JSON 导出仍会包含图片。
