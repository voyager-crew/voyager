import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import { type CollapseEngine, type CollapseReadSession, createCollapseEngine } from '../engine';

let engine: CollapseEngine;
let mutations: MutationCallback;
let resize: ResizeObserverCallback;

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal(
    'MutationObserver',
    class {
      constructor(callback: MutationCallback) {
        mutations = callback;
      }
      observe() {}
      disconnect() {}
    },
  );
  vi.stubGlobal(
    'ResizeObserver',
    class {
      constructor(callback: ResizeObserverCallback) {
        resize = callback;
      }
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
});
afterEach(() => {
  engine?.stop();
  document.body.replaceChildren();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

function host(): HTMLElement {
  const element = document.createElement('article');
  element.innerHTML = '<pre>short</pre><footer></footer>';
  document.body.append(element);
  return element;
}

function create(resolve: (root: ParentNode) => CollapseReadSession): void {
  engine = createCollapseEngine(
    {
      root: () => document.body,
      hostSelector: 'article',
      accepts: () => false,
      content: () => null,
      actions: () => null,
      isLong: (element) => (element.textContent?.length ?? 0) > 10,
      resolveHosts: resolve,
    },
    {
      collapsibleClass: 'gv-test-long',
      collapsedClass: 'gv-test-collapsed',
      clipClass: 'gv-test-clip',
      createToggle: (doc, onToggle) => {
        const button = doc.createElement('button');
        button.addEventListener('click', onToggle);
        return button;
      },
      updateToggle: () => {},
    },
  );
}

function session(hosts: readonly HTMLElement[]): CollapseReadSession {
  return {
    hosts,
    closest: (element) => hosts.find((item) => item.contains(element)) ?? null,
    matches: (element) => hosts.includes(element as HTMLElement),
    accepts: (element) => hosts.includes(element),
    content: (element) => element.querySelector('pre'),
    actions: (element) => element.querySelector('footer'),
    clip: (element) => element.querySelector('pre'),
  };
}

it('one scan keeps every toggle and clipping target in the accepted read session', () => {
  const first = host();
  const second = host();
  first.querySelector('pre')!.textContent = 'long first content';
  second.querySelector('pre')!.textContent = 'long second content';
  let reads = 0;
  create(() => (reads++ === 0 ? session([first, second]) : session([])));
  engine.process();
  expect(engine.blocks()).toEqual([first, second]);
  expect(first.querySelector('footer button')).not.toBeNull();
  expect(second.querySelector('footer button')).not.toBeNull();
  expect(second.querySelector('pre')!.classList.contains('gv-test-clip')).toBe(true);
});

it('processing one subtree preserves the collapse handles belonging to its siblings', () => {
  const first = host();
  const second = host();
  first.querySelector('pre')!.textContent = 'long first content';
  second.querySelector('pre')!.textContent = 'long second content';
  const section = document.createElement('section');
  first.before(section);
  section.append(first);
  create((root) => session(Array.from(root.querySelectorAll('article'))));
  engine.process();
  const secondToggle = second.querySelector('button');
  engine.process(section);
  expect(engine.blocks()).toEqual([first, second]);
  expect(second.querySelector('button')).toBe(secondToggle);
});

it('enhancing a newly rejected host retires its old handle while preserving accepted handles', () => {
  const first = host();
  const second = host();
  first.querySelector('pre')!.textContent = 'long first content';
  second.querySelector('pre')!.textContent = 'long second content';
  let accepted = [first, second];
  create(() => session(accepted));
  engine.process();
  accepted = [second];
  engine.enhance(first);
  expect(engine.blocks()).toEqual([second]);
  expect(second.querySelector('button')).not.toBeNull();
});

it('a mutation burst resolves after its final DOM change so a rejected host cannot receive a toggle', async () => {
  const wrong = host();
  const right = host();
  let accepted = wrong;
  create(() => session([accepted]));
  engine.start();
  right.querySelector('pre')!.textContent = 'long accepted content';
  wrong.querySelector('pre')!.textContent = 'long rejected content';
  mutations(
    [{ target: wrong, addedNodes: [right] } as unknown as MutationRecord],
    {} as MutationObserver,
  );
  accepted = right;
  await vi.advanceTimersByTimeAsync(120);
  expect(engine.blocks()).toEqual([right]);
  expect(right.querySelector('footer button')).not.toBeNull();
  expect(wrong.querySelector('footer button')).toBeNull();
});

it('resize measurements retire rejected handles and attach only to the newly accepted host', async () => {
  const first = host();
  const second = host();
  first.querySelector('pre')!.textContent = 'first long content';
  second.querySelector('pre')!.textContent = 'second long content';
  let accepted = first;
  create(() => session([accepted]));
  engine.start();
  expect(engine.blocks()).toEqual([first]);
  resize(
    [{ target: first }, { target: second }] as unknown as ResizeObserverEntry[],
    {} as ResizeObserver,
  );
  accepted = second;
  await vi.advanceTimersByTimeAsync(120);
  expect(engine.blocks()).toEqual([second]);
  expect(first.querySelector('footer button')).toBeNull();
  expect(second.querySelector('footer button')).not.toBeNull();
  engine.stop();
  mutations(
    [{ target: second, addedNodes: [] } as unknown as MutationRecord],
    {} as MutationObserver,
  );
  await vi.advanceTimersByTimeAsync(120);
  expect(engine.blocks()).toEqual([]);
  expect(second.textContent).toBe('second long content');
});
