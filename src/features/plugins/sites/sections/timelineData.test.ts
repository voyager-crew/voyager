import { describe, expect, it } from 'vitest';

import { readTimelineSection } from './timelineData';

const history = {
  source: 'chatgptConversation',
  sessionPath: '/api/auth/session',
  conversationPath: '/backend-api/conversation/{conversationId}',
};

describe('site.json timeline section', () => {
  it('reads the ChatGPT history reader and stepped homing', () => {
    expect(
      readTimelineSection({ format: 1, homing: { mode: 'step', releaseWith: 'wheel' }, history }),
    ).toEqual({
      timeline: { format: 1, homing: { mode: 'step', releaseWith: 'wheel' }, history },
      issues: [],
    });
  });

  // Remote data chooses what the page requests with the session's token: same origin only.
  it.each([
    ['an absolute URL', { conversationPath: 'https://evil.test/{conversationId}' }],
    ['a protocol-relative URL', { sessionPath: '//evil.test/session' }],
    ['a parent segment', { conversationPath: '/backend-api/../x/{conversationId}' }],
    ['a query', { sessionPath: '/api/auth/session?x=1' }],
    ['no conversation id', { conversationPath: '/backend-api/conversation' }],
    ['two conversation ids', { conversationPath: '/{conversationId}/{conversationId}' }],
    ['an unknown reader', { source: 'fetchAnything' }],
  ])('drops a history with %s and keeps the homing mode', (_label, override) => {
    const read = readTimelineSection({
      format: 1,
      homing: { mode: 'step', releaseWith: 'wheel' },
      history: { ...history, ...override },
    });
    expect(read.timeline).toEqual({ format: 1, homing: { mode: 'step', releaseWith: 'wheel' } });
    expect(read.issues).not.toEqual([]);
  });

  it('keeps the homing mode when its release is unknown', () => {
    const read = readTimelineSection({ format: 1, homing: { mode: 'step', releaseWith: 'key' } });
    expect(read.timeline).toEqual({ format: 1, homing: { mode: 'step' } });
    expect(read.issues).not.toEqual([]);
  });

  it('reads an unknown format as no section', () => {
    expect(
      readTimelineSection({ format: 2, homing: { mode: 'step', releaseWith: 'wheel' } }).timeline,
    ).toBeUndefined();
  });
});
