import { afterEach, describe, expect, it } from 'vitest';

import { inspectLocatorSource } from '../check-locator-contracts';

const consumer = 'src/pages/content/prompt/newConsumer.ts';

afterEach(() => document.body.replaceChildren());

describe('published host fragments without generic HTML friction', () => {
  it.each([
    'button',
    'textarea',
    'form',
    'main',
    'input',
    'a[href]',
    '[role="dialog"]',
    "[role='button']",
    '[role=menuitem]',
    '[hidden]',
    '[aria-hidden="true"]',
    '[aria-busy="true"]',
    '[contenteditable="true"][aria-label]',
    'main textarea',
    'button, a[href], [role="button"]',
    ':scope > nav',
    ':not(*)',
  ])('allows a new closest(%s) while still rejecting a host-specific lookup', (generic) => {
    const source = `node.closest(${JSON.stringify(generic)});\nnode.closest('user-query');`;
    const failures = inspectLocatorSource(consumer, source);
    expect(failures).toEqual([expect.objectContaining({ file: consumer, line: 2 })]);
    expect(failures[0].reason).toContain('bypasses contract');
  });

  it.each([
    'user-query',
    '.conversation-title-text',
    '[data-test-id="conversation-title"]',
    '[data-testid="share-chat-button"]',
    '[aria-label="Gemini response"]',
  ])('keeps %s subject to the published contract', (locator) => {
    expect(
      inspectLocatorSource(consumer, `document.querySelector(${JSON.stringify(locator)});`),
    ).toEqual([expect.objectContaining({ line: 1 })]);
  });
});

describe('equivalent host locator spellings', () => {
  it.each([
    '[data-test-id="conversation-title"]',
    "[data-test-id='conversation-title']",
    '[data-test-id=conversation-title]',
    "[data-testid='share-chat-button']",
    '[data-testid=share-chat-button]',
    "[aria-label='Gemini response']",
    'USER-QUERY',
    'USER-QUERY[data-local="extra"]',
    ':is(USER-QUERY, .unused) > SPAN',
    'USER-QUERY [data-test-id=conversation-title]',
  ])('rejects %s which reads the same native DOM as the published spelling', (locator) => {
    document.body.innerHTML = `<user-query data-local="extra" data-test-id="conversation-title"
      data-testid="share-chat-button" aria-label="Gemini response"><span
      data-test-id="conversation-title">Native title</span></user-query>`;
    const canonical =
      locator.includes(' > SPAN') || locator.includes('USER-QUERY [')
        ? 'user-query > span'
        : 'user-query';
    expect(document.querySelector(locator)).toBe(document.querySelector(canonical));
    const failures = inspectLocatorSource(consumer, `node.closest(${JSON.stringify(locator)});`);
    expect(failures).toEqual([expect.objectContaining({ line: 1 })]);
    expect(failures[0].reason).toContain('bypasses contract');
  });

  it.each(['[data-test-id="Conversation-Title"]', '.Conversation-title-text'])(
    'preserves case-sensitive host names in %s',
    (locator) => {
      document.body.innerHTML =
        '<div class="conversation-title-text" data-test-id="conversation-title"></div>';
      expect(
        document.querySelector('[data-test-id="conversation-title"].conversation-title-text'),
      ).toBe(document.body.firstElementChild);
      expect(
        inspectLocatorSource(
          consumer,
          'query("[data-test-id=conversation-title].conversation-title-text")',
        ),
      ).toHaveLength(1);
      expect(inspectLocatorSource(consumer, `query(${JSON.stringify(locator)})`)).toEqual([]);
    },
  );
});
