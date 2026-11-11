# Writing a local plugin with an AI (`local/authoring/`)

Part of [Write your own plugin locally](../README.md): how Voyager helps an AI write the
manifest that the import gate described there then checks.

**Create mode.** Two surfaces ask for the same one sentence ("What should
change?"). The panel's **Create** tab works on the page the panel sits on:
**Create on this page** fills a new chat's composer there (the in-page loop
below) and **Copy for a local agent** copies the handoff. The popup's **My
creations** card adds a site picker (it follows the active tab's site, which
resolves after the card mounts, until the user picks one) and
offers **Copy for this chat** and **Copy for a local agent**. Voyager never
sends a message, loads or deep-links a page, or makes a request: it fills an
empty composer or the clipboard, and the user presses send. It reads an AI
reply back in one case only: on the page, in a chat where a user message
links a create page (`isCreationChatText`), which every creation message
does. Anywhere else the user pastes the reply into the popup. Every web chat
AI is assumed to browse, so the message for it stays short and the contract
lives on a page it reads, except on a site in `inlineCreatePage.ts`, whose
default chat AI cannot open a link (Gemini's Flash): there the message carries
`renderCreatePage(site)`, the published page's own text, between marked lines,
names the page URL (the Create chat marker) and ends with the request
(`createModeChatMessageInline`). `local/creationMessage.ts` builds both texts from
i18n wrapper sentences (`createModeChatMessage`, `createModeAgentHandoff`)
with the request (trimmed, at most `MAX_PLUGIN_REQUEST_CHARS`), URLs, Voyager
version and command filled in one pass:

- **Copy for this chat** and **Create on this page**:
  `buildCreationMessage(request, site, t)`, for the chat of the site the plugin
  targets (the page filling it builds it with its own site): read `createPageUrl(site.id)` first,
  write a plugin for that site, the user's Voyager version as a ceiling,
  reply with a single json code block. Nothing Voyager puts in a composer
  (this message, the inlined create page, `createModeFixIntro`) holds a triple
  backtick: ChatGPT's composer opens a code box at one and swallows the rest.
  The chat pages show their example as an indented code block for that reason.
- **Copy for a local agent**: `buildAgentHandoff(request, site, t)`, for a
  coding agent: the site, `WRITE_PLUGIN_SKILL_URL`, the Voyager version, run
  `npx create-voyager-plugin@latest check` before handing back, and return
  `plugin.json` plus `style.css` for **Import files** (under **More ways to
  add** in the same card).

**The page's structure.** **Create on this page** also puts the outline of
the page it starts on at the top of the message, read before the new chat
replaces that page (`pages/content/createMode/pageOutline.ts`): the site's
anchors with how many elements each matches now, the reply locator
(`authoring/replyLocator.ts`, which the scripted page lists too), and a
pruned outline around the last reply and the last user message. It is
structure only: `outlinePolicy.ts` is the one whitelist of what an element
may show (tag, `data-*`/`aria-*` names, a few plain values and class tokens,
never text, ids, URLs or anything inside the composer), and the outline
stays under `MAX_PAGE_OUTLINE_CHARS`. The Create tab says so in one switch,
on each time the panel opens, with the exact text folded under it
(`gv.create.outline`, asked again whenever the page moves).

A refused clipboard write leaves the text on screen to select. The popup side
is `pages/popup/hooks/useCreateRequest.ts` and `components/CreateModeRequest.tsx`;
the panel side is `pages/panel/create/useCreateHandoff.ts` and `CreateView.tsx`.
`authoringSites.ts` holds the site list, `authoringSiteForUrl` and the request
ceiling both copies share.

**The reply.** "Paste the AI's reply" in the same card
(`hooks/usePluginReplyReview.ts`, `components/LocalPluginReplyCheck.tsx`):

- `local/pluginReply.ts` takes the pasted reply (bounded, linear fence scan;
  one ```json or unlabeled block, or bare JSON; zero or several blocks are
  refused by name) through `readLocalPluginFiles` and the gate without
  installing it. The popup closes while the user is in their AI tab, so this
  step works on its own in a fresh popup.
- `local/pluginPreview.ts` describes the result in plain terms (sites, each
  change, warnings for hidden content via `hide`, `hidden` or a hiding inline
  style, raw selectors, a replaced version, a
  reply that misses the selected site (the active tab's, or the user's pick;
  recomputed when the picker changes, no copy needed), and a `theme` the
  chat page asked the AI to leave out; a primitive is listed as a change, not
  flagged, because the contract offers it where the gate accepts it). CSS is not summarized: its full
  source is shown with a plain warning that it can change anything, hiding
  included, since reading its effect would be a guess. It builds on `inspectPlugin`, and
  the same inspect view opens under it on demand. **Import** hands the exact previewed
  object to `importLocalPlugin`, so it lands disabled (a scripted one loses its
  device-local enable too, even on an identical re-import) and follows the re-import
  rules in [../README.md](../README.md), but only over the install the preview saw: if the same id was
  installed, changed or removed meanwhile, nothing is written and the preview
  is refreshed for a new review.

**The in-page loop.** `pages/content/createMode/` is a permanent page service
(`nativeFeatures.ts`, top frame only, on every site `authoringSiteForUrl`
knows). The panel reaches it only through the background's tab relay; the
panel takes nothing from window messages.

- **Fill.** `gv.create.start` carries the sentence, parsed and bounded on both
  ends (`creation/messages.ts`, `features/panel/tabRequests.ts`). A draft in
  the current composer is refused before the page moves. `newChat.ts` holds
  each site's new-chat path and control: the site's own control first, then,
  on Gemini only, pushState plus popstate to `/u/<n>/app`; never
  `location.assign`, `href` or `reload`. `fillMachine.ts` (`startMachine`:
  opening, waiting for a stable composer, writing) fixes the account and the
  new-chat path when the request starts and checks the route in every phase:
  any other move, another account's new chat included, ends the fill without
  writing or navigating again. It writes only into an empty composer on that
  new-chat page. Nothing is sent; a toast says what happened.
- **Read.** `replyControls.ts` reads code blocks only in a Create chat: the
  site's `codeBlock` anchor inside an `assistantTurn`, or a `pre` inside one
  where the site declares none. The marker and the blocks count only when
  rendered (`isRendered`, as the export reader skips the earlier conversations
  ChatGPT keeps mounted under hidden ancestors). Each block goes through `classifyReplyBlock`
  against the installed records (refreshed by `subscribeLocalPlugins`), and
  `markLatestCandidates` lets only the last block per id act; earlier ones
  read **Earlier version**. Text that does not parse as a plugin, a block
  still streaming included, gets no control. Controls sit after the block in a
  shadow root (`gv-create-control`), take clicks only through `isUserEvent`,
  and leave with teardown.
- **Hand over.** **Preview and install** (or **Preview update**) holds the
  block for 60 seconds and calls `voyagerPanelOpener.openReview()`, which bumps
  `PanelContext.creationRequest` in the shell's authenticated context. The
  panel then fetches the block once (`gv.create.pending`). The page holds only
  the latest pick: one made while a fetch is out is fetched again before the
  answer counts, and one made during an install waits for it, so the review
  always shows the latest pick.
- **Review and install.** The panel (`pages/panel/create/`, `reviewMachine.ts`
  on `startMachine`) runs `checkPluginReply` again, since it never trusts the
  page's verdict, and shows `LocalPluginPreviewSummary`, the popup's preview
  in the panel's look. **Install and turn on** (`installReviewed.ts`) imports
  the reviewed object only over the install it saw, so it lands disabled like
  any import, then switches on exactly the imported manifest through
  `setPluginEnabledWithSiteAccess` and `enableLocalPluginIfUnchanged`. An
  install that changed in between enables nothing and the panel reviews
  again. Refused site access leaves it installed and off with **Turn on**.
- **Send the problems back.** Under a block the gate refuses, the control
  appends `buildCreationFixMessage` to the composer, after a blank line below
  any draft, and sends nothing.

**One contract, five outputs.** `local/authoring/pluginContract.ts`
(`buildPluginContract(site, { audience, refs })`) is the single description of
what a local plugin may contain: manifest fields, styles, page changes,
settings, the local rules, the site's anchors and notes, the primitives (read
only through `primitiveReference.ts`), the scripted tier, what is not possible, and examples. Five
outputs render it:

- the per-site chat pages `docs/public/create/<site>.md` (`createPages.ts`,
  `audience: 'chat'`), served at `https://voyager.nagi.fun/create/<site>.md`
  for the Create mode message. Each inlines what every request needs and one
  example, lists the primitive names that run there, and points at the
  skill's `primitives.md`, `sites/<site>.md` (primitive caveats) and
  `examples.md` with the condition for opening each. It states the Voyager
  version it was generated from and tells the AI to stay at or below the user's;
- the shared scripted page `docs/public/create/scripted.md` (`scriptedPage.ts`),
  which every chat page points at (`scriptedSection`) for a request that needs
  code: the `tier: "scripted"` shape, how `chrome.userScripts` runs it, the
  rules the prelude enforces, the browser it needs, each site's selectors and
  one example. Agent outputs say instead that only Create mode makes a
  scripted plugin, because `check` refuses the tier;
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
