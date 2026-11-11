# Write a Voyager plugin for DeepSeek

Voyager is a browser extension for AI chat sites. A Voyager plugin is a JSON manifest plus CSS that changes the page reversibly; Voyager checks it strictly on import. It runs no code unless it is the scripted kind below.

This page follows Voyager 2.3.2: the user’s message gives their request and their Voyager version.

## Target site: DeepSeek

"matches" must use these URL patterns (all of them, or a subset):
- https://chat.deepseek.com/*

Semantic anchors DeepSeek declares (use them as { "kind": "semantic", "key": … }):
- userTurn: a user message container
- assistantTurn: an assistant message container
- thinkingBlock: the reasoning / "thinking" section inside an assistant turn
- codeBlock: a rendered code block
- composer: the prompt input the user types into
- sidebar: the conversation list / navigation rail
- scrollContainer: the element that scrolls the conversation
- composerRoot: the container around the prompt input and its action buttons
- sendButton: the button that sends the prompt (may exist only while the prompt is non-empty)

DeepSeek does not declare sidePanel, headerActions: a plugin that relies on one of these is refused. Use a CSS selector instead.

Primitives (native ops) are allowed on DeepSeek.

## Manifest contract

- Required non-empty string fields: id, name, version, description, author, category, license, engine. Also "tier": "declarative", "matches" (see the target site section) and "contributes".
- "id": a lowercase reverse-dotted slug such as "me.short-name" (a-z, 0-9, ".", "_", "-"). Voyager stores it as "local.<id>" itself.
- "version": "1.0.0"; raise it when you change the plugin. "author": "me". "license": "MIT".
- "engine": the lowest Voyager version the plugin needs, as ">=1.0.0" or ">=" the sinceEngine of every primitive it uses. Never go above the user’s Voyager version.
- "category": one of render-fix, theme, layout, readability, productivity, integration, other.
- Write "name" and "description" in the language the message names; if none, the language of the request. "i18n" translations are optional for a local plugin.

## Styles

- "contributes.styles": a list of { "css": "..." } with the CSS inlined as a string.
- CSS may not load anything, not even from the same site: no @import, image-set(), image(), cross-fade() or src(), and url() only with a #fragment or a png, jpeg, gif, webp or avif data: URI (never SVG).
- Scope every rule under a class your plugin adds (see addClass), so nothing else changes. Site styles often win on specificity: add !important where a rule does not apply.
- Light or dark only rules: scope them with html[data-gv-scheme='dark'] or html[data-gv-scheme='light'], never with the site's own theme classes.
- To recolour Voyager’s own panels, menus and dialogs on any site, set these in one unscoped :root { } rule (it covers light and dark), never its gv- classes: --gv-theme-surface (their background), --gv-theme-hover (hovered rows), --gv-theme-text (their text), --gv-theme-text-muted (secondary text, icons), --gv-theme-border (borders), --gv-theme-accent (buttons, selection, focus), --gv-theme-accent-fg (text on accent), --gv-theme-accent-hue (accent OKLCH hue, a number), --gv-theme-danger (delete).

## Page changes

- "contributes.domOps": reversible page changes. Allowed "op" values: addClass, setAttribute, setStyle, hide, and "native" where the site allows primitives. Voyager applies them to every match, again as the page changes, and removes them when the plugin is turned off. One example of each:
  - addClass: { "op": "addClass", "target": { "kind": "semantic", "key": "userTurn" }, "className": "gv-plugin-my-change" }
  - setAttribute: { "op": "setAttribute", "target": { "kind": "semantic", "key": "userTurn" }, "name": "data-gv-plugin", "value": "my-change" }
  - setStyle: { "op": "setStyle", "target": { "kind": "semantic", "key": "userTurn" }, "styles": { "max-width": "960px" } }
  - hide: { "op": "hide", "target": { "kind": "semantic", "key": "userTurn" } }
- "target": prefer { "kind": "semantic", "key": <anchor> } with an anchor the target site declares. Use a plain CSS selector string only for something no anchor names; it breaks on a redesign.
- addClass "className": exactly one class that starts with "gv-"; use "gv-plugin-<plugin-name>". Then style that class in "contributes.styles".
- setAttribute "name" must be one of: title, role, lang, dir, hidden, tabindex, draggable, spellcheck, translate, style, data-*, aria-*. Never href, src, on*, class or id. Values may not contain an external URL.
- setStyle "styles": CSS property -> value, custom properties (--gv-…) included; values may not load anything either. A value ending in !important needs engine ">=1.9.0".

## Settings (optional)

- "contributes.settings": { "<key>": { "type", "label", "default", … } }. Types: boolean, number, select (the popup has no control for string or color).
- number: a slider from "min" to "max" (0 and 100 when omitted), with optional "minLabel" and "maxLabel" at its ends. select: "options": [{ "value": "…", "label": "…" }], at least one, unique values, and a "default" that is one of them.
- Optional "enabledBy": "<booleanKey>" disables a control until that boolean is true (one level, no engine floor). It does not change the page: gate page behavior with the boolean too.
- A {{key}} token in CSS text or a setStyle or setAttribute value becomes the setting’s current value. Common: setStyle sets a custom property from it and the CSS reads var(...). A boolean renders as "true" or "false": setAttribute data-gv-… to "{{key}}", then style [data-gv-…='true'].

## Local plugin rules

- "matches" may only use the URL patterns of a site Voyager supports (see the target site section).
- Every semantic key the plugin relies on must be declared by every site its "matches" cover.
- Do not add "theme", "requires", links or JavaScript. A "native" op may only call a primitive listed under Primitives.
- An import lands switched off; the user reviews it and turns it on in the popup.

## Primitives

Primitives are behavior Voyager ships as code, called as { "op": "native", "handler": "<name>", "params": { … } }. On DeepSeek these run: codeCollapse, collapse, conversationExport, copyButton, counterBadge, draftSave, echarts, folders, formulaCopy, mermaid, promptManager, quoteReply, sendShortcut, siteCheck, tableCopy, turnNavigator, userLatex, vimInput, wavedrom.

Read https://voyager.nagi.fun/skills/write-voyager-plugin/primitives.md when the request needs behavior that CSS and the page changes cannot give, such as one of these, and always before answering NOT POSSIBLE. It has each primitive’s params and engine floor.

## Plugins that run code

A scripted plugin runs JavaScript for what CSS, the page changes and the primitives cannot do, such as reacting to clicks, counting or remembering across visits. Read https://voyager.nagi.fun/create/scripted.md when the request needs such behavior, before NOT POSSIBLE. Prefer the declarative tier: a scripted plugin needs desktop Chrome or Edge 133+ with "Allow User Scripts" on, and the user reads all its code.

## What a plugin cannot do

- It cannot run JavaScript or any code of its own: no event handlers, clicks, timers or keyboard shortcuts.
- It cannot make network requests or load anything: remote images, fonts, stylesheets or scripts.
- It cannot read, rewrite or translate what a message says, or store and sync data beyond its own settings.
- It cannot add buttons or links that do something, open pages, download or copy (CSS ::before and ::after can add fixed text).
- It cannot decide by message content: logic, conditions or counting beyond what CSS selectors such as :has() and :nth-child() express.
- It cannot run on sites other than those listed, or change Voyager’s own settings.

A primitive in the Primitives list above runs Voyager’s code and may lift one of these limits: check that list before answering NOT POSSIBLE.
A scripted plugin (see "Plugins that run code") may run code and logic, never the other limits.
If the request needs any of this, do not invent fields or ops: the import refuses them. Start your reply with one line "NOT POSSIBLE: <what and why>", then build the closest version this contract allows and say what it leaves out.
Give that version in the one json code block; reply with no block only when nothing helps.

## Example (adapt it; do not copy its purpose)

### A class on an anchor, styled by CSS

    {
      "id": "me.rounded-turns",
      "name": "Rounded turns",
      "version": "1.0.0",
      "description": "Round the corners of each message",
      "author": "me",
      "category": "readability",
      "license": "MIT",
      "engine": ">=1.0.0",
      "tier": "declarative",
      "matches": ["https://chat.deepseek.com/*"],
      "contributes": {
        "styles": [
          {
            "css": ".gv-plugin-rounded-turn { border-radius: 16px; }html[data-gv-scheme='dark'] .gv-plugin-rounded-turn { outline: 1px solid #ffffff22; }"
          }
        ],
        "domOps": [
          {
            "op": "addClass",
            "target": { "kind": "semantic", "key": "userTurn" },
            "className": "gv-plugin-rounded-turn"
          }
        ]
      }
    }

Read https://voyager.nagi.fun/skills/write-voyager-plugin/examples.md when the plugin needs a setting the user adjusts in the popup, or calls a primitive: it has a worked example of each. Inline their style.css as { "css": "..." } and use this page’s "matches" and anchors.

## Reply format

Reply with exactly one fenced code block labeled json, holding the complete manifest with CSS inlined, and no other code block. The user pastes it into Voyager, so write no files or commands.
