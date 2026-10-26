# Write your own plugin locally (`local/`)

Part of the [Plugin ecosystem overview](../README.md).

A user can run a declarative plugin they wrote without publishing it:

1. Write `plugin.json` as in "Authoring a declarative plugin" ([overview](../README.md)), plus its `style.css` (or inline the CSS
   as `{ "css": "..." }`). Any lowercase reverse-dotted `id` works; it is stored
   as `local.<id>`.
2. Open the popup and find **Local plugins**: on Claude, ChatGPT or DeepSeek it
   sits on the plugin page; on Gemini and AI Studio it is a settings card
   (collapsed until opened, or until a local plugin targets the page, which
   then also shows its toggle and settings). By default it follows cloud sync
   and the eight plugin topic cards and comes before folders through general
   (`NATIVE_POPUP_SECTION_IDS` in `pages/popup/utils/nativeSiteCapabilities.ts`);
   users can reorder it. Choose **Import files** (pick
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
  plugin contract for that site (see "One contract, four outputs" below), and
  "reply with exactly one ```json block".
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
  recomputed when the picker changes, no prompt needed), and a `theme` the
  prompt asked the AI to leave out; a primitive is listed as a change, not
  flagged, because the prompt offers it where the gate accepts it). CSS is not summarized: its full
  source is shown with a plain warning that it can change anything, hiding
  included, since reading its effect would be a guess. It builds on `inspectPlugin`, and
  the same inspect view opens under it on demand. **Import** hands the exact previewed
  object to `importLocalPlugin`, so it lands disabled and follows the re-import
  rules above, but only over the install the preview saw: if the same id was
  installed, changed or removed meanwhile, nothing is written and the preview
  is refreshed for a new review.

**One contract, four outputs.** `local/authoring/pluginContract.ts`
(`buildPluginContract(site, { audience })`) is the single description of what a
local plugin may contain: manifest fields, styles, page changes, settings, the
local rules, the site's anchors and notes, the primitives (read only through
`primitiveReference.ts`), what is not possible, and examples. Four outputs
render it:

- the popup prompt above (`audience: 'chat'`: inline CSS, no `theme`, primitives
  where the site allows them, plus a pointer to the public skill for an AI that
  can browse; the pasted contract wins where the two differ);
- the public agent skill `docs/public/skills/write-voyager-plugin/SKILL.md`
  (`authoringDocs.ts`), committed and served at
  `https://voyager.nagi.fun/skills/write-voyager-plugin/SKILL.md`. Regenerate it
  with `bun run skills:build`; `authoringDocs.test.ts` fails while it is stale,
  so a new primitive, a changed `site.json` or a changed local rule shows up
  there;
- the `AGENTS.md` that `create-voyager-plugin init` writes next to a new plugin;
- the examples, which `pluginContract.test.ts` runs through
  `validateLocalManifest` (file examples through `readLocalPluginFiles`) for
  every site and both audiences, so no output can teach what the gate refuses.

`packages/create-voyager-plugin/` bundles the same gate and the bundled site
adapters into one dependency-free Node file (`bun run cli:build`): `init` writes
a passing `plugin.json`, `style.css` and `AGENTS.md`, and `check` runs
`readLocalPluginFiles` plus `validateLocalManifest` offline, exit 0 or 1. Its
tests hold it to parity with the in-process gate over a corpus. The package
version follows the extension (`scripts/bump-version.js`).

The gate (`local/validateLocalManifest.ts`) is the remote catalog's gate plus
local-only rules, never a weaker one: `validateManifest` with the CSS and
rendered-sink guards, `tier: "declarative"` only, `native` ops only for primitives
this build ships with params that match their contract and an `engine` floor
at or above their `sinceEngine` (`manifest/primitiveChecks.ts`, shared with
`plugin:check`), and `matches` inside a plugin platform's `matches` or a native
surface's (`sites/nativeSurfaces.ts`: Gemini, AI Studio), so enabling a local
plugin can only request host access an official plugin could, or none at all.
A plugin for Gemini or AI Studio may not declare `theme` (those pages keep
Voyager's own accent). Its `native` ops follow a capability policy per (site,
handler) in `sites/hostPolicy.ts`, derived from the owner table
`sites/featureOwners.ts`: only primitives explicitly listed in a plugin-owned
entry's `handlers` open on that site. Fixed-id builtins can own a feature with
no public primitive: Quote, Highlight, prevent auto-scroll, completion
notifications and NanoBanana’s two controls are such builtins. Their owner flips
keep other native ops closed. A multi-site manifest must be legal on each site
its patterns reach. Import, paste and the CLI enforce this policy; re-reading stored plugins
(`LocalPluginSource`, the popup list, review-and-enable) passes
`hostPolicy: 'defer'`, which skips only this site policy, so a build that
closes a primitive again keeps the user's plugin and reports it
`blocked: host-policy`.
`local/localPluginRules.ts` adds three rules that turn a plugin which would
import and then do nothing into an actionable error: `addClass` adds one
`gv-` prefixed class; every semantic key the plugin relies on (op targets,
`requires.semantic`, a primitive's keys and the keys its `semanticKey` params
name) is declared by every site its
`matches` target, or the popup would only show `needs-semantic`; and settings
are `boolean`, `number` or `select`, the kinds the popup renders a control for.
Stored records are re-validated on every read by
`local/LocalPluginSource.ts`, and at runtime `PluginHost` and the brand theme
refuse a theme or native op by the page's real host
(`sites/hostPolicy.ts`), whatever the patterns say. By design, a local
plugin's own CSS can still restyle anything on Gemini, Voyager's UI and its
`--gv-*` variables included; only `theme` and the closed native ops are refused.

**Gemini and AI Studio.** The packaged official plugins
(`catalog/sites/{gemini,aistudio}/` and fixed-id entries in `builtin/`) and local
plugins target them; their manifests stay packaged or local. The catalog serves
page-locator profiles for consumer Gemini without publishing these manifests. The official ones replace native modules feature by
feature. Stage 7 retires migrated native startup callbacks and registrations; the content script
admits each official plugin where its native module used to start, and the
plugin follows the native setting it replaces (`storage/legacySettingBindings.ts`).
Its row in a popup topic card writes those legacy-bound keys. The owner table has no `legacy` option: rolling a feature back to its
native module means reverting both stage 7 retirement commits (startup wiring 9c2161df and
native wrappers 0ae260c1) and the commit that removed that option. Permanent page services remain in `nativeFeatures.ts`; their
account bridge, history/message caches, selection host, sent-quote styling,
prevent-auto-scroll bridge, fork first-send finisher and default-model stale-menu cleanup stay
independent of optional plugin switches. The last service only removes old menu UI while the sync
setting is false; the plugin alone selects models and creates new stars.
The page send-key coordinator is the one service started elsewhere:
`startPageSendKeys` in `pages/content/inputStartup.ts` creates it before `PluginHost`.
They resolve semantic keys through the native
`geminiAdapter` / `aistudioAdapter`, which expose the keys their packaged
`site.json` declares (the Gemini `sidebar` key also covers Voyager's folder
panel, so prefer a precise CSS selector there). The manifest already injects the content
script and grants these hosts, so enabling one needs no permission prompt and
`pluginsToOriginPatterns` leaves their origins out of dynamic registration
(registering them would inject Voyager twice). `PluginHost` mounts them with
the same reversible engine as elsewhere, and turning one off removes its
classes and stylesheet. AI Studio's master switch (`GV_AISTUDIO_ENABLED`,
`runtime/surfaceSwitch.ts`) governs plugins too: while Voyager is off on AI
Studio ordinary plugins do not mount, and flipping it unmounts or remounts them live. Gemini
has no page-wide master switch. Its **Show Timeline** switch controls only the
rail and navigation shortcut lease; saved stars and hierarchy remain, and the
message timestamp labels plugin follows **Show Message Timestamps** independently;
history and turn identity remain page services.

The packaged owners in [`sites/featureOwners.ts`](../sites/featureOwners.ts) and
the builtins in [`builtin/index.ts`](../builtin/index.ts) cover:

- Gemini: Chat width, edit input width, font size, line height and paragraph spacing, sidebar width,
  sidebar auto-hide, sidebar full hide, Gems sidebar count, hide input halo; formula copy, Canvas
  copy, Deep Research export, user LaTeX, code collapse, Mermaid, WaveDrom, ECharts, Markdown fix,
  watermark download and preview; Vim input, prompt history, input collapse, Ctrl+Enter send, Safari
  Enter fix, draft save, quote reply; timeline, message timestamps, highlights, prevent auto-scroll,
  response notifications, batch delete, research pack, default model, fork, usage status, context
  sync. Gemini moved Gems into its More menu, so without a visible native Gems entry the Gems
  sidebar mounts its list in its own collapsible Gems section below the top nav.
- AI Studio: Formula copy, Enter send, sidebar width, batch delete.
- ChatGPT: Formula copy, Vim input, timeline, conversation export, temporary chat handoff, folders,
  response notifications.
- Claude: Formula copy, Vim input, timeline.
- Shared: Visual effects on already-injected pages, including authorized Prompt Manager custom
  sites.

Other sites' declarative plugins live in `catalog/sites/`. Every packaged Gemini / AI Studio
official plugin has a popup row in the
[`officialPluginRegistry.ts`](../../../pages/popup/officialPlugins/officialPluginRegistry.ts).
For the next migration, follow the [native migration recipe](../../../../.agents/skills/create-voyager-plugin/references/native-migration.md)
and the popup's [Adding a row](../../../pages/popup/officialPlugins/README.md#adding-a-row).

**NanoBanana watermark removal.** Two packaged fixed-ID builtins,
`voyager.gemini-watermark-download` and `voyager.gemini-watermark-preview`, map
one-to-one to the existing popup switches and are admitted at the former native
start point. Both derive enablement through `core/utils/watermarkSettings.ts`:
`gvWatermarkDownloadEnabled` and `gvWatermarkPreviewEnabled` take precedence if
either holds a boolean, with an unset sibling retaining the historical `true`
default; otherwise `geminiWatermarkRemoverEnabled` controls both, and no saved
preference means both are off. The popup writes the same keys; none are copied
into `gvPluginsState`. Neither builtin opens a public native primitive or adds
permissions. The shared image worker and download bridge remain packaged
services. Safari keeps its static MAIN-world hooks, asynchronous extension-message
routing and authenticated page-fetch fallback; full-size browser downloads keep
using that path. There is no dedicated watermark-processing Swift channel.

Disabling preview invalidates pending DOM writes. It restores the original
`src`/`srcset` pair only while `src` still equals Voyager’s blob URL and `srcset`
is still absent. If the host changed either attribute, the current pair stays
intact. A blob URL is revoked only once `src` no longer references it; a host
`srcset` may still fall back to that blob, which is retained until document unload.
Disabling download removal stops accepting new removal work immediately;
already-accepted downloads finish once with their setting at acceptance, including
across an off/on cycle. Static MAIN-world hooks cannot be unregistered: their
removal path checks the current setting and stays inert when off. Independent
read-only watermark health inspection may continue while removal is off.
The accepted download is a one-shot promise with one response and the existing
timeout fallback, independent of either activation’s lease. It does not gain a
`startMachine`: no intermediate phase is cancelled by the switch, and aborting
a state scope here would lose the response an accepted request still needs.

**Shared Visual effects.** `voyager.visual-effects` is one packaged builtin on every
already-injected page, including authorized Prompt Manager custom sites. It is admitted
before normal initialization and excluded from plugin subframes, as its native predecessor
was. It remains independent of AI Studio's master switch. Its `<all_urls>` runtime match
adds no host permission or content-script registration, and its fixed ID never requests an
origin grant. `gvVisualEffect` is authoritative across sites: any string takes precedence
(unknown strings render nothing), otherwise `gvSnowEffect === true` selects snow. The trusted
enum value binding fills `effect`; nothing is copied into `gvPluginsState`. The popup's
Visual effects row writes those legacy-bound keys on every site: in the Page layout topic
card on Gemini and AI Studio, and in a plugin site's plugin card once Voyager can run there
(a site enabled for Prompt Manager or a plugin). `legacyEnableWrite` selects snow when enabled and `off` when
disabled; both clear the legacy boolean. No previous effect is remembered. PluginScope owns
the activation's selection while the page holds renderers through a graceful drain; re-enable
resumes them, and page teardown destroys canvases, renderer frames and workers immediately.

Local `turnNavigator` on consumer Gemini requires literal `params: { "dataBackend": "shared" }`
(engine >=1.9.0). It reads and edits the same native stars, levels and collapse state, waits for
both page-owned timestamp caches, and inherits the official rail’s admission. Its own plugin
switch controls the rail independently of **Show Timeline**. Both claim `timeline-rail`: the
official setting wins on a cold page, while a mounted holder keeps the rail until disabled.
Turn off **Show Timeline** before enabling a local replacement; turn the local plugin off before
returning to the official rail. Shared manifests stay within `https://gemini.google.com/*` and
cannot override turn, route or account identity. Business, Enterprise and custom coverage
do not admit this native-data rail. Consumer Gemini can receive page-locator fixes
through the shared online catalog; a local plugin does not change catalog eligibility
or update settings. Gemini Enterprise and AI Studio remain packaged-only.
A minimal Gemini plugin:

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
