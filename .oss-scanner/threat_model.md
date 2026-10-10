# Voyager threat model

Voyager is a GPL-3.0 browser extension for AI conversation workspaces, including Gemini,
AI Studio, Claude, ChatGPT and DeepSeek. It manages prompts, folders, stars and highlights,
renders conversation content, exports data and optionally syncs selected data to the user's
Google Drive or iCloud. The project does not operate a backend receiving conversation data.

## Assets and trust boundaries

- Treat conversation text, model-generated HTML/Markdown, diagrams, images, URLs and
  page DOM/events as untrusted. A malicious conversation or compromised page must not
  gain extension privileges or access unrelated saved data.
- Treat imported backups, local plugin ZIP/JSON/CSS files, remote catalog responses and
  stored payloads as untrusted input. Plugin data must not become executable remote code.
- Protect OAuth tokens, private prompts/conversations and account-scoped stored data.
  Some settings and prompt libraries are intentionally shared; check the owning module's
  scope before claiming an account-isolation violation.
- A page, subframe or MAIN-world observer must not impersonate a trusted extension page
  when messaging the background. Check sender origin, tab/frame and account/platform scope.
- Optional site access, image capture and cloud authentication require the corresponding
  user action and permissions. Existing host permissions alone are not a vulnerability.

## Priority code

- `src/pages/background/`: message routing, sender checks, image fetching/capture and sync.
- `src/pages/content/`, `public/`: page bridges, rendering, DOM extraction and injected scripts.
- `src/features/plugins/`: manifest/CSS validation, local imports, remote catalog and runtime.
- `src/core/services/`: storage, backup/restore, Drive payloads and account isolation.
- `src/features/export/`, `src/features/savedLibrary/`, `src/features/folder/`: data handling.
- `Voyager/`: Safari native messaging, Google authentication and iCloud integration. Source
  review is in scope, but native execution requires macOS/Xcode and is unavailable here.

## Build and offline reproduction

The Dockerfile installs Node 22 and the repository's pinned Bun 1.3.12, installs locked
dependencies and builds Chrome, Edge, Firefox and the Safari web bundle. Sources and full
Git history live in `/src`; browser bundles are in `dist_chrome`, `dist_edge`,
`dist_firefox` and `dist_safari`. This image does not assemble or sign a native Safari app.

Run from `/src` after network access has been disabled:

```sh
bun run test --maxWorkers=2
bun run typecheck
bun run build:browsers
```

For focused reproduction, use `bun run test <path-to-test> --maxWorkers=2`. Vitest uses
jsdom and browser API mocks from `src/tests/setup.ts`; use adversarial payloads in these
tests, and explain which real browser behavior a mock cannot establish. Installed
dependencies and fixtures remain in the image. No real cloud credentials are needed.

## Findings and severity

Provide the affected entry point, attacker capabilities, required user interaction,
an offline reproducer or regression test, impact and a minimal candidate patch. Distinguish
execution in the host page from execution in an extension context. Do not infer privilege
escalation merely from an HTML sink without tracing its actual execution context and guards.

Prioritize demonstrated token/private-data theft, extension privilege escalation,
unauthorized cross-account access and destructive restore/sync behavior. Assess severity
from the demonstrated impact, reachability and required user interaction. UI defects and
resource exhaustion without private-data or privilege impact generally have lower severity.

Do not attack live AI providers, cloud accounts or users. Provider/browser vulnerabilities,
an already-compromised local machine and intentional maintainer-authored extension code
are outside this project's threat model. Dependency flaws remain relevant when Voyager
exposes a reachable vulnerable path; identify that path rather than reporting a version alone.
