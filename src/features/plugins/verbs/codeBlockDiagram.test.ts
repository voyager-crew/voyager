import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { PluginScope } from '../runtime/pluginScope';
import { type CodeBlockDiagram, activateCodeBlockDiagram } from './codeBlockDiagram';
import type { PrimitiveContext } from './types';

const context: PrimitiveContext = {
  doc: document,
  adapter: null,
  pluginId: 'test.diagram',
  settings: {},
  setTargetCounter: () => {},
};

/** A diagram whose library loads when `prepared` resolves. */
function fakeDiagram(prepared: Promise<boolean>): CodeBlockDiagram {
  return {
    name: 'fake',
    kind: 'mermaid',
    matches: (language) => language === 'fake',
    prepare: () => prepared,
    async render(target, source) {
      target.textContent = `drawn:${source}`;
    },
  };
}

function activate(scope: PluginScope, prepared: Promise<boolean>): void {
  activateCodeBlockDiagram(scope, { turn: '.reply' }, context, fakeDiagram(prepared));
}

const panels = () => document.querySelectorAll<HTMLElement>('.gv-diagram-panel');
const drawn = () => panels()[0]?.shadowRoot?.querySelector('.diagram')?.textContent ?? null;

const scopes: PluginScope[] = [];
const newScope = (): PluginScope => {
  const scope = new PluginScope();
  scopes.push(scope);
  return scope;
};

beforeEach(() => {
  document.body.innerHTML =
    '<div class="reply"><pre><code class="language-fake">a --> b</code></pre></div>';
});

afterEach(async () => {
  await Promise.all(scopes.splice(0).map((scope) => scope.dispose()));
  document.head.replaceChildren();
  document.body.replaceChildren();
});

describe('code block diagram engine', () => {
  it('a plugin takes over a block released before its first draw', async () => {
    const first = newScope();
    activate(first, new Promise<boolean>(() => {}));
    expect(document.querySelector('pre')!.hasAttribute('data-gv-diagram-owner')).toBe(true);
    activate(newScope(), Promise.resolve(true));

    await first.dispose();

    await expect.poll(drawn, { timeout: 3000 }).toBe('drawn:a --> b');
    expect(panels()).toHaveLength(1);
  });
});
