import { afterEach, describe, expect, it, vi } from 'vitest';

import { getBundledSiteSelectorView } from '../bundle';
import { guardedSiteStructureSelector } from '../siteSemantics';

function read(key: string, selector: string, siteId = 'chatgpt') {
  const bundle = getBundledSiteSelectorView(siteId);
  const view = {
    ...bundle,
    profiles: { ...bundle.profiles, [key]: [selector] },
    remoteKeys: new Set([key]),
  };
  return Array.from(document.querySelectorAll(guardedSiteStructureSelector(key, view, document)!));
}

afterEach(() => {
  document.body.replaceChildren();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('shared semantic repairs', () => {
  it('a renamed code host keeps the complete native code collection', () => {
    document.body.innerHTML =
      '<article data-chatgpt-selection-message-id="a"><section class="new-code"><pre><code>one</code></pre></section><section class="new-code"><pre><code>two</code></pre></section></article>';
    expect(read('codeBlock', '.new-code').map((node) => node.textContent)).toEqual(['one', 'two']);
    expect(read('codeBlock', '.new-code:first-child')).toEqual([]);
  });

  it('a wrapper containing answer prose cannot be collapsed as a repaired code block', () => {
    document.body.innerHTML =
      '<article data-chatgpt-selection-message-id="a"><section class="new-code">Keep this prose<pre><code>one</code></pre></section></article>';
    expect(read('codeBlock', '.new-code')).toEqual([]);
    document.querySelector('.new-code')!.firstChild!.remove();
    expect(read('codeBlock', '.new-code').map((node) => node.textContent)).toEqual(['one']);
  });

  it('a remote code locator cannot replace a working bundled host with another wrapper', () => {
    document.body.innerHTML =
      '<article data-chatgpt-selection-message-id="a"><section class="outer"><pre data-markdown-copy="code-block">one</pre></section></article>';
    expect(read('codeBlock', '.outer')).toEqual([document.querySelector('pre')]);
    expect(read('codeBlock', 'pre')).toEqual([document.querySelector('pre')]);
  });

  it('Voyager controls and dialog previews cannot become code hosts', () => {
    for (const owner of [
      'class="gv-preview"',
      'role="dialog"',
      'data-gv-layer="true"',
      'data-gv-component="preview"',
      'data-gv-plugin="fixture"',
    ]) {
      document.body.innerHTML = `<div ${owner}><article data-chatgpt-selection-message-id="a"><pre class="new-code">one</pre></article></div>`;
      expect(read('codeBlock', '.new-code')).toEqual([]);
    }
    document.body.innerHTML =
      '<article data-chatgpt-selection-message-id="a"><pre class="new-code">one</pre></article>';
    expect(read('codeBlock', '.new-code')).toEqual([document.querySelector('pre')]);
  });

  it('a repaired scroll owner contains all turns and actually scrolls', () => {
    document.body.innerHTML =
      '<section class="scroll" style="overflow-y:auto"><div data-user-message-bubble>Question</div><article data-chatgpt-selection-message-id="a">Answer</article></section>';
    const scroller = document.querySelector('.scroll')!;
    Object.defineProperty(scroller, 'scrollHeight', { value: 500 });
    Object.defineProperty(scroller, 'clientHeight', { value: 200 });
    expect(read('scrollContainer', '.scroll')).toEqual([scroller]);
    document.body.insertAdjacentHTML(
      'beforeend',
      '<div data-user-message-bubble>Outside question</div>',
    );
    expect(read('scrollContainer', '.scroll')).toEqual([]);
    document.body.lastChild!.remove();
    (scroller as HTMLElement).style.overflowY = 'visible';
    expect(read('scrollContainer', '.scroll')).toEqual([]);
  });
});

it('a user code sample cannot enter the assistant code-block collection', () => {
  document.body.innerHTML =
    '<div data-user-message-bubble><section class="user-code"><pre>question code</pre></section></div><article data-chatgpt-selection-message-id="a"><section class="answer-code"><pre>answer code</pre></section></article>';
  expect(read('codeBlock', '.user-code')).toEqual([]);
  expect(read('codeBlock', '.answer-code')).toEqual([document.querySelector('.answer-code')]);
});

it('a code wrapper cannot hide an adjacent image or a shadow-root preview', () => {
  document.body.innerHTML =
    '<article data-chatgpt-selection-message-id="a"><section class="code"><pre>one</pre><img src="https://example.com/kept.png"></section></article>';
  expect(read('codeBlock', '.code')).toEqual([]);
  document.querySelector('img')!.remove();
  const extra = document.createElement('span');
  extra.attachShadow({ mode: 'open' }).innerHTML = '<img src="https://example.com/shadow.png">';
  document.querySelector('.code')!.append(extra);
  expect(read('codeBlock', '.code')).toEqual([]);
  extra.remove();
  expect(read('codeBlock', '.code')).toEqual([document.querySelector('.code')]);
});

it('a repaired code host survives its own collapse decorations and toggle', () => {
  document.body.innerHTML =
    '<article data-chatgpt-selection-message-id="a"><section class="code"><pre>one</pre></section></article>';
  const host = document.querySelector('.code')!;
  expect(read('codeBlock', '.code')).toEqual([host]);
  host.classList.add('gv-code-block-collapsible', 'gv-code-block-collapsed');
  host.querySelector('pre')!.classList.add('gv-code-block-clip');
  host.insertAdjacentHTML('beforeend', '<button class="gv-code-block-toggle">Expand code</button>');
  expect(read('codeBlock', '.code')).toEqual([host]);
});

it.each([
  'hidden',
  'inert',
  'aria-hidden="true"',
  'style="display:none"',
  'style="visibility:hidden"',
])('a %s preview cannot become a remote code block', (hidden) => {
  document.body.innerHTML = `<section ${hidden}><article data-chatgpt-selection-message-id="a"><pre class="code">one</pre></article></section>`;
  expect(read('codeBlock', '.code')).toEqual([]);
  document.querySelector('section')!.replaceWith(document.querySelector('article')!);
  expect(read('codeBlock', '.code')).toEqual([document.querySelector('pre')]);
});

it('an inactive document cannot admit a remote code owner', () => {
  const doc = document.implementation.createHTMLDocument('retired');
  doc.body.innerHTML =
    '<article data-chatgpt-selection-message-id="a"><pre class="code">one</pre></article>';
  const bundle = getBundledSiteSelectorView('chatgpt');
  const view = {
    ...bundle,
    profiles: { ...bundle.profiles, codeBlock: ['.code'] },
    remoteKeys: new Set(['codeBlock']),
  };
  expect(doc.querySelector(guardedSiteStructureSelector('codeBlock', view, doc)!)).toBeNull();
  document.body.innerHTML = doc.body.innerHTML;
  expect(read('codeBlock', '.code')).toEqual([document.querySelector('pre')]);
});

it('an outer page scroller cannot replace the conversation viewport', () => {
  document.body.innerHTML =
    '<section class="outer" style="overflow-y:auto"><section class="inner" style="overflow-y:auto"><div data-user-message-bubble>Question</div><article data-chatgpt-selection-message-id="a">Answer</article></section></section>';
  for (const selector of ['.outer', '.inner']) {
    const element = document.querySelector(selector)!;
    Object.defineProperty(element, 'scrollHeight', { value: 500 });
    Object.defineProperty(element, 'clientHeight', { value: 200 });
  }
  expect(read('scrollContainer', '.outer')).toEqual([]);
  expect(read('scrollContainer', '.inner')).toEqual([document.querySelector('.inner')]);
});

it('a non-overflowing page shell cannot claim the conversation scroll target', () => {
  document.body.innerHTML =
    '<section class="scroll" style="overflow-y:auto"><div data-user-message-bubble>Question</div><article data-chatgpt-selection-message-id="a">Answer</article></section>';
  const scroller = document.querySelector('.scroll')!;
  Object.defineProperty(scroller, 'scrollHeight', { value: 200, configurable: true });
  Object.defineProperty(scroller, 'clientHeight', { value: 200 });
  expect(read('scrollContainer', '.scroll')).toEqual([]);
  Object.defineProperty(scroller, 'scrollHeight', { value: 500 });
  expect(read('scrollContainer', '.scroll')).toEqual([scroller]);
});

it('including user code in an otherwise complete answer-code list rejects the whole remote collection', () => {
  document.body.innerHTML =
    '<div data-user-message-bubble><pre class="code user">question</pre></div><article data-chatgpt-selection-message-id="a"><pre class="code answer">answer</pre></article>';
  expect(read('codeBlock', '.code')).toEqual([]);
  expect(read('codeBlock', '.answer')).toEqual([document.querySelector('.answer')]);
});

it('a full response cannot become a code block even when it only contains code', () => {
  document.body.innerHTML =
    '<article data-chatgpt-selection-message-id="a" class="reply"><pre class="code">one</pre></article>';
  expect(read('codeBlock', '.reply')).toEqual([]);
  expect(read('codeBlock', '.code')).toEqual([document.querySelector('.code')]);
});

it('scroll ownership cannot include the composer or sidebar', () => {
  document.body.innerHTML =
    '<section class="scroll" style="overflow-y:auto"><div data-user-message-bubble>Question</div><article data-chatgpt-selection-message-id="a">Answer</article><form><textarea>Draft</textarea></form></section>';
  const scroller = document.querySelector('.scroll')!;
  Object.defineProperty(scroller, 'scrollHeight', { value: 500 });
  Object.defineProperty(scroller, 'clientHeight', { value: 200 });
  expect(read('scrollContainer', '.scroll')).toEqual([]);
  document.querySelector('form')!.remove();
  expect(read('scrollContainer', '.scroll')).toEqual([scroller]);
});

it('an unrelated remote key does not add DOM or visibility proofs to a bundled read', () => {
  document.body.innerHTML =
    '<article data-chatgpt-selection-message-id="a"><pre data-markdown-copy="code-block">one</pre></article>';
  const bundle = getBundledSiteSelectorView('chatgpt');
  const view = { ...bundle, remoteKeys: new Set(['sidebar']) };
  const query = vi.spyOn(document, 'querySelectorAll');
  const style = vi.spyOn(window, 'getComputedStyle');
  const selector = guardedSiteStructureSelector('codeBlock', view, document)!;
  expect(query).not.toHaveBeenCalled();
  expect(style).not.toHaveBeenCalled();
  expect(document.querySelector(selector)?.textContent).toBe('one');
});

it('one repaired code host cannot absorb another empty native block', () => {
  document.body.innerHTML =
    '<article data-chatgpt-selection-message-id="a"><section class="outer"><pre class="first">one</pre><pre class="second"></pre></section></article>';
  expect(read('codeBlock', '.outer, .second')).toEqual([]);
  expect(read('codeBlock', '.first, .second')).toEqual(
    Array.from(document.querySelectorAll('pre')),
  );
});

it('a wrapper outside the original reply cannot become its code host', () => {
  document.body.innerHTML =
    '<section class="outer"><article data-chatgpt-selection-message-id="a"><pre class="code">one</pre></article></section>';
  expect(read('codeBlock', '.outer')).toEqual([]);
  expect(read('codeBlock', '.code')).toEqual([document.querySelector('pre')]);
});

it('a shadow host cannot conceal a different rendering behind its light-DOM code', () => {
  document.body.innerHTML =
    '<article data-chatgpt-selection-message-id="a"><section class="code"><pre>one</pre></section></article>';
  expect(read('codeBlock', '.code')).toEqual([document.querySelector('.code')]);
  document.querySelector('.code')!.attachShadow({ mode: 'open' }).innerHTML =
    '<img src="https://example.com/hidden-preview.png">';
  expect(read('codeBlock', '.code')).toEqual([]);
});
