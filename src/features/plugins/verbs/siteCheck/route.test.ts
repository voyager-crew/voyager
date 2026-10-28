import { describe, expect, it } from 'vitest';

import { requireBundledSiteAdapter } from '../../catalog/sites';
import { redactRoute } from './route';

const site = (id: string) => requireBundledSiteAdapter(id);

describe('site check route redaction', () => {
  it.each([
    // Gemini ids can be plain hex letters, which no "looks like an id" test catches.
    ['gemini', 'https://gemini.google.com/u/1/app/abcdefabcdefabcd', '/u/1/app/:id', true],
    ['gemini', 'https://gemini.google.com/app/4f2a9c0d1e7b3a55?hl=en#x', '/app/:id', true],
    ['gemini', 'https://gemini.google.com/gem/abcdefabcdef', '/gem/:id', false],
    [
      'gemini',
      'https://gemini.google.com/u/2/gem/abcdefabcdef/fedcbafedcba',
      '/u/2/gem/:id/:id',
      true,
    ],
    ['gemini', 'https://gemini.google.com/gems/view', '/gems/view', false],
    ['gemini', 'https://gemini.google.com/app', '/app', false],
    ['aistudio', 'https://aistudio.google.com/prompts/abcdefghijkl', '/prompts/:id', true],
    [
      'aistudio',
      'https://aistudio.google.com/u/0/prompts/new_chat',
      '/u/0/prompts/new_chat',
      false,
    ],
    // A short GPT id is still an id.
    [
      'chatgpt',
      'https://chatgpt.com/g/g-AbCdEfGhIjKl/c/6812a0f4-77aa-8000-b2c1-3d9e5f00aa11',
      '/g/:id/c/:id',
      true,
    ],
    [
      'chatgpt',
      'https://chatgpt.com/g/g-p-0123456789abcdef-my-plans/project',
      '/g/:id/project',
      false,
    ],
    [
      'chatgpt',
      'https://chatgpt.com/c/6812a0f4-77aa-8000-b2c1-3d9e5f00aa11?model=x#top',
      '/c/:id',
      true,
    ],
    ['chatgpt', 'https://chatgpt.com/', '/', false],
    ['claude', 'https://claude.ai/chat/2b7c1e8a-4f3d-4a51-9f0e-8c7d6b5a4e3f', '/chat/:id', true],
    [
      'claude',
      'https://claude.ai/project/2b7c1e8a-4f3d-4a51-9f0e-8c7d6b5a4e3f',
      '/project/:id',
      false,
    ],
    ['claude', 'https://claude.ai/new', '/new', false],
    ['deepseek', 'https://chat.deepseek.com/a/chat/s/9f8e7d6c-5b4a', '/a/chat/s/:id', true],
  ])('keeps only %s’s route words in %s', (id, url, route, conversation) => {
    expect(redactRoute(url, site(id))).toEqual({ route, conversation });
  });

  it('does not keep a Gemini id of hex letters or a ChatGPT GPT id in the route', () => {
    const gemini = redactRoute(
      'https://gemini.google.com/u/1/app/abcdefabcdefabcd',
      site('gemini'),
    );
    expect(gemini.route).not.toContain('abcdef');
    const gpt = redactRoute('https://chatgpt.com/g/g-AbCdEfGhIjKl/c/x', site('chatgpt'));
    expect(gpt.route).not.toContain('g-AbCdEfGhIjKl');
  });

  it('hides every segment that is not a route word, however plain it looks', () => {
    expect(redactRoute('https://claude.ai/alice/notes', site('claude')).route).toBe('/:id/:id');
    // `/u/<n>` survives only where the site has account slots.
    expect(redactRoute('https://chatgpt.com/u/1/c/abc', site('chatgpt')).route).toBe(
      '/:id/:id/c/:id',
    );
  });

  it('keeps no segment for a site it has no route table for', () => {
    expect(redactRoute('https://example.com/app/chat', { id: 'local-site' }).route).toBe(
      '/:id/:id',
    );
    expect(redactRoute('https://example.com/app/chat').route).toBe('/:id/:id');
  });

  it('reports `/` for a URL it cannot parse', () => {
    expect(redactRoute('not a url', site('chatgpt'))).toEqual({ route: '/', conversation: false });
  });

  it('ignores remote route words, account slots and fallback conversation routes', () => {
    const forged = {
      ...site('gemini'),
      routeWords: ['private-id'],
      accountSlots: false,
      conversationRoutes: ['/gems/view'],
    };
    expect(redactRoute('https://gemini.google.com/u/01/app/private-id', forged)).toEqual({
      route: '/u/01/app/:id',
      conversation: true,
    });
    expect(redactRoute('https://gemini.google.com/gems/view', forged)).toEqual({
      route: '/gems/view',
      conversation: false,
    });
    const forgedClaude = {
      ...site('claude'),
      routeWords: ['private-id'],
      accountSlots: true,
      conversationRoutes: ['/:id/:id/:id'],
    };
    expect(redactRoute('https://claude.ai/u/2/private-id', forgedClaude)).toEqual({
      route: '/:id/:id/:id',
      conversation: false,
    });
  });

  it.each([
    ['gemini', 'https://gemini.google.com/u/99/app/private-id', '/u/99/app/:id', true],
    ['gemini', 'https://gemini.google.com/u/100/app/private-id', '/u/:id/app/:id', false],
    ['aistudio', 'https://aistudio.google.cn/u/2/prompts/private-id', '/u/2/prompts/:id', true],
    ['kimi', 'https://www.kimi.com/chat/0123456789abcdefghij', '/chat/:id', true],
    ['gemini', 'https://gemini.google.com/App/%61pp/private-id', '/:id/:id/:id', false],
    [
      'gemini',
      'https://gemini.google.com/app/one/two/three/four/five/six/seven/eight?secret#private',
      '/app/:id/:id/:id/:id/:id/:id/:id/…',
      false,
    ],
  ])('preserves %s route edge behavior for %s', (id, url, route, conversation) => {
    expect(redactRoute(url, site(id))).toEqual({ route, conversation });
  });
});
