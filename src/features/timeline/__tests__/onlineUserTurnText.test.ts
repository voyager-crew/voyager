import type { JSDOM } from 'jsdom';
import { afterEach, describe, expect, it } from 'vitest';
declare const jsdom: JSDOM;
import { initializeSiteSelectors } from '@/core/selectors';

import { userTurnText } from '../userTurnText';

const sites = [
  ['gemini', 'gemini.google.com', '<user-query id="turn">BODY</user-query>'],
  ['aistudio', 'aistudio.google.com', '<section data-turn-role="User" id="turn">BODY</section>'],
  ['chatgpt', 'chatgpt.com', '<section data-user-message-bubble id="turn">BODY</section>'],
  ['claude', 'claude.ai', '<section data-testid="user-message" id="turn">BODY</section>'],
  [
    'deepseek',
    'chat.deepseek.com',
    '<section class="ds-message" id="turn"><div class="ds-collapsible-text">BODY</div></section>',
  ],
  ['kimi', 'www.kimi.com', '<section class="segment-user" id="turn">BODY</section>'],
] as const;
let stop: (() => void) | undefined;
afterEach(() => {
  stop?.();
  document.body.replaceChildren();
});

for (const [site, host, template] of sites)
  describe(`${site} timeline text`, () => {
    async function patch(selector: string) {
      jsdom.reconfigure({ url: `https://${host}/` });
      const run = initializeSiteSelectors(site, {
        host,
        doc: document,
        lifetime: new AbortController().signal,
        read: async () => ({
          id: site,
          catalogRevision: 1,
          locators: { 'timeline.userText': [selector] },
        }),
        bundledRevision: 0,
      });
      stop = run.stop;
      await run.ready;
    }
    const turn = () => document.getElementById('turn')!;
    it('a renamed text region preserves the same saved prompt and can select complete words', async () => {
      document.body.innerHTML = template.replace(
        'BODY',
        '<div class="renamed"><span class="prefix">Hello world</span> again</div>',
      );
      const before = userTurnText(turn());
      await patch('.renamed');
      expect(userTurnText(turn())).toBe(before);
      await patch('.prefix');
      expect(userTurnText(turn())).toBe('Hello world');
    });
    it('a clipped word cannot replace the saved user prompt', async () => {
      document.body.innerHTML = template.replace(
        'BODY',
        'hel<span class="clipped">lo</span> world',
      );
      const before = userTurnText(turn());
      await patch('.clipped');
      expect(userTurnText(turn())).toBe(before);
      turn().innerHTML =
        site === 'deepseek'
          ? '<div class="ds-collapsible-text"><span class="clipped">Hello</span> world</div>'
          : '<span class="clipped">Hello</span> world';
      expect(userTurnText(turn())).toBe('Hello');
    });
    it('a preview that looks like a turn cannot supply a remote saved summary', async () => {
      document.body.innerHTML = `<dialog>${template.replace('BODY', '<span class="prefix">Hello</span> world')}</dialog>`;
      await patch('.prefix');
      expect(userTurnText(turn())).toBe('Hello world');
      document.querySelector('dialog')!.replaceWith(turn());
      // DeepSeek requires its original native text witness as well as the row.
      if (site === 'deepseek')
        turn().innerHTML =
          '<div class="ds-collapsible-text"><span class="prefix">Hello</span> world</div>';
      expect(userTurnText(turn())).toBe('Hello');
    });
    it('another site policy cannot borrow the current page text repair', async () => {
      document.body.innerHTML = template.replace('BODY', '<span class="prefix">Hello</span> world');
      await patch('.prefix');
      expect(userTurnText(turn(), `https://${host}/`)).toBe('Hello');
      expect(userTurnText(turn(), 'https://custom.example/chat')).toBe('Hello world');
      expect(userTurnText(turn(), 'https://other.example/chat')).toBe('Hello world');
    });
    it('an ordinary reply region cannot become saved user text without a native user turn', async () => {
      document.body.innerHTML =
        '<article id="turn"><span class="prefix">Hello</span> world</article>';
      await patch('.prefix');
      expect(userTurnText(turn())).toBe('Hello world');
      document.body.innerHTML = template.replace('BODY', '<span class="prefix">Hello</span> world');
      expect(userTurnText(turn())).toBe('Hello');
    });
    it.each([
      '<form>',
      '<section contenteditable="true">',
      '<section role="alertdialog">',
      '<section data-gv-plugin="preview">',
    ])('a nested %s region cannot replace the saved source prompt', async (opening) => {
      const closing = opening.startsWith('<form') ? '</form>' : '</section>';
      document.body.innerHTML = template.replace(
        'BODY',
        `<div class="query-text">Original prompt</div>${opening}<span class="prefix">Unsent draft</span>${closing}`,
      );
      const before = userTurnText(turn());
      await patch('.prefix');
      expect(userTurnText(turn())).toBe(before);
      document.body.innerHTML = template.replace(
        'BODY',
        '<div class="query-text">Original prompt <span class="prefix">complete</span></div>',
      );
      expect(userTurnText(turn())).toBe('complete');
    });
  });
