# 新增平台

新增一个聊天网站分为两个相互独立的层次：

1. **站点适配器**，即 `catalog/sites/<site>/site.json`，它告诉 Voyager 如何识别该网站，并找到用户消息、助手消息、输入框、侧边栏和主题标记。
2. **插件**，位于 `catalog/sites/<site>/plugins/<id>/` 下，用于解决该网站上某个面向用户的具体问题，例如阅读宽度或渲染修复。

`site.json` 包含 `id`（与目录名相同）、`label`、`matches`、`selectors`、`theme`、`brandColor`、`capabilities`，以及可选的 `conversationIdPattern` 和 `turnKeyAttributes`。`turnKeyAttributes` 指定在页面重新渲染用户消息时，用于保持其身份的属性。发送追踪（用于文件夹的 Activity 和时间线时间戳）只会在设置了该字段、`composer`、`userTurn` 和 `conversationIdPattern` 的站点上运行。`src/features/plugins/sites/siteAdapterData.ts` 中的 `validateSiteAdapterData` 负责校验它；`bun run catalog:build` 会在发布前校验每个站点和插件。

`site.json` 就是站点适配器本身，只是写成了数据。目前的插件平台是 ChatGPT、Claude、DeepSeek、Kimi 和 Grok。Gemini 和 AI Studio 是 Voyager 的原生界面，同样有各自的 `site.json`（`catalog/sites/gemini/`、`catalog/sites/aistudio/`），但它随扩展打包，不会发布到远端目录；`sites/adapters/` 下的 `gemini.ts`、`aistudio.ts`、`claude.ts`、`chatgpt.ts`、`deepseek.ts` 现在都只是 `site.json` 的一行壳，要改就改 JSON，不要改 TypeScript。

发布的分站点目录里也带上了站点数据，所以选择器修复不发新版本也能到达用户。全新的站点仍然需要扩展本身的支持，因为它还需要随包提供的主机权限和 content script 注册。

对于 DeepSeek 这样的新平台，请让适配器工作专注于平台契约本身。将 `site.json`、必要的选择器测试，以及解释该支持所需的最少文档，放在同一个完整的变更中。站点注册表会直接从文件中识别新适配器，因此无需编辑任何注册列表。不要为每个插件都新增一个站点。

适配器通过审核后，后续插件可以作为独立的、聚焦的变更单独提交。如果多个变更彼此依赖，可以使用堆叠 PR 链：每个后续分支基于前一个分支，每个 PR 只展示自己增量的功能。整条链仍应遵循同样的范围原则：每个 PR 只对应一个明确的用户目标，并附带必要的测试和清理。

站点支持不需要模型 API 集成。不要为新平台添加静态 content script 或必需的主机权限；对于仅插件的站点，请使用现有的可选权限与动态注册流程。

可选权限与动态注册路径依赖于浏览器版本：Chrome 和 Edge 支持扩展所使用的流程；Firefox 需要 128 或更高版本才能使用可选主机权限；Safari 需要 16.4 或更高版本才能进行动态 content script 注册。在较旧的受支持浏览器版本上，弹窗可能会正确地拒绝为自定义站点启用插件，因为所需的 API 无法提供持久授权。不要通过添加宽泛的静态主机权限来绕过此限制，除非得到维护者的批准。
