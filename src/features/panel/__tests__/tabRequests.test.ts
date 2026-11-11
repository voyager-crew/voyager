import { describe, expect, it } from 'vitest';

import { MAX_PLUGIN_REQUEST_CHARS } from '@/features/plugins/local/authoringSites';

import { parsePanelRuntimeMessage, parsePanelTabRequest } from '../protocol';

const SESSION = 'b'.repeat(64);

describe('Create mode requests through the panel tab relay', () => {
  it('passes the sentence on, trimmed, and drops every other field', () => {
    expect(
      parsePanelTabRequest({
        type: 'gv.create.start',
        request: '  Round my messages  ',
        tabId: 7,
        url: 'https://evil.example/',
      }),
    ).toEqual({ type: 'gv.create.start', request: 'Round my messages' });
  });

  it.each([
    ['an empty sentence', '   '],
    ['a sentence over the ceiling', 'x'.repeat(MAX_PLUGIN_REQUEST_CHARS + 1)],
    ['a non-string sentence', { text: 'hi' }],
    ['no sentence', undefined],
  ])('refuses %s', (_label, request) => {
    expect(parsePanelTabRequest({ type: 'gv.create.start', request })).toBeNull();
  });

  it('accepts a sentence at the ceiling', () => {
    const request = 'x'.repeat(MAX_PLUGIN_REQUEST_CHARS);
    expect(parsePanelTabRequest({ type: 'gv.create.start', request })).toEqual({
      type: 'gv.create.start',
      request,
    });
  });

  it('keeps the pending-review request payload-free', () => {
    expect(parsePanelTabRequest({ type: 'gv.create.pending', candidate: { text: '{}' } })).toEqual({
      type: 'gv.create.pending',
    });
  });

  it('refuses a runtime message whose create request is out of bounds', () => {
    const message = (request: string) => ({
      type: 'gv.panel.tab.request',
      payload: { sessionId: SESSION, request: { type: 'gv.create.start', request } },
    });
    expect(parsePanelRuntimeMessage(message('ok'))).not.toBeNull();
    expect(parsePanelRuntimeMessage(message(''))).toBeNull();
  });
});
