# 编写自己的插件

只想用一句话做插件，请看 [创造模式](./create-mode.md)：网站上的 AI 来写，Voyager 检查后装上。这一页讲另外两条路：交给你电脑上的编程 Agent，或者自己动手写，以及插件格式的规则。

本地插件是你给自己做的插件：它改变 Gemini、AI Studio、ChatGPT、Claude、DeepSeek 或 Kimi 的外观和布局，只存在于你的浏览器里，不需要提 PR，也不需要 Voyager 的源码。

大多数插件是声明式的：一个 `plugin.json` 清单加上 CSS，本身不运行任何代码。Voyager 在导入时检查它、应用它的改动，关掉时撤销全部改动。导入的插件默认是关闭的，你可以先看一遍再打开。需求非得用代码时，可以写一个[会运行代码的创造](./create-mode.md#会运行代码的创造)。

两条路最后都在 **我的创造** 里导入：展开 **更多添加方式**，选 **导入文件**，选中 `plugin.json` 和 `style.css`。

## 复制给本地 Agent

如果你在用编程 Agent（Claude Code、Codex、Cursor 等），在面板的 **创造** 分页或弹窗的 **我的创造** 里写一句话，选 **复制给本地 Agent**，把这段文字交给它。文字会让 Agent 按照 Voyager 的插件 skill 来写：

```text
https://voyager.nagi.fun/skills/write-voyager-plugin/SKILL.md
```

这个 skill 包含完整的约定：清单字段、每个网站声明了什么、可用的原语，以及插件做不到的事。Agent 会写好 `plugin.json` 和 `style.css`，运行 `npx create-voyager-plugin@latest check` 直到通过，再把两个文件交回给你，由你用 **导入文件** 导入。

想让 Agent 一直带着这个 skill，可以把文件保存为 Agent skills 目录下的 `write-voyager-plugin/SKILL.md`（Claude Code 是 `~/.claude/skills/`）。

## 自己动手写

需要 Node.js 18 或更新版本：

```sh
npx create-voyager-plugin@latest init my-plugin --site claude
# 编辑 my-plugin/plugin.json 和 my-plugin/style.css
npx create-voyager-plugin@latest check my-plugin
```

`init` 会写出一个已经能通过检查的 `plugin.json` 和 `style.css`，外加一份写有该网站规则的 `AGENTS.md`。`--site` 可选 `gemini`、`aistudio`、`chatgpt`、`claude`、`deepseek` 或 `kimi`。

`check` 离线运行和弹窗导入完全相同的检查。插件能导入时退出码为 0，否则每个问题输出一行 `path: message`。加 `--json` 可得到机器可读的输出。

检查通过后，同样在 **更多添加方式** 里用 **导入文件** 导入这两个文件。

## 插件能做什么

- 添加 CSS，作用域限定在插件给页面加上的 `gv-` 类名下。
- 添加类名、设置安全的属性或内联样式、隐藏元素。目标可以是网站声明的语义锚点（`userTurn`、`assistantTurn`、`composer` 等），也可以是 CSS 选择器。
- 在弹窗里提供设置：开关、滑块和下拉框，设置值通过 `{{key}}` 写进 CSS。
- 在 ChatGPT、Claude、DeepSeek 和 Kimi 上，启用 Voyager 的原语（公式复制、时间轴、Mermaid 图表等），并给 Voyager 自己的界面换色。在任何网站上，都可以用 `:root` 上的 `--gv-theme-*` 变量给 Voyager 换配色，见 [创造模式](./create-mode.md#给-voyager-换配色)。

## 插件做不到什么

声明式插件不能运行 JavaScript，不能响应点击或按键，不能从网络加载任何东西（字体、图片、样式表），不能读取或改写消息内容，也不能在其他网站上运行。只有代码才能做到时，可以写一个会运行代码的创造。任何创造都不能在其他网站上运行，也不能改 Voyager 自己的设置；遇到这类需求，写作材料会让 AI 直接说明，并做出最接近、能实现的版本。

## 导入时检查的规则

除了通用的清单检查（见[插件贡献说明](./plugin-contribution.md)），本地插件还必须：

- 只匹配 Voyager 支持的网站范围内的 URL；
- 只使用每个匹配网站都声明了的语义锚点；
- 每个 `addClass` 只加一个类名，并以 `gv-` 开头；
- 只使用 boolean、number 或 select 设置（string 和 color 目前在弹窗里还没有对应控件）；
- 在 Gemini 和 AI Studio 上不使用 `theme`；原语只能用该站点放开的：Gemini 上是 `formulaCopy`、`vimInput`、`userLatex`、`codeCollapse`、`mermaid`、`wavedrom` 和 `echarts`、`sendShortcut`、`draftSave`、`turnNavigator`，AI Studio 上是 `formulaCopy`、`sendShortcut`。它们与 Voyager 自带的对应设置是同一套代码。`formulaCopy` 和 `vimInput`（「公式复制」「输入框 Vim 模式」）在同一页面上，自带设置和插件只运行其中一个：页面刚加载、或两者都没在运行时，自带开关优先；之后谁已经在运行就继续运行，另一方显示为暂停。关掉其中一个，功能就交给另一个。`userLatex`、`codeCollapse`、`mermaid`、`wavedrom` 和 `echarts` 按元素逐个认领，可以和自带设置同时运行：对方已经处理的行或代码块留给对方。

翻译（`i18n`）是可选的。

### 时间线与发送、草稿原语

Gemini 个人版现已支持本地 `turnNavigator`：设置 `params.dataBackend: "shared"` 和 `engine: ">=1.9.0"`，即可读写官方时间线的同一份星标和层级数据；不能重写会话、账号或轮次的身份参数。官方「显示时间线」开启时会发生冲突：先关官方开关，再启用本地插件；返回官方时，先停用本地插件，再开官方开关。Business、Enterprise 和自定义网站范围暂不开放。

发送快捷键插件在所有站点每页只能运行一个；已有插件占用发送模式时，另一个显示冲突并暂停。可选 `mode`（需要 `"engine": ">=1.9.0"`）为 `ctrlEnterSends`（默认）或 `enterSends`。输入法确认键不会触发发送。Gemini 和 AI Studio 现已开放，具体模式见下文。

Gemini 现在允许 `sendShortcut` 替代官方 Ctrl+Enter 发送；关闭官方开关后启用本地插件。只支持 `ctrlEnterSends`，Enterprise 不运行。公开的 `composerRoot` 区分主框和编辑框，`sendButton` 不包含停止按钮。

AI Studio 上使用 `sendShortcut` 时必须设置 `params.mode: "enterSends"`。关闭官方 Enter 发送开关后，本地插件可以接管；Ctrl/Cmd+Enter 换行，Shift/Alt+Enter 由宿主处理。

Gemini 的 `draftSave` 与官方草稿保存共用 `gvDraft_<完整 pathname>`，保留 `/u/N` 和 Gem 路径。关闭插件会保留已保存的草稿；同页多个插件可以共同使用这些记录。卸载前会尽力保存最后输入，浏览器关闭时不能保证异步存储完成。写入和修剪只在同页协调；同一个 `/u/N` 槽位换邮箱仍共用已存草稿。
