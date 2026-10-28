# Voyager lint rules

Oxlint 1.80 loads `index.mjs` through `.oxlintrc.json`'s `jsPlugins`. Both CI and
`verify:pr` already run `bun run lint:check`, so the baseline is enforced there
without a second lint command or disable comments.

`baselinedRule` accepts `targetsFile` in its fourth-argument options. Its default,
`isTestFile`, preserves the three test rules' scope: `**/*.test.ts`,
`**/*.test.tsx`, and `**/__tests__/**`. The production rule selects
`isProductionFile`, which checks canonical repository-relative `src/**/*.ts` and
`src/**/*.tsx` paths, excluding `.test.ts(x)`, `.spec.ts(x)`, `__tests__/`, and
`src/tests/`. A nested `src/` directory outside the repository root is not
production source. `isTestCode` adds the shared helpers in `src/tests/` to the
test scope. All five rules report errors in their respective scopes.
Collectors can also select `nodeTypes` in those options; the double-cast rule
visits assertion nodes only, avoiding a second traversal of production ASTs.
The existing test collectors still run at `Program:exit`.

- `no-real-sleep-in-tests`: advance fake timers or await the completion signal.
  Detects timer-backed Promises, calls to same-file sleep helpers (including
  aliases, wrappers and duration parameters), and Node promise timer APIs.
  Zero-delay yields, microtasks, and Vitest timer advancement are allowed.
- `no-per-test-timeout`: keep the shared timeout. Detects numeric third arguments,
  `timeout` options, test modifiers/table builders, and `vi.setConfig`'s
  `testTimeout` option.
- `no-unlinked-skip`: enable the test or put `// quarantine: #123` on its line
  or the preceding line. Works for `it`, `test`, and `describe` skip/todo chains.
- `no-double-cast`: parse the value into the type with a type guard or narrowing.
  Detects consecutive assertions through `unknown` or `any`, including
  `value as unknown as T`, `value as any as T`, and `<T><unknown>value`, with
  parentheses or mixed assertion syntax. Single assertions, `as const`, and
  `satisfies` remain allowed.
- `no-unforgeable-global-stub`: move the page with `setPageUrl()` or count full
  page loads with `watchFullPageLoads()` from `src/tests/pageUrl.ts`. The VM
  pools run tests in a browser realm, which refuses to redefine `location`,
  `window`, `document` and `top`. Detects `Object.defineProperty` and
  `Reflect.defineProperty` of those names on `window`, `globalThis` or `self`,
  and `vi.stubGlobal` of them, through aliases. It covers test files and
  `src/tests/`, and skips a file that declares a non-DOM
  `@vitest-environment` such as `node`. `navigator` stays allowed: it is
  configurable on jsdom's window.

## Baseline ratchet

`baseline.json` records an allowance for each repository-relative file and rule.
Every rule collects its findings in source order and reports only findings beyond
that allowance. Counts can shrink without breaking lint. Allowances never move
between files or rules. This is a count baseline: replacing an old violation with
a new one in the same file/rule is invisible until the allowance is tightened.

The check/update pair mirrors the file-size baseline workflow. No root package
scripts are needed because the rules themselves implement the lint gate:

```sh
bun scripts/oxlint-plugin-voyager/check-baseline.mjs
bun scripts/oxlint-plugin-voyager/check-baseline.mjs --update
```

The checker discovers tracked and untracked files in either rule scope. The
updater runs the real oxlint rules with baseline suppression disabled, lowers
or removes existing allowances, and never creates or increases one. It exits
nonzero if any new violations remain. Raising an allowance requires an explicit,
reviewable edit to the JSON. To inspect all findings in an integration, each rule
also accepts `{ "baseline": false }` or `{ "baseline": "/path/to/baseline.json" }`.

## Detection boundaries

Resolution is lexical and stays within the linted file. Arbitrary imported sleep
helpers, runtime reassignment, dynamic property names, and higher-order timer
factories are not followed; doing so reliably needs broader data-flow analysis.
Arbitrary runtime-computed timeout values and imported options are not inferred.
Direct non-Promise timers used to schedule events are not classified
as sleeps. A fake-timer setup somewhere in a file does not exempt sleeps: the
same file can switch back to real timers. This deliberately requires explicit
fake-timer advancement rather than inferring the test runner's current clock.

The Vitest tests lint source strings in disposable scratch files using the
installed oxlint CLI and the actual repository config. They check diagnostics,
exit codes, zero-delay exceptions, baseline isolation/shrinking, and recursive
or repeated helper branches. Production-scope fixtures copy the plugin and config
into a temporary repository, so no fixture writes into this checkout's `src/`.
Existing repository tests are not edited or used as permanent lint fixtures.
