# 插件贡献说明

Voyager 的插件系统优先支持声明式插件：用 `plugin.json` 描述插件信息和 DOM 操作，用 CSS 描述样式。插件本身不运行远程 JavaScript，而是由 Voyager 内置的插件引擎解释这些数据。

这让插件更容易审核和维护。如果你想贡献一个插件，建议先从这个方向开始。

## 只给自己用：本地插件

只在自己浏览器里用的插件不需要走这套流程。把它做成本地插件，在 popup 里导入即可：不用提 Issue、不用提 PR，也不用拉取仓库。[编写自己的插件](./write-a-plugin.md)介绍了三种做法，包括 `create-voyager-plugin` 检查工具和给编程 Agent 用的 skill。

## 推荐路径

1. 先确认它适合做成插件：阅读宽度、排版修复、主题微调、隐藏/标记页面元素、简单的站点适配，通常都适合声明式插件。
2. 先在 Voyager 主仓库提交 Issue，说明它解决的问题、目标网站、和现有插件相比的区别；等待维护者明确同意方案后再编码和提交 PR。
3. 使用 `plugin.json` 写插件元信息、匹配站点和贡献内容。
4. 将样式放进同目录的 `style.css`，再由 `plugin.json` 的 `contributes.styles` 引用。
5. 本地测试后提交 PR，并附上测试页面、截图或录屏。维护者会根据插件成熟度决定是否进入官方 catalog。

## 目录结构

官方内置插件都放在 `src/features/plugins/catalog/` 下面，一个插件平台一个目录：

```
src/features/plugins/catalog/
  marketplace.json                        手动维护的站点插件索引，由测试校验
  sites/<site>/site.json                  站点适配器（数据形式）
  sites/<site>/plugins/<id>/plugin.json   一个声明式插件
  sites/<site>/plugins/<id>/style.css     它的样式
  sites/<site>/plugins/<id>/README.md     它修了什么、为什么这么修
```

发现过程是自动的：`catalog/sites/index.ts` 用 `import.meta.glob` 找出每个 `site.json` 和每个 `plugin.json`，所以新增站点或插件就是新增文件，没有映射表需要维护。

`marketplace.json` 不是那张映射表，它只是手动维护的站点插件索引；有测试保证它和自动发现的结果一致，所以新插件还要在里面加一条（`bun run plugin:new` 会替你追加），`source` 写 catalog 相对路径，例如 `sites/deepseek/plugins/reading-width/plugin.json`。`sites/gemini/` 和 `sites/aistudio/` 下的插件是例外：它们随 Voyager 打包，不进 `marketplace.json`。文档站的[插件一览](/guide/plugins)直接从磁盘读取各插件的清单，不读这个文件。

插件的 `matches` 必须落在所属站点的 `matches` 范围内；越界的插件会让构建失败。

## 语义选择器键

`site.json` 把一组固定的语义键映射到站点自己的 CSS 选择器。这组词表定义在 `src/features/plugins/sites/semanticKeys.ts`，`site.json` 只能使用表内的键，用了表外的键会被拒绝。

- `userTurn`：用户消息容器。
- `assistantTurn`：助手消息容器。
- `thinkingBlock`：助手回答里的思考段落。
- `codeBlock`：渲染后的代码块。
- `composer`：用户输入框。
- `sidebar`：会话列表或导航栏。
- `sidePanel`：次级面板，例如 artifacts 或 canvas。
- `headerActions`：会话页右上角的操作区。
- `scrollContainer`：负责滚动会话的元素。
- `composerRoot`：输入框及其操作按钮所在的容器。
- `sendButton`：发送按钮；有的站点只在输入框有内容时才显示它。

站点只需要声明它真正能提供的键。插件用 `{ "kind": "semantic", "key": "userTurn" }` 作为 DOM 操作的 `target` 来引用语义键，而不是写死选择器，这样站点改版时只要改 `site.json` 一个文件。

`conversationIdPattern` 是 `site.json` 里的另一个字段，不是选择器：它是一个匹配 URL 路径的正则，第一个捕获组就是会话 id，例如 `^/chat/([^/?#]+)`。

[新增平台](./adding-a-platform.md)

## 插件粒度

插件应该以“用户要解决的问题”为边界，而不是机械地按平台拆开。

catalog 里的插件属于单个站点文件夹，它的每个 `matches` 都必须落在该文件夹 `site.json` 的范围内（否则 `bun run plugin:check` 会失败），所以同一个插件不能同时覆盖 Claude 和 ChatGPT。如果同一个功能适用于多个平台，例如“阅读宽度”“翻页体验”“代码块排版”，就在每个站点文件夹各做一个插件（例如 `sites/claude/plugins/reading-width` 和 `sites/chatgpt/plugins/reading-width`），并让名称、设置和说明保持一致。

但如果不同平台需要完全不同的设置、DOM 逻辑或用户文案，拆成多个插件会更清晰。不要为了“一个插件管所有事”把无关功能硬塞在一起；一个插件最好只解决一个明确问题。

简单判断：

- 同一个用户目标、同一组设置、只是站点选择器不同：每个站点文件夹各做一个插件，名称与设置保持一致。
- 同一个主题但每个平台体验差异很大：可以拆开，但名称和说明里保持关联。
- 功能目标不同：不要合并。

## 避免重复插件

提交前请先在[插件一览](/guide/plugins)里看看已有的官方插件。如果已经有一个好用的插件，优先给它提改进 PR，而不是再做一个类似插件。

重复插件只有在有明显提升时才值得接受，例如：

- 覆盖了原插件不支持的重要平台。
- 修复了原插件长期无法解决的兼容性问题。
- 有明显更好的性能、可访问性或维护性。
- 提供了不同但足够清晰的用户体验，而不只是换名字或微调样式。

这样插件列表会更干净，用户也更容易选择。

## 最小示例

不用从空目录开始：`bun run plugin:new <id-segment> --site <site>` 会生成 `catalog/sites/<site>/plugins/<id-segment>/`，里面有 `plugin.json`、`style.css` 和 `README.md`，并顺手往 `marketplace.json` 追加对应条目。它生成的只是起点，不代表已经通过审核；你要填的清单长这样：

```json
{
  "$schema": "https://voyager.nagi.fun/plugin.schema.json",
  "id": "your-name.example-plugin",
  "name": "Example Plugin",
  "version": "1.0.0",
  "description": "A short description of what this plugin improves.",
  "author": "your-name",
  "category": "readability",
  "license": "MIT",
  "engine": ">=1.0.0",
  "tier": "declarative",
  "matches": ["https://claude.ai/*"],
  "contributes": {
    "styles": [{ "file": "style.css" }],
    "domOps": [
      {
        "op": "addClass",
        "target": "body",
        "className": "gv-plugin-example"
      }
    ]
  }
}
```

`$schema` 这行是可选的，只服务于编辑器：它指向清单的 JSON Schema，让编辑器边写边校验和补全。`site.json` 也有自己的一份，地址是 `https://voyager.nagi.fun/site.schema.json`。

`style.css` 可以像普通 CSS 一样写，但建议所有插件样式都挂在自己的 `gv-plugin-*` 类下面：

```css
.gv-plugin-example .some-target {
  max-width: 880px;
}
```

## Manifest 注意事项

- `id` 使用反向域名或作者前缀，例如 `your-name.reading-width`，避免和其他插件冲突。
- `matches` 尽量收窄，只匹配插件真正需要生效的网站。
- `matches` 只有在所属站点的 `site.json` 全部覆盖时，才能列出多个主机（例如 chatgpt.com 和 chat.openai.com）；要支持其他站点，请在该站点的文件夹里新增插件。
- `category` 建议使用 `render-fix`、`theme`、`layout`、`readability`、`productivity`、`integration` 或 `other`。
- `engine` 写插件需要的最低 Voyager 版本。官方插件可参考当前目录中的示例。
- `i18n` 推荐补齐中文、英文和其他常用语言的名称、描述、设置项文案。

## CSS 与资源限制

声明式插件会被当作不可信输入校验，所以请保持资源自包含：

- 不要使用 `@import`。
- 不要引用外链图片、外部字体或远程 CSS。
- 可以使用普通 CSS、自定义属性和 Voyager 提供的设置值替换。
- 类名请使用 `gv-plugin-` 前缀，避免污染宿主网站或 Voyager 自身样式。

如果插件需要用户设置，推荐先使用数字型设置；例如阅读宽度这类插件可以用设置值写入 CSS 变量，再由样式消费。

[DOM 操作边界](./dom-operation-boundaries.md)

## 什么时候不适合做成普通插件

如果功能必须执行 JavaScript、拦截请求、读写 Voyager 内部数据，或依赖复杂的运行时逻辑，它就不适合作为普通声明式插件提交。

这类功能请先开 Issue 说明需求。确实需要内置能力时，我们会考虑把它做成 Voyager 主仓库里的 builtin/native 插件，例如 Formula Copy。

## PR 前检查

先跑 `bun run plugin:check <插件目录>`，并把输出贴进 PR。它会一次列出所有问题：清单和 CSS、`matches` 是否越出站点范围、原语、语义键、十种语言的翻译，以及 README；CI 也会对每个内置插件跑同一套检查。

- 插件默认关闭，用户需要自己启用。
- 已检查没有功能几乎相同的现有插件；如果有，优先改进现有插件。
- 在目标网站的浅色和深色主题都测试过。
- `matches` 没有覆盖无关网站。
- 没有远程资源引用。
- 插件目录包含 `plugin.json`、必要的 CSS 文件和简短 README。
- 官方插件的目录位于 `catalog/sites/<site>/plugins/<id>/`，`matches` 落在站点 `matches` 范围内，并且 `catalog/marketplace.json` 里有对应条目（Gemini 和 AI Studio 插件随 Voyager 一起发布，不需要此条目）。
- PR 描述里写清楚测试页面、截图或录屏，以及可能影响的页面区域。

保持简单、克制、可撤销。一个插件只解决一个明确问题，通常会更容易合并和维护。
