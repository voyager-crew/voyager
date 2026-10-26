# 隐私政策

最后更新：2026 年 10 月 26 日

## 概述

Voyager 是一个以本地处理为主的浏览器扩展，用于整理和增强受支持的 AI 对话工作区。它只会为用户主动使用的功能处理必要的数据。Voyager 不运营用于接收对话、提示词、浏览活动、图片或账户标识的后端，也不使用广告或分析追踪器。

## 处理的数据

根据您使用的功能，Voyager 可能会处理：

- **网站内容和个人通信**：对话文本、提示词、草稿、图片、链接及其他受支持页面内容，用于文件夹、导航、导出、提示词管理、研究和界面功能。
- **账户标识**：受支持的 Google 服务可能提供当前登录邮箱。Voyager 会将其转换为本地账户标识，用于隔离不同账户的数据；原始邮箱不会发送给我们。
- **网页历史和用户活动**：受支持网站的 URL、对话路由，以及实现导航、快捷键、用量显示、回复完成通知等功能所需的有限页面、交互和网络事件。这些数据不会用于画像或广告。
- **身份验证信息**：仅在用户主动启用 Google Drive 同步时使用、权限范围为 `drive.file` 的 OAuth2 令牌。
- **扩展数据和设置**：文件夹、提示词模板、草稿、星标消息、用量快照、插件状态和界面偏好。

这些数据保存在 `chrome.storage.local`，或在受支持的情况下保存在 `chrome.storage.sync`。部分功能还会使用受支持网站自身在用户设备上的 `localStorage`，用于保存文件夹数据的备份副本和时间轴缓存。短时的转交记录使用会话存储：Research Pack 转交使用浏览器内存中的扩展 `storage.session`；ChatGPT 临时对话转交只在页面的 `sessionStorage` 中保存一个标签页令牌，对话记录在 `chrome.storage.local` 中最多保留 60 秒。除非用户主动使用下述传输功能，否则数据只保留在用户设备或浏览器同步账户中。

## 用户主动发起的数据传输

- **Google Drive 同步（可选）**：选定的备份数据会在用户设备与用户自己的 Google Drive 之间直接传输。Chrome、Edge 和 Firefox 使用浏览器身份 API；Safari 直装版使用原生 Google Sign-In，并将凭据保存在 macOS 钥匙串中。两种路径都只申请权限受限的 `drive.file` 范围，OAuth 令牌不会发送到 Voyager 服务器。在 Chromium 浏览器中，如果浏览器无法直接签发令牌（例如 Brave，或该登录方式失败时），Google 会把登录结果返回到 `https://voyager.nagi.fun/oauth/callback/` 上的静态中转页，由该页的脚本在浏览器内转交给扩展。令牌位于 URL fragment 中，浏览器不会把它发送给服务器；与访问任何网页一样，该静态站点能看到请求的 IP 地址和浏览器 User-Agent。Firefox 则使用 loopback 重定向（`http://127.0.0.1/mozoauth2/…`），由浏览器在请求发出前拦截，并通过 PKCE 直接与 Google 交换授权码。
- **Safari iCloud 同步（可选）**：选定的备份数据由 Safari 原生扩展直接传输到用户 iCloud 账户的私有 CloudKit 数据库。Voyager 不会取得用户的 Apple ID 或 iCloud 身份验证令牌，开发者也无法访问该私有数据库中的记录。
- **导出和图片**：用户发起导出时，Voyager 可能从页面原有来源获取图片，并可能临时申请捕获生成式界面内容所需的访问权限。导出文件直接提供给用户，不会上传到 Voyager 服务器。
- **Context Sync（可选）**：用户点击同步时，Voyager 会把抓取的对话上下文发送到用户本机上的本地服务器 `http://127.0.0.1:<端口>/sync`（默认端口 3030，可修改）。功能开启且弹窗打开时，Voyager 还会检查该地址，以显示本地服务器是否可用。这些数据不会经由 Voyager 离开用户设备。
- **Research Pack“在 ChatGPT / Claude 中继续”**：用户选择目标后，Voyager 会在所选网站（ChatGPT 或 Claude）打开一个新对话。如果 Voyager 已在该网站运行，研究包会通过浏览器内存中的 `storage.session` 转交，只能由该标签页领取一次，并填入输入框而不会发送；该记录 60 秒后过期。否则研究包会复制到剪贴板，由用户自行粘贴。研究包不会放在 URL 中传递。
- **ChatGPT 临时对话转交**：用户选择继续 ChatGPT 临时对话时，Voyager 会把一份 Markdown 备份下载到用户设备，退出临时模式，并把对话内容放入普通 ChatGPT 对话的输入框而不发送。对话记录只留在 ChatGPT 和用户设备上。
- **公开项目资源**：Voyager 可能请求公开的版本、公告或文档资源；这些请求不会携带对话或提示词内容。
- **在线目录更新**：“在线更新”默认开启。在受支持的 Gemini（含 Enterprise）、AI Studio、ChatGPT、Claude、DeepSeek 和 Kimi 页面，打开页面时，Voyager 可能通过 HTTPS 获取 `https://voyager.nagi.fun/catalog/hosts/<网站主机名>.json`。打开弹窗只读取本地缓存，其中的按钮可发起手动检查。自动检查从上次尝试起按所选间隔进行（默认 6 小时，可选 1 小时、6 小时、24 小时或仅手动），失败后会延后重试。手动检查可跳过间隔，关闭在线更新后仍可使用。关闭后停止自动目录请求。缓存的插件和原有网站设置（包括其中的页面识别规则）仍可使用。关闭更新并刷新后，这些规则保持原有行为；新增的页面识别数据使用包内版本。开关与间隔保存在浏览器同步存储中，并包含在设置备份内；下载的目录留在本机。同一通道提供各站点自己的页面识别数据。在线修复覆盖受支持功能的页面识别，包括对话、输入、导航、菜单、导出、图片和 Voyager 控件布局。Gemini 与 AI Studio 的官方插件和 CSS，以及所有站点的身份规则、删除等操作和点击、输入协议仍随扩展打包。新修复、撤回和关闭更新在用户自行刷新后生效；已打开页面保留当前快照，不自动重载。开启在线更新时，影响网站操作、数据或对话归属的修复须通过独立页面验证，否则整次操作使用包内数据。仅调整 Voyager 控件位置的修复信任官方目录；找不到目标，或挂载目标位于可编辑区域内时，使用包内位置。目录请求是普通 GET，不携带 Cookie、账户或扩展标识、页面或对话内容。服务器可见 IP 地址、User-Agent 和 URL 中的网站主机名等常规连接元数据。目录中的 CSS 和 JSON 使用前经过校验，不执行远程 JavaScript 或 WebAssembly。公告和可选云同步各有开关。voyager.nagi.fun 是由 Cloudflare 代理的静态托管站点；Voyager 项目不记录、不保存这些请求，托管方按其自身隐私政策处理连接元数据。

Voyager 不会出售用户数据，也不会将其用于广告、信用评估或与扩展面向用户的功能无关的目的。

## 权限说明

- **Storage（存储）**：在本地保存扩展数据和偏好，并在受支持时使用浏览器同步。Chrome、Edge 和 Firefox 还会授予 `unlimitedStorage`，避免本地数据受默认配额限制；Voyager 自身仍设有存储上限。Safari 上该权限为可选。
- **Identity（身份认证）**：在用户明确操作后，为可选的 Google Drive 同步进行认证。Safari 版不申请此权限：Safari 上的 Google Drive 和 iCloud 同步都通过 Voyager macOS 应用完成。
- **Scripting（脚本注入）**：只在受支持网站注入扩展自身打包的脚本，不执行远程 JavaScript 或 WebAssembly。
- **Active tab 和 Declarative content**：识别用户当前打开的受支持网站，并显示对应的网站设置。Declarative content 仅在 Chrome 和 Edge 上使用。
- **Alarms（定时任务）**：定期检查公开公告，并运行后台定时器，用于清理过期的转交记录和执行延迟任务。
- **Notifications（通知，可选）**：仅在用户开启回复完成通知或远程公告的系统提醒时申请。Safari 版不申请此权限，回复完成通知由 Voyager macOS 应用发出。
- **Native messaging（原生消息，仅 Safari）**：将 Safari 扩展连接到 Voyager macOS 应用，用于 Google Drive 和 iCloud 同步以及回复完成通知。
- **Host permissions（主机权限）**：安装时即授予 Gemini、Gemini Enterprise 和 AI Studio，以及用户主动发起的 Google Drive 和图片操作所需的 Google 域名。
- **Optional host permissions（可选主机权限）**：Claude、ChatGPT、DeepSeek 和自定义网站，只有在用户为该网站启用 Voyager 或插件、并在浏览器权限提示中同意后才会访问。用户选择捕获生成式界面内容的导出方式时，也可能临时申请 `<all_urls>`；如果用户拒绝，导出会跳过该捕获并继续进行。

## 保留期限和用户控制

本地和浏览器同步数据会保留到用户删除数据、清除扩展存储或卸载扩展为止。Voyager 存在受支持网站自身 `localStorage` 中的副本（文件夹备份和时间线缓存）不会随卸载删除，需要在浏览器中清除该网站的数据。云端备份会保留在用户所选的 Google Drive 或 iCloud 账户中，直到用户从该账户中删除。用户可以在 Voyager 和浏览器设置中关闭可选功能，并撤销可选网站权限或 Google 授权。

## Google API Limited Use

Voyager 对从 Google API 获取的信息的使用和传输，遵守 Chrome Web Store User Data Policy，包括 Limited Use 要求。

## 政策变更

我们可能会随着 Voyager 的变化更新本隐私政策。最新版本及更新日期会发布在本页面。

## 联系我们

如有隐私问题，请通过 [Voyager GitHub 仓库](https://github.com/voyager-crew/voyager) 联系我们。
