# Voyager plugins on AI Studio

Part of the write-voyager-plugin skill: the workflow, rules and examples are in [SKILL.md](../SKILL.md), primitives and their params in [primitives.md](../primitives.md). Scaffold with `--site aistudio`.

"matches" must use these URL patterns (all of them, or a subset):
- https://aistudio.google.com/*
- https://aistudio.google.cn/*

Semantic anchors AI Studio declares (use them as { "kind": "semantic", "key": … }):
- userTurn: a user message container
- assistantTurn: an assistant message container
- composer: the prompt input the user types into
- sidebar: the conversation list / navigation rail
- composerRoot: the container around the prompt input and its action buttons
- sendButton: the button that sends the prompt (may exist only while the prompt is non-empty)

AI Studio does not declare thinkingBlock, codeBlock, sidePanel, headerActions, scrollContainer: a plugin that relies on one of these is refused. Use a CSS selector instead.

AI Studio allows only these primitives (native ops): formulaCopy, sendShortcut, siteCheck. No "theme".

- The `sidebar` anchor is Voyager’s own folder panel on AI Studio, not AI Studio’s navigation. Use a CSS selector for AI Studio’s own panels.
- Voyager’s AI Studio switch governs plugins too: while Voyager is off on AI Studio, nothing mounts.

These primitives run the same code as one of Voyager’s own settings (named in parentheses):
- `sendShortcut` (AI Studio Enter send), `formulaCopy` (Formula copy), `siteCheck` (Site check): only the setting or the plugin runs on a page. When the page loads, or while neither is running, the setting goes first: with it on, the plugin stays paused. Whichever is already running keeps running, and turning on the other leaves that one paused (the popup says why). Turn one off to hand the feature to the other.

- On AI Studio, `sendShortcut` requires `params: { "mode": "enterSends" }`: Enter sends, Ctrl/Cmd+Enter inserts a newline, and Shift/Alt+Enter keep the host behavior.
