# Voyager plugins on Grok

Part of the write-voyager-plugin skill: the workflow, rules and examples are in [SKILL.md](../SKILL.md), primitives and their params in [primitives.md](../primitives.md). Scaffold with `--site grok`.

"matches" must use these URL patterns (all of them, or a subset):
- https://grok.com/*

Semantic anchors Grok declares (use them as { "kind": "semantic", "key": … }):
- userTurn: a user message container
- assistantTurn: an assistant message container
- thinkingBlock: the reasoning / "thinking" section inside an assistant turn
- composer: the prompt input the user types into
- sidebar: the conversation list / navigation rail
- scrollContainer: the element that scrolls the conversation
- composerRoot: the container around the prompt input and its action buttons
- sendButton: the button that sends the prompt (may exist only while the prompt is non-empty)

Grok does not declare codeBlock, sidePanel, headerActions: a plugin that relies on one of these is refused. Use a CSS selector instead.

Primitives (native ops) and an optional "theme" accent are allowed on Grok.
