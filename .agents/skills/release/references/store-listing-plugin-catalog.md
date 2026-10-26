# Store listing copy: plugin catalogs and Gemini page detection fixes

> **Draft, awaiting maintainer review.** Nothing here has been submitted to a
> store. Wording, tone and the Firefox decision in section 3 are proposals; edit
> freely before pasting into Chrome Web Store, Edge Add-ons or Firefox AMO.

Voyager has two distinct data channels: plugin catalogs at
`https://voyager.nagi.fun/catalog/hosts/<site host>.json` and default-off Gemini
page detection data at `https://voyager.nagi.fun/catalog/gemini-selectors/v1/hosts/gemini.google.com.json`.
The copy below discloses each channel's consent and timing separately. It is
shared by the Chrome Web Store, Edge Add-ons and Firefox AMO listings; the
Gemini disclosure also applies to Safari when that channel is enabled in the build.

## 1. Listing paragraph (English)

> Voyager works locally. On sites such as Claude, ChatGPT, DeepSeek and Kimi,
> enabling a plugin allows Voyager to check voyager.nagi.fun for validated
> plugin CSS and JSON at your selected interval (6 hours by default). Gemini
> and AI Studio never request this plugin catalog. Turning off “Plugin online
> updates” stops its automatic checks; its manual check remains available.
>
> Gemini has a separate “Online fixes for Gemini page detection” option, off by
> default. Only after you enable it does Voyager request page detection data
> for gemini.google.com from voyager.nagi.fun. This helps Voyager find conversation
> turns, sidebar entries and titles, areas used to display folders, model menu
> controls, conversation and export menus, the export selection bar, the sidebar toggle button’s clickable area and sidebar hover areas,
> message content for export and forks, context images, response and research-pack actions, usage displays, code blocks and diagrams, paragraphs containing LaTeX in your messages, search result images in exports, generated image download buttons, Canvas code export, the Gems sidebar, message inputs and their controls, and page elements used by input
> collapse, Vim mode, prompt history, slash commands, sent prompt previews, Folder as Project and folder
> activity. It downloads no code, CSS or
> plugins. Automatic checks run at most once every 6 hours; turning the setting
> off and on does not reset the interval. A check interrupted by an extension
> restart may be retried. “Check now” can bypass the interval only while the
> option is on. Turning it on needs an open Gemini tab; you can turn it off from
> the popup on any tab. Off blocks all of these requests, including manual
> checks, cancels checks in progress and removes downloaded data. The setting and cache stay on your device and are excluded from sync
> and settings backups; the last-attempt time is kept locally. Open pages keep
> their current fixes until you refresh them yourself. AI Studio remains
> packaged-only.
>
> Both channels send no cookies, account or extension identifiers, or page or
> conversation content. The host sees standard request metadata such as IP
> address and User-Agent, and the site host name in the URL. No remote
> JavaScript or WebAssembly is downloaded or executed. Failed checks keep
> existing data. Announcement checks have their own setting.

## 2. Listing paragraph (Simplified Chinese)

> Voyager 在本地运行。在 Claude、ChatGPT、DeepSeek、Kimi 等网站启用插件后，Voyager 可按所选间隔（默认 6 小时）向 voyager.nagi.fun 检查经过校验的插件 CSS 和 JSON。Gemini 和 AI Studio 不请求这个插件目录。关闭「插件在线更新」会停止自动检查，手动检查仍可使用。
>
> Gemini 另有独立的「Gemini 页面识别在线修复」选项，默认关闭。只有开启后才会向 voyager.nagi.fun 请求 gemini.google.com 的页面识别数据，用于找到对话轮次、侧边栏条目和标题、文件夹显示区域、模型菜单控件、对话和导出菜单、导出选择栏、侧边栏开关按钮的点击区域与侧边栏悬停区域、导出与分支所用的消息正文、上下文图片、回复和研究资料包操作、用量显示、代码块和图表、用户消息中含 LaTeX 的段落、导出中的搜索结果图片、生成图片下载按钮、Canvas 代码导出、Gems 侧边栏、消息输入框和相关控件，以及输入框折叠、Vim 模式、提示词历史、斜杠命令、已发送提示词预览、文件夹作为项目及文件夹活动所用的页面元素，不下载代码、CSS 或插件。自动检查最多每 6 小时一次，关闭再开启不会重置间隔；被扩展重启中断的检查可能重试。「立即检查」只在开启时可跳过间隔。开启需要在 Gemini 标签页中操作，关闭可在任何标签页的弹窗里完成。关闭后禁止这类请求，包括手动检查，取消进行中的检查并删除已下载的数据。设置和缓存仅保存在当前设备，不参与同步或设置备份，上次尝试时间保留在本地。已打开页面继续使用当前修复，直到你自行刷新。AI Studio 仍只使用包内数据。
>
> 两个通道均不发送 Cookie、账户或扩展标识、页面或对话内容。服务器能看到 IP 地址、User-Agent 等常规请求元数据及 URL 中的主机名。不下载或执行远程 JavaScript 或 WebAssembly。检查失败时保留现有数据。公告检查有自己的开关。

The Gemini disclosure is also available in the other eight supported locales:
[Arabic](store-listing-gemini/ar.md), [Spanish](store-listing-gemini/es.md),
[French](store-listing-gemini/fr.md), [Japanese](store-listing-gemini/ja.md),
[Korean](store-listing-gemini/ko.md), [Portuguese](store-listing-gemini/pt.md),
[Russian](store-listing-gemini/ru.md), and [Traditional Chinese](store-listing-gemini/zh_TW.md).
These drafts use the same coverage and consent wording as the privacy pages.
Keep the plugin-catalog paragraph separate when assembling a localized listing.

## 3. Firefox data collection note

The AMO submission keeps `data_collection_permissions.required = ["none"]`. Each
catalog or page detection check is an HTTPS GET for a static file, sent
without cookies and without any account or extension identifier, and it carries
no page or conversation content. What the server can observe is the standard
request metadata every web request exposes, namely the requesting IP address and
the browser user agent, plus the site host name in the URL path. That is the
standard metadata exposed by a static-file request. The listing and privacy
pages disclose it; the store's classification still depends on its review.

If AMO review disagrees, the fallback is to ship the Firefox build with
`VOYAGER_PLUGIN_CATALOG_REMOTE=off`. It disables both data channels, including
Gemini page detection cache use, so only bundled plugin and page detection data apply.
`VOYAGER_GEMINI_SELECTOR_REMOTE=off` disables just the Gemini channel. Remove
only the disabled channel's listing paragraph. These flags do not disable
unrelated announcements or user-requested cloud sync.

## 4. Chrome Web Store privacy practices

One-line answer for the data-usage questionnaire:

> Voyager fetches public static plugin or page detection data over HTTPS without
> cookies, identifiers, page content or conversation content. The server sees
> the request's IP address, User-Agent and site host. Gemini page detection
> requests require a separate opt-in that is off by default; off also blocks
> manual checks.

## 5. Related material

- Privacy policy wording, all 10 locales: `docs/privacy.md` and
  `docs/<locale>/privacy.md`, under the plugin catalog bullet or section.
- Implementation and gates: `src/features/plugins/remote/README.md` and
  `src/features/geminiSelectorFixes/`.
- Build flags: `src/features/plugins/remote/config.ts` and
  `src/features/geminiSelectorFixes/config.ts`.
