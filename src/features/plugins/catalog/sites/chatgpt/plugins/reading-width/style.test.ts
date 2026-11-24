import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const stylePath = resolve(
  process.cwd(),
  'src/features/plugins/catalog/sites/chatgpt/plugins/reading-width/style.css',
);

describe('ChatGPT reading width styles', () => {
  it('applies the adjustable width only while the plugin is enabled', () => {
    document.body.innerHTML = `<main class="gv-plugin-chatgpt-readable">
      <div id="wrapper" class="max-w-(--thread-content-max-width)"></div>
      <div id="conversation" class="mx-auto max-w-(--thread-content-max-width)"></div>
      <div id="composer-column" class="max-w-(--thread-content-max-width)">
        <h1>Welcome</h1>
        <form id="composer" data-type="unified-composer">
          <div class="max-w-(--thread-content-max-width)">
            <div contenteditable="true"></div>
          </div>
        </form>
      </div>
    </main>`;

    const style = document.createElement('style');
    style.textContent = readFileSync(stylePath, 'utf8');
    document.head.append(style);

    const rules = Array.from(style.sheet?.cssRules ?? []) as CSSStyleRule[];
    const widthRule = rules.find(
      (rule) => rule.style.getPropertyValue('--thread-content-max-width') !== '',
    );
    const conversationCenteringRule = rules.find(
      (rule) =>
        rule.selectorText.includes('.mx-auto') &&
        rule.style.getPropertyValue('margin-inline') !== '',
    );
    const composerColumnCenteringRule = rules.find(
      (rule) =>
        rule.selectorText.includes(':has(') &&
        rule.style.getPropertyValue('width') === '100%' &&
        rule.style.getPropertyValue('margin-inline') === 'auto',
    );
    const composerCenteringRule = rules.find(
      (rule) =>
        rule.selectorText.includes("form[data-type='unified-composer']") &&
        rule.style.getPropertyValue('margin-inline') !== '' &&
        rule.style.getPropertyValue('max-width') !== '',
    );
    const wrapper = document.getElementById('wrapper')!;
    const conversation = document.getElementById('conversation')!;
    const composerColumn = document.getElementById('composer-column')!;
    const composer = document.getElementById('composer')!;
    const composerWidthContainer = composer.querySelector('[class*="--thread-content-max-width"]')!;

    expect(widthRule).toBeDefined();
    expect(widthRule!.style.getPropertyValue('max-width')).toBe(
      'var(--gv-plugin-reading-width, 768px)',
    );
    expect(wrapper.matches(widthRule!.selectorText)).toBe(true);
    expect(conversation.matches(widthRule!.selectorText)).toBe(true);
    expect(composerWidthContainer.matches(widthRule!.selectorText)).toBe(true);

    expect(conversationCenteringRule).toBeDefined();
    expect(conversationCenteringRule!.style.getPropertyValue('margin-inline')).toBe('auto');
    expect(wrapper.matches(conversationCenteringRule!.selectorText)).toBe(false);
    expect(conversation.matches(conversationCenteringRule!.selectorText)).toBe(true);
    expect(composer.matches(conversationCenteringRule!.selectorText)).toBe(false);

    expect(composerColumnCenteringRule).toBeDefined();
    expect(composerColumn.matches(composerColumnCenteringRule!.selectorText)).toBe(true);
    expect(wrapper.matches(composerColumnCenteringRule!.selectorText)).toBe(false);
    expect(conversation.matches(composerColumnCenteringRule!.selectorText)).toBe(false);

    expect(composerCenteringRule).toBeDefined();
    expect(composerCenteringRule!.style.getPropertyValue('width')).toBe('100%');
    expect(composerCenteringRule!.style.getPropertyValue('max-width')).toBe(
      'var(--gv-plugin-reading-width, 768px)',
    );
    expect(composerCenteringRule!.style.getPropertyValue('margin-inline')).toBe('auto');
    expect(wrapper.matches(composerCenteringRule!.selectorText)).toBe(false);
    expect(conversation.matches(composerCenteringRule!.selectorText)).toBe(false);
    expect(composer.matches(composerCenteringRule!.selectorText)).toBe(true);

    document.querySelector('main')!.classList.remove('gv-plugin-chatgpt-readable');
    expect(wrapper.matches(widthRule!.selectorText)).toBe(false);
    expect(conversation.matches(widthRule!.selectorText)).toBe(false);
    expect(composerWidthContainer.matches(widthRule!.selectorText)).toBe(false);
    expect(conversation.matches(conversationCenteringRule!.selectorText)).toBe(false);
    expect(composerColumn.matches(composerColumnCenteringRule!.selectorText)).toBe(false);
    expect(composer.matches(conversationCenteringRule!.selectorText)).toBe(false);
    expect(composer.matches(composerCenteringRule!.selectorText)).toBe(false);
  });
});
