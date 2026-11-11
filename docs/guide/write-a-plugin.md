# 编写自己的插件

创造模式能把一句话变成插件：你说想改什么，AI 来写插件，Voyager 检查后再启用。它在 Voyager 面板的「创造」页和 Voyager popup 的「我的创造」卡片里，做出来的是本地插件。

本地插件是你给自己做的插件：它改变 Gemini、AI Studio、ChatGPT、Claude、DeepSeek 或 Kimi 的外观和布局，只存在于你的浏览器里，不需要提 PR，也不需要 Voyager 的源码。

大多数创造是声明式的：一个 `plugin.json` 清单加上 CSS，本身不运行任何代码。Voyager 在导入时检查它、应用它的改动，关掉时撤销全部改动。导入的插件默认是关闭的，你可以先看一遍再打开。需求非得用代码时，AI 可以写一个会运行代码的创造，见下文。

## 在页面上创造

最快的做法就在插件要用的那个 AI 网站上：在那里打开 [Voyager 面板](./panel.md)，选择「创造」。

1. 在「想改什么？」下面写一句话，选择「在此页创造」。
2. Voyager 会在这个网站新建一个对话，把请求填进输入框。检查后再自己发送，Voyager 不会替你按发送。如果输入框里已经有内容，Voyager 不会动它，并提示你。
3. AI 读完 Voyager 为该网站准备的说明页，回复一个 JSON 代码块。代码块下方会出现 Voyager 的「预览并安装」。
4. 点它，面板会打开审阅：插件在哪些网站生效、每一处改动、完整的 CSS，以及需要先留意的地方。选择「安装并开启」，插件立即生效。

想再改，直接在同一个对话里告诉 AI。新回复下方会出现「预览更新」，旧的代码块标为「较早的版本」。Voyager 装不了某个回复时，会改为提供「把问题发回给 AI」：问题会填进输入框，接在你已输入的内容后面，由你来发送。

Voyager 只在你的消息带有 Voyager 创造页链接的对话里读取回复，「在此页创造」填入的请求总会带上它。其他对话的回复下方什么都不会出现，请用下面 popup 里的做法。「创造」页里也有「复制给本地 Agent」。

## 另外三种做法

三种做法最后都回到「我的创造」。在 Gemini 和 AI Studio 上，它是一张设置卡片，默认紧挨在「云同步」下面，你也可以调整它的位置；popup 顶部的「跳到」目录能直接跳过去。在 ChatGPT、Claude、DeepSeek 和 Kimi 上，它在插件列表下方。插件列表末尾的「自己创造一个」会直接带你到它的输入框。

前两种做法都从一句话开始。在「想改什么？」下面写一句话（例如「把我的消息变窄，并隐藏侧边栏」）。下方的「网站」默认是当前标签页的网站；插件要用在别的网站上时，改一下即可。

### 复制到当前对话

1. 选择「复制到当前对话」，把消息粘贴到该网站的 AI 对话里。
2. AI 会先读 Voyager 为该网站准备的说明页（例如 `https://voyager.nagi.fun/create/claude.md`），然后只回复一个 JSON 代码块。AI 需要能打开链接。
3. 把完整回复粘贴到「粘贴 AI 的回复」，选择「检查回复」。
4. Voyager 会用大白话说明这个插件改了什么。选择「导入」，再到插件列表里打开它。在 Gemini 和 AI Studio 上，它的开关就在卡片下方。

Voyager 自己不发送任何东西。消息由你粘贴过去，回复也由你带回来。

### 复制给本地 Agent

如果你在用编程 Agent（Claude Code、Codex、Cursor 等），选择「复制给本地 Agent」，把这段文字交给它。文字会让 Agent 按照 Voyager 的插件 skill 来写：

```text
https://voyager.nagi.fun/skills/write-voyager-plugin/SKILL.md
```

这个 skill 包含完整的约定：清单字段、每个网站声明了什么、可用的原语，以及插件做不到的事。Agent 会写好 `plugin.json` 和 `style.css`，运行 `npx create-voyager-plugin@latest check` 直到通过，再把两个文件交回给你。在「我的创造」里展开「更多添加方式」，选择「导入文件」，选中这两个文件即可。

想让 Agent 一直带着这个 skill，可以把文件保存为 Agent skills 目录下的 `write-voyager-plugin/SKILL.md`（Claude Code 是 `~/.claude/skills/`）。

### 自己动手写

需要 Node.js 18 或更新版本：

```sh
npx create-voyager-plugin@latest init my-plugin --site claude
# 编辑 my-plugin/plugin.json 和 my-plugin/style.css
npx create-voyager-plugin@latest check my-plugin
```

`init` 会写出一个已经能通过检查的 `plugin.json` 和 `style.css`，外加一份写有该网站规则的 `AGENTS.md`。`--site` 可选 `gemini`、`aistudio`、`chatgpt`、`claude`、`deepseek` 或 `kimi`。

`check` 离线运行和 popup 导入完全相同的检查。插件能导入时退出码为 0，否则每个问题输出一行 `path: message`。加 `--json` 可得到机器可读的输出。

检查通过后，同样在「更多添加方式」里用「导入文件」导入这两个文件。

## 插件能做什么

- 添加 CSS，作用域限定在插件给页面加上的 `gv-` 类名下。
- 添加类名、设置安全的属性或内联样式、隐藏元素。目标可以是网站声明的语义锚点（`userTurn`、`assistantTurn`、`composer` 等），也可以是 CSS 选择器。
- 在 popup 里提供设置：开关、滑块和下拉框，设置值通过 `{{key}}` 写进 CSS。
- 在 ChatGPT、Claude、DeepSeek 和 Kimi 上，启用 Voyager 的原语（公式复制、时间轴、Mermaid 图表等），并给 Voyager 自己的界面换色。

## 插件做不到什么

声明式插件不能运行 JavaScript，不能响应点击或按键，不能从网络加载任何东西（字体、图片、样式表），不能读取或改写消息内容，也不能在其他网站上运行。只有代码才能做到时，AI 会写一个会运行代码的创造，见下文。任何创造都不能在其他网站上运行，也不能改 Voyager 自己的设置；遇到这类需求，写作材料会让 AI 直接说明，并做出最接近、能实现的版本。

## 会运行代码的创造

CSS 和页面改动做不到的需求，比如统计你发了几条消息、点一下就做点什么，AI 可以写一个运行 JavaScript 的创造。Voyager 通过 Chrome 的用户脚本运行它，只在它列出的网站上运行，而且要等你读过代码之后。

### 打开它

审核时，这类创造带有「运行代码」标记。

- **先读代码**：审核会列出它运行的网站，并完整显示源码。它能读到这些页面上的一切，Voyager 也拦不住它把读到的内容发到别处，所以只安装你信得过的代码。
- **安装并开启**：开启的正是你读过的这份代码。AI 之后给的新版本会保持关闭，等你重新审核；这个开关也不会同步到你的其他设备。
- **一次性开关**：Chrome 要你允许之后，扩展才能运行这类代码。点「打开 Voyager 详情页」，在那里打开「允许用户脚本」（Allow User Scripts；Chrome 138 之前是 `chrome://extensions` 顶部的「开发者模式」），回来再点「我已开启」。
- **浏览器**：桌面版 Chrome 或 Edge 133 及以上。在 Safari、Firefox 和手机上，它会保留但处于暂停状态；可以让 AI 改成只改外观的版本。

### 随时可控

在「我的创造」里，每个创造都会显示「已开启，仅限这台设备」「已关闭」或「已暂停」及原因。

- **全部停止**：在「我的创造」末尾（popup 里的卡片，或面板的「功能」页）点「停止所有运行代码的创造」，会一次停下全部；点「恢复」重新启用。
- **已打开的页面**：已经打开的页面会继续运行它们，直到重新加载。点「刷新这个页面」就能重新加载当前标签页。
- **页面卡死**：如果这些创造运行后页面失去响应，Voyager 会关掉它们，并在页面下次加载时用通知写明是哪几个。修好之后，在「我的创造」里重新审核，再打开。

## 导入时检查的规则

除了通用的清单检查（见[插件贡献说明](./plugin-contribution.md)），本地插件还必须：

- 只匹配 Voyager 支持的网站范围内的 URL；
- 只使用每个匹配网站都声明了的语义锚点；
- 每个 `addClass` 只加一个类名，并以 `gv-` 开头；
- 只使用 boolean、number 或 select 设置（string 和 color 目前在 popup 里还没有对应控件）；
- 在 Gemini 和 AI Studio 上不使用 `theme`；原语只能用该站点放开的：Gemini 上是 `formulaCopy`、`vimInput`、`userLatex`、`codeCollapse`、`mermaid`、`wavedrom` 和 `echarts`、`sendShortcut`、`draftSave`、`turnNavigator`，AI Studio 上是 `formulaCopy`、`sendShortcut`。它们与 Voyager 自带的对应设置是同一套代码。`formulaCopy` 和 `vimInput`（「公式复制」「输入框 Vim 模式」）在同一页面上，自带设置和插件只运行其中一个：页面刚加载、或两者都没在运行时，自带开关优先；之后谁已经在运行就继续运行，另一方显示为暂停。关掉其中一个，功能就交给另一个。`userLatex`、`codeCollapse`、`mermaid`、`wavedrom` 和 `echarts` 按元素逐个认领，可以和自带设置同时运行：对方已经处理的行或代码块留给对方。

Gemini 个人版现已支持本地 `turnNavigator`：设置 `params.dataBackend: "shared"` 和 `engine: ">=1.9.0"`，即可读写官方时间线的同一份星标和层级数据；不能重写会话、账号或轮次的身份参数。官方「显示时间线」开启时会发生冲突：先关官方开关，再启用本地插件；返回官方时，先停用本地插件，再开官方开关。Business、Enterprise 和自定义网站范围暂不开放。

翻译（`i18n`）是可选的。

## 分享

本地插件只存在于你的浏览器里。需要换到别处时，在「我的创造」列表里对它选择「导出」，再到那边导入这个 JSON 文件。如果它对大家都有用，可以提议收进官方插件目录，流程见[插件贡献说明](./plugin-contribution.md)。

发送快捷键插件在所有站点每页只能运行一个；已有插件占用发送模式时，另一个显示冲突并暂停。可选 `mode`（需要 `"engine": ">=1.9.0"`）为 `ctrlEnterSends`（默认）或 `enterSends`。输入法确认键不会触发发送。Gemini 和 AI Studio 现已开放，具体模式见下文。

Gemini 现在允许 `sendShortcut` 替代官方 Ctrl+Enter 发送；关闭官方开关后启用本地插件。只支持 `ctrlEnterSends`，Enterprise 不运行。公开的 `composerRoot` 区分主框和编辑框，`sendButton` 不包含停止按钮。

AI Studio 上使用 `sendShortcut` 时必须设置 `params.mode: "enterSends"`。关闭官方 Enter 发送开关后，本地插件可以接管；Ctrl/Cmd+Enter 换行，Shift/Alt+Enter 由宿主处理。

Gemini 的 `draftSave` 与官方草稿保存共用 `gvDraft_<完整 pathname>`，保留 `/u/N` 和 Gem 路径。关闭插件会保留已保存的草稿；同页多个插件可以共同使用这些记录。卸载前会尽力保存最后输入，浏览器关闭时不能保证异步存储完成。写入和修剪只在同页协调；同一个 `/u/N` 槽位换邮箱仍共用已存草稿。
