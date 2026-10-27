---
globs: ["src/**/*.ts", "src/**/*.tsx"]
---

# TypeScript Coding Standards

## Conventions
- Data that crosses in (storage reads, runtime or window messages, parsed JSON) starts as `unknown` and is parsed into its type where it enters; [CODING_STANDARDS.md](../../CODING_STANDARDS.md) → Types covers the rest.
- Data structures are plain objects typed by interfaces or types.
- Named exports: `export function X`.
- Functional React: hooks at top level, strictly functional components; business logic lives in `features/*/services/` or custom hooks, not UI files.
- State lives in defined Services, never in module-level globals.
- Constants or enums (`StorageKeys`, CSS classes) instead of string literals.
- UI components (`src/components/`, `src/pages/popup/`) reach storage through `StorageKeys` and existing helpers/services; direct `chrome.storage` / `browser.storage` matches established popup settings patterns, bulk reads/writes and storage listeners.
- Log through `LoggerService`; oxlint only warns on `console.log`, so add none.

## Testing (Vitest + jsdom)
- Chrome `chrome` object is globally mocked in `src/tests/setup.ts`
- Mock specific storage: `vi.mocked(chrome.storage.sync.get).mockResolvedValue({ key: 'val' })`
- jsdom cannot create trusted events: code that tells a person's input from a script's goes through `isUserEvent` (`src/core/utils/userEvent.ts`), and tests mock it
