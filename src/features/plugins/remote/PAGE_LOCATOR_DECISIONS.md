# D14：一个页面定位目录通道

[分发决定](DECISIONS.md#11-d14-细则一个目录通道)的完整细则。

- 每个具体 host 使用 `/catalog/hosts/<host>.json`。Gemini、AI Studio、ChatGPT、Claude、DeepSeek、Kimi 各读自己的 `site.locators` 及获准的 `site.selectors`，在 `core/selectors/contracts/` 定义 literal allowlist 与 groups。Gemini Enterprise 与 consumer Gemini 共享 Gemini 数据和守卫；两个 AI Studio host 共享 AI Studio 数据。
- `validateSiteAdapterData` 独立校验 locators。未知 key 或超限 section 只丢弃 locators；单个 locator 的 shape 或语法错误只丢弃所属 group，不影响其余 site data、插件列表或 kill switch。
- 现有「在线更新」`gvPluginOnlineUpdatesEnabled` 默认开启，间隔默认 6 小时，可选 1h / 6h / 24h / manual。两项设置都在 sync 并参与备份。OFF 阻止自动目录请求；手动 `force` 可跳过开关、间隔及 enabled-plugin gate。页面启动可请求 due check，打开 popup 只读缓存，按钮触发手动检查。
- 只有比 bundle 更新的 site data 才能提供修复；revision、缓存及版本策略沿用 catalog。清空 `site.locators` 只撤回 namespaced profiles；完整撤回还须把允许远程更新的 `site.selectors` 恢复为包内值。OFF 不清缓存或用户数据；首次挂载与 catalog reload 都按同一 revision/identity 规则采用缓存 adapter，OFF 时所有 semantic keys（包括已纳入 contract 的 keys）直接读取 baseline `6fa19b4ae` 使用的缓存 adapter 值；只有 namespaced `site.locators` profiles 使用 bundle。新增 contract proofs 只在 ON 时应用。
- Gemini 与 AI Studio 的官方插件、CSS 和 native 协议继续留在包内。所有站点的 host admission、账号、ID、删除/重命名、点击与输入协议、模型元数据、ARIA 关联和 clone sanitizer 不由定位更新改变。设计 §6 协议继续打包；保留在包内的 Tier A 定位项须逐 key 说明为何无法独立证明替代值。本地插件不能绕过这些边界。
- ON 时按 D21 分两级。Tier A 包括 host 点击、发送、停止、删除、输入、导航、开菜单，持久化或导出的内容，以及决定 conversation/turn/account/Gem/folder/project 归属的定位项；独立证据不成立时整次读取回到 bundle。Tier B 只决定 Voyager UI 的挂载、插入、对齐和避让，信任自有目录，不要求独立 proof；零命中或挂载到 contenteditable、input、textarea 等 host 表单控件内时回退 bundle。混合用途不能按 Tier B 放宽。
- 两级都使用 literal allowlist、groups、大小限制与按组语法拒绝。未知 key 忽略。`remoteKeys`、分级和 consumer guards 由包内代码控制；OFF 或无 remote data 保持 `6fa19b4ae` 的值、顺序、行为和成本，新增检查不进入 bundled path。
- 共用的 per-site hydration 与独立 adapter read 使用 `startMachine`，复用首次 catalog/settings 读取；首个 consumer 的有界等待、页面 snapshot 冻结与 baseline adapter precedence 统一遵循[启动就绪规则](../../../core/selectors/README.md#startup-readiness)。新数据、撤回和关闭更新在用户刷新后生效，不自动重载页面或重挂 native 功能。
