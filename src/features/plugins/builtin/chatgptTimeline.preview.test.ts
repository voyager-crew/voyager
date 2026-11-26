import './__tests__/chatgptTimelineHarness';
import { expect, it } from 'vitest';

import {
  dots,
  exchange,
  makeScroller,
  mount,
  serveConversation,
  settle,
} from './__tests__/chatgptTimelineHarness';

it('lists mounted turns at once, then the complete history without host wrappers', async () => {
  const ambient =
    '<in-app-browser-context source="ambient-ui-state">Browser metadata</in-app-browser-context>';
  const fetch = serveConversation([
    `${ambient}\n\n## My request: Opening question`,
    '# Selected text:\n\n## Selection 1\nExcerpt\n\n## My request:\nSecond question',
    'Third question',
    'Newest question',
  ]);
  const respond = fetch.getMockImplementation()!;
  const pending = Promise.withResolvers<void>();
  fetch.mockImplementation(async (input: unknown) => {
    if (String(input).startsWith('/backend-api/conversation/')) await pending.promise;
    return respond(input);
  });
  makeScroller();
  exchange('Opening question').remove();
  exchange('Second question').remove();
  exchange('Third question');
  exchange('Newest question');

  await mount();
  // A slow history read must not leave the rail empty (#1120).
  expect(dots().map((dot) => dot.getAttribute('aria-label'))).toEqual([
    'Third question',
    'Newest question',
  ]);

  pending.resolve();
  await settle();
  expect(dots().map((dot) => dot.getAttribute('aria-label'))).toEqual([
    'Opening question',
    'Second question',
    'Third question',
    'Newest question',
  ]);
});
