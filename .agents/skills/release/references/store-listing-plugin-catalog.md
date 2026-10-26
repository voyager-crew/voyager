# Store listing copy: online catalog updates

> **Draft, awaiting maintainer review.** Nothing here has been submitted to a
> store. Wording, tone and the Firefox decision in section 3 are proposals; edit
> freely before pasting into Chrome Web Store, Edge Add-ons or Firefox AMO.

Voyager uses one online catalog at
`https://voyager.nagi.fun/catalog/hosts/<site host>.json`. It may carry plugin
updates and site-specific page detection fixes for all supported sites. The same setting, interval and
catalog cache govern both. This disclosure applies to Chrome, Edge, Firefox and
Safari builds with remote catalog updates enabled.

## 1. Listing paragraph (English)

> **Online catalog updates**: the “Online updates” setting is on by default. On supported Gemini (including Enterprise), AI Studio, ChatGPT, Claude, DeepSeek and Kimi pages, Voyager may fetch `https://voyager.nagi.fun/catalog/hosts/<site host>.json` over HTTPS when you open the page. Opening the extension popup reads the local cache; its button requests a manual check. Automatic checks follow your selected interval from the last attempt (6 hours by default; 1 hour, 6 hours, 24 hours or manual only), with backoff after failures. Manual checks bypass the interval and remain available when online updates are off. Turning updates off stops automatic catalog requests. Cached plugins and existing site settings, including their page detection rules, remain usable. After you refresh with updates off, those rules keep their previous behavior; additional page detection data uses the bundled version. The switch and interval use browser sync storage and settings backup; downloaded catalogs stay on the device. This one channel carries each site’s own page detection data. Online fixes cover page detection for supported features, including conversations, input, navigation, menus, exports and images. Gemini and AI Studio official plugins and CSS, and all sites’ identity rules, destructive actions and click/input policies remain packaged. Fixes, withdrawals and switching updates off apply after you refresh the page yourself; open pages keep their current snapshot without automatic reload. With online updates on, unusable or unproved fixes fall back to the bundled read for the entire operation. Catalog requests are plain GETs without cookies, account or extension identifiers, or page or conversation content. The server sees ordinary connection metadata, including IP address, User-Agent and the site hostname in the URL. Catalog CSS and JSON are validated before use; no remote JavaScript or WebAssembly is executed. Announcements and optional cloud sync have separate controls. voyager.nagi.fun uses static hosting behind a Cloudflare proxy; the Voyager project does not log or retain these requests, and hosting providers handle connection metadata under their own privacy policies.

## 2. Listing paragraph (Simplified Chinese)

> **在线目录更新**：“在线更新”默认开启。在受支持的 Gemini（含 Enterprise）、AI Studio、ChatGPT、Claude、DeepSeek 和 Kimi 页面，打开页面时，Voyager 可能通过 HTTPS 获取 `https://voyager.nagi.fun/catalog/hosts/<网站主机名>.json`。打开弹窗只读取本地缓存，其中的按钮可发起手动检查。自动检查从上次尝试起按所选间隔进行（默认 6 小时，可选 1 小时、6 小时、24 小时或仅手动），失败后会延后重试。手动检查可跳过间隔，关闭在线更新后仍可使用。关闭后停止自动目录请求。缓存的插件和原有网站设置（包括其中的页面识别规则）仍可使用。关闭更新并刷新后，这些规则保持原有行为；新增的页面识别数据使用包内版本。开关与间隔保存在浏览器同步存储中，并包含在设置备份内；下载的目录留在本机。同一通道提供各站点自己的页面识别数据。在线修复覆盖受支持功能的页面识别，包括对话、输入、导航、菜单、导出和图片。Gemini 与 AI Studio 的官方插件和 CSS，以及所有站点的身份规则、删除等操作和点击、输入协议仍随扩展打包。新修复、撤回和关闭更新在用户自行刷新后生效；已打开页面保留当前快照，不自动重载。开启在线更新时，修复不可用或无法独立验证，整次操作就使用包内数据。目录请求是普通 GET，不携带 Cookie、账户或扩展标识、页面或对话内容。服务器可见 IP 地址、User-Agent 和 URL 中的网站主机名等常规连接元数据。目录中的 CSS 和 JSON 使用前经过校验，不执行远程 JavaScript 或 WebAssembly。公告和可选云同步各有开关。voyager.nagi.fun 是由 Cloudflare 代理的静态托管站点；Voyager 项目不记录、不保存这些请求，托管方按其自身隐私政策处理连接元数据。

The same disclosure is available in the other eight supported locales:
[Arabic](store-listing-locales/ar.md), [Spanish](store-listing-locales/es.md),
[French](store-listing-locales/fr.md), [Japanese](store-listing-locales/ja.md),
[Korean](store-listing-locales/ko.md), [Portuguese](store-listing-locales/pt.md),
[Russian](store-listing-locales/ru.md), and [Traditional Chinese](store-listing-locales/zh_TW.md).
These drafts use the same single-channel wording as the privacy pages.

## 3. Firefox data collection note

The AMO submission keeps `data_collection_permissions.required = ["none"]`.
Catalog checks are HTTPS GET requests for static files without cookies, account
or extension identifiers, or page or conversation content. The server sees
ordinary connection metadata: the requesting IP address, browser User-Agent and
site hostname in the URL. The listing and privacy pages disclose this; the
store’s classification still depends on its review.

If AMO review disagrees, ship the Firefox build with
`VOYAGER_PLUGIN_CATALOG_REMOTE=off`. It disables this channel, including all sites’
page detection cache use, so only bundled plugin and page detection data apply.
Remove the online-update listing paragraphs for that build. The flag does not
disable announcements or user-requested cloud sync.

## 4. Chrome Web Store privacy practices

One-line answer for the data-usage questionnaire:

> Voyager fetches public static catalog data, including site-specific page detection
> fixes, over HTTPS without cookies, identifiers, page content or conversation
> content. The server sees the request’s IP address, User-Agent and site host.
> “Online updates” is on by default; turning it off stops automatic catalog
> requests. Manual checks remain available.

## 5. Related material

- Privacy policy wording, all 10 locales: `docs/privacy.md` and
  `docs/<locale>/privacy.md`, under the online catalog updates bullet.
- Implementation and gates: `src/features/plugins/remote/README.md` and
  `src/core/selectors/README.md`.
- Build flag: `src/features/plugins/remote/config.ts`.
