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
  current URL. Site-specific selectors live **only** in an adapter, behind the
  fixed semantic vocabulary in `sites/semanticKeys.ts` (`userTurn`,
  `assistantTurn`, `thinkingBlock`, `codeBlock`, `composer`, `sidebar`,
  `sidePanel`, `headerActions`, `scrollContainer`), so a site redesign is a
  one-file fix. Gemini and AI Studio are native surfaces and stay TypeScript
  adapters; every plugin platform is data, so `adapters/claude.ts`,
  `adapters/chatgpt.ts` and `adapters/deepseek.ts` are one-line shells over their
  `site.json`: edit the JSON, not the TS. `sites/siteAdapterData.ts` holds
  `validateSiteAdapterData`, the one validator for the bundled `site.json`, the
  remote override and `catalog:build`.
- **`runtime/declarativeEngine.ts`** — applies a manifest's `styles` + `domOps`.
  Reversible (full teardown), idempotent, and uses a `childList`-only
  MutationObserver so its own mutations can't loop. Pure DOM → all platforms.
- **`runtime/PluginHost.ts`** — orchestrator. Loads manifests, checks
  match-URL + enabled + engine-range + entitlement, mounts/unmounts, reacts to
  state changes. All dependencies injected → fully unit-testable.
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
  summary the popup shows. See "Write your own plugin locally" below.
- **`remote/`** — the per-host remote catalog channel: a read-only source over a
  storage cache, plus a background-only fetcher. See below.
- **`catalog/`** — the bundled official data: one directory per plugin platform,
  each holding that platform's `site.json` and its declarative plugins. This
  keeps official CSS/JSON changes in the same PR, CI run, and release as engine
  or popup changes.

```
catalog/
  marketplace.json                        index for the docs plugin store
  sites/index.ts                          import.meta.glob discovery
  sites/<site>/site.json                  the site adapter, as data
  sites/<site>/plugins/<id>/plugin.json   a declarative plugin
  sites/<site>/plugins/<id>/style.css     its styles
  sites/<site>/plugins/<id>/README.md     what it fixes and why
```

`catalog/sites/index.ts` finds every `site.json` and `plugin.json` with
`import.meta.glob`, so adding a site or a plugin is adding files: there is no
mapping table. (`scripts/build-plugin-catalog.ts` reads the same tree from disk,
because `import.meta.glob` does not exist under Bun.) Sites today are `chatgpt`,
`claude` and `deepseek`. A plugin's `matches` must stay inside its site's
`matches` (plan D18) or the build fails, and `bun run catalog:build` validates
every site and plugin before publishing.

`catalog/marketplace.json` is **not** that mapping table. It is only the index
the docs plugin-store page reads at build time, and a test keeps it in sync with discovery,
so a new plugin also needs an entry there whose `source` is the catalog-relative
path (`sites/deepseek/plugins/reading-width/plugin.json`).

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
   `brandColor`, `capabilities`, optional `conversationIdPattern`). Nothing
   registers it: the registry picks it up from the file.
2. Create `catalog/sites/<site>/plugins/<id>/` with `plugin.json`, `style.css`
   and a short `README.md`.
3. Keep the plugin's `matches` inside the site's `matches` (D18).
4. Add the entry to `catalog/marketplace.json` so the docs plugin store lists it.
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

`target` is a CSS selector string, or `{ "kind": "semantic", "key": "userTurn" }`
to use the site adapter's stable selector for one of the nine semantic keys in
`sites/semanticKeys.ts`; a `site.json` may not invent a key outside that
vocabulary. Supported ops: `addClass`,
`setAttribute`, `setStyle`, `hide`, plus `native` (below). All are reversible.
Classes must be `gv-` prefixed (content-script rule). `setAttribute` names are an
exact-match allowlist: `data-*`, `aria-*`, `title`, `role`, `lang`, `dir`,
`hidden`, `tabindex`, `draggable`, `spellcheck`, `translate` and `style`; URL,
`on*`, `class` and `id` attributes are refused because a selector can reach any
page element. `setStyle` values and `style` attributes follow the CSS rule
above, and attribute values may not contain an external URL. All of this is
checked again after `{{setting}}` substitution (`manifest/sinkGuards.ts`).

## Write your own plugin locally (`local/`)

A user can run a declarative plugin they wrote without publishing it:

1. Write `plugin.json` exactly as above, plus its `style.css` (or inline the CSS
   as `{ "css": "..." }`). Any lowercase reverse-dotted `id` works; it is stored
   as `local.<id>`.
2. Open the popup and find **Local plugins**: on Claude, ChatGPT or DeepSeek it
   sits on the plugin page; on Gemini and AI Studio it is the last entry of the
   settings (collapsed until opened, or until a local plugin targets the page,
   which then also shows its toggle and settings). Choose **Import files** (pick
   the manifest together with its `.css` files) or **Paste JSON** (a manifest
   with its CSS inlined).
3. A rejected import lists every problem as `path: message` and leaves the
   installed version untouched. An accepted one is stored **disabled** and its
   inspect view shows the sites it matches, the CSS size, every page change,
   each Voyager primitive it calls with its params, and its settings.
4. Turn it on from the plugin list like any other plugin; it applies live. To
   update it, edit the files and import again: a re-import also lands disabled,
   so the user re-inspects the new version (it may add a `native` op) and turns
   it back on. A plugin with a `native` op that was running when it was
   re-imported keeps its mounted version until the page reloads, as official
   ones do (D7). **Export** downloads the stored manifest with CSS inlined;
   **Remove** deletes it with its enable state and settings.

**Describe a change in one sentence.** The same panel can write the manifest
with any AI the user already uses, while Voyager itself stays offline:

- `local/pluginAuthoringPrompt.ts` turns the sentence and a chosen site (the
  active tab's when supported) into a self-contained prompt: the request, the
  site's `matches`, the contract derived from the gate's own exports (`OP_KINDS`,
  `REQUIRED_STRINGS`, the attribute allowlist), the site's semantic anchors, a
  minimal example, and "reply with exactly one ```json block". Its tests run the
  embedded example and every op template through `validateLocalManifest` for
  every site, so the prompt cannot drift from the gate.
- The user copies the prompt and sends it themselves. Voyager never sends it,
  opens or deep-links an AI page, reads one back, or makes a request.
- `local/pluginReply.ts` takes the pasted reply (bounded, linear fence scan;
  one ```json or unlabeled block, or bare JSON; zero or several blocks are
  refused by name) through `readLocalPluginFiles` and the gate without
  installing it. The popup closes while the user is in their AI tab, so this
  step works on its own in a fresh popup.
- `local/pluginPreview.ts` describes the result in plain terms (sites, each
  change, warnings for hidden content via `hide`, `hidden` or a hiding inline
  style, raw selectors, a replaced version, a
  reply that misses the selected site (the active tab's, or the user's pick;
  recomputed when the picker changes, no prompt needed), and a `theme` or `native`
  op the prompt asked the AI to leave out). CSS is not summarized: its full
  source is shown with a plain warning that it can change anything, hiding
  included, since reading its effect would be a guess. It builds on `inspectPlugin`, and
  the same inspect view opens under it on demand. **Import** hands the exact previewed
  object to `importLocalPlugin`, so it lands disabled and follows the re-import
  rules above, but only over the install the preview saw: if the same id was
  installed, changed or removed meanwhile, nothing is written and the preview
  is refreshed for a new review.

The gate (`local/validateLocalManifest.ts`) is the remote catalog's gate plus
local-only rules, never a weaker one: `validateManifest` with the CSS and
rendered-sink guards, `tier: "declarative"` only, `native` ops only for primitives
this build ships with params that match their contract and an `engine` floor
at or above their `sinceEngine` (`manifest/primitiveChecks.ts`, shared with
`plugin:check`), and `matches` inside a plugin platform's `matches` or a native
surface's (`sites/nativeSurfaces.ts`: Gemini, AI Studio), so enabling a local
plugin can only request host access an official plugin could, or none at all.
A plugin for Gemini or AI Studio may not declare `theme` (those pages keep
Voyager's own accent) or any `native` op (every shipped primitive, the
timeline, formula copy and Vim, already runs there as a native Voyager
feature, and a second copy would fight it): CSS and reversible DOM ops only.
Stored records are re-validated on every read by
`local/LocalPluginSource.ts`, and at runtime `PluginHost` and the brand theme
refuse a theme or native op by the page's real host
(`sites/nativeSurfaces.ts`), whatever the patterns say. By design, a local
plugin's own CSS can still restyle anything on Gemini, Voyager's UI and its
`--gv-*` variables included; only `theme` and native ops are refused.

**Gemini and AI Studio.** Only local plugins can target them; the bundled and
remote catalogs never do. They resolve semantic keys through the native
`geminiAdapter` / `aistudioAdapter` (`userTurn`, `assistantTurn`, `composer`,
`sidebar`; the Gemini `sidebar` key also covers Voyager's folder panel, so
prefer a precise CSS selector there). The manifest already injects the content
script and grants these hosts, so enabling one needs no permission prompt and
`pluginsToOriginPatterns` leaves their origins out of dynamic registration
(registering them would inject Voyager twice). `PluginHost` mounts them with
the same reversible engine as elsewhere, and turning one off removes its
classes and stylesheet. AI Studio's master switch (`GV_AISTUDIO_ENABLED`,
`runtime/surfaceSwitch.ts`) governs plugins too: while Voyager is off on AI
Studio nothing mounts, and flipping it unmounts or remounts them live. Gemini
has no master switch. The zero-request promise
holds: `isEligibleCatalogHost` refuses every native host, so a Gemini page has
no catalog host, never asks for a check and never reads a catalog cache, and
the background refuses a forced check for them too. A minimal Gemini plugin:

```json
{
  "id": "me.gemini-compact-turns",
  "name": "Compact Gemini turns",
  "version": "1.0.0",
  "description": "Tighter spacing between my messages",
  "author": "me",
  "category": "readability",
  "license": "MIT",
  "engine": ">=1.0.0",
  "tier": "declarative",
  "matches": ["https://gemini.google.com/*"],
  "contributes": {
    "styles": [{ "css": ".gv-plugin-compact-turn{margin-block:4px!important}" }],
    "domOps": [
      {
        "op": "addClass",
        "target": { "kind": "semantic", "key": "userTurn" },
        "className": "gv-plugin-compact-turn"
      }
    ]
  }
}
```

Ownership and precedence:

- **`local.*` is reserved.** Ids are forced into it on import; `plugin:check`
  rejects an official plugin in it and `mergePluginRecords` drops any builtin,
  bundled or remote record that claims one. A local plugin can therefore never
  replace an official one, and its enable state and settings in
  `storage/pluginState.ts` never share a key with one.
- **Merged last, outside the kill switch.** The remote catalog says nothing about
  a user's own plugin, and an enabled local plugin never makes a page eligible
  for a catalog check (`remote/hostCatalogPolicy.ts`). A kindless or official
  source cannot serve a `local.*` id either: only `kind: 'local'` does.
- **Storage.** Manifests live in `chrome.storage.local` under
  `StorageKeys.PLUGIN_LOCAL_MANIFESTS` (at most 50; per import at most
  1,000,000 characters read, 32 style entries and 1,000,000 characters of CSS
  after file expansion, checked before anything is expanded or scanned). An
  import writes the manifest and its `enabled: false` in one `storage.set`, so
  no page ever sees the new version enabled. Mutations reject on a failed read
  (never write back a map rebuilt from nothing), keep entries this build cannot
  read, and hold the `gv-local-plugins` Web Lock (`storage/pluginStorageLock.ts`),
  which every plugin-state writer shares, so neither a second popup nor a late
  setting toggle or Drive restore can write an old `enabled: true` back over a
  new version. Content scripts cannot share that lock, so they send setting
  changes to the background (`requestPluginSetting`). They stay on the device:
  the enable state rides the plugin-state Drive backup, but the manifests
  themselves do not, and a restore may switch a local plugin off but never on;
  export them to keep a copy.

## Primitives (`verbs/`) and the `native` op

Shipped primitives (`verbs/contracts.ts`): `formulaCopy` (since 1.3.0), `vimInput` (since 1.4.0,
`composer` param, defaults to the adapter's `composer` selector) and `turnNavigator` (since 1.4.0,
`turn` / `conversationIdPattern` / `scrollContainer` / `yieldWhen` / `position`, all optional and
defaulting to the adapter, plus the optional `conversationIdAttribute` attribute and `turnItem`
selector since 1.5.0). The formula-copy,
Vim, Claude-timeline and ChatGPT-timeline builtins are now manifests that invoke these primitives;
the shared timeline engine lives in `../timeline/TimelineEngine.ts`. Its catalog adapter
(`../timeline/adapters/catalog/`) accumulates markers across virtualized windows (`turnMerge.ts`)
and keeps stars and hierarchy in per-site local keys, while stars remain available in Saved Library. Star ids come from the URL at
each read or write (`conversationId.ts`) through the site adapter's `conversationIdPattern`, which a
manifest's pattern only fills in where the adapter has none, so ChatGPT export's starred filter
reads the same ids; a site with a `conversationIdPattern` cannot star a route that does not match
it. Without a site adapter the timeline stays inert: its stars, outline and placement are keyed by
the site id. A star is written only for a turn proven to be the current conversation's:
the host's own id for it where the site names one (`conversationIdAttribute` on an ancestor, as
Claude's `data-conv-id`, or inside the turn's `turnItem`; a turn without it is unstarrable), else
the URL when the turn entered the page (`turnOwnership.ts`).

Some behaviour cannot be expressed as CSS or as the reversible DOM operations.
A **primitive** is that behaviour, written once as first-party TypeScript inside
the extension and given a name a manifest can call:

```jsonc
{
  "engine": ">=1.3.0",
  "requires": { "handlers": ["formulaCopy"] },
  "contributes": {
    "domOps": [{ "op": "native", "handler": "formulaCopy", "params": {} }],
  },
}
```

The manifest picks a primitive and configures it. It never supplies logic: no
conditions, no ordering, no code. `params` is configuration, checked by that
primitive's own hand-written guard before the primitive sees it (plan C1, D17).
That is what keeps a remote manifest data rather than remotely-hosted code, and
it is why `native` is safe on the same channel as CSS.

Three files divide the work:

- **`verbs/contracts.ts`** — data only: every primitive's `name`, `sinceEngine`,
  the semantic keys it reads from the adapter, and its parameter spec. It
  imports no DOM and no implementation, so `scripts/build-plugin-catalog.ts`
  can read it under Bun.
- **`verbs/registry.ts`** — the implementations, keyed by name.
  `verifyPrimitiveRegistry()` asserts the two lists match, so a contract can
  never describe a primitive that does not exist and vice versa.
- **`verbs/<name>.ts`** — one primitive: its `contract`, a `validateParams`
  guard, and `activate(scope, params, context)`. Every side effect is registered
  on the `PluginScope`, so unmount pays them all back, and the primitive reports
  how many elements it acts on through `context.setTargetCounter`.

`sinceEngine` is the `PLUGIN_ENGINE_VERSION` that first shipped the primitive.
A manifest that uses a primitive must set an `engine` range whose **minimum** is
at least that version, and `bun run catalog:build` fails the build otherwise
(plan §5, §8). This ordering is the point: an older Voyager then reports
`needs-engine` ("update Voyager") instead of `needs-handler`, which is left
meaning a genuine configuration mistake. `catalog:build` also rejects a handler
with no contract, and a semantic key the plugin's own site does not define.

A param added to a shipped primitive carries its own `sinceEngine` (D9: params
are only ever added). An older engine rejects a param it does not know and skips
the whole op, so a manifest that sets the param needs an `engine` floor at least
that high; `plugin:check` and `catalog:build` enforce it alongside the primitive
floor, and `builtin.test.ts` applies the same check to the builtins.

`requires` states the same needs declaratively:

- `requires.handlers` lists the primitives the plugin invokes. Every `native` op
  is implied, so listing it is documentation, not duplication.
- `requires.semantic` lists semantic keys the plugin depends on beyond the ones
  its ops target. A primitive's own `semantic` keys come from its contract.

`runtime/pluginStatus.ts` derives both sets (`requiredHandlers`,
`requiredSemanticKeys`) and turns them into a status, which `PluginHost` reports
for every plugin that targets the page instead of quietly filtering it:

| Kind             | Meaning                               | Popup                                  |
| ---------------- | ------------------------------------- | -------------------------------------- |
| `needs-engine`   | `engine` range above this build       | toggle disabled, "needs Voyager ≥ x.y" |
| `needs-handler`  | a primitive this build does not ship  | toggle disabled, "update Voyager"      |
| `needs-semantic` | the site adapter lacks a key it needs | toggle disabled, names the site        |
| `ready`          | compatible, not mounted yet           | normal toggle                          |
| `mounted`        | enabled and running on this page      | normal toggle                          |
| `no-effect`      | mounted but found nothing (D12)       | toggle stays on, yellow warning        |

`needs-permission` is not in this list: the popup owns the permission flow, and
a content script that is running already has its permission.

**Health signal (D12).** `runtime/healthMonitor.ts` answers "is this plugin
doing anything here?". It waits for the engine's `childList` observer to go
quiet, then flags a plugin only when the adapter's `userTurn` selector matches
more than zero elements **and** the plugin's own target count is zero. An empty
conversation is never flagged, a slow page is never flagged early (quiet
detection drives the timing; the deadline is only a ceiling), and a target
appearing later clears the flag. Pure-CSS plugins have no countable targets and
are never tracked.

**Update timing (D7).** A CSS or `domOps` update remounts immediately. A
primitive-backed plugin does not: the primitive may hold UI state, so the page
keeps the mounted version, the status carries `pendingVersion`, and the popup
says the update applies after a reload. A SPA `pushState` is not a reload; only
a full page load switches versions.

**Evolution (D9).** A published parameter never changes type and never becomes
required. Parameters may only be **added**, and only as **optional**. Anything
breaking ships under a new primitive name, so `handler` never needs a version
suffix. A committed baseline in `verbs/paramsBaseline.json` holds the contract
tests to this.

`formulaCopy` is the first primitive, and
`catalog/sites/deepseek/plugins/formula-copy/` is the first plugin built on one.
The native builtin `voyager.formula-copy` is unaffected and stays as it is until
P4 rewrites the Claude and ChatGPT builtins as primitive-backed JSON.

## Boundaries

- **Official CSS/JSON plugins** live in `catalog/sites/<site>/plugins/<id>/` and
  load through `BundledCatalogPluginSource`. Their site adapters live beside
  them in `catalog/sites/<site>/site.json`.
- **First-party features that need JS** live in `builtin/` and register native
  handlers in the content script. `voyager.formula-copy` is the model here.
- **Updates to those official plugins** can also reach users between releases
  through the per-host remote catalog below. Only data travels; executable code
  never does.

`sources/defaultSources.ts` defines the active sources and merge rules below.
Maintain bundled official plugins in this repository; the retired
`../voyager-plugins` marketplace is no longer a source. `bun run catalog:build`
generates the remote catalog published by the docs deploy. See the
[distribution design](../../../.github/docs/PLUGIN_DISTRIBUTION_PLAN.md).

## Remote host catalog (`remote/`)

The official CSS/JSON plugins ship as a snapshot inside the extension, and the
same data is published per site at `<base>/hosts/<host>.json` (default base
`https://voyager.nagi.fun/catalog`, so DeepSeek is
`https://voyager.nagi.fun/catalog/hosts/chat.deepseek.com.json`). A selector fix
can therefore reach users without a store release, while the engine that reads
the data still ships in the package. The host file's optional `site` section is
adapter data validated by the same `validateSiteAdapterData`. It replaces the bundled
adapter only when its `catalogRevision` is strictly newer; ties and unstamped remote data
prefer the bundle. `scripts/build-plugin-catalog.ts` and production browser builds use the same
full-history first-parent Git source revision. Publishing the same commit ties its bundle,
and rebuilding older source cannot make it newer. `generatedAt` remains a diagnostic
publication timestamp. Production browser builds and catalog publication require full history;
shallow checkouts fail clearly rather than stamping a truncated revision. Dev builds and Vitest
stamp the bundle as 0, so any stamped remote adapter wins. Production Pages builds and deploys
run only from main, publishing the docs and catalog together. Source ordering assumes the
append-only main publication lineage; uncommitted production data carries HEAD’s revision. Cache reads do not rewrite or clear older entries, and plugin-list
authority and kill-switch rules are unchanged. A newer `site.json` fix can still travel
without an extension release.

- **`remote/HostCatalogSource.ts`** — a read-only `PluginSource`
  (`kind: 'remote'`). `list({ host })` serves whatever the cache holds for that
  host and never touches the network, so page loads, popup opens and
  catalog-change reloads all stay local. It is authoritative for a host only
  when the cached entry is a successful fetch written by the running extension
  version.
- **`remote/hostCatalogRefresh.ts`** — the only network writer, and it runs in
  the background only. Single flight per host, so concurrent tabs share one
  pass. Gates in order: the build flag; the host shape (plain hostnames, no
  wildcards or ports); the user settings (online-updates switch, check interval
  counted from the last attempt, failure backoff, writer-version staleness); and
  page eligibility, meaning at least one **enabled** plugin targets the host.
  Gemini and AI Studio are never catalog hosts (`isEligibleCatalogHost`), even
  with a local plugin enabled there, so they never produce a request. A manual
  check sends `force` and skips every gate except the build flag and the host
  shape.
- **`remote/hostCatalogPolicy.ts`** — the pure rules the background and the
  content script must agree on (which hosts may be looked up, when a check is
  due, the backoff curve, when a cached entry may be used at all), each one
  directly testable without storage or network.
- **`remote/hostCatalogCache.ts`** — one entry per host under
  `StorageKeys.PLUGIN_HOST_CATALOG_PREFIX`, i.e. `gvPluginHostCatalog:<host>` in
  `chrome.storage.local`. Readers subscribe to **content** changes only:
  recording a failed or byte-identical attempt must not remount plugin CSS or
  feed back into another refresh.
- **`remote/hostCatalogFile.ts`** — validates the published file (`format: 1`,
  matching `host`, a plugin array, an optional `site` section), which
  `scripts/build-plugin-catalog.ts` generates from `catalog/` with the CSS
  inlined. Every entry passes the same `validateManifest` as the bundled
  snapshot and the `site` section the same `validateSiteAdapterData`; a bad
  entry or a bad `site` is skipped and logged, a bad file is discarded whole.
- **`remote/config.ts`** — build-time flags injected through Vite `define`:
  `VOYAGER_PLUGIN_CATALOG_URL` repoints the base URL (https only) for a preview
  environment, and `VOYAGER_PLUGIN_CATALOG_REMOTE=off` compiles a build that
  never contacts the catalog host, leaving the bundled snapshot as the only
  source. The second flag is the store-review fallback.

**Settings** live in `chrome.storage.sync` and are covered by
`SettingsBackupService`: `gvPluginOnlineUpdatesEnabled` (master switch, on by
default) and `gvPluginCatalogCheckInterval` (`1h` / `6h` / `24h` / `manual`,
default `6h`). The popup surfaces both on plugin sites, plus a manual check that
works even when the switch is off.

**Message**: a content script or the popup sends `gv.pluginCatalog.refresh`
(`PLUGIN_CATALOG_REFRESH_MESSAGE` in `runtime/messages.ts`) with
`{ host, force }`. The background decides and writes the cache entry; nothing
else fetches.

**Merge rules** — `mergePluginRecords` in `sources/defaultSources.ts`, per
plugin id:

- builtin ids always come from `builtin/`; a remote entry with the same id is
  ignored, so first-party scope and settings can never be rewritten remotely;
- a remote entry whose `engine` range this build satisfies replaces the bundled
  copy;
- if the remote entry needs a newer engine, the bundled copy stays and carries
  `blockedUpdate`, which the popup renders as "needs a newer Voyager" (when
  neither copy is compatible the remote one is listed and the status machine
  reports needs-engine);
- when the remote catalog is authoritative for the host, a bundled plugin that
  targets the page and is absent from the catalog is dropped: the kill switch;
- a 404, a failed fetch, or an entry written by a different extension version
  contributes nothing, so the bundled snapshot stays in force until the next
  successful fetch;
- `local.*` ids belong to the user: an official or remote record in that
  namespace is dropped, and local plugins are added last, never replace an
  official id, and are outside the kill switch.

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
- **Chrome/Edge**: full support, including the future gated `scripted` tier.
