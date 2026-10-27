// @vitest-environment jsdom
// @vitest-environment-options { "url": "https://chatgpt.com/c/landmarks" }
import { afterEach, expect, it, vi } from 'vitest';

import { resolveComposerOperation } from '@/core/services/composer/siteComposerOperation';
import { findSiteChatInput } from '@/core/services/composer/siteInputReads';
import { chatgptActionSelector } from '@/features/plugins/builtin/chatgptActionTargets';
import { chatgptComposerRootOf } from '@/features/plugins/builtin/chatgptComposerTargets';
import { findComposerField } from '@/features/plugins/builtin/chatgptLocalBridge/ops/pageReaders';
import { findTrigger } from '@/features/plugins/builtin/chatgptModelSelect/pickerDom';
import { chatgptAdapter } from '@/features/plugins/sites/adapters/chatgpt';
import type { ModelPickerSection } from '@/features/plugins/sites/sections/modelPickerData';
import { ownsTimelineUserText } from '@/features/timeline/userTextProof';
import { chatgptCodeLanguageLabel } from '@/pages/content/export/adapter/chatgptCodeLanguage';
import {
  chatgptLoggedOutThreadSelector,
  chatgptLoggedOutAssistantSelector,
} from '@/pages/content/export/adapter/chatgptExportLocators';
import {
  chatgptThreadListSelector,
  chatgptHistoryPendingSelector,
} from '@/pages/content/export/adapter/chatgptHistoryLocators';

import { getBundledSiteSelectorView } from '../bundle';
import { initializeSiteSelectors, pageSemanticSelector, type SiteSelectorLifetime } from '../index';
import { guardedSiteStructureSelector } from '../siteSemantics';

let run: SiteSelectorLifetime | undefined;
afterEach(() => {
  run?.stop();
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

async function online(
  selectors: Record<string, string> = {},
  locators: Record<string, string[]> = {},
  pageHooks: Record<string, string> = {},
) {
  run?.stop();
  run = initializeSiteSelectors('chatgpt', {
    host: 'chatgpt.com',
    doc: document,
    lifetime: new AbortController().signal,
    bundledRevision: 0,
    read: async () => ({ id: 'chatgpt', catalogRevision: 1, selectors, locators, pageHooks }),
  });
  await run.ready;
}

function shell(tag: string, body: string): void {
  document.body.innerHTML = `<${tag}><main>${body}</main></${tag.split(' ')[0]}>`;
}

it.each(['form', 'nav', 'aside', 'div role="navigation"'])(
  'a shared %s around the app cannot erase repaired ChatGPT turns or timeline prompt text',
  async (tag) => {
    shell(
      tag,
      '<article data-chatgpt-search-unit-key="one:user"><div class="question">Question</div></article><article data-message-author-role="assistant"><section class="answer">Answer</section></article>',
    );
    await online({ userTurn: '.question', assistantTurn: '.answer' });
    expect(document.querySelector(pageSemanticSelector(chatgptAdapter, 'userTurn')!)).toBe(
      document.querySelector('.question'),
    );
    expect(document.querySelector(pageSemanticSelector(chatgptAdapter, 'assistantTurn')!)).toBe(
      document.querySelector('.answer'),
    );
    expect(ownsTimelineUserText(document.querySelector<HTMLElement>('.question')!, 'chatgpt')).toBe(
      true,
    );
    const preview = document.createElement('div');
    preview.setAttribute('role', 'dialog');
    const main = document.querySelector('main')!;
    main.replaceChildren(preview);
    preview.innerHTML =
      '<main><article data-chatgpt-search-unit-key="one:user"><div class="question">Question</div></article><article data-message-author-role="assistant"><section class="answer">Answer</section></article></main>';
    expect(
      document.querySelector(pageSemanticSelector(chatgptAdapter, 'assistantTurn')!),
    ).toBeNull();
    expect(ownsTimelineUserText(document.querySelector<HTMLElement>('.question')!, 'chatgpt')).toBe(
      false,
    );
  },
);

it('a second main inside a dialog cannot certify itself as the conversation app boundary', async () => {
  document.body.innerHTML =
    '<main><p>The live app</p></main><dialog open><main><article data-chatgpt-search-unit-key="one:user"><div class="question">Question</div></article><article data-message-author-role="assistant"><section class="answer">Answer</section></article><nav aria-label="History"><a href="/c/previous">Previous</a></nav><form><div id="prompt-textarea" contenteditable="true">Copied draft</div><button type="submit">Send</button></form></main></dialog>';
  await online({ userTurn: '.question', assistantTurn: '.answer' });
  expect(document.querySelector(pageSemanticSelector(chatgptAdapter, 'assistantTurn')!)).toBeNull();
  document.querySelector('body > main')!.remove();
  expect(document.querySelector(pageSemanticSelector(chatgptAdapter, 'assistantTurn')!)).toBeNull();
  const realMain = document.querySelector('dialog > main')!;
  document.querySelector('dialog')!.replaceWith(realMain);
  expect(document.querySelector(pageSemanticSelector(chatgptAdapter, 'assistantTurn')!)).toBe(
    document.querySelector('.answer'),
  );
});

it('a nested main does not turn a shared app form into the message owner', async () => {
  shell(
    'form',
    '<main><article data-chatgpt-search-unit-key="one:user"><div class="question">Question</div></article><article data-message-author-role="assistant"><section class="answer">Answer</section></article></main>',
  );
  await online({ userTurn: '.question', assistantTurn: '.answer' });
  expect(document.querySelector(pageSemanticSelector(chatgptAdapter, 'assistantTurn')!)).toBe(
    document.querySelector('.answer'),
  );
});

it('a second main inside an edit form cannot borrow the live app boundary', async () => {
  document.body.innerHTML =
    '<main id="live-app"><p>Live app</p></main><form><main><article data-chatgpt-search-unit-key="one:user"><div class="question">Question</div></article><article data-message-author-role="assistant"><section class="answer">Answer</section></article></main></form>';
  await online({ userTurn: '.question', assistantTurn: '.answer' });
  expect(document.querySelector(pageSemanticSelector(chatgptAdapter, 'assistantTurn')!)).toBeNull();
  const edited = document.querySelector('form > main')!;
  const live = document.getElementById('live-app')!;
  live.replaceChildren(...edited.children);
  document.querySelector('form')!.remove();
  expect(document.querySelector(pageSemanticSelector(chatgptAdapter, 'assistantTurn')!)).toBe(
    document.querySelector('.answer'),
  );
});

it('an inner editing form cannot impersonate conversation turns inside the app main', async () => {
  shell(
    'nav',
    '<form><article data-chatgpt-search-unit-key="one:user"><div class="question">Question</div></article><article data-message-author-role="assistant"><section class="answer">Answer</section></article></form>',
  );
  await online({ userTurn: '.question', assistantTurn: '.answer' });
  expect(document.querySelector(pageSemanticSelector(chatgptAdapter, 'assistantTurn')!)).toBeNull();
  const edit = document.querySelector('form')!;
  edit.replaceWith(...edit.children);
  expect(document.querySelector(pageSemanticSelector(chatgptAdapter, 'assistantTurn')!)).toBe(
    document.querySelector('.answer'),
  );
});

it('shared app landmarks do not erase original header actions and an inner preview cannot borrow them', async () => {
  shell('form', '<header><button class="share">Share</button></header>');
  await online({}, { 'actions.shareButton': ['.share'] });
  expect(document.querySelector(chatgptActionSelector('actions.shareButton'))).toBe(
    document.querySelector('.share'),
  );
  document.querySelector('header')!.setAttribute('role', 'dialog');
  expect(document.querySelector(chatgptActionSelector('actions.shareButton'))).toBeNull();
  document.querySelector('header')!.removeAttribute('role');
  expect(document.querySelector(chatgptActionSelector('actions.shareButton'))).toBe(
    document.querySelector('.share'),
  );
});

it('a remote send cannot borrow an editor inside a dialog after the native submit disappears', async () => {
  shell(
    'nav',
    '<form data-chatgpt-composer><div id="prompt-textarea" contenteditable="true">Draft</div><button class="send" type="button" aria-label="Send">Send</button></form>',
  );
  await online({ sendButton: '.send' });
  const selectors = {
    composer: chatgptAdapter.selectors.composer!,
    composerRoot: chatgptAdapter.selectors.composerRoot!,
    sendButton: '.send',
  };
  const read = () =>
    resolveComposerOperation(chatgptAdapter, document, selectors, (selected) => ({
      field: document.querySelector<HTMLElement>(selected.composer),
      root: document.querySelector(selected.composerRoot),
      control: document.querySelector<HTMLElement>(selected.sendButton),
    })).control;
  const button = document.querySelector('button');
  expect(read()).toBe(button);
  document.querySelector('form')!.setAttribute('role', 'dialog');
  expect(read()).toBeNull();
  document.querySelector('form')!.removeAttribute('role');
  expect(read()).toBe(button);
});

it('an app navigation outside main cannot hide a composer owner moved out of form', async () => {
  shell(
    'nav',
    '<section class="root"><div id="prompt-textarea" contenteditable="true">Draft</div><button type="submit">Send</button></section>',
  );
  await online({ composerRoot: '.root' });
  const field = document.getElementById('prompt-textarea')!;
  const root = document.querySelector('.root')!;
  expect(chatgptComposerRootOf(field, chatgptAdapter)).toBe(root);
  root.setAttribute('role', 'dialog');
  expect(chatgptComposerRootOf(field, chatgptAdapter)).toBeNull();
  root.removeAttribute('role');
  expect(chatgptComposerRootOf(field, chatgptAdapter)).toBe(root);
});

it('the whole ARIA main cannot borrow an editor and submit as a repaired composer owner', async () => {
  document.body.innerHTML =
    '<section class="root" role="main"><div id="prompt-textarea" contenteditable="true">Draft</div><button type="submit">Send</button></section>';
  await online({ composerRoot: '.root' });
  const field = document.getElementById('prompt-textarea')!;
  const root = document.querySelector('.root')!;
  expect(chatgptComposerRootOf(field, chatgptAdapter)).toBeNull();
  root.removeAttribute('role');
  expect(chatgptComposerRootOf(field, chatgptAdapter)).toBe(root);
});

it('an app-wide form cannot let a sidebar menu borrow the main composer model picker', async () => {
  document.body.innerHTML =
    '<main><form><div id="prompt-textarea" contenteditable="true">Draft</div><button class="picker" aria-label="Select ChatGPT model" aria-haspopup="menu">Model</button></form><aside><button id="sidebar-picker" aria-label="Select ChatGPT model" aria-haspopup="menu">Another model</button></aside></main>';
  const main = document.querySelector('main')!;
  const appForm = document.createElement('form');
  main.replaceWith(appForm);
  appForm.append(main);
  const original = document.querySelector<HTMLButtonElement>('.picker')!;
  const other = document.getElementById('sidebar-picker')!;
  const data: ModelPickerSection = {
    format: 1,
    triggerLabels: { en: ['Select ChatGPT model'] },
    effortStatus: {},
    models: {},
    presets: {},
  };
  await online({}, {}, { modelPickerTrigger: '.picker' });
  expect(findTrigger(document, data)).toBe(original);
  original.classList.remove('picker');
  other.classList.add('picker');
  expect(findTrigger(document, data)).toBe(original);
  other.classList.remove('picker');
  original.classList.add('picker');
  const preview = document.createElement('div');
  preview.setAttribute('role', 'dialog');
  original.before(preview);
  preview.append(original);
  expect(findTrigger(document, data)).toBeNull();
  preview.replaceWith(original);
  expect(findTrigger(document, data)).toBe(original);
});

it.each(['chatgpt', 'deepseek', 'claude', 'kimi'])(
  'a shared form cannot hide the %s conversation scroller or code while nested preview owners still fail',
  (site) => {
    const user =
      site === 'chatgpt'
        ? 'data-user-message-bubble'
        : site === 'claude'
          ? 'data-testid="user-message"'
          : site === 'kimi'
            ? 'class="segment-user"'
            : 'class="ds-message"';
    const assistant =
      site === 'chatgpt'
        ? 'data-chatgpt-selection-message-id="answer"'
        : site === 'claude'
          ? 'data-testid="assistant-message"'
          : site === 'kimi'
            ? 'class="segment-assistant"'
            : 'class="ds-message"';
    shell(
      'form',
      `<section class="scroll" style="overflow-y:auto"><div ${user}>${site === 'deepseek' ? '<div class="ds-collapsible-text">Question</div>' : 'Question'}</div><article ${assistant}>${site === 'deepseek' ? '<div class="ds-assistant-message-main-content">Answer</div>' : ''}<section class="code"><pre>answer code</pre></section></article></section><aside>Sidebar</aside>`,
    );
    const scroller = document.querySelector('.scroll')!;
    Object.defineProperty(scroller, 'scrollHeight', { value: 500 });
    Object.defineProperty(scroller, 'clientHeight', { value: 200 });
    const bundle = getBundledSiteSelectorView(site);
    const view = {
      ...bundle,
      profiles: { ...bundle.profiles, scrollContainer: ['.scroll'], codeBlock: ['.code'] },
      remoteKeys: new Set(['scrollContainer', 'codeBlock']),
    };
    const read = (key: string) =>
      Array.from(document.querySelectorAll(guardedSiteStructureSelector(key, view, document)!));
    expect(read('scrollContainer')).toEqual([scroller]);
    if (site === 'chatgpt' || site === 'deepseek')
      expect(read('codeBlock')).toEqual([document.querySelector('.code')]);
    scroller.setAttribute('role', 'dialog');
    expect(read('scrollContainer')).toEqual([]);
    if (site === 'chatgpt' || site === 'deepseek') expect(read('codeBlock')).toEqual([]);
    scroller.removeAttribute('role');
    expect(read('scrollContainer')).toEqual([scroller]);
  },
);

it.each(['nav', 'aside', 'div role="navigation"'])(
  'a %s outside main cannot hide a repaired native composer, send or notification owner',
  async (tag) => {
    shell(
      tag,
      '<form data-chatgpt-composer class="root"><section id="repaired-editor" contenteditable="true">Draft</section><button type="submit">Send</button></form>',
    );
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
      width: 100,
      height: 30,
      x: 0,
      y: 0,
      top: 0,
      bottom: 30,
      left: 0,
      right: 100,
      toJSON: () => ({}),
    });
    await online(
      { composer: '#repaired-editor', composerRoot: '.root', sendButton: '.root > button' },
      { 'input.candidates': ['#repaired-editor'] },
    );
    const field = document.getElementById('repaired-editor')!;
    const root = document.querySelector('.root')!;
    expect(findSiteChatInput('chatgpt')).toBe(field);
    expect(findComposerField(chatgptAdapter)).toBe(field);
    expect(chatgptComposerRootOf(field, chatgptAdapter)).toBe(root);
    const send = () =>
      resolveComposerOperation(
        chatgptAdapter,
        document,
        { composer: '#repaired-editor', composerRoot: '.root', sendButton: '.root > button' },
        (selectors) => ({
          field: document.querySelector<HTMLElement>(selectors.composer),
          root: document.querySelector(selectors.composerRoot),
          control: document.querySelector<HTMLElement>(selectors.sendButton),
        }),
      ).control;
    expect(send()).toBe(root.querySelector('button'));
    root.setAttribute('role', 'dialog');
    expect(findSiteChatInput('chatgpt')).toBeNull();
    expect(findComposerField(chatgptAdapter)).toBeNull();
    expect(send()).toBeNull();
    root.removeAttribute('role');
    expect(findSiteChatInput('chatgpt')).toBe(field);
  },
);

it('navigation authored inside a reply cannot erase the conversation viewport', () => {
  shell(
    'form',
    '<section class="scroll" style="overflow-y:auto"><div data-user-message-bubble>Question</div><article data-chatgpt-selection-message-id="answer">Answer<nav>Source links</nav></article></section>',
  );
  const authoredForm = document.createElement('form');
  authoredForm.textContent = 'Generated form';
  document.querySelector('article')!.append(authoredForm);
  const scroller = document.querySelector('.scroll')!;
  Object.defineProperty(scroller, 'scrollHeight', { value: 500 });
  Object.defineProperty(scroller, 'clientHeight', { value: 200 });
  const bundle = getBundledSiteSelectorView('chatgpt');
  const view = {
    ...bundle,
    profiles: { ...bundle.profiles, scrollContainer: ['.scroll'] },
    remoteKeys: new Set(['scrollContainer']),
  };
  const read = () =>
    document.querySelector(guardedSiteStructureSelector('scrollContainer', view, document)!);
  expect(read()).toBe(scroller);
  const sidebar = document.createElement('nav');
  sidebar.textContent = 'Sidebar';
  scroller.append(sidebar);
  expect(read()).toBeNull();
  sidebar.remove();
  expect(read()).toBe(scroller);
});

it('an outer form cannot erase repaired ChatGPT history, logged-out content or a code language', async () => {
  shell(
    'form',
    '<section class="thread"><div class="loading" aria-busy="true">Loading</div><article data-turn-key="one" data-message-role="user"><div data-user-message-bubble>Question</div></article><article data-turn-key="two" data-message-role="assistant"><div class="answer">Whole answer</div><section class="code language-python"><header><span class="language-name">Python</span></header><code>print(1)</code></section></article></section>',
  );
  await online(
    {},
    {
      'export.threadList': ['.thread'],
      'export.historyPending': ['.loading'],
      'export.loggedOutThread': ['.thread'],
      'export.loggedOutAssistant': ['.answer'],
      'export.codeLanguage': ['.language-name'],
    },
  );
  const first = document.querySelector('[data-turn-key]')!;
  const thread = document.querySelector('.thread')!;
  const status = document.querySelector('.loading')!;
  const code = document.querySelector('.code')!;
  // The whole answer contains its code too; keep it inside the authored body.
  document.querySelector('.answer')!.append(code);
  document.querySelector('.answer')!.insertAdjacentHTML('beforeend', '<nav>Source links</nav>');
  const authoredForm = document.createElement('form');
  authoredForm.textContent = 'Generated form';
  document.querySelector('.answer')!.append(authoredForm);
  const read = () => [
    document.querySelector(chatgptThreadListSelector()),
    document.querySelector(chatgptHistoryPendingSelector(document, first)),
    document.querySelector(chatgptLoggedOutThreadSelector()),
    document.querySelector(chatgptLoggedOutAssistantSelector()),
    chatgptCodeLanguageLabel(code),
  ];
  expect(read()).toEqual([thread, status, thread, document.querySelector('.answer'), 'Python']);
  const sidebar = document.createElement('nav');
  sidebar.textContent = 'Sidebar';
  thread.append(sidebar);
  expect([read()[0], read()[2]]).toEqual([null, null]);
  sidebar.remove();
  expect(read()).toEqual([thread, status, thread, document.querySelector('.answer'), 'Python']);
  const preview = document.createElement('div');
  preview.setAttribute('role', 'dialog');
  thread.append(preview);
  expect([read()[0], read()[2]]).toEqual([null, null]);
  preview.remove();
  thread.setAttribute('role', 'dialog');
  expect(read()).toEqual([null, null, null, null, '']);
  thread.removeAttribute('role');
  expect(read()).toEqual([thread, status, thread, document.querySelector('.answer'), 'Python']);
});
