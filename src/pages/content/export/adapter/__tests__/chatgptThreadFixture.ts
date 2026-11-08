/**
 * A jsdom model of ChatGPT's thread as measured live (October 2026):
 * - `main > div[data-app-action-timeline-scroll]` scrolls in a
 *   `flex-direction: column-reverse` box, so `scrollTop` is 0 at the newest
 *   turn and negative toward the oldest;
 * - `[data-chatgpt-conversation-selection-target]` holds an optional
 *   "Loading older messages" `[role="status"]` spinner, then the virtual list;
 * - the list mounts only the `[data-turn-key]` items near the viewport,
 *   re-creating an item's element each time it mounts again, inside a box as
 *   tall as the whole loaded list;
 * - older history loads a page at a time once the scroller reaches the top.
 */

export interface FixtureTurn {
  readonly key: string;
  readonly height: number;
  readonly user?: string;
  readonly assistant?: string;
  /** The reply's message id; `<key>-a` by default. */
  readonly replyId?: string;
}

export interface ThreadFixtureOptions {
  readonly turns: readonly FixtureTurn[];
  readonly viewportHeight?: number;
  /** Extra distance around the viewport whose items stay mounted. */
  readonly overscan?: number;
  /** Turns already loaded when the page opens, counted from the end. */
  readonly initiallyLoaded?: number;
  readonly pageSize?: number;
  /** Delay before a requested history page arrives; Infinity never loads it. */
  readonly historyDelayMs?: number;
  /** Delay before the list re-renders after a scroll; Infinity freezes it. */
  readonly renderDelayMs?: number;
  /**
   * Pushes scroll writes (other than to the very top) this much further, as a
   * list that re-measures items mid-scroll can.
   */
  readonly scrollOvershoot?: number;
  /** How many writes overshoot; every one by default. */
  readonly overshootWrites?: number;
  /**
   * Blank room ChatGPT keeps at the top of the list box for turns not yet
   * loaded (measured live: ~950px), while older history remains.
   */
  readonly unloadedRoom?: number;
  /** A cached, `display: none` page placed before the visible one. */
  readonly cachedPageTurns?: readonly FixtureTurn[];
}

export interface ThreadFixture {
  readonly main: HTMLElement;
  readonly scroller: HTMLElement;
  /** Offset of the viewport's top from the thread's start. */
  offset(): number;
  range(): number;
  setOffset(offset: number): void;
  mountedKeys(): string[];
  loadedCount(): number;
  /** Swap a turn's content in place, as a branch switch does; re-renders it if mounted. */
  replaceTurn(key: string, changes: Partial<Omit<FixtureTurn, 'key'>>): void;
  /**
   * Replace the turns from `fromKey` on with `turns`, as switching to an edited
   * prompt's branch does: the prompt and every later turn get new keys.
   */
  switchBranch(fromKey: string, turns: readonly FixtureTurn[]): void;
}

function renderItem(turn: FixtureTurn): HTMLElement {
  const item = document.createElement('div');
  item.setAttribute('data-turn-key', turn.key);
  if (turn.user !== undefined) {
    item.insertAdjacentHTML(
      'beforeend',
      `<h4 class="sr-only">You said:</h4>
       <div data-chatgpt-search-unit-key="${turn.key}-u" data-chatgpt-search-message-ids="${turn.key}">
         <div data-content-search-unit-key="${turn.key}-u">
           <div class="group/user-message flex flex-col items-end">
             <div data-user-message-bubble="true"><div data-search-result-target=""><div><div dir="auto"></div></div></div></div>
             <div><span data-state="closed"><button aria-label="Copy message">Copy</button></span></div>
           </div>
         </div>
       </div>`,
    );
    item.querySelector('[dir="auto"]')!.textContent = turn.user;
  }
  if (turn.assistant !== undefined) {
    item.insertAdjacentHTML(
      'beforeend',
      `<span hidden data-chatgpt-agent-turn-start=""></span>
       <div data-chatgpt-search-unit-key="${turn.key}-a" data-chatgpt-search-message-ids="${turn.key}-a">
         <h4 data-conversation-role="assistant">ChatGPT said:</h4>
         <div data-chatgpt-selection-conversation-id="conv" data-chatgpt-selection-message-id="${turn.replyId ?? `${turn.key}-a`}">
           <div data-markdown-text-style="assistant-message" dir="auto"><p></p></div>
         </div>
       </div>`,
    );
    item.querySelector('p')!.textContent = turn.assistant;
  }
  return item;
}

function renderCachedPage(turns: readonly FixtureTurn[]): HTMLElement {
  const page = document.createElement('div');
  page.className = 'Workspace';
  page.style.display = 'none';
  const main = document.createElement('main');
  turns.forEach((turn) => main.appendChild(renderItem(turn)));
  page.appendChild(main);
  return page;
}

export function mountThreadFixture(options: ThreadFixtureOptions): ThreadFixture {
  const viewport = options.viewportHeight ?? 1000;
  const overscan = options.overscan ?? 200;
  const pageSize = options.pageSize ?? 3;
  const historyDelay = options.historyDelayMs ?? 5;
  const renderDelay = options.renderDelayMs ?? 1;
  const all = [...options.turns];
  let loadedFrom = Math.max(0, all.length - (options.initiallyLoaded ?? all.length));
  let scrollTop = 0;
  let overshootsLeft = options.overshootWrites ?? Infinity;
  let historyTimer: number | null = null;
  let renderTimer: number | null = null;
  const mounted = new Map<string, HTMLElement>();

  if (options.cachedPageTurns) {
    document.body.appendChild(renderCachedPage(options.cachedPageTurns));
  }
  const page = document.createElement('div');
  page.setAttribute('data-app-shell-active-page', 'true');
  const main = document.createElement('main');
  const scroller = document.createElement('div');
  scroller.setAttribute('data-app-action-timeline-scroll', '');
  scroller.setAttribute('role', 'presentation');
  scroller.style.overflowY = 'auto';
  scroller.style.display = 'flex';
  scroller.style.flexDirection = 'column-reverse';
  const target = document.createElement('div');
  target.setAttribute('data-chatgpt-conversation-selection-target', '');
  const spinner = document.createElement('div');
  spinner.className = 'flex justify-center py-4';
  spinner.innerHTML = '<div role="status">Loading older messages…</div>';
  const outer = document.createElement('div');
  const list = document.createElement('div');
  outer.appendChild(list);
  target.append(spinner, outer);
  scroller.appendChild(target);
  // A live region elsewhere in main, as ChatGPT renders after the thread.
  const liveRegion = document.createElement('span');
  liveRegion.className = 'sr-only';
  liveRegion.setAttribute('role', 'status');
  main.append(scroller, liveRegion);
  page.appendChild(main);
  document.body.appendChild(page);

  const loaded = () => all.slice(loadedFrom);
  const room = () => (loadedFrom > 0 ? (options.unloadedRoom ?? 0) : 0);
  const contentHeight = () => loaded().reduce((sum, turn) => sum + turn.height, room());
  const range = () => Math.max(0, contentHeight() - viewport);
  const offset = () => scrollTop + range();
  const topOf = (key: string) => {
    let top = room();
    for (const turn of loaded()) {
      if (turn.key === key) return top;
      top += turn.height;
    }
    return top;
  };

  function render(): void {
    if (loadedFrom === 0) spinner.remove();
    else if (!spinner.isConnected) target.insertBefore(spinner, outer);
    const view = offset();
    const visible = new Set<string>();
    let top = room();
    for (const turn of loaded()) {
      const bottom = top + turn.height;
      if (bottom > view - overscan && top < view + viewport + overscan) visible.add(turn.key);
      top = bottom;
    }
    for (const [key, element] of mounted) {
      if (!visible.has(key)) {
        element.remove();
        mounted.delete(key);
      }
    }
    for (const turn of loaded()) {
      if (!visible.has(turn.key)) continue;
      let element = mounted.get(turn.key);
      if (!element) {
        element = renderItem(turn);
        const key = turn.key;
        element.getBoundingClientRect = () =>
          ({ top: topOf(key) - offset(), height: turn.height }) as DOMRect;
        mounted.set(turn.key, element);
      }
      list.appendChild(element);
    }
    maybeLoadHistory();
  }

  function scheduleRender(): void {
    if (renderTimer !== null || !Number.isFinite(renderDelay)) return;
    renderTimer = window.setTimeout(() => {
      renderTimer = null;
      render();
    }, renderDelay);
  }

  function maybeLoadHistory(): void {
    if (loadedFrom === 0 || offset() > 1 || historyTimer !== null) return;
    if (!Number.isFinite(historyDelay)) return;
    historyTimer = window.setTimeout(() => {
      historyTimer = null;
      // column-reverse: the distance from the bottom (scrollTop) is kept, so
      // the new page lands above the viewport.
      loadedFrom = Math.max(0, loadedFrom - pageSize);
      render();
    }, historyDelay);
  }

  Object.defineProperty(scroller, 'scrollTop', {
    configurable: true,
    get: () => scrollTop,
    set: (value: number) => {
      let shifted = value;
      if (options.scrollOvershoot && value > -range() && overshootsLeft > 0) {
        overshootsLeft -= 1;
        shifted += options.scrollOvershoot;
      }
      scrollTop = Math.min(0, Math.max(-range(), shifted));
      scheduleRender();
    },
  });
  Object.defineProperty(scroller, 'scrollHeight', {
    configurable: true,
    get: () => Math.max(contentHeight(), viewport),
  });
  Object.defineProperty(scroller, 'clientHeight', { configurable: true, get: () => viewport });
  scroller.getBoundingClientRect = () => ({ top: 0, height: viewport }) as DOMRect;
  outer.getBoundingClientRect = () => ({ top: -offset(), height: contentHeight() }) as DOMRect;

  render();

  return {
    main,
    scroller,
    offset,
    range,
    setOffset(next) {
      scrollTop = Math.min(0, Math.max(-range(), next - range()));
      render();
    },
    mountedKeys: () =>
      Array.from(list.querySelectorAll('[data-turn-key]')).map(
        (item) => item.getAttribute('data-turn-key') ?? '',
      ),
    loadedCount: () => all.length - loadedFrom,
    replaceTurn(key, changes) {
      const index = all.findIndex((turn) => turn.key === key);
      all[index] = { ...all[index]!, ...changes };
      const element = mounted.get(key);
      if (!element) return;
      element.remove();
      mounted.delete(key);
      render();
    },
    switchBranch(fromKey, turns) {
      const index = all.findIndex((turn) => turn.key === fromKey);
      all.splice(index, all.length - index, ...turns);
      render();
    },
  };
}

export function makeTurns(count: number, height = 1500): FixtureTurn[] {
  return Array.from({ length: count }, (_, index) => ({
    key: `turn-${String(index + 1).padStart(2, '0')}`,
    height,
    user: `Question ${index + 1}`,
    assistant: `Answer ${index + 1}`,
  }));
}
