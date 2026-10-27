import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { installGeminiSelectorPatch } from '../../__tests__/geminiOnlineSelectorFixture';
import { resolveSidebarConversationTarget } from '../sidebarConversationTarget';

const FIRST = 'abcdef0123456789';
const SECOND = 'fedcba9876543210';

function row(id: string, title: string, native = false): HTMLElement {
  const element = document.createElement('div');
  element.className = 'online-row';
  element.setAttribute('jslog', `["c_${id}"]`);
  if (native) element.dataset.testId = 'conversation';
  const link = document.createElement('a');
  link.href = `/u/1/app/${id}`;
  const label = document.createElement('span');
  label.className = 'title-text';
  label.textContent = title;
  link.append(label);
  element.append(link);
  return element;
}

function mount(...rows: HTMLElement[]): { sidebar: HTMLElement; trigger: HTMLButtonElement } {
  const sidebar = document.createElement('bard-sidenav');
  const trigger = document.createElement('button');
  trigger.setAttribute('aria-label', 'More options for Second chat');
  sidebar.append(...rows, trigger);
  document.body.append(sidebar);
  return { sidebar, trigger };
}

function expectSecond(trigger: HTMLElement): void {
  expect(resolveSidebarConversationTarget(trigger)).toEqual({
    conversationId: SECOND,
    url: `${location.origin}/u/1/app/${SECOND}`,
    title: 'Second chat',
  });
}

describe('sidebar export row repairs', () => {
  let originalUrl: string;
  let stopSnapshot: (() => void) | undefined;

  beforeEach(() => {
    originalUrl = location.href;
    history.replaceState({}, '', '/u/1/app/current');
    document.body.replaceChildren();
  });

  afterEach(() => {
    stopSnapshot?.();
    stopSnapshot = undefined;
    document.body.replaceChildren();
    history.replaceState({}, '', originalUrl);
    vi.restoreAllMocks();
  });

  it('recovers the requested export target after sidebar row markers are renamed', async () => {
    const { trigger } = mount(row(FIRST, 'First chat'), row(SECOND, 'Second chat'));
    expect(resolveSidebarConversationTarget(trigger)).toBeNull();
    stopSnapshot = await installGeminiSelectorPatch({ 'sidebar.row': ['.online-row'] });

    expectSecond(trigger);
  });

  it('recovers a renamed native anchor row without changing its Gem conversation route', async () => {
    const second = row(SECOND, 'Second chat');
    const link = second.querySelector('a')!;
    link.className = 'online-row';
    link.setAttribute('jslog', `["c_${SECOND}"]`);
    link.href = `/u/1/gem/my-gem/${SECOND}`;
    const { trigger } = mount(link);
    stopSnapshot = await installGeminiSelectorPatch({ 'sidebar.row': ['.online-row'] });

    expect(resolveSidebarConversationTarget(trigger)).toEqual({
      conversationId: SECOND,
      url: `${location.origin}/u/1/gem/my-gem/${SECOND}`,
      title: 'Second chat',
    });
  });

  it('preserves target ID, URL and title on the same DOM with equivalent bundled and remote rows', async () => {
    const { trigger } = mount(row(FIRST, 'First chat', true), row(SECOND, 'Second chat', true));
    const bundled = resolveSidebarConversationTarget(trigger);
    expectSecond(trigger);
    stopSnapshot = await installGeminiSelectorPatch({ 'sidebar.row': ['.online-row'] });

    expect(resolveSidebarConversationTarget(trigger)).toEqual(bundled);
    expectSecond(trigger);
  });

  it('keeps the single bundled row scan and avoids native proof scans with online fixes off', () => {
    const { trigger } = mount(row(FIRST, 'First chat', true), row(SECOND, 'Second chat', true));
    const queries = vi.spyOn(document, 'querySelectorAll');

    expectSecond(trigger);

    expect(queries.mock.calls).toEqual([['[data-test-id="conversation"]']]);
  });

  it('retries the complete bundled list when a nonempty alias omits a surviving native row', async () => {
    const first = row(FIRST, 'First chat', true);
    first.className = '';
    const second = row(SECOND, 'Second chat', true);
    const { trigger } = mount(first, second);
    trigger.setAttribute('aria-label', 'More options for First chat');
    stopSnapshot = await installGeminiSelectorPatch({ 'sidebar.row': ['.online-row'] });

    expect(resolveSidebarConversationTarget(trigger)?.conversationId).toBe(FIRST);
  });

  it('keeps native link instrumentation from hiding another repaired conversation', async () => {
    const first = row(FIRST, 'First chat', true);
    const link = first.querySelector('a')!;
    link.setAttribute('jslog', `["c_${FIRST}"]`);
    const { trigger } = mount(first, row(SECOND, 'Second chat'));
    stopSnapshot = await installGeminiSelectorPatch({ 'sidebar.row': ['.online-row'] });

    expectSecond(trigger);
  });

  it('finds the renamed row through ordinary native link instrumentation without a conversation ID', async () => {
    const second = row(SECOND, 'Second chat');
    second.querySelector('a')!.setAttribute('jslog', '12345; track:click');
    const { trigger } = mount(second);
    stopSnapshot = await installGeminiSelectorPatch({ 'sidebar.row': ['.online-row'] });

    expectSecond(trigger);
  });

  it('rejects a partial renamed row list and recovers after all native identities are covered', async () => {
    const first = row(FIRST, 'First chat');
    first.className = '';
    const { trigger } = mount(first, row(SECOND, 'Second chat'));
    stopSnapshot = await installGeminiSelectorPatch({ 'sidebar.row': ['.online-row'] });

    expect(resolveSidebarConversationTarget(trigger)).toBeNull();

    first.className = 'online-row';
    expectSecond(trigger);
  });

  it.each([
    [
      'another origin',
      (element: HTMLElement) =>
        element.querySelector('a')!.setAttribute('href', `https://other.example/u/1/app/${FIRST}`),
    ],
    [
      'another account',
      (element: HTMLElement) =>
        element.querySelector('a')!.setAttribute('href', `/u/2/app/${FIRST}`),
    ],
    [
      'a nonconversation route',
      (element: HTMLElement) =>
        element.querySelector('a')!.setAttribute('href', `/u/1/other/${FIRST}`),
    ],
    [
      'conflicting native ID',
      (element: HTMLElement) => element.setAttribute('jslog', `["c_${SECOND}"]`),
    ],
    ['missing native ID', (element: HTMLElement) => element.removeAttribute('jslog')],
    [
      'an unparseable URL',
      (element: HTMLElement) => element.querySelector('a')!.setAttribute('href', 'http://['),
    ],
    [
      'another linked control',
      (element: HTMLElement) => element.append(document.createElement('a')),
    ],
  ] as const)(
    'rejects %s before a renamed row can become an export target',
    async (_name, change) => {
      const decoy = row(FIRST, 'Second chat');
      change(decoy);
      if (
        decoy.lastElementChild instanceof HTMLAnchorElement &&
        !decoy.lastElementChild.hasAttribute('href')
      )
        decoy.lastElementChild.href = `/u/1/app/${FIRST}`;
      const { trigger } = mount(decoy, row(SECOND, 'Second chat'));
      stopSnapshot = await installGeminiSelectorPatch({ 'sidebar.row': ['.online-row'] });

      expect(resolveSidebarConversationTarget(trigger)).toBeNull();

      decoy.className = '';
      expectSecond(trigger);
    },
  );

  it.each(['main', 'form', 'dialog', 'menu', 'editable', 'voyager', 'outside-sidebar'])(
    'rejects a renamed row in %s ownership and rechecks the current DOM',
    async (owner) => {
      const decoy = row(FIRST, 'Second chat');
      const { sidebar, trigger } = mount(row(SECOND, 'Second chat'));
      const wrapper = document.createElement(owner === 'main' || owner === 'form' ? owner : 'div');
      if (owner === 'dialog' || owner === 'menu') wrapper.setAttribute('role', owner);
      if (owner === 'editable') wrapper.setAttribute('contenteditable', 'true');
      if (owner === 'voyager') wrapper.className = 'gv-folder-container';
      (owner === 'outside-sidebar' ? document.body : sidebar).prepend(wrapper);
      wrapper.append(decoy);
      stopSnapshot = await installGeminiSelectorPatch({ 'sidebar.row': ['.online-row'] });

      expect(resolveSidebarConversationTarget(trigger)).toBeNull();

      decoy.className = '';
      expectSecond(trigger);
    },
  );

  it('keeps a containing shell from replacing the nearest native jslog identity owner', async () => {
    const original = row(SECOND, 'Second chat');
    original.className = '';
    const shell = document.createElement('div');
    shell.className = 'online-row';
    shell.setAttribute('jslog', `["c_${FIRST}"]`);
    shell.innerHTML = '<span class="title-text">Wrong shell title</span>';
    shell.append(original);
    const { trigger } = mount(shell);
    stopSnapshot = await installGeminiSelectorPatch({ 'sidebar.row': ['.online-row'] });

    expect(resolveSidebarConversationTarget(trigger)).toBeNull();

    shell.className = '';
    original.className = 'online-row';
    expectSecond(trigger);
  });

  it('rejects a renamed shell containing a surviving native conversation stub', async () => {
    const second = row(SECOND, 'Second chat');
    const stub = document.createElement('div');
    stub.className = 'online-row';
    stub.dataset.testId = 'conversation';
    second.append(stub);
    const { trigger } = mount(second);
    stopSnapshot = await installGeminiSelectorPatch({ 'sidebar.row': ['.online-row'] });

    expect(resolveSidebarConversationTarget(trigger)).toBeNull();

    stub.remove();
    expectSecond(trigger);
  });

  it('does not turn the whole native sidebar into a conversation row', async () => {
    const second = row(SECOND, 'Second chat');
    const { sidebar, trigger } = mount(second);
    sidebar.className = 'online-row';
    sidebar.setAttribute('jslog', `["c_${SECOND}"]`);
    second.removeAttribute('jslog');
    second.className = '';
    stopSnapshot = await installGeminiSelectorPatch({ 'sidebar.row': ['.online-row'] });

    expect(resolveSidebarConversationTarget(trigger)).toBeNull();

    sidebar.className = '';
    second.className = 'online-row';
    second.setAttribute('jslog', `["c_${SECOND}"]`);
    expectSecond(trigger);
  });

  it.each([
    [
      'hidden',
      (owner: HTMLElement) => {
        owner.hidden = true;
        owner.style.display = 'block';
      },
    ],
    ['aria-hidden', (owner: HTMLElement) => owner.setAttribute('aria-hidden', 'true')],
    [
      'display:none',
      (owner: HTMLElement) => {
        owner.style.display = 'none';
      },
    ],
    [
      'visibility:hidden',
      (owner: HTMLElement) => {
        owner.style.visibility = 'hidden';
      },
    ],
    [
      'visibility:collapse',
      (owner: HTMLElement) => {
        owner.style.visibility = 'collapse';
      },
    ],
    [
      'content-visibility:hidden',
      (owner: HTMLElement) => {
        owner.style.contentVisibility = 'hidden';
      },
    ],
  ] as const)(
    'does not export a renamed row in a %s ancestor and recovers when rendered',
    async (_name, hide) => {
      const second = row(SECOND, 'Second chat');
      const { sidebar, trigger } = mount();
      const owner = document.createElement('div');
      owner.append(second);
      sidebar.prepend(owner);
      hide(owner);
      stopSnapshot = await installGeminiSelectorPatch({ 'sidebar.row': ['.online-row'] });

      expect(resolveSidebarConversationTarget(trigger)).toBeNull();

      owner.hidden = false;
      owner.removeAttribute('aria-hidden');
      owner.removeAttribute('style');
      expectSecond(trigger);
    },
  );

  it('preserves baseline hidden native-row association when the remote selector is equivalent', async () => {
    const second = row(SECOND, 'Second chat', true);
    second.hidden = true;
    const { trigger } = mount(second);
    const bundled = resolveSidebarConversationTarget(trigger);
    stopSnapshot = await installGeminiSelectorPatch({ 'sidebar.row': ['.online-row'] });

    expect(resolveSidebarConversationTarget(trigger)).toEqual(bundled);
    expectSecond(trigger);
  });

  it('rechecks a previously valid alias after its native link moves to another account', async () => {
    const second = row(SECOND, 'Second chat');
    const { trigger } = mount(second);
    stopSnapshot = await installGeminiSelectorPatch({ 'sidebar.row': ['.online-row'] });
    expectSecond(trigger);

    second.querySelector('a')!.href = `/u/2/app/${SECOND}`;
    expect(resolveSidebarConversationTarget(trigger)).toBeNull();

    second.querySelector('a')!.href = `/u/1/app/${SECOND}`;
    expectSecond(trigger);
  });
});
