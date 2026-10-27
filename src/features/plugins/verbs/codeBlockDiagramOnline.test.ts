import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import { createContentExtractor } from '@/features/export/services/DOMContentExtractor';
import { installGeminiSelectorPatch } from '@/pages/content/__tests__/geminiOnlineSelectorFixture';
import { buildGeminiAdapter } from '@/pages/content/export/adapter/platform/gemini';

import { requireBundledSiteAdapter } from '../catalog/sites';
import { PluginScope } from '../runtime/pluginScope';
import { activateCodeBlockDiagram, type CodeBlockDiagram } from './codeBlockDiagram';
import { readDiagramExport } from './diagramExportRegistry';

const originalLocation = Object.getOwnPropertyDescriptor(window, 'location')!;
const scopes: PluginScope[] = [];
let retire: (() => void) | undefined;
const render = vi.fn(async (target: HTMLElement, source: string): Promise<void | (() => void)> => {
  target.textContent = source;
});
const diagram: CodeBlockDiagram = {
  name: 'mermaid',
  kind: 'mermaid',
  matches: (language, source) => language === 'mermaid' && source.startsWith('flowchart'),
  prepare: async () => true,
  render,
  exportHtml: (target) => `<svg><text>${target.textContent}</text></svg>`,
};
const params = {
  code: 'code[data-test-id="code-content"]',
  language: '.code-block-decoration > span',
  copyButton: true,
  exportImage: true,
};
const adapter = requireBundledSiteAdapter('gemini');
function block(tag = 'code-block', source = 'flowchart TD\nA-->B'): HTMLElement {
  const reply = document.createElement('model-response');
  reply.innerHTML = `<message-content><div class="markdown"><${tag} class="remote"><div class="code-block"><div class="code-block-decoration"><span>mermaid</span><div class="buttons"></div></div><pre><code data-test-id="code-content"></code></pre></div></${tag}></div></message-content>`;
  reply.querySelector('code')!.textContent = source;
  document.body.append(reply);
  return reply.querySelector<HTMLElement>(tag)!;
}
function activate(custom: CodeBlockDiagram = diagram): PluginScope {
  const scope = new PluginScope();
  scopes.push(scope);
  activateCodeBlockDiagram(
    scope,
    params,
    {
      doc: document,
      adapter,
      pluginId: 'voyager.gemini-mermaid',
      settings: {},
      setTargetCounter: () => {},
    },
    custom,
  );
  return scope;
}
function panel(block: Element): HTMLElement {
  return block.previousElementSibling as HTMLElement;
}
function copy(block: Element): HTMLButtonElement {
  return panel(block).shadowRoot!.querySelector<HTMLButtonElement>('button')!;
}

beforeEach(() => {
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: { hostname: 'gemini.google.com' },
  });
  render.mockClear();
});
afterEach(async () => {
  for (const scope of scopes.splice(0)) await scope.dispose();
  retire?.();
  retire = undefined;
  document.body.replaceChildren();
  document.head.querySelectorAll('style').forEach((style) => style.remove());
  Object.defineProperty(window, 'location', originalLocation);
  vi.restoreAllMocks();
});

it('bundled and remote diagram reads keep source, language, copy and export on the original block', async () => {
  const host = block();
  const before = host.outerHTML;
  const writes = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { writeText: writes },
  });
  const first = activate();
  await vi.waitFor(() => expect(render).toHaveBeenCalledTimes(1));
  copy(host).click();
  const exported = readDiagramExport(host);
  await first.dispose();
  retire = await installGeminiSelectorPatch({ 'code.host': ['.remote'] });
  const second = activate();
  await vi.waitFor(() => expect(render).toHaveBeenCalledTimes(2));
  copy(host).click();
  expect(writes.mock.calls).toEqual([['flowchart TD\nA-->B'], ['flowchart TD\nA-->B']]);
  expect(readDiagramExport(host)).toEqual(exported);
  await second.dispose();
  expect(host.outerHTML).toBe(before);
});

it('a renamed host renders and exports its own diagram without borrowing a sibling source', async () => {
  const host = block('new-code');
  const second = block('new-code', 'flowchart LR\nC-->D');
  retire = await installGeminiSelectorPatch({ 'code.host': ['new-code'] });
  activate();
  await vi.waitFor(() => expect(render).toHaveBeenCalledTimes(2));
  const extractor = createContentExtractor(buildGeminiAdapter(adapter));
  const exported = extractor.extractAssistantContent(host.closest('model-response')!);
  expect(exported.text).toBe('```mermaid\nflowchart TD\nA-->B\n```');
  expect(exported.html).toContain('flowchart TD');
  expect(readDiagramExport(second)?.text).toBe('```mermaid\nflowchart LR\nC-->D\n```');
});

it.each([false, true])(
  're-highlighting keeps the diagram panel and selected Code view in place (online: %s)',
  async (online) => {
    vi.useFakeTimers();
    try {
      const host = block(online ? 'new-code' : 'code-block');
      if (online) retire = await installGeminiSelectorPatch({ 'code.host': ['new-code'] });
      const cleanup = vi.fn();
      activate({
        ...diagram,
        render: async (target, source) => {
          await render(target, source);
          return cleanup;
        },
      });
      await vi.advanceTimersByTimeAsync(0);
      expect(render).toHaveBeenCalledTimes(1);
      const originalPanel = panel(host);
      const buttons = originalPanel.shadowRoot!.querySelectorAll<HTMLButtonElement>('button');
      buttons[2].click();
      expect(originalPanel.dataset.view).toBe('code');
      const originalCode = host.querySelector('code')!;
      originalCode.replaceWith(originalCode.cloneNode(true));
      await Promise.resolve();
      await vi.advanceTimersByTimeAsync(1001);
      expect(panel(host)).toBe(originalPanel);
      expect(originalPanel.dataset.view).toBe('code');
      expect(render).toHaveBeenCalledTimes(1);
      expect(cleanup).not.toHaveBeenCalled();

      const updatedCode = host.querySelector('code')!.cloneNode(true);
      updatedCode.textContent = 'flowchart LR\nC-->D';
      host.querySelector('code')!.replaceWith(updatedCode);
      await Promise.resolve();
      await vi.advanceTimersByTimeAsync(1001);
      expect(panel(host)).toBe(originalPanel);
      expect(originalPanel.dataset.view).toBe('code');
      expect(render).toHaveBeenCalledTimes(2);
      expect(cleanup).toHaveBeenCalledTimes(1);
      expect(originalPanel.shadowRoot!.querySelector('.diagram')!.textContent).toBe(
        'flowchart LR\nC-->D',
      );
      buttons[1].click();
      expect(readDiagramExport(host)?.text).toBe('```mermaid\nflowchart LR\nC-->D\n```');
    } finally {
      vi.useRealTimers();
    }
  },
);

it.each(
  (['prepare', 'render'] as const).flatMap((phase) =>
    [false, true].flatMap((changed) => [false, true].map((online) => ({ phase, changed, online }))),
  ),
)(
  're-highlighting during $phase keeps the panel and view (changed: $changed, online: $online)',
  async ({ phase, changed, online }) => {
    vi.useFakeTimers();
    try {
      const host = block(online ? 'new-code' : 'code-block');
      if (online) retire = await installGeminiSelectorPatch({ 'code.host': ['new-code'] });
      let finish!: () => void;
      const waiting = new Promise<void>((resolve) => {
        finish = resolve;
      });
      const cleanup = vi.fn();
      const prepare = vi.fn(async () => {
        if (phase === 'prepare' && prepare.mock.calls.length === 2) await waiting;
        return true;
      });
      activate({
        ...diagram,
        prepare,
        render: async (target, source) => {
          await render(target, source);
          if (phase === 'render' && render.mock.calls.length === 2) await waiting;
          return cleanup;
        },
      });
      await vi.advanceTimersByTimeAsync(0);
      expect(render).toHaveBeenCalledTimes(1);
      const originalPanel = panel(host);
      const buttons = originalPanel.shadowRoot!.querySelectorAll<HTMLButtonElement>('button');
      buttons[2].click();
      document.documentElement.setAttribute('data-gv-scheme', 'dark');
      await vi.advanceTimersByTimeAsync(0);
      expect(prepare).toHaveBeenCalledTimes(2);
      expect(render).toHaveBeenCalledTimes(phase === 'render' ? 2 : 1);
      const replacement = host.querySelector('code')!.cloneNode(true);
      const source = changed ? 'flowchart LR\nC-->D' : 'flowchart TD\nA-->B';
      replacement.textContent = source;
      host.querySelector('code')!.replaceWith(replacement);
      await Promise.resolve();
      await vi.advanceTimersByTimeAsync(1001);
      expect(panel(host)).toBe(originalPanel);
      finish();
      await vi.advanceTimersByTimeAsync(0);
      expect(panel(host)).toBe(originalPanel);
      expect(originalPanel.dataset.view).toBe('code');
      if (online) {
        buttons[1].click();
        expect(readDiagramExport(host)).toBeNull();
        buttons[2].click();
      }
      await vi.advanceTimersByTimeAsync(1001);
      expect(panel(host)).toBe(originalPanel);
      expect(originalPanel.dataset.view).toBe('code');
      expect(render).toHaveBeenCalledTimes(phase === 'render' && changed ? 3 : 2);
      expect(cleanup).toHaveBeenCalledTimes(phase === 'render' && changed ? 2 : 1);
      buttons[1].click();
      expect(readDiagramExport(host)?.text).toBe('```mermaid\n' + source + '\n```');
    } finally {
      vi.useRealTimers();
      document.documentElement.removeAttribute('data-gv-scheme');
    }
  },
);

it.each([false, true])(
  're-highlighting during a draw does not preserve the previous theme (online: %s)',
  async (online) => {
    vi.useFakeTimers();
    try {
      const host = block(online ? 'new-code' : 'code-block');
      if (online) retire = await installGeminiSelectorPatch({ 'code.host': ['new-code'] });
      let finish!: () => void;
      const waiting = new Promise<void>((resolve) => {
        finish = resolve;
      });
      activate({
        ...diagram,
        render: async (target, source) => {
          await render(target, source);
          target.dataset.scheme = document.documentElement.getAttribute('data-gv-scheme') ?? '';
          if (render.mock.calls.length === 2) await waiting;
        },
      });
      await vi.advanceTimersByTimeAsync(0);
      const originalPanel = panel(host);
      document.documentElement.setAttribute('data-gv-scheme', 'dark');
      await vi.advanceTimersByTimeAsync(0);
      expect(render).toHaveBeenCalledTimes(2);
      host.querySelector('code')!.replaceWith(host.querySelector('code')!.cloneNode(true));
      document.documentElement.setAttribute('data-gv-scheme', 'light');
      await vi.advanceTimersByTimeAsync(0);
      finish();
      await vi.advanceTimersByTimeAsync(1001);
      expect(panel(host)).toBe(originalPanel);
      expect(render).toHaveBeenCalledTimes(3);
      expect(originalPanel.shadowRoot!.querySelector<HTMLElement>('.diagram')!.dataset.scheme).toBe(
        'light',
      );
      expect(readDiagramExport(host)?.text).toContain('A-->B');
    } finally {
      vi.useRealTimers();
      document.documentElement.removeAttribute('data-gv-scheme');
    }
  },
);

it('a stale remote toolbar cannot copy a replacement block with the same selector', async () => {
  const host = block('new-code');
  const writes = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { writeText: writes },
  });
  retire = await installGeminiSelectorPatch({ 'code.host': ['new-code'] });
  activate();
  await vi.waitFor(() => expect(render).toHaveBeenCalledTimes(1));
  const oldCopy = copy(host);
  oldCopy.click();
  host.closest('model-response')!.remove();
  block('new-code', 'flowchart TD\nOTHER-->CONTENT');
  oldCopy.click();
  expect(writes.mock.calls).toEqual([['flowchart TD\nA-->B']]);
});

it('a partial remote host list still renders both bundled diagrams in DOM order', async () => {
  const first = block();
  const second = block('code-block', 'flowchart LR\nC-->D');
  second.id = 'last';
  retire = await installGeminiSelectorPatch({ 'code.host': ['#last'] });
  activate();
  await vi.waitFor(() => expect(render).toHaveBeenCalledTimes(2));
  expect(render.mock.calls.map(([, source]) => source)).toEqual([
    'flowchart TD\nA-->B',
    'flowchart LR\nC-->D',
  ]);
  expect(readDiagramExport(first)?.text).toContain('A-->B');
});

it('a renderer resolving after teardown cannot replace a new activation or register its old export', async () => {
  const host = block('new-code');
  retire = await installGeminiSelectorPatch({ 'code.host': ['new-code'] });
  let finish!: (cleanup: () => void) => void;
  const oldCleanup = vi.fn();
  const first = activate({
    ...diagram,
    render: async () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  });
  await vi.waitFor(() => expect(finish).toBeTypeOf('function'));
  await first.dispose();
  activate();
  await vi.waitFor(() => expect(render).toHaveBeenCalledTimes(1));
  const current = panel(host);
  finish(oldCleanup);
  await vi.waitFor(() => expect(oldCleanup).toHaveBeenCalledTimes(1));
  expect(panel(host)).toBe(current);
  expect(readDiagramExport(host)?.text).toBe('```mermaid\nflowchart TD\nA-->B\n```');
});

it('library preparation cancelled before rendering leaves a fresh activation able to draw', async () => {
  const host = block();
  let finish!: (ready: boolean) => void;
  const first = activate({
    ...diagram,
    prepare: async () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  });
  await first.dispose();
  activate();
  await vi.waitFor(() => expect(render).toHaveBeenCalledTimes(1));
  finish(true);
  await Promise.resolve();
  expect(render).toHaveBeenCalledTimes(1);
  expect(readDiagramExport(host)?.text).toContain('A-->B');
});

it.each(['reply', 'source'])(
  'a remote diagram moved to another %s cannot copy or export under the old toolbar',
  async (change) => {
    const host = block('new-code');
    const home = host.parentElement!;
    const other = document.createElement('model-response');
    document.body.append(other);
    const originalCode = host.querySelector('code')!;
    const writes = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: writes },
    });
    retire = await installGeminiSelectorPatch({ 'code.host': ['new-code'] });
    activate();
    await vi.waitFor(() => expect(render).toHaveBeenCalledTimes(1));
    const button = copy(host);
    const exported = readDiagramExport(host);
    button.click();
    if (change === 'reply') other.append(host);
    else originalCode.replaceWith(originalCode.cloneNode(true));
    button.click();
    expect(writes.mock.calls).toEqual([['flowchart TD\nA-->B']]);
    expect(readDiagramExport(host)).toBeNull();
    if (change === 'reply') home.append(host);
    else host.querySelector('code')!.replaceWith(originalCode);
    expect(readDiagramExport(host)).toEqual(exported);
  },
);

it('a remote block moved to another reply while its library loads starts a fresh draw operation', async () => {
  vi.useFakeTimers();
  const host = block('new-code');
  const other = document.createElement('model-response');
  document.body.append(other);
  retire = await installGeminiSelectorPatch({ 'code.host': ['new-code'] });
  let finish!: (ready: boolean) => void;
  activate({
    ...diagram,
    prepare: async () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  });
  other.append(host);
  finish(true);
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  expect(render).toHaveBeenCalledTimes(0);
  await vi.advanceTimersByTimeAsync(1001);
  expect(render).toHaveBeenCalledTimes(1);
  expect(panel(host).parentElement).toBe(other);
  vi.useRealTimers();
});

it('a retired remote toolbar cannot copy through a block the activation released', async () => {
  const host = block('new-code');
  const writes = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { writeText: writes },
  });
  retire = await installGeminiSelectorPatch({ 'code.host': ['new-code'] });
  const scope = activate();
  await vi.waitFor(() => expect(render).toHaveBeenCalledTimes(1));
  const button = copy(host);
  button.click();
  await scope.dispose();
  button.click();
  expect(writes.mock.calls).toEqual([['flowchart TD\nA-->B']]);
});

it('a changed operation tier cannot copy a host still inside its original reply', async () => {
  const host = block('new-code');
  const writes = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { writeText: writes },
  });
  retire = await installGeminiSelectorPatch({ 'code.host': ['new-code'] });
  activate();
  await vi.waitFor(() => expect(render).toHaveBeenCalledTimes(1));
  const button = copy(host);
  button.click();
  const native = block('code-block', 'flowchart LR\nC-->D');
  button.click();
  expect(writes.mock.calls).toEqual([['flowchart TD\nA-->B']]);
  await vi.waitFor(() => expect(readDiagramExport(native)?.text).toContain('C-->D'), {
    timeout: 2500,
  });
  expect(host.hasAttribute('data-gv-diagram-hidden')).toBe(false);
  expect(host.parentElement?.querySelector('.gv-diagram-panel')).toBeNull();
  expect(host.querySelector('code')?.textContent).toBe('flowchart TD\nA-->B');
});

it('OFF copies directly from the block without rescanning replies', async () => {
  const host = block();
  const writes = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { writeText: writes },
  });
  activate();
  await vi.waitFor(() => expect(render).toHaveBeenCalledTimes(1));
  const queries = vi.spyOn(document, 'querySelectorAll');
  copy(host).click();
  expect(writes).toHaveBeenCalledWith('flowchart TD\nA-->B');
  expect(queries).toHaveBeenCalledTimes(0);
});
