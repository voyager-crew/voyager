import { afterEach, describe, expect, it } from 'vitest';

import { resetPageUrl } from '@/tests/pageUrl';

import { getVimComposerMount } from '../vimComposerMount';
import { setVimTestSite } from './vimHarness';

const COMPOSER = 'textarea.ds-scroll-area';

/** jsdom has no layout, so each element states where its top edge sits. */
function atTop(element: HTMLElement, top: number): HTMLElement {
  element.getBoundingClientRect = () => ({ top, bottom: top, left: 0, right: 0 }) as DOMRect;
  return element;
}

function div(className: string, top: number, overflow?: string): HTMLElement {
  const element = document.createElement('div');
  element.className = className;
  if (overflow) element.style.overflow = overflow;
  return atTop(element, top);
}

afterEach(() => {
  document.body.innerHTML = '';
  resetPageUrl();
});

describe('vim HUD composer mount', () => {
  it('climbs out of a composer card that would clip the badge above it', () => {
    // DeepSeek: the badge renders in the strip above the textarea row, and the
    // card wrapping both that row and the toolbar hides its overflow.
    const card = div('card', 589, 'hidden');
    const outer = div('outer', 589);
    const row = div('row', 594);
    const input = atTop(document.createElement('textarea'), 594);
    input.className = 'ds-scroll-area';
    row.appendChild(input);
    card.appendChild(row);
    outer.appendChild(card);
    document.body.appendChild(outer);

    expect(getVimComposerMount(input, COMPOSER)).toBe(outer);
  });

  it('keeps the nearest mount when the clipping ancestor leaves the badge room', () => {
    const scroller = div('scroller', 100, 'auto');
    const row = div('row', 594);
    const input = atTop(document.createElement('textarea'), 594);
    input.className = 'ds-scroll-area';
    row.appendChild(input);
    scroller.appendChild(row);
    document.body.appendChild(scroller);

    expect(getVimComposerMount(input, COMPOSER)).toBe(row);
  });

  it('leaves an unclipped host composer alone', () => {
    setVimTestSite('chatgpt.com');
    // ChatGPT's form and Claude's fieldset already sit outside any clip.
    const form = atTop(document.createElement('form'), 549);
    const input = atTop(document.createElement('div'), 549);
    input.id = 'prompt-textarea';
    input.setAttribute('contenteditable', 'true');
    form.appendChild(input);
    document.body.appendChild(form);

    expect(getVimComposerMount(input, null)).toBe(form);
  });

  it('ignores an input the configured composer selector does not match', () => {
    const row = div('row', 594);
    const input = atTop(document.createElement('textarea'), 594);
    row.appendChild(input);
    document.body.appendChild(row);

    expect(getVimComposerMount(input, COMPOSER)).toBeNull();
  });
});
