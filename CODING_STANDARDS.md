# Coding standards — Voyager

Read when reviewing a diff, and before writing or deleting tests. These are judgement calls; mechanical rules live in `.oxlintrc.json`, `scripts/` checks and the pre-commit hook, and report themselves.

## Tests

A test earns its place by the **regression** it catches: it fails on a plausible change that a user or stored data would feel. For every added or kept test, ask whether it would fail on the broken code, and whether the entry point it drives is the one users reach.

- **Assert behavior or data invariants**: storage formats, migrations, account scope, teardown, host-DOM parsing, races the code guards against. Static checks suit static contracts such as resource registration or forbidden primitives.
- **Harmful kinds**:
  - _Tautological_: the expected value is recomputed the way the implementation computes it, or a mock is checked for returning what the test told it to.
  - _Change-detector_: pins source spelling, private wiring, a hand-copied copy of a config table, or incidental detail (call order, z-index, copy, row order). When a behavior assertion sits beside such a pin, keep the assertion and loosen the pin.
  - _Unreachable_: covers code no build runs. Delete the code, and its tests go with it.
  - _Vacuous_: cannot fail, such as asserting that a selector the code no longer uses is never queried, or checking a value a mock fixed.
- **Bug fixes**: add a regression test only when coverage has a genuine gap; otherwise extend or rely on the existing test. Name it after the symptom, and put a one-line why-comment at the code that prevents the bug. A test added by a `fix(...)` commit stays unless another case catches the same regression.
- **Time**: drive time with fake timers or await the event the code emits. Virtual time is cheap but the DOM work it triggers is not, so a long wait is one clock jump plus a short window, not a scan of every tick. Lint flags real sleeps, per-test timeouts and unlinked skips.
- **Worker state**: under `vmThreads` the files in a worker share Node's built-ins, their prototypes and `process.env`, so a change left there reaches later files. Tests undo it (`vi.unstubAllEnvs()`, restored spies); a global the test realm lacks goes in `src/tests/vmRealm.ts`, on the realm's own global.
- **Deleting tests**: judge each case by the regression it catches. A category (timers, DOM, mocks, long, slow) is never the reason.
- **Moving code**: when a responsibility is extracted, its valuable regression assertions move with it. Prose, formatting and other reversible changes without a behavior change need no new tests.

## Types

An `as` tells the compiler to stop checking; nothing checks at runtime. Prefer code where the types are **proven**: narrowing that the compiler follows, so a later type change breaks the build at every affected site.

- **Boundaries**: storage reads (sync data from other devices and older versions), runtime and window messages (MAIN-world scripts), and parsed JSON (imports, catalog host files) arrive as `unknown`. Parse once where they enter into the domain type, drop or repair bad entries there, and trust the type inside. `JSON.parse(raw) as unknown` handed to a parser is the right shape; `JSON.parse(raw) as PromptItem[]` is a finding.
- **Type guards** verify everything their name claims. A guard named `isX` that checks less hides the bug behind a safe-sounding name.
- **Variants**: mutually exclusive states are a discriminated union on a literal tag, never a bag of optional fields. Async phases use `startMachine`.
- **Literal tables** use `satisfies`, which checks without widening. A `switch` over a union ends with `default: { const _exhaustive: never = value; }` so a new variant fails to compile.
- **Elsewhere**: in new code, ask for narrowing when a guard, `instanceof` or a generic (`querySelector<HTMLElement>`) expresses the same thing. `as const`, a cast after validation, and test fixtures are fine; `any` is a finding. Lint flags casts through `unknown`.

## Structure

- Extract cohesive data operations or complete lifecycle responsibilities from large managers. Helpers take explicit inputs and have one state owner; the whole manager is never passed in. Each step works on its own and keeps existing callers and data.
- Raising an entry in `scripts/file-size-baseline.json` is a deliberate change the PR explains.

## UI

- Confirmations go through `askConfirm` (`src/core/ui/confirm.ts`) and toasts through `createToaster` (`src/core/ui/toast/toaster.ts`); they own stacking, dismissal, theming and teardown. Outside-press handlers skip `isVoyagerLayerEvent`.
