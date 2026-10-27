# Page-locator trust ledger

Every key is classified by what its consumers can do, including online contract
keys, all packaged fragment fields and semantic keys forced to the bundle. Each
site's table gives one reason per key. Stored titles, timeline/preview text,
export roots/content, filenames, IDs and saved prompts are **Tier A**, even when
their native source grammar remains packaged.

- **Tier A:** host actions (click, send, stop, delete, type/insert, navigate or open
  menus), stored/exported data, or conversation/turn/account/Gem/folder/project
  ownership. Remote replacements require independent page evidence before the
  whole operation is accepted. An action or source protocol is not proved merely
  because a remote query found a node.
- **Tier B:** only positions, mounts, aligns or avoids Voyager's own UI. Trust the
  official catalog without independent ownership proof. Zero matches fall back
  for that operation; mounts follow the shared [mount rule](README.md#shared-snapshot-and-guards).
  Both tiers keep literal allowlists, rejection groups, size limits and per-group
  rejection of unparsable values. Mixed-use keys stay Tier A or gain a separate
  placement key.
- **§6:** packaged host/permission, ID extraction, native health, source or action
  protocols, CSS sinks, Voyager-owned DOM and dormant compatibility fragments.
  Attributes and flags listed beside locators are included so no source field is
  silently omitted. §6 does not excuse a stored-data locator from Tier A.

## Per-site inventory

“Before” is `3adb77650`; both columns use the new classification. Counts are
**distinct site/key names**, not CSS strings: duplicate copies with the same key
count once. A new `exportLayout.*` or `sidebar.*` alias and its differently named
baseline copy each count once. Legacy values/order stay intact; two explicit chat-width CSS profiles now record their separate baseline order.
“Online” counts the literal profile contract, including semantic/page-hook
aliases; legacy adapter overrides are separate. The two ChatGPT model-picker
aliases come from `site.json/pageHooks`, so its before count is 116, not 114.

| Site                                           | Keys before → after | A         | B       | §6      | Online before → after | Nested adapter fields |
| ---------------------------------------------- | ------------------- | --------- | ------- | ------- | --------------------- | --------------------- |
| [gemini](../gemini/selectors/PACKAGED_DATA.md) | 280 → 299           | 179 → 183 | 38 → 51 | 63 → 65 | 75 → 119              | 10                    |
| [aistudio](PACKAGED_AISTUDIO.md)               | 59 → 71             | 18 → 18   | 27 → 39 | 14 → 14 | 12 → 36               | 6                     |
| [chatgpt](PACKAGED_CHATGPT.md)                 | 116 → 128           | 56 → 56   | 23 → 35 | 37 → 37 | 25 → 49               | 30                    |
| [claude](PACKAGED_CLAUDE.md)                   | 42 → 54             | 11 → 11   | 22 → 34 | 9 → 9   | 8 → 29                | 16                    |
| [deepseek](PACKAGED_DEEPSEEK.md)               | 42 → 54             | 12 → 12   | 22 → 34 | 8 → 8   | 4 → 25                | 7                     |
| [kimi](PACKAGED_KIMI.md)                       | 41 → 53             | 11 → 11   | 22 → 34 | 8 → 8   | 6 → 27                | 7                     |

The [nested adapter supplement](PACKAGED_ADAPTERS.md) and its
[ChatGPT continuation](PACKAGED_ADAPTER_CHATGPT.md) list existing folder, project,
page-hook, export-state and theme fields separately. They already use the catalog's
adapter sections and are not additional page-locator profiles. The two ChatGPT
page-hook aliases overlap the main table; supplemental counts must not be added
to the main totals without removing that overlap.

## Reading delivery and retained keys

`online` means admitted to the frozen page-locator contract. `bundle copy` means
an unchanged literal fallback for a separately named online counterpart, not an
unimplemented repair. `packaged` has the per-key protocol or proof limitation in
its row. `legacy adapter` keeps the established resolved-adapter path; admission
to the new contract must not silently remove those existing overrides.

With Online updates OFF, all semantic keys keep baseline cached-adapter reads;
only namespaced profiles revert to bundled values. With no remote changes, no
new proof or placement query runs. The baseline ordered input, Vim, clearance
and mount candidates remain unchanged on every host. Each site reads only its
own profiles and unknown keys are ignored.

The old `exportToolbar.*` compatibility fragments have no live consumer; the
active export toolbar uses `exportLayout.*`. Every site's toolbar hit-tests its
row through the `interactive` layout probe, and its `turns` gain the site's own
`userTurn`/`assistantTurn` and export message key. AI Studio relative insertion steps keep their
original bundled query behavior; the online profile uses parser-safe `:scope`
queries for the same relative placement operation.

Host admission/matches/capabilities, account controls/exclusions, parsed-ID
comparison, destructive actions, native clone sanitizing, ARIA/focus association,
send/Stop/IME/disabled checks, event ordering, Quill/caret writes, model metadata,
URL/origin policy, HTML/MathML serialization, CSS and Voyager-owned markers remain
packaged. MAIN-world scroll policy stays in `public/prevent-auto-scroll.js`; it
is not a remotely projected execution channel. Source locators that produce data
remain labelled A in the site tables even when these protocols explain retention.
