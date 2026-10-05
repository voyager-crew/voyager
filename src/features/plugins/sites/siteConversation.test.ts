import { describe, expect, it } from 'vitest';

import {
  siteConversationConfig,
  starConversationId,
} from '@/features/timeline/adapters/catalog/conversationId';

import { requireBundledSiteAdapter } from '../catalog/sites';
import { parseSiteConversation } from './siteConversation';

const ID = '68a1f2c3-0b4d-8001-9e2f-1a2b3c4d5e6f';
const chatgpt = siteConversationConfig(requireBundledSiteAdapter('chatgpt'));

describe('parseSiteConversation', () => {
  it.each([
    ['a plain conversation', `https://chatgpt.com/c/${ID}`, `/c/${ID}`],
    [
      'a Project conversation',
      `https://chatgpt.com/g/g-p-67ab-trip/c/${ID}`,
      `/g/g-p-67ab-trip/c/${ID}`,
    ],
    [
      'a GPT conversation',
      `https://chatgpt.com/g/g-2fkFE8rbu-dall-e/c/${ID}`,
      `/g/g-2fkFE8rbu-dall-e/c/${ID}`,
    ],
    ['an account route', `https://chatgpt.com/u/1/c/${ID}`, `/u/1/c/${ID}`],
    ['an account Project route', `https://chatgpt.com/u/2/g/g-p-x/c/${ID}`, `/u/2/g/g-p-x/c/${ID}`],
    ['a sidebar link', `/g/g-p-x/c/${ID}?model=gpt-5#top`, `/g/g-p-x/c/${ID}`],
  ])('reads %s as one conversation key and its route', (_name, href, path) => {
    expect(parseSiteConversation(chatgpt, href)).toEqual({
      id: ID,
      key: `chatgpt:conv:${ID}`,
      path,
    });
  });

  it.each([
    ['the home page', 'https://chatgpt.com/'],
    ['a Project overview', 'https://chatgpt.com/g/g-p-x/project'],
    ['a path that only ends in /c/', `https://chatgpt.com/share/x/c/${ID}`],
    ['a protocol-relative link', `//evil.example/x/c/${ID}`],
    ['garbage', 'not a url'],
  ])('reads no conversation from %s', (_name, href) => {
    expect(parseSiteConversation(chatgpt, href)).toBeNull();
  });

  it('reads nothing on a site without a route pattern', () => {
    expect(parseSiteConversation({ siteId: 'custom' }, `https://example.com/c/${ID}`)).toBeNull();
  });

  // Stars are already stored under the timeline's ids; one parser must never rename them.
  it.each(['chatgpt', 'claude', 'deepseek'])(
    'names every %s conversation with the id its timeline stars use',
    (site) => {
      const namespace = siteConversationConfig(requireBundledSiteAdapter(site));
      const origin = requireBundledSiteAdapter(site).matches[0].replace('/*', '');
      const routes = [
        `/c/${ID}`,
        `/g/g-p-x/c/${ID}`,
        `/u/3/c/${ID}`,
        `/chat/${ID}`,
        `/a/chat/s/${ID}`,
        '/',
        '/new',
      ];
      for (const route of routes) {
        const href = `${origin}${route}`;
        expect(parseSiteConversation(namespace, href)?.key ?? null, href).toBe(
          starConversationId(namespace, href),
        );
      }
    },
  );
});
