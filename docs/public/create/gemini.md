# Write a Voyager plugin for Gemini

Voyager is a browser extension for AI chat sites. A Voyager plugin is a JSON manifest plus CSS that restyles or rearranges the page through reversible changes; Voyager checks it strictly on import. It runs no code of its own, unless it is the scripted kind below.

The user’s message gives their request and their Voyager version. This page follows Voyager 2.3.1: use nothing whose sinceEngine is above the user’s version.

## Target site: Gemini

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

No "theme" on Gemini.

- The `sidebar` anchor also matches Voyager’s own folder panel (`.gv-folder-container`). To change only Gemini’s navigation rail, target `bard-sidenav` with a CSS selector.

## Manifest contract

- Required non-empty string fields: id, name, version, description, author, category, license, engine. Also "tier": "declarative", "matches" (see the target site section) and "contributes".
- "id": a lowercase reverse-dotted slug such as "me.short-name" (a-z, 0-9, ".", "_", "-"). Voyager stores it as "local.<id>" itself.
- "version": "1.0.0"; raise it when you change the plugin. "author": "me". "license": "MIT".
- "engine": the lowest Voyager version the plugin needs, as ">=1.0.0" or ">=" the sinceEngine of every primitive it uses. Never go above the user’s Voyager version.
- "category": one of render-fix, theme, layout, readability, productivity, integration, other.
- Write "name" and "description" in the language of the request. "i18n" translations are optional for a local plugin.

## Styles

- "contributes.styles": a list of { "css": "..." } with the CSS inlined as a string.
- CSS may not load anything, not even from the same site: no @import, image-set(), image(), cross-fade() or src(), and url() only with a #fragment or a png, jpeg, gif, webp or avif data: URI (never SVG).
- Scope every rule under a class your plugin adds (see addClass), so nothing else changes. Site styles often win on specificity: add !important where a rule does not apply.
- Light or dark only rules: scope them with html[data-gv-scheme='dark'] or html[data-gv-scheme='light'], never with the site's own theme classes.

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
- Optional "enabledBy": "<booleanKey>" disables a control in the popup until that boolean setting is true (one level: the boolean has no enabledBy). It needs no engine floor and does not change the page, so gate page behavior with the boolean too.
- Use a setting through a {{key}} token in CSS text, a setStyle value or a setAttribute value; Voyager substitutes the current value. A common pattern: setStyle sets a custom property from the setting, and the CSS reads var(...). A boolean renders as "true" or "false": set data-gv-… to "{{key}}" with setAttribute and style [data-gv-…='true'].

## Local plugin rules

- "matches" may only use the URL patterns of a site Voyager supports (see the target site section).
- Every semantic key the plugin relies on must be declared by every site its "matches" cover.
- Do not add "theme", "requires", links or JavaScript. A "native" op may only call a primitive listed under Primitives.
- An import lands switched off; the user reviews it and turns it on in the popup.

## Primitives

Primitives are behavior Voyager ships as code, called as { "op": "native", "handler": "<name>", "params": { … } }. On Gemini these run: codeCollapse, draftSave, echarts, formulaCopy, mermaid, sendShortcut, siteCheck, turnNavigator, userLatex, vimInput, wavedrom.

Read https://voyager.nagi.fun/skills/write-voyager-plugin/primitives.md when the request needs behavior that CSS and the page changes cannot give, such as one of these, and always before answering NOT POSSIBLE. It has each primitive’s params and engine floor.
Before you call one, also read https://voyager.nagi.fun/skills/write-voyager-plugin/sites/gemini.md: how it shares the page with Voyager’s own setting, and its caveats on Gemini.

## Plugins that run code

A scripted plugin carries JavaScript for behavior CSS, the page changes and the primitives cannot give, such as reacting to clicks, counting or remembering something across visits. Read https://voyager.nagi.fun/create/scripted.md when the request needs such behavior, before answering NOT POSSIBLE. Use the declarative tier whenever it suffices: a scripted plugin needs desktop Chrome or Edge 133 or later, with "Allow User Scripts" turned on for Voyager on its details page in chrome://extensions (Developer mode before Chrome 138), and the user reads all of its code before turning it on.

## What a plugin cannot do

- It cannot run JavaScript or any code of its own: no event handlers, clicks, timers or keyboard shortcuts.
- It cannot make network requests or load anything: remote images, fonts, stylesheets or scripts.
- It cannot read, rewrite or translate what a message says, or store and sync data beyond its own settings.
- It cannot add buttons or links that do something, open pages, download or copy (CSS ::before and ::after can add fixed text).
- It cannot decide by message content: logic, conditions or counting beyond what CSS selectors such as :has() and :nth-child() express.
- It cannot run on sites other than those listed, or change Voyager’s own settings.

These limits are on the plugin’s own fields and CSS. A primitive in the Primitives list above runs Voyager’s code and may lift one of them: read that list before answering NOT POSSIBLE, and use a primitive when the target site declares the keys it reads.
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
      "matches": ["https://gemini.google.com/*", "https://business.gemini.google/*"],
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
