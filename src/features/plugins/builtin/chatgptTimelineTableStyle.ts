/** Keep ChatGPT's overflow measurement independent of its table bleed state. */
export const CHATGPT_TIMELINE_TABLE_STYLE = `
  [data-app-action-timeline-scroll] [data-markdown-text-style]
    [class*='TableContainer-']:has(> [class*='TableScroller-']),
  [data-app-action-timeline-scroll] [data-markdown-text-style]
    [class*='TableContainer-'] > [class*='TableScroller-'] {
    max-inline-size: 100% !important;
    margin-inline: 0 !important;
    padding-inline: 0 !important;
  }
`;
