// @vitest-environment jsdom
// @vitest-environment-options { "url": "https://custom.example/c/work" }
import { expect, it, vi } from 'vitest';

import { PluginScope } from '../../runtime/pluginScope';
import { trackUserSends } from '../trackUserSends';

it('a custom adapter records its sent prompt without requiring a bundled catalog site', async () => {
  document.body.innerHTML =
    '<main></main><form><textarea id="draft">custom prompt</textarea><button type="button" aria-label="Send">Send</button></form>';
  const scope = new PluginScope();
  const report = vi.fn();
  try {
    trackUserSends(
      scope,
      {
        siteId: 'custom',
        matches: ['https://custom.example/*'],
        conversationIdPattern: '^/c/([^/?#]+)',
        composer: '#draft',
        userTurn: '.message',
        turnKeyAttributes: ['data-custom-turn'],
      },
      report,
    );
    document.querySelector('button')!.click();
    document.querySelector('main')!.innerHTML =
      '<article class="message" data-custom-turn="sent">custom prompt</article>';
    for (let i = 0; i < 5; i++) await Promise.resolve();
    expect(report).toHaveBeenCalledWith({
      conversationKey: 'custom:conv:work',
      turnKey: 'sent',
      at: expect.any(Number),
    });
  } finally {
    await scope.dispose();
    document.body.replaceChildren();
  }
});

it('a custom host can report an attachment-only send independently of ChatGPT page data', async () => {
  const { chatgptPageData } = await import('../../builtin/chatgptPageData');
  const descriptor = Object.getOwnPropertyDescriptor(chatgptPageData, 'attachmentArea')!;
  Object.defineProperty(chatgptPageData, 'attachmentArea', {
    configurable: true,
    get: () => {
      throw new Error('another site owns this profile');
    },
  });
  document.body.innerHTML =
    '<main></main><form><textarea id="draft"></textarea><div data-composer-attachments><span>report.pdf</span></div><button type="button" aria-label="Send">Send</button></form>';
  const scope = new PluginScope();
  const report = vi.fn();
  try {
    trackUserSends(
      scope,
      {
        siteId: 'custom',
        matches: ['https://custom.example/*'],
        conversationIdPattern: '^/c/([^/?#]+)',
        composer: '#draft',
        userTurn: '.message',
        turnKeyAttributes: ['data-custom-turn'],
      },
      report,
    );
    document.querySelector('button')!.click();
    document.querySelector('main')!.innerHTML =
      '<article class="message" data-custom-turn="file"><span>report.pdf</span></article>';
    for (let i = 0; i < 5; i++) await Promise.resolve();
    expect(report).toHaveBeenCalledWith({
      conversationKey: 'custom:conv:work',
      turnKey: 'file',
      at: expect.any(Number),
    });
  } finally {
    await scope.dispose();
    document.body.replaceChildren();
    Object.defineProperty(chatgptPageData, 'attachmentArea', descriptor);
  }
});
