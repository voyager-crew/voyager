---
globs: ["src/pages/content/**", "src/styles/contentStyle/**"]
---

# Content Script Rules

## CSS
- All injected CSS classes MUST be prefixed with `gv-` (e.g., `.gv-rtl`, `.gv-pm-trigger`)
- Shared/static injected CSS goes in the matching part under `src/styles/contentStyle/` by default; the build joins the parts in file-name order into the shipped `contentStyle.css`, so the number prefix is cascade order. Add a numbered part rather than grow one past the commit size limit. Feature-specific dynamic CSS may be injected by content modules or the plugin runtime when values are computed at runtime; keep it `gv-` prefixed and tear it down.
- Support both light and dark themes through `html[data-gv-scheme='dark']` / `html[data-gv-scheme='light']`, which `platformTheme` stamps from each site's `site.json` theme descriptor. Never target a host's own theme markers (`.theme-host.dark-theme`, `body.dark-theme`, `html.dark`, …); `src/core/utils/__tests__/contentStyleTheme.test.ts` rejects them.
- RTL layout: use `body.gv-rtl` selector for RTL overrides (see `src/core/utils/rtl.ts`)

## Storage
- Content scripts use `chrome.storage` / `browser.storage` directly — this is the exception to the "use StorageService" rule
- Outside content scripts, prefer `StorageKeys` plus existing storage helpers/services. Direct `chrome.storage` / `browser.storage` still exists in popup/background/options for established settings patterns, bulk reads/writes, and storage listeners.

## DOM Injection
- Each content script sub-module in `src/pages/content/` is self-contained
- Bridge between host sites (Gemini, AI Studio, Claude, ChatGPT, DeepSeek, Kimi) and the extension — any host DOM may change without notice
- Safari has platform-specific manifest and native-bridge paths, but cloud sync,
  watermark removal, and image export are supported. Do not add an `isSafari()`
  skip from historical assumptions; verify the current Safari implementation
  and its browser-specific tests first.
- Extension context can be invalidated after update/reload. Use `isExtensionContextInvalidatedError()`.

## Material Symbols Icons
- Popup Material Symbols are bundled locally through `public/fonts/material-symbols-outlined.css` and `.ttf`; verify the glyph exists in the bundled font or update the bundled font assets. Do not add a remote Google Fonts URL.
