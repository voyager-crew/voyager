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
    'A[HREF]',
    '[ARIA-LABEL]',
    '[ROLE]',
    '[HIDDEN]',
    '[role="dialog"]',
    "[role='button']",
    '[role=menuitem]',
    '[role=menuitem i]',
    "[role='dialog' s]",
    '[hidden]',
    '[aria-hidden="true"]',
    '[aria-busy="true"]',
    '[contenteditable="true"][aria-label]',
    'main textarea',
    'main  textarea',
    'main > textarea',
    'button, a[href], [role="button"]',
    ':scope > nav',
    ':not(*)',
  ])('allows a new closest(%s) while still rejecting a host-specific lookup', (generic) => {
    const source = `node.closest(${JSON.stringify(generic)});\nnode.closest('user-query');`;
    const failures = inspectLocatorSource(consumer, source);
    expect(failures).toEqual([expect.objectContaining({ file: consumer, line: 2 })]);
    expect(failures[0].reason).toContain('bypasses contract');
  });

  it.each(['i', 'I', 's', 'S'])(
    'an attribute %s flag cannot hide a copied host landmark',
    (flag) => {
      document.body.innerHTML = '<article data-test-id="conversation-title">Native title</article>';
      const published = '[data-test-id="conversation-title"]';
      for (const locator of [
        `[data-test-id="conversation-title" ${flag}]`,
        `[data-test-id='conversation-title' ${flag}]`,
        `[ data-test-id = conversation-title   ${flag} ]`,
      ]) {
        expect(Array.from(document.querySelectorAll(locator))).toEqual(
          Array.from(document.querySelectorAll(published)),
        );
        const failures = inspectLocatorSource(consumer, `query(${JSON.stringify(locator)})`);
        expect(failures).toEqual([expect.objectContaining({ line: 1 })]);
        expect(failures[0].reason).toContain('bypasses contract');
      }
    },
  );

  it.each([
    'mat-list-item.mdc-list-item--activated  [mat-line]',
    '  mat-list-item.mdc-list-item--activated \n\t [mat-line]  ',
    ':scope>nav>.empty-space',
    ':scope  >  nav \t>\n .empty-space',
  ])('extra whitespace in %s cannot hide a copied host path', (locator) => {
    document.body.innerHTML = `<nav><div class="empty-space"></div></nav>
      <mat-list-item class="mdc-list-item--activated"><span mat-line>Native title</span></mat-list-item>`;
    const published = locator.includes('mat-list-item')
      ? 'mat-list-item.mdc-list-item--activated [mat-line]'
      : ':scope > nav > .empty-space';
    const root = document.body;
    expect(Array.from(root.querySelectorAll(published))).toHaveLength(1);
    expect(Array.from(root.querySelectorAll(locator))).toEqual(
      Array.from(root.querySelectorAll(published)),
    );
    const failures = inspectLocatorSource(
      consumer,
      `root.querySelector(${JSON.stringify(locator)})`,
    );
    expect(failures).toEqual([expect.objectContaining({ line: 1 })]);
    expect(failures[0].reason).toContain('bypasses contract');
  });

  it('normalizing host paths preserves whitespace within quoted host values', () => {
    document.body.innerHTML = '<div aria-label="Gemini response"></div>';
    expect(document.querySelector('[aria-label="Gemini response"]')).toBe(
      document.body.firstElementChild,
    );
    expect(document.querySelector('[aria-label="Gemini  response"]')).toBeNull();
    expect(
      inspectLocatorSource(consumer, 'query(\'[aria-label="Gemini response"]\')'),
    ).toHaveLength(1);
    expect(inspectLocatorSource(consumer, 'query(\'[aria-label="Gemini  response"]\')')).toEqual(
      [],
    );
  });

  it('an i flag cannot hide a host value by changing its ASCII case', () => {
    document.body.innerHTML = '<article data-test-id="conversation-title"></article>';
    const published = '[data-test-id="conversation-title"]';
    for (const locator of [
      '[data-test-id="CONVERSATION-TITLE" i]',
      '[DATA-TEST-ID=Conversation-Title I]',
    ]) {
      expect(document.querySelector(locator)).toBe(document.querySelector(published));
      expect(inspectLocatorSource(consumer, `query(${JSON.stringify(locator)})`)).toHaveLength(1);
    }
    expect(
      inspectLocatorSource(consumer, 'query(`[data-test-id="CONVERSATION-${kind}" i]`)'),
    ).toHaveLength(1);
    for (const locator of [
      '[data-test-id="CONVERSATION-TITLE"]',
      '[data-test-id="CONVERSATION-TITLE" s]',
    ]) {
      expect(inspectLocatorSource(consumer, `query(${JSON.stringify(locator)})`)).toEqual([]);
    }
    expect(document.querySelector('[data-test-id="CONVERSATION-TITLE" s]')).toBeNull();
  });

  it('an i flag preserves the case of classes and other attribute values', () => {
    document.body.innerHTML =
      '<button class="conversation-title-text" data-local="OWNER" aria-label="Open sidebar"></button>';
    for (const locator of [
      '.Conversation-title-text[data-local="owner" i]',
      'button[aria-label="OPEN SIDEBAR"][data-local="owner" i]',
    ]) {
      expect(inspectLocatorSource(consumer, `query(${JSON.stringify(locator)})`)).toEqual([]);
    }
    expect(document.querySelector('.Conversation-title-text[data-local="owner" i]')).toBeNull();
    expect(document.querySelector('.conversation-title-text[data-local="owner" i]')).toBe(
      document.body.firstElementChild,
    );
    expect(
      inspectLocatorSource(consumer, 'query(\'.conversation-title-text[data-local="owner" i]\')'),
    ).toHaveLength(1);
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

  it.each([
    'data-message-author-role',
    'data-user-message-bubble',
    'data-mode-id',
    'data-chatgpt-selection-message-id',
    'data-app-action-timeline-scroll',
    'data-mobile-thread',
    'data-assistant-markdown-root',
    'data-chatgpt-conversation-selection-target',
  ])('uppercase presence names cannot bypass the published %s host owner', (attribute) => {
    const owner = document.createElement('article');
    owner.setAttribute(attribute, 'native owner');
    document.body.appendChild(owner);
    for (const locator of [
      `[${attribute}]`,
      `[${attribute.toUpperCase()}]`,
      `[ ${attribute.toUpperCase()} ]`,
      `ARTICLE[${attribute.toUpperCase()}]`,
    ]) {
      expect(Array.from(document.querySelectorAll(locator))).toEqual([owner]);
      const failures = inspectLocatorSource(
        consumer,
        `document.querySelectorAll(${JSON.stringify(locator)});`,
      );
      expect(failures).toEqual([expect.objectContaining({ line: 1 })]);
      expect(failures[0].reason).toContain('bypasses contract');
    }
  });

  it.each(['[data-test-id="Conversation-Title"]', '.Conversation-title-text', '#Prompt-textarea'])(
    'preserves case-sensitive host names in %s',
    (locator) => {
      document.body.innerHTML =
        '<div id="prompt-textarea" class="conversation-title-text" data-test-id="conversation-title"></div>';
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
