# Adding a new platform

Adding a new chat website has two separate layers:

1. The **site adapter**, `catalog/sites/<site>/site.json`, teaches Voyager how to
   recognize the website and find its user turns, assistant turns, composer,
   sidebar, and theme markers.
2. A **plugin** under `catalog/sites/<site>/plugins/<id>/` solves one
   user-facing problem on that website, such as reading width or a rendering
   fix.

A `site.json` carries `id` (equal to its directory name), `label`, `matches`,
`selectors`, `theme`, `brandColor`, `capabilities`, and optional
`conversationIdPattern` and `turnKeyAttributes`. `turnKeyAttributes` names the
attributes that keep a user message's identity when the page re-renders it;
send tracking (used by folder Activity and timeline timestamps) only runs on a
site that sets it, along with `composer`, `userTurn`, and a
`conversationIdPattern`. `validateSiteAdapterData` in
`src/features/plugins/sites/siteAdapterData.ts` validates it, and
`bun run catalog:build` validates every site and plugin before publishing.

Every plugin platform is data. Sites today are ChatGPT, Claude, DeepSeek, Kimi, and Grok.
Gemini and AI Studio are native Voyager surfaces with their own `site.json`
(`catalog/sites/gemini/` and `catalog/sites/aistudio/`), but it ships inside the
package and is never published to the remote catalog. All five adapters,
`adapters/gemini.ts`, `aistudio.ts`, `claude.ts`, `chatgpt.ts` and `deepseek.ts`,
are one-line shells over their `site.json`: edit the JSON, not the TypeScript.

The published per-host catalog carries the site data too, so a selector fix in
`site.json` can reach users without an extension release. A brand new site still
needs one, because it also needs host permission and content-script registration
that ship inside the package.

For a new platform such as DeepSeek, keep the adapter work focused on the
platform contract. Put the `site.json`, the required selector tests, and the
minimum documentation needed to explain the support in one complete change. The
site registry picks the new adapter up from the file itself, so there is no
registration list to edit. Do not add a new site for every plugin.

After the adapter is accepted, follow-up plugins can be submitted as separate
focused changes. If several changes depend on one another, a stacked PR chain
is useful: each later branch is based on the previous branch, and each PR
shows only its own incremental feature. The chain should still follow the same
scope rule: one clear user goal per PR, with its required tests and cleanup.

Site support does not require a model API integration. Do not add static
content scripts or required host permissions for a new platform; use the
existing optional-permission and dynamic-registration flow for plugin-only
sites.

The optional-permission and dynamic-registration path is browser-version
dependent. Chrome and Edge support the flow used by the extension. Firefox
requires version 128 or newer for optional host permissions, and Safari
requires version 16.4 or newer for dynamic content-script registration. On
older supported browser versions, the popup may correctly refuse to enable a
plugin for a custom site because the required APIs cannot provide a persistent
grant; do not work around this by adding a broad static host permission without
maintainer approval.
