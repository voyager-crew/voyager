# Voyager plugins on Gemini

Part of the write-voyager-plugin skill: the workflow, rules and examples are in [SKILL.md](../SKILL.md), primitives and their params in [primitives.md](../primitives.md). Scaffold with `--site gemini`.

"matches" must use these URL patterns (all of them, or a subset):
- https://gemini.google.com/*
- https://business.gemini.google/*

Semantic anchors Gemini declares (use them as { "kind": "semantic", "key": … }):
- userTurn: a user message container
- assistantTurn: an assistant message container
- codeBlock: a rendered code block
- composer: the prompt input the user types into
- sidebar: the conversation list / navigation rail
- scrollContainer: the element that scrolls the conversation
- composerRoot: the container around the prompt input and its action buttons
- sendButton: the button that sends the prompt (may exist only while the prompt is non-empty)

Gemini does not declare thinkingBlock, sidePanel, headerActions: a plugin that relies on one of these is refused. Use a CSS selector instead.

Gemini allows only these primitives (native ops): codeCollapse, draftSave, echarts, formulaCopy, mermaid, sendShortcut, siteCheck, turnNavigator, userLatex, vimInput, wavedrom. No "theme".

These primitives run the same code as one of Voyager’s own settings (named in parentheses):
- `turnNavigator` (Show Timeline), `sendShortcut` (Ctrl/Cmd+Enter send), `formulaCopy` (Formula copy), `vimInput` (Input Vim mode), `siteCheck` (Site check): only the setting or the plugin runs on a page. When the page loads, or while neither is running, the setting goes first: with it on, the plugin stays paused. Whichever is already running keeps running, and turning on the other leaves that one paused (the popup says why). Turn one off to hand the feature to the other.
- `userLatex` (Render LaTeX in my messages), `codeCollapse` (Collapse long code blocks), `wavedrom` (WaveDrom timing diagram rendering), `echarts` (ECharts rendering), `mermaid` (Mermaid diagram rendering): both can run on one page: each claims the elements it works on, and an element the other already holds is left to it.
- `draftSave` (Draft auto-save): the official and a local draft plugin may run together and share the same `gvDraft_` full-path data. Their writes and pruning are coordinated on this page. Turning either off keeps stored drafts.

- The `sidebar` anchor also matches Voyager’s own folder panel (`.gv-folder-container`). To change only Gemini’s navigation rail, target `bard-sidenav` with a CSS selector.
- `draftSave` keys drafts as `gvDraft_` plus the full pathname, including `/u/<index>/` and Gem routes. Different account slots have different keys; changing email within the same slot still shares stored drafts.
- On consumer gemini.google.com, `turnNavigator` requires literal `params: { "dataBackend": "shared" }` and the engine version shown in its primitive reference. All matches must stay on that host: no Business or mixed catalog sites. It shares Voyager’s existing stars, levels, collapse state and native account/turn identity; do not set turn, turnItem, conversationIdPattern, conversationIdAttribute or accountIdAttributes. Enterprise and custom-website coverage still refuse this rail at the native start point.
