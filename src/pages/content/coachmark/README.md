# Coachmarks

Read this when adding or changing a guide or its lifecycle.

- Reuse the primitives in this directory; keep each consumer beside its feature.
- Register Gemini guides in `createOnboardingCoachmarks` in `src/pages/content/onboardingCoachmarks.ts`.
- A plugin-site guide starts from its plugin's own lifecycle instead, such as `src/features/plugins/verbs/folders/folderGuide.ts` (ChatGPT's folders). Those sites have no `body.gv-rtl`, so pass `rtl`, and pass a `signal` that aborts when the plugin scope is disposed.
- Each guide needs a stable ID, side-effect-free eligibility, cleanup after partial mount failure, all 10 locales, a debug trigger and tests.
- Skip seen or ineligible guides. Show the remaining guides continuously in registration order with `1/N` progress.
- Confirmation advances the tour; close or Escape exits it. While a guide is open, a person's clicks elsewhere on the page are blocked and the guide stays; script clicks (such as a plugin's send) pass through (`isUserEvent` in `src/core/utils/userEvent.ts`).
