import { describe, expect, it } from 'vitest';

import { createContentExtractor } from '@/features/export/services/DOMContentExtractor';
import { chatgptAdapter } from '@/features/plugins/sites/adapters/chatgpt';

import { extractUserMessage } from '../chatgptThread';
import { buildChatGptAdapter } from '../platform/chatgpt';

const extractor = createContentExtractor(buildChatGptAdapter(chatgptAdapter));

const RESOURCE_CARD = `
  <span class="flex flex-col overflow-hidden rounded-2xl">
    <span class="group/resource-card relative">
      <button aria-busy="false" aria-label="Voyager 测试 notes.pdf" type="button"></button>
      <span class="pointer-events-none">
        <span title="Voyager 测试 notes.pdf">Voyager 测试 notes.pdf</span>
        <span>PDF</span>
      </span>
    </span>
  </span>`;

describe('ChatGPT user attachments', () => {
  it('exports a resource card upload as a filename placeholder without its card text', () => {
    // Measured live (2026-10): the card labels only its button, not the card itself.
    const user = document.createElement('div');
    user.innerHTML = `
      <div class="flex w-full flex-wrap justify-end gap-2">${RESOURCE_CARD}</div>
      <div>这是啥？</div>
    `;

    const extracted = extractor.extractUserContent(user);

    expect(extracted.attachments).toEqual([{ name: 'Voyager 测试 notes.pdf', type: 'pdf' }]);
    expect(extracted.text).toContain('📎 Voyager 测试 notes.pdf');
    expect(extracted.text).toContain('这是啥？');
    expect(extracted.text).not.toContain('notes.pdf\nPDF');
  });

  it('carries a card rendered beside the bubble into the crawled prompt', () => {
    // Live layout: the card sits in the prompt's unit, outside its bubble.
    const item = document.createElement('div');
    item.setAttribute('data-turn-key', 'turn-1');
    item.innerHTML = `
      <div data-chatgpt-search-unit-key="turn-1:0:user">
        <div class="flex w-full flex-wrap justify-end gap-2">${RESOURCE_CARD}</div>
        <div data-user-message-bubble>这是啥？</div>
      </div>
    `;
    const bubble = item.querySelector<HTMLElement>('[data-user-message-bubble]')!;

    const extracted = extractUserMessage(item, bubble, extractor);

    expect(extracted.attachments).toEqual([{ name: 'Voyager 测试 notes.pdf', type: 'pdf' }]);
    expect(extracted.text).toContain('这是啥？');
  });

  it('ignores a labelled group whose button names something else', () => {
    const user = document.createElement('div');
    user.innerHTML = `
      <div role="group" aria-label="Actions">
        <div data-default-action="true"><button type="button" aria-label="Copy"></button></div>
      </div>
      <div>Hello</div>
    `;

    expect(extractor.extractUserContent(user).attachments).toEqual([]);
  });
});
