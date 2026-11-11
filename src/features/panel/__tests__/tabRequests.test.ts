import { describe, expect, it } from 'vitest';

import { MAX_PLUGIN_REQUEST_CHARS } from '@/features/plugins/local/authoringSites';

import { parsePanelContext, parsePanelRuntimeMessage, parsePanelTabRequest } from '../protocol';

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

describe('the review count in the panel context', () => {
  const context = {
    pageUrl: 'https://gemini.google.com/app',
    siteId: 'gemini',
    accountSlot: '0',
    scheme: 'light',
    direction: 'ltr',
  };

  it('carries a count of picks and reads a context without one as none', () => {
    expect(parsePanelContext({ ...context, creationRequest: 2 })?.creationRequest).toBe(2);
    expect(parsePanelContext(context)?.creationRequest).toBeUndefined();
  });

  it.each([-1, 1.5, '2', Number.NaN])('refuses a context whose count is %s', (count) => {
    expect(parsePanelContext({ ...context, creationRequest: count })).toBeNull();
  });
});
