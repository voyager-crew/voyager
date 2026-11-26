import { getBundledSiteSelectorView } from '@/core/selectors/bundle';

const scrollContainer = getBundledSiteSelectorView('chatgpt').profiles.scrollContainer.join(',');

/** Keep ChatGPT's overflow measurement independent of its table bleed state. */
export const CHATGPT_TIMELINE_TABLE_STYLE = `
  :is(${scrollContainer}) [data-markdown-text-style]
    [class*='TableContainer-']:has(> [class*='TableScroller-']),
  :is(${scrollContainer}) [data-markdown-text-style]
    [class*='TableContainer-'] > [class*='TableScroller-'] {
    max-inline-size: 100% !important;
    margin-inline: 0 !important;
    padding-inline: 0 !important;
  }
`;
