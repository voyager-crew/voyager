# Store listing copy: online catalog updates

> **Draft, awaiting maintainer review.** Nothing here has been submitted to a
> store. Wording, tone and the Firefox decision in section 3 are proposals; edit
> freely before pasting into Chrome Web Store, Edge Add-ons or Firefox AMO.

Voyager uses one online catalog at
`https://voyager.nagi.fun/catalog/hosts/<site host>.json`. It may carry plugin
updates and page detection fixes for Gemini. The same setting, interval and
catalog cache govern both. This disclosure applies to Chrome, Edge, Firefox and
Safari builds with remote catalog updates enabled.

## 1. Listing paragraph (English)

> Voyager works locally. “Online updates” is on by default. On Gemini, or another
> supported site where you have enabled a plugin, Voyager may check
> voyager.nagi.fun for validated catalog data when you open the page, at your
> selected interval (6 hours by default). Opening the extension popup reads the
> local cache; its manual check can skip the interval while updates are on.
> Turning updates off blocks automatic and manual catalog requests. The switch
> and interval are included in browser sync and settings backups; downloaded
> catalogs stay on the device.
>
> This same channel may provide fixes for finding page elements on
> gemini.google.com, including conversation, sidebar, input, menu, export and
> image features. Gemini’s official plugins, CSS, account and content identity
> rules, and click behavior remain packaged. Gemini Enterprise and AI Studio
> use only packaged data. New Gemini fixes, withdrawals and switching updates
> off apply after you refresh the page yourself. Open pages keep their current
> snapshot; Voyager does not reload them automatically.
>
> Catalog requests send no cookies, account or extension identifiers, or page
> or conversation content. The server sees ordinary request metadata, such as
> IP address, User-Agent and the site hostname in the URL. No remote JavaScript
> or WebAssembly is executed. Announcement checks and optional cloud sync have
> separate controls.

## 2. Listing paragraph (Simplified Chinese)

> Voyager 在本地运行。「在线更新」默认开启。在 Gemini，或已启用插件的其他受支持网站，打开页面时，Voyager 可按所选间隔（默认 6 小时）向 voyager.nagi.fun 检查经过校验的目录数据。打开扩展弹窗只读取本地缓存；开启更新时，可通过其中的手动检查跳过间隔。关闭更新后禁止自动和手动目录请求。开关与间隔参与浏览器同步和设置备份，下载的目录留在本机。
>
> 同一通道也可提供 gemini.google.com 的页面识别修复，覆盖对话、侧边栏、输入、菜单、导出和图片等功能。Gemini 官方插件、CSS、账户与内容身份规则及点击行为仍随扩展打包。Gemini Enterprise 和 AI Studio 只使用包内数据。Gemini 的新修复、撤回和关闭更新在用户自行刷新后生效；已打开页面保留当前快照，Voyager 不会自动重载。
>
> 目录请求不发送 Cookie、账户或扩展标识、页面或对话内容。服务器可见 IP 地址、User-Agent 和 URL 中的网站主机名等常规请求元数据。不执行远程 JavaScript 或 WebAssembly。公告检查和可选云同步各有开关。

The same disclosure is available in the other eight supported locales:
[Arabic](store-listing-gemini/ar.md), [Spanish](store-listing-gemini/es.md),
[French](store-listing-gemini/fr.md), [Japanese](store-listing-gemini/ja.md),
[Korean](store-listing-gemini/ko.md), [Portuguese](store-listing-gemini/pt.md),
[Russian](store-listing-gemini/ru.md), and [Traditional Chinese](store-listing-gemini/zh_TW.md).
These drafts use the same single-channel wording as the privacy pages.

## 3. Firefox data collection note

The AMO submission keeps `data_collection_permissions.required = ["none"]`.
Catalog checks are HTTPS GET requests for static files without cookies, account
or extension identifiers, or page or conversation content. The server sees
ordinary connection metadata: the requesting IP address, browser User-Agent and
site hostname in the URL. The listing and privacy pages disclose this; the
store’s classification still depends on its review.

If AMO review disagrees, ship the Firefox build with
`VOYAGER_PLUGIN_CATALOG_REMOTE=off`. It disables this channel, including Gemini
page detection cache use, so only bundled plugin and page detection data apply.
Remove the online-update listing paragraphs for that build. The flag does not
disable announcements or user-requested cloud sync.

## 4. Chrome Web Store privacy practices

One-line answer for the data-usage questionnaire:

> Voyager fetches public static catalog data, including Gemini page detection
> fixes, over HTTPS without cookies, identifiers, page content or conversation
> content. The server sees the request’s IP address, User-Agent and site host.
> “Online updates” is on by default; turning it off blocks automatic and manual
> catalog requests.

## 5. Related material

- Privacy policy wording, all 10 locales: `docs/privacy.md` and
  `docs/<locale>/privacy.md`, under the online catalog updates bullet.
- Implementation and gates: `src/features/plugins/remote/README.md` and
  `src/core/gemini/selectors/README.md`.
- Build flag: `src/features/plugins/remote/config.ts`.
