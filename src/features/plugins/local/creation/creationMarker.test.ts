import { describe, expect, it } from 'vitest';

import { createPageUrl } from '../authoring/skillLink';
import { authoringSites } from '../authoringSites';
import { isCreationChatText } from './creationMarker';

const URL = createPageUrl('gemini');
const BARE = URL.replace(/^https:\/\//, '');

describe('recognizing a Create chat from a user message', () => {
  it.each(authoringSites().map((site) => [site.id, createPageUrl(site.id)]))(
    'recognizes the %s create page',
    (_id, url) => {
      expect(isCreationChatText(`Read ${url} and write me a plugin.`)).toBe(true);
    },
  );

  it.each([
    ['at the start of the message', `${URL} then do it`],
    ['inside parentheses', `(see ${URL})`],
    ['as a markdown link', `[the guide](${URL})`],
    ['inside angle brackets', `<${URL}>`],
    ['inside quotes', `"${URL}"`],
    ['followed by a full stop', `Read ${URL}.`],
    ['without its scheme', `Read ${BARE} first`],
    ['over http', `Read ${URL.replace('https://', 'http://')}`],
    ['in upper case', `Read ${URL.toUpperCase()}`],
    ['after a line break', `My request\n${URL}`],
  ])('recognizes the link %s', (_label, text) => {
    expect(isCreationChatText(text)).toBe(true);
  });

  it.each([
    ['no link', 'Make my messages rounded'],
    ['another page of the docs site', 'https://voyager.nagi.fun/guide/plugins.md'],
    ['a page for a site Voyager does not author', 'https://voyager.nagi.fun/create/example.md'],
    ['a longer file name', `${URL}x`],
    ['a look-alike host', `https://evilvoyager.nagi.fun/create/gemini.md`],
    ['a subdomain of another host', `https://voyager.nagi.fun.evil.com/create/gemini.md`],
    ['a subdomain of the docs host', `https://www.${BARE}`],
    ['the link as a path on another host', `https://evil.com/${BARE}`],
    ['the link as a full URL path on another host', `https://evil.com/${URL}`],
    ['the link after credentials', `https://user@${BARE}`],
  ])('ignores %s', (_label, text) => {
    expect(isCreationChatText(text)).toBe(false);
  });

  it('finds a real link after a look-alike in the same message', () => {
    expect(isCreationChatText(`https://evil.com/${BARE} or ${URL}`)).toBe(true);
  });
});
