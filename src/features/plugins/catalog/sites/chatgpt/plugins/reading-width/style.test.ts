import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const css = readFileSync(
  resolve(
    process.cwd(),
    'src/features/plugins/catalog/sites/chatgpt/plugins/reading-width/style.css',
  ),
  'utf8',
);

function mount(html: string): void {
  const style = document.createElement('style');
  style.textContent = css;
  document.head.append(style);
  document.body.className = 'gv-plugin-chatgpt-readable';
  document.body.innerHTML = html;
}

function byId(id: string): HTMLElement {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Missing fixture element #${id}`);
  return element;
}

afterEach(() => {
  document.head.innerHTML = '';
  document.body.innerHTML = '';
  document.body.removeAttribute('class');
});

describe('ChatGPT reading width layout', () => {
  // Shape of the new-chat page (2026-11): the composer sits in a flex-1 wrapper
  // that declares the width variable but carries no mx-auto.
  it('centers the new-chat composer column instead of pinning it left', () => {
    mount(`<main>
      <div id="wrapper" class="relative min-h-0 flex-1 flex flex-col [--thread-content-max-width:42rem]">
        <div id="column" class="[--thread-content-max-width:var(--thread-content-responsive-max-width,inherit)] mx-auto max-w-(--thread-content-max-width)">
          <form data-chatgpt-composer=""><div contenteditable="true" data-composer-markdown=""></div></form>
        </div>
      </div>
    </main>`);

    for (const id of ['wrapper', 'column']) {
      const style = getComputedStyle(byId(id));
      expect(style.getPropertyValue('margin-inline'), id).toBe('auto');
      // Auto margins alone let the flex item shrink to its content.
      expect(style.width, id).toBe('100%');
    }
  });
});
