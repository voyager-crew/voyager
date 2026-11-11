# Writing a local plugin with an AI (`local/authoring/`)

Part of [Write your own plugin locally](../README.md): how Voyager helps an AI write the
manifest that the import gate described there then checks.

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
  rules in [../README.md](../README.md), but only over the install the preview saw: if the same id was
  installed, changed or removed meanwhile, nothing is written and the preview
  is refreshed for a new review.

**Create mode.** Every web chat AI is assumed to browse, so the message for it
stays short and the contract lives on a page it reads. `local/creationMessage.ts`
builds the two texts Voyager hands over, from i18n wrapper sentences
(`createModeChatMessage`, `createModeAgentHandoff`) with the request (trimmed,
at most `MAX_PLUGIN_REQUEST_CHARS`), URLs, engine version and command filled in
one pass:

- `buildCreationMessage(request, site, t)` goes in the chat composer of the
  site the plugin targets: read `createPageUrl(site.id)` first, write a plugin
  for that site, the user's plugin engine version as a ceiling, reply with
  exactly one ```json block.
- `buildAgentHandoff(request, site, t)` is copied to a local coding agent: the
  site, `WRITE_PLUGIN_SKILL_URL`, the engine, run
  `npx create-voyager-plugin@latest check` before handing back, and return
  `plugin.json` plus `style.css` for **Import files**.

`authoringSites.ts` holds the site list, `authoringSiteForUrl` and the request
ceiling both flows share.

**One contract, five outputs.** `local/authoring/pluginContract.ts`
(`buildPluginContract(site, { audience, refs })`) is the single description of
what a local plugin may contain: manifest fields, styles, page changes,
settings, the local rules, the site's anchors and notes, the primitives (read
only through `primitiveReference.ts`), what is not possible, and examples. Five
outputs render it:

- the per-site chat pages `docs/public/create/<site>.md` (`createPages.ts`,
  `audience: 'chat'`), served at `https://voyager.nagi.fun/create/<site>.md`
  for the Create mode message. Each inlines what every request needs and one
  example, lists the primitive names that run there, and points at the
  skill's `primitives.md`, `sites/<site>.md` (primitive caveats) and
  `examples.md` with the condition for opening each. It states the engine it
  was generated from and tells the AI to stay at or below the user's;
- the popup prompt above (`pluginAuthoringPrompt.ts`, `audience: 'chat'`, the
  whole contract pasted), until the popup moves to Create mode;
- the public agent skill `docs/public/skills/write-voyager-plugin/`
  (`authoringDocs.ts`): `SKILL.md` with one example, plus `sites/<site>.md`,
  `primitives.md` and `examples.md` behind pointers, served at
  `https://voyager.nagi.fun/skills/write-voyager-plugin/SKILL.md`;
- the `AGENTS.md` that `create-voyager-plugin init` writes next to a new plugin;
- the examples, which `pluginContract.test.ts` runs through
  `validateLocalManifest` (file examples through `readLocalPluginFiles`) for
  every site and both audiences, so no output can teach what the gate refuses.

`bun run skills:build` regenerates the skill folder and the chat pages
(`create-voyager-plugin skill --out` and `create-pages --out`).
`authoringDocs.test.ts` and `createPages.test.ts` fail while either is stale,
so a new primitive, a changed `site.json` or a changed local rule shows up
there.

`packages/create-voyager-plugin/` bundles the same gate and the bundled site
adapters into one dependency-free Node file (`bun run cli:build`): `init` writes
a passing `plugin.json`, `style.css` and `AGENTS.md`, and `check` runs
`readLocalPluginFiles` plus `validateLocalManifest` offline, exit 0 or 1. Its
tests hold it to parity with the in-process gate over a corpus. The package
version follows the extension (`scripts/bump-version.js`).
