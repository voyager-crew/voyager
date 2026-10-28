import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { setCachedLanguage } from '@/utils/i18n';

import { requireBundledSiteAdapter } from '../../catalog/sites';
import { DeclarativeEngine } from '../../runtime/declarativeEngine';
import { PluginScope } from '../../runtime/pluginScope';
import type { PluginManifest, SiteAdapter } from '../../types';
import type { PrimitiveContext } from '../types';
import {
  COLLAPSE_HEIGHT_SLACK_PX,
  COLLAPSE_TOGGLE_CLASS,
  type CollapseParams,
  collapsePrimitive,
} from './index';

class TestResizeObserver implements ResizeObserver {
  static instances: TestResizeObserver[] = [];
  readonly targets = new Set<Element>();
  readonly observe = vi.fn((target: Element) => this.targets.add(target));
  readonly unobserve = vi.fn((target: Element) => this.targets.delete(target));
  readonly disconnect = vi.fn(() => this.targets.clear());

  constructor(private readonly callback: ResizeObserverCallback) {
    TestResizeObserver.instances.push(this);
  }

  resize(target: Element): void {
    this.callback([{ target } as ResizeObserverEntry], this);
  }
}

const sites = [
  {
    name: 'ChatGPT',
    adapter: requireBundledSiteAdapter('chatgpt'),
    markup:
      '<article data-message-author-role="user"><div data-user-message-bubble>' +
      '<p>Long pasted text <strong>keeps its formatting</strong></p>' +
      '<button type="button" data-native>Native action</button></div></article>',
  },
  {
    name: 'Claude',
    adapter: requireBundledSiteAdapter('claude'),
    markup:
      '<div data-testid="user-message"><p>Long pasted text <strong>keeps its formatting</strong></p>' +
      '<button type="button" data-native>Native action</button></div>',
  },
];
const [chatgpt] = sites;

let scope: PluginScope;
const engines: DeclarativeEngine[] = [];

function fixture(site: (typeof sites)[number], height = 400) {
  document.querySelector('main')!.insertAdjacentHTML('beforeend', site.markup);
  const host = document.querySelector<HTMLElement>(site.adapter.selectors.userTurn!)!;
  let measuredHeight = height;
  Object.defineProperty(host, 'scrollHeight', {
    configurable: true,
    get: () => measuredHeight,
  });
  return { host, setHeight: (value: number) => (measuredHeight = value) };
}

function activate(adapter: SiteAdapter | null, params: CollapseParams = {}) {
  let counter: () => number = () => -1;
  const context: PrimitiveContext = {
    doc: document,
    adapter,
    pluginId: 'test.collapse',
    settings: {},
    setTargetCounter: (count) => (counter = count),
  };
  void collapsePrimitive.activate(scope, params, context);
  return { count: () => counter() };
}

function toggleOf(host: HTMLElement): HTMLButtonElement | null {
  const sibling = host.nextElementSibling;
  return sibling instanceof HTMLButtonElement && sibling.classList.contains(COLLAPSE_TOGGLE_CLASS)
    ? sibling
    : null;
}

function cap(host: HTMLElement): string {
  return getComputedStyle(host).maxHeight;
}

beforeEach(async () => {
  vi.useFakeTimers();
  vi.stubGlobal('ResizeObserver', TestResizeObserver);
  TestResizeObserver.instances = [];
  await setCachedLanguage('en');
  document.head.replaceChildren();
  document.body.innerHTML = '<main></main>';
  scope = new PluginScope();
});

afterEach(async () => {
  for (const engine of engines.splice(0)) engine.unmountAll();
  await scope.dispose();
  await Promise.resolve();
  await setCachedLanguage('en');
  document.body.replaceChildren();
  document.head.replaceChildren();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('collapse primitive', () => {
  it('accepts optional semantic targets, finite bounded heights and boolean initial state', () => {
    expect(collapsePrimitive.validateParams(undefined)).toMatchObject({ success: true });
    expect(collapsePrimitive.validateParams({})).toMatchObject({ success: true });
    for (const target of ['userTurn', 'assistantTurn', 'thinkingBlock']) {
      const params = { target, maxPx: 80, startCollapsed: false };
      expect(collapsePrimitive.validateParams(params)).toEqual({ success: true, data: params });
    }
    expect(collapsePrimitive.validateParams({ maxPx: 2_000 })).toEqual({
      success: true,
      data: { maxPx: 2_000 },
    });
  });

  it.each([
    null,
    [],
    'userTurn',
    { target: 'body' },
    { target: '[data-user-message-bubble]' },
    { target: 'codeBlock' },
    { target: 1 },
    { maxPx: 79 },
    { maxPx: 2_001 },
    { maxPx: NaN },
    { maxPx: Infinity },
    { maxPx: '320' },
    { startCollapsed: 'true' },
    { selector: 'p' },
  ])('rejects invalid configuration %j', (raw) => {
    expect(collapsePrimitive.validateParams(raw).success).toBe(false);
  });

  it.each(sites)('caps a long $name user message without rewriting native content', (site) => {
    const { host } = fixture(site);
    const text = host.querySelector('p')!.firstChild;
    const originalChildren = Array.from(host.childNodes);
    const nativeButton = host.querySelector<HTMLButtonElement>('[data-native]')!;
    const nativeClick = vi.fn();
    nativeButton.addEventListener('click', nativeClick);
    activate(site.adapter);

    const toggle = toggleOf(host)!;
    expect(document.querySelectorAll(`.${COLLAPSE_TOGGLE_CLASS}`)).toHaveLength(1);
    expect(toggle.type).toBe('button');
    expect(toggle.disabled).toBe(false);
    expect(toggle.getAttribute('aria-label')).toBe('Expand text');
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(cap(host)).toBe('320px');
    expect(getComputedStyle(host).overflow).toBe('hidden');
    expect(Array.from(host.childNodes)).toEqual(originalChildren);
    expect(host.querySelector('p')!.firstChild).toBe(text);
    nativeButton.click();
    expect(nativeClick).toHaveBeenCalledOnce();

    toggle.focus();
    expect(document.activeElement).toBe(toggle);
    toggle.click();
    expect(toggle.getAttribute('aria-label')).toBe('Collapse text');
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(cap(host)).not.toBe('320px');
    toggle.click();
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(cap(host)).toBe('320px');
  });

  it.each([320, 320 + COLLAPSE_HEIGHT_SLACK_PX])(
    'leaves content of height %i at or within the threshold slack untouched',
    (height) => {
      const { host } = fixture(chatgpt, height);
      const before = host.outerHTML;
      const { count } = activate(chatgpt.adapter);
      expect(toggleOf(host)).toBeNull();
      expect(host.outerHTML).toBe(before);
      expect(cap(host)).not.toBe('320px');
      expect(count()).toBe(1);
    },
  );

  it('adds a toggle only when content is strictly beyond threshold plus slack', () => {
    const { host } = fixture(chatgpt, 320 + COLLAPSE_HEIGHT_SLACK_PX + 1);
    activate(chatgpt.adapter);
    expect(toggleOf(host)).not.toBeNull();
  });

  it.each([true, false])('honors startCollapsed=%s', (startCollapsed) => {
    const { host } = fixture(chatgpt);
    activate(chatgpt.adapter, { maxPx: 200, startCollapsed });
    expect(toggleOf(host)!.getAttribute('aria-expanded')).toBe(String(!startCollapsed));
    expect(cap(host) === '200px').toBe(startCollapsed);
  });

  it.each(sites)(
    'streaming $name content gains a toggle after growing past the threshold',
    async (site) => {
      const { host, setHeight } = fixture(site, 200);
      activate(site.adapter);
      expect(toggleOf(host)).toBeNull();
      setHeight(400);
      host.querySelector('p')!.append(' More streamed text.');
      await vi.runAllTimersAsync();
      expect(toggleOf(host)!.getAttribute('aria-expanded')).toBe('false');
      expect(cap(host)).toBe('320px');
    },
  );

  it('remeasures a target after resize without requiring a DOM mutation', async () => {
    const { host, setHeight } = fixture(chatgpt, 200);
    activate(chatgpt.adapter);
    const observer = TestResizeObserver.instances.find((candidate) => candidate.targets.has(host))!;
    expect(observer).toBeDefined();
    setHeight(400);
    observer.resize(host);
    await vi.runAllTimersAsync();
    expect(toggleOf(host)).not.toBeNull();
  });

  it('keeps an expanded surviving host expanded through child replacement and short-long changes', async () => {
    const { host, setHeight } = fixture(chatgpt);
    activate(chatgpt.adapter);
    toggleOf(host)!.click();
    host.innerHTML = '<p>Replacement native content</p>';
    await vi.runAllTimersAsync();
    expect(toggleOf(host)!.getAttribute('aria-expanded')).toBe('true');
    expect(document.querySelectorAll(`.${COLLAPSE_TOGGLE_CLASS}`)).toHaveLength(1);

    setHeight(100);
    host.querySelector('p')!.textContent = 'Short';
    await vi.runAllTimersAsync();
    expect(toggleOf(host)).toBeNull();
    setHeight(500);
    host.querySelector('p')!.textContent = 'Long again';
    await vi.runAllTimersAsync();
    expect(toggleOf(host)!.getAttribute('aria-expanded')).toBe('true');
    expect(cap(host)).not.toBe('320px');
  });

  it('leaves other turns and pages without a matching semantic selector alone', async () => {
    const { host } = fixture(chatgpt);
    activate(null);
    expect(toggleOf(host)).toBeNull();
    await scope.dispose();
    scope = new PluginScope();
    activate(chatgpt.adapter, { target: 'thinkingBlock' });
    expect(toggleOf(host)).toBeNull();
  });

  it.each([
    {
      target: 'assistantTurn' as const,
      adapter: requireBundledSiteAdapter('claude'),
      markup:
        '<div data-testid="assistant-message"><p>Long answer</p></div>' +
        '<div data-testid="user-message"><p>Long question</p></div>',
      untouched: '[data-testid="user-message"]',
    },
    {
      target: 'thinkingBlock' as const,
      adapter: requireBundledSiteAdapter('deepseek'),
      markup:
        '<div class="ds-message"><div class="ds-think-content"><p>Long thinking</p></div>' +
        '<div class="ds-assistant-message-main-content"><p>Long answer</p></div></div>',
      untouched: '.ds-assistant-message-main-content',
    },
  ])('uses the adapter semantic selector for $target without clipping other content', (site) => {
    document.querySelector('main')!.innerHTML = site.markup;
    const host = document.querySelector<HTMLElement>(site.adapter.selectors[site.target]!)!;
    const other = document.querySelector<HTMLElement>(site.untouched)!;
    for (const element of [host, other]) {
      Object.defineProperty(element, 'scrollHeight', { configurable: true, value: 400 });
    }
    const originalOther = other.outerHTML;
    activate(site.adapter, { target: site.target });
    expect(toggleOf(host)).not.toBeNull();
    expect(cap(host)).toBe('320px');
    expect(other.outerHTML).toBe(originalOther);
    expect(document.querySelectorAll(`.${COLLAPSE_TOGGLE_CLASS}`)).toHaveLength(1);
  });

  it('relabels toggles when the Voyager language changes', async () => {
    const { host } = fixture(chatgpt);
    activate(chatgpt.adapter);
    await setCachedLanguage('zh');
    expect(toggleOf(host)!.getAttribute('aria-label')).toBe('展开文本');
    toggleOf(host)!.click();
    expect(toggleOf(host)!.getAttribute('aria-label')).toBe('收起文本');
  });

  it('keeps different target height caps independent and removes only the stopped instance', async () => {
    const { host } = fixture(chatgpt);
    const assistant = document.createElement('div');
    assistant.setAttribute('data-chatgpt-selection-message-id', 'answer');
    assistant.textContent = 'Long answer';
    Object.defineProperty(assistant, 'scrollHeight', { value: 400 });
    document.querySelector('main')!.append(assistant);
    activate(chatgpt.adapter, { maxPx: 200 });
    const otherScope = new PluginScope();
    try {
      collapsePrimitive.activate(
        otherScope,
        { target: 'assistantTurn', maxPx: 300 },
        {
          doc: document,
          adapter: chatgpt.adapter,
          pluginId: 'test.other-collapse',
          settings: {},
          setTargetCounter() {},
        },
      );
      expect(cap(host)).toBe('200px');
      expect(cap(assistant)).toBe('300px');
      await scope.dispose();
      expect(toggleOf(host)).toBeNull();
      expect(cap(assistant)).toBe('300px');
      expect(toggleOf(assistant)).not.toBeNull();
    } finally {
      await otherScope.dispose();
    }
  });

  it('does not leave a stylesheet behind when an invalid adapter selector prevents startup', () => {
    fixture(chatgpt);
    const before = { head: document.head.innerHTML, body: document.body.innerHTML };
    expect(() => activate({ ...chatgpt.adapter, selectors: { userTurn: '[' } })).toThrow();
    expect(document.head.innerHTML).toBe(before.head);
    expect(document.body.innerHTML).toBe(before.body);
    expect(scope.getEffects()).toEqual([]);
  });

  it.each([undefined, '', 'native-message'])(
    'restores class=%j and native DOM exactly on teardown',
    async (className) => {
      const { host } = fixture(chatgpt);
      if (className !== undefined) host.setAttribute('class', className);
      const before = { head: document.head.innerHTML, body: document.body.innerHTML };
      activate(chatgpt.adapter);
      const observer = TestResizeObserver.instances.find((candidate) =>
        candidate.targets.has(host),
      )!;
      await scope.dispose();
      expect(document.head.innerHTML).toBe(before.head);
      expect(document.body.innerHTML).toBe(before.body);
      expect(observer.disconnect).toHaveBeenCalledOnce();
      expect(scope.getEffects()).toEqual([]);

      observer.resize(host);
      host.querySelector('p')!.append(' Stream after teardown.');
      await vi.runAllTimersAsync();
      expect(toggleOf(host)).toBeNull();
      expect(document.head.innerHTML).toBe(before.head);
      expect(host.getAttribute('class')).toBe(className ?? null);
    },
  );

  it('does not leave a collapse stylesheet or controls behind when unmounted before a queued settings restart', async () => {
    const { host } = fixture(chatgpt);
    const engine = new DeclarativeEngine({ doc: document, adapter: chatgpt.adapter });
    engines.push(engine);
    const manifest: PluginManifest = {
      id: 'test.collapse-unmount',
      name: 'Collapse',
      version: '1.0.0',
      description: 'Cap long messages',
      author: 'Test',
      category: 'readability',
      license: 'MIT',
      engine: '>=next',
      tier: 'declarative',
      matches: ['https://chatgpt.com/*'],
      contributes: {
        settings: { maxHeight: { type: 'number', label: 'Height', default: 320 } },
        domOps: [{ op: 'native', handler: 'collapse', params: { maxPx: '{{maxHeight}}' } }],
      },
    };
    const headWithoutBase = () =>
      Array.from(document.head.children)
        .filter((element) => element.id !== 'gv-plugin-base-style')
        .map((element) => element.outerHTML)
        .join('');
    const before = { head: headWithoutBase(), body: document.body.outerHTML };
    engine.mount(manifest);
    expect(document.head.querySelector('style[id^="gv-collapse-"]')).not.toBeNull();
    expect(toggleOf(host)).not.toBeNull();
    expect(cap(host)).toBe('320px');

    engine.updateSettings(manifest.id, { maxHeight: 200 });
    engine.unmount(manifest.id);
    expect(headWithoutBase()).toBe(before.head);
    expect(document.body.outerHTML).toBe(before.body);

    await vi.runAllTimersAsync();
    expect(headWithoutBase()).toBe(before.head);
    expect(document.body.outerHTML).toBe(before.body);
    expect(TestResizeObserver.instances).toHaveLength(1);
    expect(TestResizeObserver.instances[0].disconnect).toHaveBeenCalledOnce();
  });

  it('restarts a real templated native op with the new threshold and initial state', async () => {
    const { host } = fixture(chatgpt);
    const manifest: PluginManifest = {
      id: 'test.collapse-settings',
      name: 'Collapse long user messages',
      version: '1.0.0',
      description: 'Cap long user messages',
      author: 'Test',
      category: 'readability',
      license: 'MIT',
      engine: '>=next',
      tier: 'declarative',
      matches: ['https://chatgpt.com/*'],
      requires: { semantic: ['userTurn'] },
      contributes: {
        settings: {
          maxHeight: { type: 'number', label: 'Collapsed height', default: 320 },
          startCollapsed: { type: 'boolean', label: 'Start collapsed', default: true },
        },
        domOps: [
          {
            op: 'native',
            handler: 'collapse',
            params: {
              target: 'userTurn',
              maxPx: '{{maxHeight}}',
              startCollapsed: '{{startCollapsed}}',
            },
          },
        ],
      },
    };
    const engine = new DeclarativeEngine({ doc: document, adapter: chatgpt.adapter });
    engines.push(engine);
    engine.mount(manifest);
    const initialToggle = toggleOf(host)!;
    expect(cap(host)).toBe('320px');
    const initialObserver = TestResizeObserver.instances.find((candidate) =>
      candidate.targets.has(host),
    )!;

    engine.updateSettings(manifest.id, { maxHeight: 500, startCollapsed: true });
    await vi.runAllTimersAsync();
    expect(toggleOf(host)).toBeNull();
    expect(initialToggle.isConnected).toBe(false);
    expect(initialObserver.disconnect).toHaveBeenCalledOnce();
    expect(cap(host)).not.toBe('320px');

    engine.updateSettings(manifest.id, { maxHeight: 200, startCollapsed: false });
    await vi.runAllTimersAsync();
    expect(document.querySelectorAll(`.${COLLAPSE_TOGGLE_CLASS}`)).toHaveLength(1);
    expect(toggleOf(host)!.getAttribute('aria-expanded')).toBe('true');
    toggleOf(host)!.click();
    expect(cap(host)).toBe('200px');
    expect(manifest.contributes.domOps?.[0]).toMatchObject({
      params: { maxPx: '{{maxHeight}}', startCollapsed: '{{startCollapsed}}' },
    });
  });
});
