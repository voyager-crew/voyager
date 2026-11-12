---
id: voyager.gemini-palette
name: Gemini · Voyager palette
category: theme
version: 1.0.0
author: voyager-official
license: MIT
matches:
  - https://gemini.google.com/*
engine: '>=1.11.0'
settings:
  palette: 'select (nord, nord-dark, nord-light; default nord): which Nord to use'
---

# Gemini · Voyager palette

Recolours Voyager's own UI on Gemini in [Nord](https://www.nordtheme.com/): its
panels, menus, dialogs, tooltips, toasts and the timeline. The page itself
keeps Gemini's colours. Turning the plugin off restores Voyager's default
colours at once.

In the popup's **Page layout** card, turn on **Voyager palette**, then pick a palette under it.

| Option     | What it does                                                       |
| ---------- | ------------------------------------------------------------------ |
| nord       | Nord light while the page is light, Nord dark while it is dark     |
| nord-dark  | Nord dark always, for a page darkened by a tool Voyager cannot see |
| nord-light | Nord light always                                                  |

The first version was written by Gemini (model Argon) through Create mode, from
the request "recolour Voyager's own UI to Nord". Other palettes can be made the
same way, in the Create tab of the Voyager panel; this plugin may gain more of
them as options.

## How it works

CSS only, through the public colour interface: `style.css` sets the
`--gv-theme-*` roles listed in `src/core/ui/themeVariables.ts` and nothing
else, so it never restyles a `gv-` class of Voyager's UI. One `setAttribute`
op writes the chosen palette to `<html data-gv-palette>`; the light values sit
under `html[data-gv-scheme='light']` and the dark ones under
`html[data-gv-scheme='dark']`, the scheme Voyager stamps from the site's theme.
The engine removes the attribute and the sheet together when the plugin is off.
The rules sit inside `:where()`, at zero specificity, so a creation that sets
its own `--gv-theme-*` on `:root` still wins while this plugin is on.

The light values and every dark value but `timeline` are Argon's. Its dark
reply predates the `timeline` role, so the dark `timeline` is Nord's `#d8dee9`
(nord4), the light text-muted of the same scale: it reads on a dark page, as
the light palette's `#4c566a` does on a light one.

When `themeVariables.ts` gains a role, `palette.test.ts` fails until both
palettes set it, in every site's copy.

## Delivery and control

- Ships inside the extension and updates only with a Voyager release. It is
  never published to or replaced by the online plugin catalog.
- Its switch and its palette are sync settings shared by Gemini and AI
  Studio (`gvVoyagerPaletteEnabled`, off by default, and `gvVoyagerPalette`,
  default `nord`), shown as a row in the popup's Page layout card. They travel with
  the settings backup.
- Needs no extra site access: Voyager's content script already runs here.

## Engine floor

Packaged only, so it ships only in builds that carry the `--gv-theme-*`
variables; `engine` stays at the current floor, `>=1.11.0`.

This is a declarative plugin: CSS and JSON interpreted by Voyager's bundled
plugin engine. It does not execute remote JavaScript or load external resources.
