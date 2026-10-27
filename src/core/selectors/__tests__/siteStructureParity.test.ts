// @vitest-environment jsdom
// @vitest-environment-options { "url": "https://page.example/" }
import { afterEach, describe, expect, it } from 'vitest';

import chatgpt from '@/features/plugins/catalog/sites/chatgpt/site.json';
import claude from '@/features/plugins/catalog/sites/claude/site.json';
import deepseek from '@/features/plugins/catalog/sites/deepseek/site.json';
import kimi from '@/features/plugins/catalog/sites/kimi/site.json';

import { initializeSiteSelectors, pageSemanticSelector } from '../index';

const stops: Array<() => void> = [];
afterEach(() => {
  stops.splice(0).forEach((stop) => stop());
  document.body.replaceChildren();
});
const cases = [
  {
    site: chatgpt,
    host: 'chatgpt.com',
    sidebar:
      '<aside id="stage-slideover-sidebar" class="repaired-sidebar"><a href="/c/one">One</a></aside>',
    scroll: 'data-app-action-timeline-scroll',
    user: '<div data-user-message-bubble>Question</div>',
    assistant:
      '<article data-chatgpt-selection-message-id="a"><section data-markdown-copy="code-block" class="repaired-code"><pre>answer code</pre></section></article>',
    rename: () => {
      document.querySelector('aside')!.removeAttribute('id');
      document.querySelector('.repaired-code')!.removeAttribute('data-markdown-copy');
    },
  },
  {
    site: claude,
    host: 'claude.ai',
    sidebar:
      '<aside data-testid="sidebar" class="repaired-sidebar"><a href="/chat/one">One</a></aside>',
    scroll: 'data-autoscroll-container="true"',
    user: '<div data-testid="user-message">Question</div>',
    assistant: '<article data-testid="assistant-message">Answer</article>',
    rename: () => {
      document.querySelector('aside')!.removeAttribute('data-testid');
    },
  },
  {
    site: deepseek,
    host: 'chat.deepseek.com',
    sidebar:
      '<div role="navigation" class="repaired-sidebar"><div class="ds-scroll-area"><a href="/a/chat/s/one">One</a></div></div>',
    scroll: 'data-native-scroll class="ds-virtual-list ds-scroll-area repaired-scroll"',
    user: '<div class="ds-message"><div class="ds-collapsible-text">Question</div></div>',
    assistant:
      '<article class="ds-message"><div class="ds-assistant-message-main-content"><section class="md-code-block repaired-code"><pre>answer code</pre></section></div></article>',
    rename: () => {
      document.querySelector('.repaired-sidebar > div')!.removeAttribute('class');
      document.querySelector('.repaired-code')!.classList.remove('md-code-block');
    },
  },
  {
    site: kimi,
    host: 'www.kimi.com',
    sidebar:
      '<aside class="next-sidebar repaired-sidebar"><a href="/chat/abcdefghijklmnopqrst">One</a></aside>',
    scroll: 'class="chat-detail-main repaired-scroll"',
    user: '<div class="segment-user">Question</div>',
    assistant: '<article class="segment-assistant">Answer</article>',
    rename: () => {
      document.querySelector('aside')!.classList.remove('next-sidebar');
    },
  },
];

async function online(
  site: (typeof cases)[number]['site'],
  host: string,
  selectors: Record<string, string>,
) {
  const run = initializeSiteSelectors(site.id, {
    host,
    doc: document,
    lifetime: new AbortController().signal,
    bundledRevision: 0,
    read: async () => ({ id: site.id, catalogRevision: 1, selectors }),
  });
  stops.push(run.stop);
  await run.ready;
}
function fixture(data: (typeof cases)[number]) {
  document.body.innerHTML = `<form><main>${data.sidebar}<div ${data.scroll} style="overflow-y:auto">${data.user}${data.assistant}</div></main></form>`;
  const scroller = document.querySelector('main')!.lastElementChild!;
  scroller.classList.add('repaired-scroll');
  Object.defineProperty(scroller, 'scrollHeight', { value: 600 });
  Object.defineProperty(scroller, 'clientHeight', { value: 200 });
  return scroller;
}
function nodes(site: (typeof cases)[number]['site'], key: string): Element[] {
  const selector = pageSemanticSelector(site, key);
  return selector ? Array.from(document.querySelectorAll(selector)) : [];
}

describe.each(cases)('$site.id structural profile parity', (data) => {
  it('keeps the same sidebar, scroll owner and code hosts on the same DOM through raw catalog hydration', async () => {
    fixture(data);
    const keys = [
      'sidebar',
      'scrollContainer',
      ...('codeBlock' in data.site.selectors ? ['codeBlock'] : []),
    ];
    const before = keys.map((key) => nodes(data.site, key));
    await online(data.site, data.host, {
      sidebar: '.repaired-sidebar',
      scrollContainer: '.repaired-scroll',
      codeBlock: '.repaired-code',
    });
    expect(keys.map((key) => nodes(data.site, key))).toEqual(before);
    expect(before.every((collection) => collection.length > 0)).toBe(true);
  });

  it('repairs renamed structure while preserving the native site conversation and answer owners', async () => {
    const scroller = fixture(data);
    data.rename();
    for (const attr of [
      'data-app-action-timeline-scroll',
      'data-autoscroll-container',
      'data-native-scroll',
    ])
      scroller.removeAttribute(attr);
    scroller.className = 'repaired-scroll';
    await online(data.site, data.host, {
      sidebar: '.repaired-sidebar',
      scrollContainer: '.repaired-scroll',
      codeBlock: '.repaired-code',
    });
    expect(nodes(data.site, 'sidebar')).toEqual([document.querySelector('.repaired-sidebar')]);
    expect(nodes(data.site, 'scrollContainer')).toEqual([scroller]);
    if ('codeBlock' in data.site.selectors)
      expect(nodes(data.site, 'codeBlock').map((node) => node.textContent)).toEqual([
        'answer code',
      ]);
  });
});

it('ChatGPT can repair its turn bodies and their code and scroll owners in one catalog snapshot', async () => {
  document.body.innerHTML =
    '<section class="scroll" style="overflow-y:auto"><div data-message-author-role="user"><div class="question">Question</div></div><article data-message-author-role="assistant"><section class="answer"><section class="code"><pre>one</pre></section></section></article></section>';
  const scroller = document.querySelector('.scroll')!;
  Object.defineProperty(scroller, 'scrollHeight', { value: 600 });
  Object.defineProperty(scroller, 'clientHeight', { value: 200 });
  // Avoid the legacy userTurn fallback while retaining its independent role witness.
  document
    .querySelector('[data-message-author-role="user"]')!
    .setAttribute('data-chatgpt-search-unit-key', 'a:user');
  document
    .querySelector('[data-message-author-role="user"]')!
    .removeAttribute('data-message-author-role');
  await online(chatgpt, 'chatgpt.com', {
    userTurn: '.question',
    assistantTurn: '.answer',
    codeBlock: '.code',
    scrollContainer: '.scroll',
  });
  expect(nodes(chatgpt, 'assistantTurn')).toEqual([document.querySelector('.answer')]);
  expect(nodes(chatgpt, 'codeBlock')).toEqual([document.querySelector('.code')]);
  expect(nodes(chatgpt, 'scrollContainer')).toEqual([scroller]);
});
