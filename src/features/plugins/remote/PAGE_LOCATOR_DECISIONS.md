# D14：一个页面定位目录通道

[分发决定](DECISIONS.md#11-d14-细则一个目录通道)的完整细则。

- 每个具体 host 使用 `/catalog/hosts/<host>.json`。Gemini、AI Studio、ChatGPT、Claude、DeepSeek、Kimi 各读自己的 `site.locators` 及获准的 `site.selectors`，在 `core/selectors/contracts/` 定义 literal allowlist 与 groups。Gemini Enterprise 与 consumer Gemini 共享 Gemini 数据和守卫；两个 AI Studio host 共享 AI Studio 数据。
- `validateSiteAdapterData` 独立校验 locators。未知 key 或超限 section 只丢弃 locators；单个 locator 的 shape 或语法错误只丢弃所属 group，不影响其余 site data、插件列表或 kill switch。
- 现有「在线更新」`gvPluginOnlineUpdatesEnabled` 默认开启，间隔默认 6 小时，可选 1h / 6h / 24h / manual。两项设置都在 sync 并参与备份。OFF 阻止自动目录请求；手动 `force` 可跳过开关、间隔及 enabled-plugin gate。页面启动可请求 due check，打开 popup 只读缓存，按钮触发手动检查。
- 只有比 bundle 更新的 site data 才能提供修复；revision、缓存及版本策略沿用 catalog。清空 `site.locators` 只撤回 namespaced profiles；完整撤回还须把允许远程更新的 `site.selectors` 恢复为包内值。OFF 不清缓存或用户数据；首次挂载与 catalog reload 都按同一 revision/identity 规则采用缓存 adapter，OFF 仅让受守卫的页面定位 snapshot 使用 bundle，不丢弃其他 adapter 字段。
- Gemini 与 AI Studio 的官方插件、CSS 和 native 协议继续留在包内。所有站点的 host admission、账号、ID、删除/重命名、点击与输入协议、模型元数据、ARIA 关联和 clone sanitizer 不由定位更新改变。只能确认 bundled 结果的定位项仍为 packaged-only；本地插件不能绕过这些边界。
- 每个 surface 独立拒绝语法错误；集合不完整、与独立 native/bundled 检查冲突或不属于原操作元素时，整次读取回到 bundle。`remoteKeys` 与 consumer guards 由包内代码控制；新增检查不进入 bundled path。
- 共用的 per-site hydration 使用 `startMachine`，从同一 resolved catalog site data 建立 snapshot。native 启动不额外等 catalog：在原有 settings/coverage 读取之后、首次挂载之前固定已就绪的 snapshot；缓存未读完则本页固定 bundle，迟到结果不能切换，可在后续页面加载重试。snapshot 固定到用户自行刷新；新数据、撤回和关闭更新不自动重载页面，也不重挂 native 功能。
