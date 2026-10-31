# Primitives (`verbs/`) and the `native` op

Part of the [Plugin ecosystem overview](../README.md). What a plugin declares it needs, and the statuses that follow, are in [runtime/README.md](../runtime/README.md).

Shipped primitives (`verbs/<name>/contract.ts`): `formulaCopy` (since 1.3.0), `vimInput` (since 1.4.0,
`composer` param, defaults to the adapter's `composer` selector) and `turnNavigator` (since 1.4.0,
`turn` / `conversationIdPattern` / `scrollContainer` / `yieldWhen` / `position`, all optional and
defaulting to the adapter, plus the optional `conversationIdAttribute` attribute and `turnItem`
selector since 1.5.0, and `dataBackend: "shared"` on consumer Gemini since 1.9.0) and `userLatex` (since 1.7.0, optional `turn` selector defaulting to the
adapter's `userTurn`, plus an optional `unit` of `leaf` (default) or `turn` since 1.9.0; renders the LaTeX a user typed with Gemini's renderer and restores the text on
unmount) and the code-block diagram primitives `mermaid`, `echarts` and `wavedrom` (all since
1.7.0, optional `turn` / `codeBlock` / `code` / `codeLine` / `language` selectors defaulting to
the adapter's `assistantTurn` and `codeBlock`). Each is Gemini's renderer core plus the shared
engine in `verbs/codeBlockDiagram.ts`, which draws a diagram in a shadow-root panel before the
host's untouched code block; a label counts as a language only when it is shaped like an id, so a
host's localized "plain text" label leaves the block to content detection. New diagram kinds follow
the PATTERN note at the top of that file, and each site gets one `diagram-rendering` plugin listing
its diagram ops: ChatGPT's lists `echarts` and `wavedrom`, since ChatGPT draws Mermaid itself, and
`mermaid` waits for a site that needs it. `codeCollapse` (since 1.8.0, optional
`code` / `action` selectors, blocks from the adapter's `codeBlock` inside `assistantTurn`
and outside `thinkingBlock`) is Gemini's long code block collapse on another site: one engine in
`pages/content/codeBlockCollapse/engine.ts` drives both, Gemini with its blocks expanded until the
user collapses them, the primitive with them collapsed plus expand all / collapse all. The formula-copy,
Vim, Claude-timeline and ChatGPT-timeline builtins are now manifests that invoke these primitives;
the shared timeline engine lives in `../../timeline/TimelineEngine.ts`. Its catalog adapter
(`../../timeline/adapters/catalog/`) accumulates markers across virtualized windows (`turnMerge.ts`)
and keeps stars and hierarchy in per-site local keys, while stars remain available in Saved Library. Star ids come from the URL at
each read or write (`conversationId.ts`); a manifest's `conversationIdPattern` wins over the site
adapter's. A mounted timeline publishes that namespace (`activeStarNamespace.ts`) so ChatGPT
export's starred filter reads the same ids. A site with a `conversationIdPattern` cannot star a
route that does not match it. Without a site adapter the timeline stays inert: its stars, outline
and placement are keyed by the site id. A star is written only for a turn proven to be the current conversation's:
the host's own id for it where the site names one (`conversationIdAttribute` on an ancestor, as
Claude's `data-conv-id`, or inside the turn's `turnItem`; a turn without it is unstarrable), else
the URL when the turn entered the page (`turnOwnership.ts`).

`tableCopy` (since 1.8.0, no parameters) finds tables inside the adapter's
`assistantTurn` and puts a shadow-root toolbar before each reply table that copies it as
Markdown or TSV. The Markdown is conversation export's own `extractTable`, and TSV reads the same
`collectTableRows`, so formulas stay LaTeX and copy never drifts from export.

`collapse` (since 1.8.0) limits the visible height of long content and
places one expand/collapse button after each target. Its optional `target` is a semantic key:
`userTurn` (default), `assistantTurn` or `thinkingBlock`; raw selectors are not accepted.
`maxPx` defaults to 320 and accepts finite numbers from 80 to 2000; `startCollapsed` defaults
to `true`. Content at or below `maxPx + 16` pixels gets no toggle. Streaming content gains a
toggle when it grows past that threshold, and an expanded element stays expanded while the
same host element survives. Labels are localized, buttons work with the keyboard, and styling
supports Voyager's light/dark scheme and RTL layout. Unmount restores the host layout.

Because `target` is configurable, the contract has no fixed semantic requirements. Authors
must declare the chosen key in `requires.semantic`, including `userTurn` when omitting
`target`; a missing adapter selector leaves the primitive inactive. Targeting `assistantTurn`
clips the complete reply, including any thinking content inside it. Choose `thinkingBlock`
separately when only that content should collapse. The primitive has no host-specific checks:
avoid content that already has native collapse, such as DeepSeek's `.ds-collapsible-text`.
There is no expand-all control. A plugin can expose `maxPx` and `startCollapsed` as settings
using `"params": { "target": "userTurn", "maxPx": "{{maxHeight}}", "startCollapsed": "{{startCollapsed}}" }`.

`sendShortcut` claims one composer send mode per page on every site: a second plugin
reports a conflict while the current holder keeps running. The optional `mode`
(since 1.9.0) is `ctrlEnterSends` (default) or `enterSends`. Gemini only accepts
the default, AI Studio only the latter, via the packaged page coordinator; Gemini
Enterprise accepts neither. Composition, Process and keyCode 229 are left to the IME.
Local send plugins are open on Gemini and AI Studio. Disable the corresponding
official send switch to hand the page's mode to a local plugin; the Safari fix
remains paired with Gemini's packaged send owner.

`turnNavigator` likewise claims `timeline-rail` on every site, by design: a second rail on
ChatGPT, Claude or DeepSeek is paused as a conflict while the mounted one keeps running.

`draftSave` (since 1.8.0, no parameters; reads `composer` and
`sendButton`, and stays inert without `conversationIdPattern`) is Gemini's draft auto-save on a
catalog site. It shares `pages/content/draftSave/draftStore.ts` (debounce, empty means remove,
five newest per prefix) and the composer reader/writer in `core/services/composer/`. Drafts are
stored in `chrome.storage.local` as `gvDraft:<siteId>:conv:<id>`, or `gvDraft:<siteId>:new` for
every page without a conversation id, so they never meet Gemini's `gvDraft_<path>` entries.
A draft is restored once per conversation entry and only into an empty composer; a restore
still loading is abandoned once the person types (`core/utils/userEvent.ts` `isUserEvent`, so a
host filling its composer while mounting does not count). A draft is dropped when the composer
empties within two seconds of Enter, the send button or a form submit, or when that send moves
the new-chat page to its conversation; switching from one conversation to another never counts
as a send. While a `sendShortcut` plugin holds the composer's Enter
(`verbs/composerEnterOwner.ts`), Enter is never read as a send: only its button click is. ChatGPT temporary chats save
nothing. These sites have no account index in their routes, so drafts are per site and
conversation, not per account. Unmount stops everything and keeps stored drafts.

On Gemini, the same primitive selects the trusted Gemini policy and shares native
`gvDraft_<full pathname>` records, including `/u/N` and Gem routes. Official and
local draft plugins can run together; writes and five-record pruning are queued
on this page. A confirmed first send clears its source new-chat draft, while
navigation without a send keeps it. Restore checks route, account and input edits
after asynchronous waits, and never restores into an old-question edit input.
Unload makes a best-effort final save; asynchronous storage cannot be guaranteed
after browser closure. Changing email within one account slot still shares stored
drafts. Gemini Enterprise stays inactive. Drafts and their key format survive
any rollback of the plugin owner.

`quoteReply` (since 1.8.0, no parameters; reads `assistantTurn` and
`composer`) is Gemini's quote reply on a catalog site. Selecting text wholly inside one
assistant turn shows a localized Quote button near the selection end; activating it appends the
text to the composer as a Markdown quote (every line prefixed `> `, a blank line after an
existing draft) and never sends. Selections touching a user turn or the adapter's
`thinkingBlock` show nothing. Rendered KaTeX is quoted as its LaTeX source through
`features/formulaCopy/formulaSource.ts`; line prefixing and Gemini math replacement are shared
with Gemini's quote reply in `core/utils/quotedText.ts`. A missing composer shows a toast and
keeps the selection. Unmount removes the button, its style and every listener synchronously.

`copyButton` (since 1.8.0; required `target` of `userTurn`, `assistantTurn`, `thinkingBlock`
or `codeBlock`; optional `format`, which accepts only `text` today) places a small copy button above each
matched element. It copies the element's visible text without Voyager's own controls and
confirms with a toast; the element itself is left untouched.

`counterBadge` (since 1.8.0; `target` is `composer` or `assistantTurn`,
`metric` is `chars` (default), `words`, `cjkChars` or `lines`) shows a small read-only count.
For `composer` it sits above the adapter's `composerRoot` (or the composer's parent), reads the
draft with `readComposer` and hides while the draft is empty; for `assistantTurn` each reply
gets a badge at its end, recounted from `copyableText` once streaming settles. The label is CSS
generated content, so copying, export and the counts themselves never include it. Shipped
plugins use only the composer target.

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

Native params may use `{{settingKey}}` in string values, recursively inside
objects and arrays. Parameter names and object keys stay literal. A whole-value
token preserves the setting's number, boolean or string type; embedded tokens
produce a string. For example, `turnNavigator` can receive
`"params": { "position": "{{side}}" }` from a select setting with `left` and
`right` options. Expansion runs once, so tokens inside setting values remain
literal. Every referenced key must exist in `contributes.settings`, and the
setting type must fit the primitive contract wherever statically knowable.
Manifest loading checks substituted defaults. Each activation substitutes
resolved stored values and runs the primitive's `validateParams`; an invalid
result skips the op through the same diagnostic path as invalid static params.
Settings changes serialize disposal and reactivation for templated primitive
ops; static params keep the existing in-place update path.

Params substitution requires engine 1.8.0, alongside any higher primitive or
parameter floor. It has shipped, so plugins that rely only on it declare a concrete
`">=1.8.0"`; `">=next"` is for a primitive or parameter that is still unreleased.
The capability floor remains 1.8.0 in later releases. Engine 1.7.0 passes tokens
literally to primitive guards, so a selector token can be accepted yet match
nothing; enforcing the floor makes an older build report `needs-engine`.

Each primitive is one folder, `verbs/<name>/`, and adding the folder is all
the registration there is:

- **`contract.ts`** — data only: `export const contract` with the primitive's
  `name` (the folder name), `sinceEngine`, the semantic keys it reads from the
  adapter, and its parameter spec (`type`, `required`, `description`; a
  param that names a semantic key the primitive reads is `type: 'semanticKey'`,
  optionally narrowed by `allowedKeys`). It imports only types and data modules
  (`contractTypes.ts`, `codeBlockDiagramParams.ts`), so Bun scripts and the CLI
  can load it without DOM or implementations; `primitiveFolders.test.ts`
  enforces this.
- **`index.ts`** — the implementation: a primitive object carrying that
  contract, a `validateParams` guard, and `activate(scope, params, context)`.
  Every side effect is registered on the `PluginScope`, so unmount pays them
  all back, and the primitive reports how many elements it acts on through
  `context.setTargetCounter`.
- **`paramsBaseline.json`** — the published params (D9, [runtime/README.md](../runtime/README.md)).

`verbs/contracts.ts` collects the contracts, sorted by name, through
`import.meta.glob`; Bun has no glob, so Bun scripts and the CLI build feed the
same files from disk (`scripts/lib/primitiveContractsSeam.ts`). `verbs/registry.ts`
finds the implementations the same way, and `verifyPrimitiveRegistry()` names
any folder whose contract and implementation disagree. The primitive enums in
`docs/public/plugin.schema.json` are generated: run `bun run skills:build`
after adding a primitive (it also refreshes the public skill).

`PLUGIN_ENGINE_VERSION` records the released engine version and is never
hand-bumped by a contributor. A new primitive or optional parameter declares
`sinceEngine: 'next'`; its dependent catalog plugin uses `"engine": ">=next"`.
The shared resolver maps `next` to the released engine plus one minor, patch
zero (1.8.0 → 1.9.0). While any contract or param is `next`, this tree runs that
effective engine version, so its bundled unreleased plugins are usable.

A manifest that uses a primitive must set an `engine` range whose **minimum** is
at least its resolved `sinceEngine`, and `bun run catalog:build` fails the build
otherwise (D9). Contributor checks, CLI checks and bundled loading
resolve the same notation. Catalog publishing writes only concrete versions,
so a released extension filters an update requiring the next engine without
mistaking it for a remote kill switch. Local imports require concrete versions;
the public authoring skill and CLI scaffold document resolved primitive floors.

`bun run bump` stamps all unpublished contracts, param baselines and dependent
catalog manifest ranges, and advances the engine only when `next` exists. A
release gate rejects any remaining `next`; extension-version bumps without
unpublished engine additions leave the engine version unchanged.

The primitive engine floor makes an older Voyager report `needs-engine`
("update Voyager") instead of `needs-handler`, which means a configuration
mistake. `catalog:build` also rejects a handler
with no contract, and a semantic key the plugin's own site does not define.

A param added to a shipped primitive carries its own `sinceEngine` (D9: params
are only ever added). An older engine rejects a param it does not know and skips
the whole op, so a manifest that sets the param needs an `engine` floor at least
that high; `plugin:check` and `catalog:build` enforce it alongside the primitive
floor, and `builtin.test.ts` applies the same check to the builtins.
