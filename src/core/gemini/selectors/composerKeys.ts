/** Positive locators only. Editor protocols and send/stop guards remain packaged. */
export const GEMINI_COMPOSER_PROFILE_KEYS = [
  'composer.candidates',
  'composer.draftCandidates',
  'composer.sendContainers',
] as const;

export type GeminiComposerProfileKey = (typeof GEMINI_COMPOSER_PROFILE_KEYS)[number];
