import { describe, expect, it } from 'vitest';

import { createContentExtractor } from '../DOMContentExtractor';
import { domExtractorTestAdapter } from './domExtractorTestAdapter';

const extractor = createContentExtractor(domExtractorTestAdapter);

describe('exportRichText.inline', () => {
  it.each([
    ['paragraph', '<p>First<br>Second</p>', 'First\nSecond'],
    [
      'table cell',
      '<table><tbody><tr><td>First<br>Second</td></tr></tbody></table>',
      '| First Second |\n| --- |',
    ],
  ])('does not join words across <br> in an exported reply %s', (_kind, content, expectedText) => {
    const assistant = document.createElement('div');
    assistant.innerHTML = `<message-content><div class="markdown">${content}</div></message-content>`;

    const extracted = extractor.extractAssistantContent(assistant);

    expect(extracted.text).toBe(expectedText);
    expect(extracted.html).toBe(content);
  });

  it('keeps an inline formula inside bold text as LaTeX (#571)', () => {
    const assistant = document.createElement('div');
    assistant.innerHTML = `
      <message-content>
        <div class="markdown"><p><b>Final answer: <span class="math-inline" data-math="\\frac{4 + 3\\sqrt{15}}{17}"><span class="katex"><span class="katex-html">174+315</span></span></span></b></p></div>
      </message-content>
    `;

    const extracted = extractor.extractAssistantContent(assistant);

    expect(extracted.text).toBe('**Final answer: $\\frac{4 + 3\\sqrt{15}}{17}$**');
    expect(extracted.hasFormulas).toBe(true);
  });

  it('preserves direct text around nested inline elements', () => {
    const assistant = document.createElement('div');
    assistant.innerHTML = `
      <message-content>
        <div class="markdown"><div>Amount: <strong>42</strong> total</div></div>
      </message-content>
    `;

    const extracted = extractor.extractAssistantContent(assistant);

    expect(extracted.text).toContain('Amount: **42** total');
    expect(extracted.html).toContain('Amount:');
    expect(extracted.html).toContain('total');
  });

  it.each([
    ['<span>First <strong>bold</strong> </span><span>Second.</span>', 'First **bold** Second.'],
    ['<span>First <strong>bold</strong></span><span> Second.</span>', 'First **bold** Second.'],
  ])('preserves whitespace between adjacent inline containers', (content, expected) => {
    const assistant = document.createElement('div');
    assistant.innerHTML = `
      <message-content>
        <div class="markdown">
          <div>${content}</div>
        </div>
      </message-content>
    `;

    const extracted = extractor.extractAssistantContent(assistant);

    expect(extracted.text).toBe(expected);
  });

  it('does not invent whitespace between adjacent inline containers', () => {
    const assistant = document.createElement('div');
    assistant.innerHTML = `
      <message-content>
        <div class="markdown">
          <div><span>Hello</span><span>, world.</span></div>
        </div>
      </message-content>
    `;

    const extracted = extractor.extractAssistantContent(assistant);

    expect(extracted.text).toBe('Hello, world.');
  });

  it('preserves a whitespace-only inline container between text containers', () => {
    const assistant = document.createElement('div');
    assistant.innerHTML = `
      <message-content>
        <div class="markdown">
          <div><span>First</span><span> </span><span>Second</span></div>
        </div>
      </message-content>
    `;

    const extracted = extractor.extractAssistantContent(assistant);

    expect(extracted.text).toBe('First Second');
    expect(extracted.html).toContain('<span> </span>');
  });
});
