# Plugin Ecosystem (`src/features/plugins`)

A self-contained subsystem that lets Voyager run **plugins** — units that inject
styles / DOM changes into AI chat sites (Gemini, AI Studio, ChatGPT, Claude,
DeepSeek, …). Voyager's own features can migrate onto this over time; third parties
can ship their own plugins against the same contract.

## Two design constraints that shaped everything

1. **Chrome MV3 forbids remotely-hosted code.** You may download _data_ (JSON/CSS)
   and run it through engine logic that ships **inside** the package; you may not
   download and execute JS. (`chrome.userScripts` is the only sanctioned escape
   hatch, and it's gated behind a per-user "Allow User Scripts" toggle and is
   unavailable on Safari.)
2. **The core is GPL-3.0 with many copyright holders.** It can't be relicensed or
   closed. Monetizable / proprietary plugins must therefore be **independent works**
   — and _data read by a GPL engine is not a derivative work of it._

Both constraints point at the same answer → **declarative-first** plugins.

## Two tiers

| Tier                    | Ships                       | Store-safe                     | Runs on                   | Status                                          |
| ----------------------- | --------------------------- | ------------------------------ | ------------------------- | ----------------------------------------------- |
| `declarative` (default) | CSS + JSON (`domOps`)       | ✅ everywhere, remote-loadable | Chrome / Firefox / Safari | **implemented**                                 |
| `scripted` (advanced)   | JS via `chrome.userScripts` | gated toggle, no Safari        | Chrome / Firefox          | reserved (gated, runtime is a future milestone) |

## Architecture

```
PluginSource[]  ──►  manifests        SiteRegistry ──► SiteAdapter (current URL)
   (native builtin,
    bundled catalog,
    remote host catalog,
    local imports)                         ▼
pluginState (storage) ─► enabled?    DeclarativeEngine (interprets contributions)
EntitlementProvider  ─► entitled?         │  styles + domOps, reversible, idempotent
        └──────────►  PluginHost.reconcile() ──► engine.mount/unmount
```

- **`types.ts`** — the whole contract: `PluginManifest`, `PluginContributions`,
  `DomOperation` (discriminated union — the main extension point), `SiteAdapter`,
  and the `PluginSource` / `EntitlementProvider` seams.
- **`sites/`** — `SiteAdapter` per site + a `SiteRegistry` that resolves the
  current URL. Declarative plugin selectors live in an adapter, behind the
  fixed semantic vocabulary in `sites/semanticKeys.ts` (`userTurn`,
  `assistantTurn`, `thinkingBlock`, `codeBlock`, `composer`, `sidebar`,
  `sidePanel`, `headerActions`, `scrollContainer`, `composerRoot`,
  `sendButton`), so a site redesign is a
  one-file fix. Every adapter is data: `adapters/gemini.ts`, `adapters/aistudio.ts`,
  `adapters/claude.ts`, `adapters/chatgpt.ts` and `adapters/deepseek.ts` are
  one-line shells over their `site.json`: edit the JSON, not the TS. Gemini and
  AI Studio stay native surfaces (`NATIVE_SITE_IDS`, `sites/hostPolicy.ts`); their
  native adapter fields remain packaged. Consumer Gemini can receive ordered
  page-locator profiles through the catalog host file’s optional `site.locators`.
  Gemini's packaged `userTurn`/`assistantTurn` are the joined bundled membership lists from
  `core/gemini/turnSelectors.ts`, bound by `adapters/gemini.parity.test.ts`;
  Gemini native turn consumers read ordered profiles through
  `core/gemini/selectors/`; the shared online-updates setting governs those
  profiles without changing packaged identity rules, CSS or official plugins.
  Draft deletion keeps using the bundled turn profiles.
  `sites/siteAdapterData.ts` holds
  `validateSiteAdapterData`, the one validator for the bundled `site.json`, the
  remote override and `catalog:build`.
- **`runtime/declarativeEngine.ts`** — applies a manifest's `styles` + `domOps`.
  Reversible (full teardown), idempotent, and uses a `childList`-only
  MutationObserver so its own mutations can't loop. Pure DOM → all platforms.
- **`runtime/PluginHost.ts`** — orchestrator. Loads manifests, checks
  match-URL + enabled + engine-range + entitlement, mounts/unmounts, reacts to
  state changes. All dependencies injected → fully unit-testable.
- **`runtime/officialAdmission.ts`** — when each packaged Gemini/AI Studio
  official plugin may mount: the content script admits it where its native
  module used to start, and `close` denies whatever is still pending.
- **`runtime/resourceClaims.ts`, `resourceArbiter.ts`, `reconcileArbitration.ts`,
  `releaseLedger.ts`** — exclusive page resources (`timeline-rail`, the composer
  send mode, …): which plugin holds each, why the others are `blocked`, and
  waiting until a released runtime has really shut down.
- **`runtime/stateMachine.ts`** — `startMachine`, the runtime for features with
  interruptible phases: a pure `transition`, one `PluginScope` per status, late
  callbacks from a left status ignored. Used by export selection, default
  model, draft restore, reply notifications and both batch deletes; see
  [the state machine plan](../../../.github/docs/STATE_MACHINE_PLAN.md).
- **`manifest/validate.ts`** — turns `unknown` into a typed manifest or a list of
  issues. Remote catalog plugins are untrusted; bundled catalog plugins use
  the same validator so official data cannot drift from the runtime contract.
- **`storage/pluginState.ts`** — per-plugin enable state in `chrome.storage.local`.
- **`sources/` `entitlement/`** — the swap points for native first-party
  features, bundled official declarative plugins, the per-host remote catalog,
  the user's locally imported plugins, and a future paid (Stripe/account) store. `sources/defaultSources.ts` also
  owns `mergePluginRecords`, the rules that pick which copy of a plugin id wins.
- **`local/`** — user-imported declarative plugins: the `local.*` id namespace,
  the import gate, storage, the read-only `LocalPluginSource` and the inspect
  summary the popup shows. See [local/README.md](local/README.md).
- **`remote/`** — the per-host remote catalog channel: a read-only source over a
  storage cache, plus a background-only fetcher. See [remote/README.md](remote/README.md).
- **`catalog/`** — the bundled official data: one directory per site, each
  holding that site's `site.json` and its declarative plugins. This
  keeps official CSS/JSON changes in the same PR, CI run, and release as engine
  or popup changes.

```
catalog/
  marketplace.json                        list of public catalog plugins (tests, plugin:new)
  sites/index.ts                          import.meta.glob discovery
  sites/<site>/site.json                  the site adapter, as data
  sites/<site>/plugins/<id>/plugin.json   a declarative plugin
  sites/<site>/plugins/<id>/style.css     its styles
  sites/<site>/plugins/<id>/README.md     what it fixes and why
```

`catalog/sites/index.ts` finds every `site.json` and `plugin.json` with
`import.meta.glob`, so adding a site or a plugin is adding files: there is no
mapping table. (`scripts/build-plugin-catalog.ts` reads the same tree from disk,
because `import.meta.glob` does not exist under Bun.) Sites today are
`aistudio`, `chatgpt`, `claude`, `deepseek`, `gemini` and `kimi`. A plugin's `matches`
must stay inside its site's `matches` (plan D18) or the build fails, and
`bun run catalog:build` validates every site and plugin before publishing.
Gemini and AI Studio official plugins are validated like the rest but stay
packaged and outside `marketplace.json`. Every concrete host has a catalog
file, including Gemini Enterprise and both AI Studio hosts. Each site’s admitted
page-locator profiles live in `site.locators`; identity and action policies stay
packaged. Gemini Enterprise reads the Gemini profiles under the same guards.
See [remote/README.md](remote/README.md#page-locator-profiles-in-site-data).

`catalog/marketplace.json` is **not** that mapping table, and no page reads it:
the site's plugin table is built from the manifests themselves
(`docs/.vitepress/pluginsPage.ts`, which lists the Gemini and AI Studio
packaged plugins too). It stays as the list of public catalog plugins that
`catalog/sites/index.test.ts` keeps in sync with discovery and `plugin:new`
appends to, so a new plugin still needs an entry whose `source` is the
catalog-relative path (`sites/deepseek/plugins/reading-width/plugin.json`).
Plugins under `sites/gemini/` and `sites/aistudio/` are not listed.

## Authoring a declarative plugin

```jsonc
{
  "id": "vendor.my-plugin",
  "name": "My Plugin",
  "version": "1.0.0",
  "description": "...",
  "author": "...",
  "category": "readability",
  "license": "MIT",
  "engine": ">=1.0.0",
  "tier": "declarative",
  "matches": ["https://claude.ai/*"],
  "contributes": {
    "styles": [{ "file": "style.css" }],
    "domOps": [{ "op": "addClass", "target": "body", "className": "gv-plugin-readable" }],
  },
}
```

An official plugin is authored as files under its platform's directory:

1. Pick the site it belongs to. If that site has no `catalog/sites/<site>/`
   directory yet, write its `site.json` first (`id` equal to the directory name,
   `label`, `matches`, `selectors` keyed by the semantic vocabulary, `theme`,
   `brandColor`, `capabilities`, optional `conversationIdPattern`,
   `turnKeyAttributes` and `routeWords`, the static path segments site-check
   reports keep). Nothing registers it: the registry picks it up from the
   file. `turnKeyAttributes` names the attributes that keep a user message's
   identity across remounts; send tracking (`sends/trackUserSends.ts`, behind
   folder Activity and catalog timeline timestamps) runs only on a site that
   names them, its `composer` and `userTurn`, and a `conversationIdPattern`.
2. Create `catalog/sites/<site>/plugins/<id>/` with `plugin.json`, `style.css`
   and a short `README.md`.
3. Keep the plugin's `matches` inside the site's `matches` (D18).
4. Add the entry to `catalog/marketplace.json` (`plugin:new` does it for you).
5. Run the suite: discovery, D18 and the marketplace index are all asserted in
   `catalog/sites/index.test.ts`.

Manifests may keep tiny CSS inline with `{ "css": "..." }`, but the preferred
authoring shape is `{ "file": "style.css" }` next to `plugin.json`. The bundled
source and the published catalog file both resolve that CSS to inline text,
reject anything that loads, from the page's own origin too (`@import`,
`image-set()`, `image()`, `cross-fade()`, `src()`, a `url()` other than a
raster-image `data:` URL or `#fragment`, or any string that starts with an
external URL), and normalize
it before the runtime sees it. A `data:` URL in `url()` must declare a raster
type (`image/png`, `jpeg`, `gif`, `webp`, `avif`, `bmp` or an icon type);
`data:image/svg+xml` is refused in every encoding, because an SVG used as a
filter, mask or clip-path resource can load images of its own. For
user settings, `{{settingKey}}` tokens can be used in CSS text or in
`setAttribute` / `setStyle` DOM op values; a common pattern is for CSS files to
use a normal custom property and for a `setStyle` op to set that variable from a
setting.

Select settings render their declared value/label options in the popup. Localize
each option under `i18n.<locale>.settings.<key>.options.<value>` (engine 1.6.0+).
A select needs at least one option, unique string values (`""` included) and a
default among them; a stored choice the manifest no longer offers resolves to
that default in both the popup and the host (`runtime/resolvePluginSettings.ts`).

Setting fields may declare `enabledBy: "<booleanKey>"` to depend on another
boolean setting in the same plugin. The popup keeps number, select and boolean
controls visible with their values, but disables them unless the controlling
setting's resolved value is `true`; stored values remain intact. The key must
be non-empty and name another boolean field without its own `enabledBy`
(one level only). This affects popup controls; page behavior keeps its own
boolean gate.
Engine 1.7.0 ignores `enabledBy` and leaves the control enabled, so this field
requires no higher engine floor.

`target` is a CSS selector string, or `{ "kind": "semantic", "key": "userTurn" }`
to use the site adapter's stable selector for one of the eleven semantic keys in
`sites/semanticKeys.ts`; a `site.json` may not invent a key outside that
vocabulary. Supported ops: `addClass`,
`setAttribute`, `setStyle`, `hide`, plus `native` ([verbs/README.md](verbs/README.md)). All are reversible.
Inline styles are layered per longhand property: a `setStyle` value or a whole
`style` attribute is expanded into longhands (a trailing `!important` is kept as
priority), so turning one plugin off restores only the longhands it wrote and never
another live plugin's value. A `var()` shorthand written with `setStyle` stays whole.
Classes must be `gv-` prefixed (content-script rule). `setAttribute` names are an
exact-match allowlist: `data-*`, `aria-*`, `title`, `role`, `lang`, `dir`,
`hidden`, `tabindex`, `draggable`, `spellcheck`, `translate` and `style`; URL,
`on*`, `class` and `id` attributes are refused because a selector can reach any
page element. `setStyle` values and `style` attributes follow the CSS rule
above, and attribute values may not contain an external URL. All of this is
checked again after `{{setting}}` substitution (`manifest/sinkGuards.ts`).

## Topics in their own files

- [Write your own plugin locally](local/README.md): the import gate, the
  authoring contract and the packaged Gemini / AI Studio plugins.
- [Primitives and the `native` op](verbs/README.md): contracts, params and
  engine floors.
- [Requirements and plugin status](runtime/README.md): `requires`, the status
  each plugin reports, health, update timing and evolution.
- [Remote host catalog](remote/README.md): the per-host catalog channel and its
  merge rules.

## Boundaries

- **Official CSS/JSON plugins** live in `catalog/sites/<site>/plugins/<id>/` and
  load through `BundledCatalogPluginSource`. Their site adapters live beside
  them in `catalog/sites/<site>/site.json`.
- **First-party features that need JS** live in `builtin/` and register native
  handlers in the content script. `voyager.formula-copy` is the model here.
- **Updates to those official plugins** can also reach users between releases
  through the [per-host remote catalog](remote/README.md). Only data travels; executable code
  never does.

`sources/defaultSources.ts` defines the active sources and merge rules
([remote/README.md](remote/README.md)).
Maintain bundled official plugins in this repository; the retired
`../voyager-plugins` marketplace is no longer a source. `bun run catalog:build`
generates the remote catalog published by the docs deploy. See the
[distribution decisions](remote/DECISIONS.md). Gemini and AI
Studio became plugin platforms too; their packaged official plugins and the
rules they keep are in [builtin/README.md](builtin/README.md).

## What is NOT done yet (next milestones)

- **A remote-only NEW site.** The catalog updates plugins _and_ adapter data for
  hosts the extension already knows, but the file is fetched per host, and host
  permissions plus content-script registration still ship in the package. Adding
  a site is still an extension release.
- **Full setting UI coverage.** The schema accepts boolean/string/color/select;
  the popup currently renders boolean switches, number/range controls and select
  controls, while string and color controls remain future work.
- **Scripted runtime** via gated `chrome.userScripts`.
- **Account + Stripe entitlement**.

## Platform notes

- **Safari**: declarative only (no `userScripts`, App Store review). Cross-site
  dynamic registration is limited — keep Safari on manifest-declared sites.
- **Firefox**: declarative works; `userScripts` exists but differs; AMO review
  forbids remote code (declarative is the safe path).
- **Android** (Firefox for Android and its forks, Edge and other Chromium
  browsers): every plugin runs unless its `requires.formFactors` is
  `["desktop"]`, which reports `needs-form-factor`
  ([runtime/README.md](runtime/README.md)). Google Drive sync is off wherever the
  browser has no identity API to sign in with, as on Firefox for Android
  (`core/utils/googleDriveSignIn.ts`).
- **Chrome/Edge**: full support, including the future gated `scripted` tier.
