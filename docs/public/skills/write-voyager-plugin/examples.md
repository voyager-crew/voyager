# More Voyager plugin examples

Part of the write-voyager-plugin skill: the rules are in [SKILL.md](SKILL.md). These examples target ChatGPT; on another site use the "matches" and anchors from its site file, and call only the primitives that site file lists.

## A setting the user adjusts in the popup

plugin.json:

```json
{
  "id": "me.turn-accent",
  "name": "Turn accent",
  "version": "1.0.0",
  "description": "A left border on each message, with an adjustable width",
  "author": "me",
  "category": "readability",
  "license": "MIT",
  "engine": ">=1.0.0",
  "tier": "declarative",
  "matches": ["https://chatgpt.com/*", "https://chat.openai.com/*"],
  "contributes": {
    "styles": [{ "file": "style.css" }],
    "settings": {
      "width": {
        "type": "number",
        "label": "Border width (px)",
        "default": 3,
        "min": 1,
        "max": 8,
        "minLabel": "Thin",
        "maxLabel": "Bold"
      }
    },
    "domOps": [
      {
        "op": "addClass",
        "target": { "kind": "semantic", "key": "userTurn" },
        "className": "gv-plugin-turn-accent"
      },
      {
        "op": "setStyle",
        "target": { "kind": "semantic", "key": "userTurn" },
        "styles": { "--gv-plugin-turn-accent-w": "{{width}}px" }
      }
    ]
  }
}
```

style.css:

```css
.gv-plugin-turn-accent { border-left: var(--gv-plugin-turn-accent-w, 3px) solid #8888; }
html[data-gv-scheme='dark'] .gv-plugin-turn-accent { border-left-color: #fff6; }
```

## A Voyager primitive (formula copy)

```json
{
  "id": "me.formula-copy",
  "name": "Formula copy",
  "version": "1.0.0",
  "description": "Click a formula to copy its LaTeX",
  "author": "me",
  "category": "readability",
  "license": "MIT",
  "engine": ">=1.3.0",
  "tier": "declarative",
  "matches": ["https://chatgpt.com/*", "https://chat.openai.com/*"],
  "contributes": { "domOps": [{ "op": "native", "handler": "formulaCopy", "params": {} }] }
}
```
