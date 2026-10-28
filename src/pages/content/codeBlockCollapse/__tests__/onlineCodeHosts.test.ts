import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import { resolveGeminiCodeHosts } from '@/core/gemini/code/hosts';
import { createContentExtractor } from '@/features/export/services/DOMContentExtractor';
import { requireBundledSiteAdapter } from '@/features/plugins/catalog/sites';
import { buildGeminiAdapter } from '@/pages/content/export/adapter/platform/gemini';
import { resetPageUrl, setPageUrl } from '@/tests/pageUrl';

import { installGeminiSelectorPatch } from '../../__tests__/geminiOnlineSelectorFixture';
import { createCodeBlockCollapse, type CodeBlockCollapse } from '../engine';
import { createGeminiCodeBlockSite } from '../geminiSite';

let retire: (() => void) | undefined;
let engine: CodeBlockCollapse | undefined;

function block(tag = 'code-block', id = 'one'): HTMLElement {
  const host = document.createElement(tag);
  host.id = id;
  host.className = 'remote';
  host.innerHTML =
    '<div class="code-block"><div class="code-block-decoration"><span>typescript</span>' +
    '<div class="buttons"><button>Copy</button></div></div><pre><code data-test-id="code-content"></code></pre></div>';
  host.querySelector('code')!.textContent = 'const value = 1;\n'.repeat(25);
  document.body.append(host);
  return host;
}

beforeEach(() => {
  setPageUrl('https://gemini.google.com/');
});
afterEach(() => {
  engine?.stop();
  engine = undefined;
  retire?.();
  retire = undefined;
  document.body.replaceChildren();
  resetPageUrl();
  vi.useRealTimers();
});

it('bundled and remote reads collapse the same blocks in place and export the same code and language', async () => {
  const first = block();
  const second = block('code-block', 'two');
  const bundled = resolveGeminiCodeHosts(document).value;
  const extractor = createContentExtractor(buildGeminiAdapter(requireBundledSiteAdapter('gemini')));
  const content = extractor.extractAssistantContent(first);
  retire = await installGeminiSelectorPatch({ 'code.host': ['.remote'] });
  expect(resolveGeminiCodeHosts(document).value).toEqual(bundled);
  engine = createCodeBlockCollapse(createGeminiCodeBlockSite(document, 'code-block'));
  engine.start();
  expect(engine.blocks()).toEqual([first, second]);
  const code = first.querySelector('code');
  first.querySelector<HTMLButtonElement>('.gv-code-block-toggle')!.click();
  expect(first.classList.contains('gv-code-block-collapsed')).toBe(true);
  engine.stop();
  expect(first.querySelector('code')).toBe(code);
  expect(extractor.extractAssistantContent(first)).toEqual(content);
});

it('a partial remote list falls back for every code block in the scan', async () => {
  const first = block();
  const second = block('code-block', 'two');
  retire = await installGeminiSelectorPatch({ 'code.host': ['#one'] });
  engine = createCodeBlockCollapse(createGeminiCodeBlockSite(document, 'code-block'));
  engine.start();
  expect(engine.blocks()).toEqual([first, second]);
});

it('an equally sized wrong host cannot move a collapse toggle to another response', async () => {
  const host = block();
  const wrong = document.createElement('aside');
  wrong.innerHTML = host.innerHTML;
  document.body.append(wrong);
  retire = await installGeminiSelectorPatch({ 'code.host': ['aside'] });
  engine = createCodeBlockCollapse(createGeminiCodeBlockSite(document, 'code-block'));
  engine.start();
  expect(engine.blocks()).toEqual([host]);
  expect(host.querySelector('.gv-code-block-toggle')?.parentElement).toBe(
    host.querySelector('.buttons'),
  );
});

it('a renamed code host is proved by its native shell and keeps export bytes', async () => {
  const host = block('new-code');
  const code = host.querySelector('code');
  const extractor = createContentExtractor(buildGeminiAdapter(requireBundledSiteAdapter('gemini')));
  const content = extractor.extractAssistantContent(host.cloneNode(true) as HTMLElement);
  retire = await installGeminiSelectorPatch({ 'code.host': ['new-code'] });
  expect(resolveGeminiCodeHosts(document).value).toEqual([host]);
  engine = createCodeBlockCollapse(createGeminiCodeBlockSite(document, 'code-block'));
  engine.start();
  expect(engine.blocks()).toEqual([host]);
  engine.stop();
  expect(host.querySelector('code')).toBe(code);
  expect(extractor.extractAssistantContent(host.cloneNode(true) as HTMLElement)).toEqual(content);
});

it.each(['extra source', 'missing header', 'unrelated sibling'])(
  'a renamed shell with %s cannot become the operation owner',
  async (corruption) => {
    const host = block('new-code');
    const shell = host.firstElementChild!;
    const header = shell.querySelector('.code-block-decoration')!;
    const extra = document.createElement(corruption === 'extra source' ? 'code' : 'p');
    if (corruption === 'extra source') {
      extra.className = 'code-container';
      shell.append(extra);
    } else if (corruption === 'missing header') header.remove();
    else host.append(extra);
    retire = await installGeminiSelectorPatch({ 'code.host': ['new-code'] });
    engine = createCodeBlockCollapse(createGeminiCodeBlockSite(document, 'code-block'));
    engine.start();
    expect(engine.blocks()).toEqual([]);
    expect(resolveGeminiCodeHosts(document).value).toEqual([]);
    extra.remove();
    if (!header.isConnected) shell.prepend(header);
    engine.process();
    expect(engine.blocks()).toEqual([host]);
  },
);

it('a streaming renamed block is enhanced in the same observer flush as a whole-operation fallback', async () => {
  vi.useFakeTimers();
  const first = block('new-code');
  retire = await installGeminiSelectorPatch({ 'code.host': ['new-code'] });
  engine = createCodeBlockCollapse(createGeminiCodeBlockSite(document, 'code-block'));
  engine.start();
  expect(engine.blocks()).toEqual([first]);
  const second = block('new-code', 'two');
  await vi.advanceTimersByTimeAsync(125);
  expect(engine.blocks()).toEqual([first, second]);
  const third = block('code-block', 'three');
  await vi.advanceTimersByTimeAsync(125);
  expect(engine.blocks()).toEqual([third]);
});

it.each(['header', 'source'])(
  'a streaming renamed host without its %s does not expand the other collapsed blocks',
  async (missing) => {
    vi.useFakeTimers();
    const first = block('new-code');
    retire = await installGeminiSelectorPatch({ 'code.host': ['new-code'] });
    engine = createCodeBlockCollapse(createGeminiCodeBlockSite(document, 'code-block'));
    engine.start();
    const toggle = first.querySelector<HTMLButtonElement>('.gv-code-block-toggle')!;
    toggle.click();
    expect(first.classList.contains('gv-code-block-collapsed')).toBe(true);

    const streaming = block('new-code', 'streaming');
    const pending = streaming.querySelector(
      missing === 'header' ? '.code-block-decoration' : 'pre',
    )!;
    pending.remove();
    await vi.advanceTimersByTimeAsync(125);

    expect(engine.blocks()).toEqual([first]);
    expect(first.querySelector('.gv-code-block-toggle')).toBe(toggle);
    expect(first.classList.contains('gv-code-block-collapsed')).toBe(true);

    streaming.firstElementChild!.append(pending);
    await vi.advanceTimersByTimeAsync(125);
    expect(engine.blocks()).toEqual([first, streaming]);
    expect(first.querySelector('.gv-code-block-toggle')).toBe(toggle);
    expect(first.classList.contains('gv-code-block-collapsed')).toBe(true);
  },
);

it('an unfinished packaged host does not release collapsed repaired siblings', async () => {
  vi.useFakeTimers();
  const first = block('new-code');
  retire = await installGeminiSelectorPatch({ 'code.host': ['new-code, code-block'] });
  engine = createCodeBlockCollapse(createGeminiCodeBlockSite(document, 'code-block'));
  engine.start();
  const toggle = first.querySelector<HTMLButtonElement>('.gv-code-block-toggle')!;
  toggle.click();
  expect(engine.blocks()).toEqual([first]);
  expect(first.classList.contains('gv-code-block-collapsed')).toBe(true);

  const streaming = block('code-block', 'streaming');
  streaming.querySelector('.code-block-decoration')!.remove();
  await vi.advanceTimersByTimeAsync(125);

  expect(engine.blocks()).toEqual([first]);
  expect(first.querySelector('.gv-code-block-toggle')).toBe(toggle);
  expect(first.classList.contains('gv-code-block-collapsed')).toBe(true);
});

it.each(['dialog', 'input-area', 'editor', 'voyager'])(
  'a code-shaped shell in a %s cannot borrow native code ownership',
  async (context) => {
    const host = block('new-code');
    const boundary = document.createElement(
      context === 'dialog' || context === 'input-area' ? context : 'div',
    );
    if (context === 'editor') boundary.setAttribute('contenteditable', 'true');
    if (context === 'voyager') boundary.className = 'gv-dialog';
    document.body.append(boundary);
    boundary.append(host);
    retire = await installGeminiSelectorPatch({ 'code.host': ['new-code'] });
    engine = createCodeBlockCollapse(createGeminiCodeBlockSite(document, 'code-block'));
    engine.start();
    expect(engine.blocks()).toEqual([]);
    document.body.append(host);
    engine.process();
    expect(engine.blocks()).toEqual([host]);
  },
);

it('a response frame cannot become a code host even when it contains only one native shell', async () => {
  const host = block('model-response');
  retire = await installGeminiSelectorPatch({ 'code.host': ['model-response, new-code'] });
  engine = createCodeBlockCollapse(createGeminiCodeBlockSite(document, 'code-block'));
  engine.start();
  expect(engine.blocks()).toEqual([]);
  const renamed = document.createElement('new-code');
  renamed.append(...host.childNodes);
  host.replaceWith(renamed);
  engine.process();
  expect(engine.blocks()).toEqual([renamed]);
});

it('ordinary text beside a native code shell cannot be hidden by a renamed host', async () => {
  const host = block('new-code');
  const prose = document.createTextNode('Keep this explanation visible');
  host.prepend(prose);
  retire = await installGeminiSelectorPatch({ 'code.host': ['new-code'] });
  expect(resolveGeminiCodeHosts(document).value).toEqual([]);
  prose.remove();
  expect(resolveGeminiCodeHosts(document).value).toEqual([host]);
});

it.each(['blockquote', 'li', 'td'])(
  'a %s frame cannot be hidden or moved as a code host',
  async (tag) => {
    const host = block(tag);
    retire = await installGeminiSelectorPatch({ 'code.host': [tag + ', new-code'] });
    expect(resolveGeminiCodeHosts(document).value).toEqual([]);
    const renamed = document.createElement('new-code');
    renamed.append(...host.childNodes);
    host.replaceWith(renamed);
    expect(resolveGeminiCodeHosts(document).value).toEqual([renamed]);
  },
);

it('decorating a proved native host keeps its collapse handle and locator identity', async () => {
  const host = block('new-code');
  retire = await installGeminiSelectorPatch({ 'code.host': ['new-code'] });
  engine = createCodeBlockCollapse(createGeminiCodeBlockSite(document, 'code-block'));
  engine.start();
  const toggle = host.querySelector('.gv-code-block-toggle');
  host.classList.add('gv-custom-decoration');
  engine.process();
  expect(resolveGeminiCodeHosts(document).value).toEqual([host]);
  expect(engine.blocks()).toEqual([host]);
  expect(host.querySelector('.gv-code-block-toggle')).toBe(toggle);
});

it.each(['data-gv-layer', 'data-gv-plugin', 'gv-dialog'])(
  'an explicitly owned %s host remains outside native repair',
  async (marker) => {
    const host = block('new-code');
    if (marker.startsWith('data-')) host.setAttribute(marker, 'dialog');
    else host.classList.add(marker);
    retire = await installGeminiSelectorPatch({ 'code.host': ['new-code'] });
    expect(resolveGeminiCodeHosts(document).value).toEqual([]);
    host.removeAttribute(marker);
    host.classList.remove(marker);
    expect(resolveGeminiCodeHosts(document).value).toEqual([host]);
  },
);
