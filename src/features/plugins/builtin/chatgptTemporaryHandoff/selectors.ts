import { chatgptPageData } from '../chatgptPageData';

/** Ordered legacy fallbacks; current semantic controls are in ChatGPT's site adapter. */
export const CHATGPT_COMPOSER_SELECTORS = chatgptPageData.composerCandidates;
export const CHATGPT_GENERIC_COMPOSER_SELECTOR = chatgptPageData.genericComposer;
export const CHATGPT_SEND_CONTROL_SELECTOR = chatgptPageData.sendControls.join(',');
export const CHATGPT_COMPOSER_SELECTOR = [
  ...CHATGPT_COMPOSER_SELECTORS,
  CHATGPT_GENERIC_COMPOSER_SELECTOR,
].join(',');
