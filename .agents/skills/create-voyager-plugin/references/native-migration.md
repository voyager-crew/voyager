# Migrate a native Gemini or AI Studio feature

The order of work, tests and checks for turning a native feature into a packaged official plugin. The decisions behind it (legacy keys stay the switch, no native fallback, conflict and upgrade rules) are in [`src/features/plugins/builtin/README.md`](../../../../src/features/plugins/builtin/README.md); the popup half is [Adding a row](../../../../src/pages/popup/officialPlugins/README.md#adding-a-row). Paths are relative to `src/features/plugins/` unless they start with `src/`.

Edit input width (`voyager.gemini-edit-input-width`) is the reference migration: a switch, a slider, its own lifetime, no business data and no MAIN-world bridge. Copy its shape before inventing one.

## Steps

1. **Values.** If the feature has a slider or another stored number, put the range, the normalize and any derived switch reading in `src/core/utils/chatAppearanceValues.ts` or a sibling `*Values.ts`, so the native reading, the binding and the handler share one function.
2. **Manifest.** Feature code becomes a fixed-id builtin, `builtin/<site><Feature>Manifest.ts`: relative imports (the docs plugin table imports the builtin list without the `@/` alias), `matches` for the one site, `i18n` for the nine non-English locales including every setting label, and only the settings the host fills from value bindings. Register it in `builtin/index.ts`. Pure CSS or an already shipped public primitive goes in `catalog/sites/{gemini,aistudio}/plugins/<id>/` instead.
3. **Owner.** In `sites/featureOwners.ts` add the `OwnedFeatureId`, the id in `OFFICIAL_PLUGIN_IDS` and a `FEATURE_OWNERS` entry with `handlers: []` unless a public primitive is deliberately opened to local plugins, and `healthTracking: false` for a default-on feature. Typecheck then asks for the label in `OWNED_FEATURE_SETTINGS` (`local/authoring/siteFacts.ts`).
4. **Bindings.** Add the enable binding to `LEGACY_ENABLE_BINDINGS` in `storage/legacyEnableBindingTable.ts`: `read` is exactly the native reading of the key, invalid values included, and `derive` covers a native decision that reads more than one key or decides once per page. Map numbers in `storage/legacyValueBindings.ts`. Nothing is written to `gvPluginsState`. A feature that had no switch gets a new default-on sync key in the domain's `StorageKeys` group plus its default in `src/core/services/settingsBackupDefaults.ts`.
5. **Handler.** `src/pages/content/<feature>/pluginHandler.ts` hangs every effect on `PluginScope` (`effect`, `observe`, `timer`, `onChromeEvent`). A native module that rewrote storage keeps that through `startLegacyWriteBack` (`runtime/legacyWriteBack.ts`): a derived "on" is recorded only on `firstRead`, and `updateSettings` calls `recheck()`. Register the handler in `src/pages/content/pluginNativeRegistration.ts`.
6. **Admission.** At the native start point call `admission.admit('<site>', '<feature>')` (`runtime/officialAdmission.ts`) in place of the native start, so the plugin inherits the Enterprise and custom-coverage early returns and the background-tab delay. Delete the native call, its `NATIVE_FEATURES` entry in `src/pages/content/nativeFeatures.ts` and the native module; page services the feature depends on stay where they are.
7. **Popup.** Add the row as [Adding a row](../../../../src/pages/popup/officialPlugins/README.md#adding-a-row) describes, in the same change that removes the old settings control, so one switch never shows twice.
8. **Docs.** If it runs on a fresh install, add it to `FRESH_INSTALL_ON` in `docs/.vitepress/pluginsPage.ts` (its test compares that set with the bindings). The guide page in every locale names the popup path as **topic card title → manifest row name**, in that locale's actual strings.

## Tests

- Move the native module's regressions into the handler's unit test.
- Drive the real `BuiltinPluginSource` + `PluginHost` + legacy snapshot feed through: never set, explicit off, explicit on, derived on (and its write-back), live switch and live value changes, live removal while the host has not yet unmounted, off then on during a debounce (one stylesheet, observers and listeners back to baseline), not admitted (does not run), and the admission point itself drawing nothing and subscribing to nothing.
- Update the binding, builtin, startup and `src/pages/content/__tests__/pluginOwnedFeatures.test.ts` cases.
- Mutate once each: remove the binding, remove the `admit`, remove the key guard (for example the `firstRead` check). Each must turn a test red; restore it.

## `PluginScope` or `startMachine`

`PluginScope` is enough when the feature only mounts and tears down (styles, observers, listeners, debounces): turning it off disposes everything. Use `startMachine` (`runtime/stateMachine.ts`) when an async result can outlive the phase that started it and turning the plugin off must decide per phase whether that result survives, as in batch delete (selecting, confirming, deleting) or a download already accepted. A timer or read that restarts on every event within one phase stays a revision counter or `scope.timer`. The audit and the reasons are in [`.github/docs/STATE_MACHINE_PLAN.md`](../../../../.github/docs/STATE_MACHINE_PLAN.md).

## Checks

`bun run test:changed`, `typecheck`, `lint:check`, `i18n:check`, `plugin:check`, `filesize:check`, and `skills:build` with no diff; then the live-browser check from `verify-in-browser`.
