import type { JSDOM } from 'jsdom';
import { afterEach, expect, it } from 'vitest';

import { initializeSiteSelectors } from '@/core/selectors';

import { readSentChipTargets } from '../sentChipTargets';

declare const jsdom: JSDOM;
let retire = () => {};
afterEach(() => {
  retire();
  document.body.replaceChildren();
});

async function repair(host: string, selector: string): Promise<void> {
  const run = initializeSiteSelectors('gemini', {
    host,
    doc: document,
    lifetime: new AbortController().signal,
    bundledRevision: 0,
    read: async () => ({
      id: 'gemini',
      catalogRevision: 1,
      locators: { 'sentChips.lines': [selector] },
    }),
  });
  retire = run.stop;
  await run.ready;
}

it.each(['gemini.google.com', 'business.gemini.google'])(
  '%s sent-chip repairs preserve the same native lines after attachment metadata',
  async (host) => {
    jsdom.reconfigure({ url: `https://${host}/app/test` });
    document.body.innerHTML =
      '<user-query class="user-query-container"><user-query-file-preview>notes.pdf</user-query-file-preview><div class="query-text"><p class="query-text-line" id="first">Explain the proof</p>\n<p class="query-text-line" id="last">Keep every step</p></div></user-query>';
    const bundled = readSentChipTargets(document);
    expect(bundled[0]?.lines.map((line) => line.textContent)).toEqual([
      'Explain the proof',
      'Keep every step',
    ]);
    await repair(host, '#first, #last');
    expect(readSentChipTargets(document)).toEqual(bundled);

    document.querySelector('.query-text')!.removeAttribute('class');
    document.querySelectorAll('.query-text-line').forEach((line) => {
      line.removeAttribute('class');
    });
    expect(readSentChipTargets(document)[0]?.lines).toEqual(bundled[0].lines);
  },
);

it.each([
  'aistudio.google.com',
  'aistudio.google.cn',
  'chatgpt.com',
  'claude.ai',
  'chat.deepseek.com',
  'www.kimi.com',
  'custom.example',
])(
  '%s cannot use Gemini attachment metadata to certify a foreign sent-chip repair',
  async (host) => {
    jsdom.reconfigure({ url: `https://${host}/chat/test` });
    document.body.innerHTML =
      '<user-query class="user-query-container"><user-query-file-preview>Keep this authored note</user-query-file-preview><div id="renamed">Explain the complete proof</div></user-query>';
    const bundled = readSentChipTargets(document);
    expect(bundled[0]?.lines).toEqual([]);
    // A still-live Gemini snapshot must not follow a reader to another website.
    await repair('gemini.google.com', '#renamed');
    expect(readSentChipTargets(document)).toEqual(bundled);
  },
);
