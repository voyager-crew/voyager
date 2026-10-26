const DEFAULT_MODEL_UI_SELECTOR = '.gv-default-star-btn';
const TITLE_WRAPPER_CLASS = 'gv-title-wrapper';

/** Remove every star button inside `root`. */
export function sweepStars(root: ParentNode = document): void {
  root.querySelectorAll(DEFAULT_MODEL_UI_SELECTOR).forEach((el) => el.remove());
}

function mayContainDefaultModelUi(root: HTMLElement): boolean {
  return root.matches(DEFAULT_MODEL_UI_SELECTOR) || !!root.querySelector(DEFAULT_MODEL_UI_SELECTOR);
}

/**
 * Off-state guard of the native module: sweeps the stars already on the page,
 * then keeps walking added subtrees so a CDK overlay pane that was detached
 * when the switch went off cannot bring stars back when Gemini reattaches it.
 */
export function startStaleStarSweeper(): () => void {
  sweepStars();
  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      for (const node of Array.from(mutation.addedNodes)) {
        if (node instanceof HTMLElement && mayContainDefaultModelUi(node)) sweepStars(node);
      }
    }
  });
  observer.observe(document.body, { childList: true, subtree: true });
  return () => observer.disconnect();
}

/**
 * Nodes this module put into Gemini's menus, kept so stop can take them out
 * even when the host detached their pane meanwhile. Weak references: a pane
 * the host dropped for good is not kept alive, and cannot come back either.
 */
class InjectedNodes<T extends Node> {
  private refs = new Set<WeakRef<T>>();
  private known = new WeakSet<T>();

  public add(node: T): void {
    if (this.known.has(node)) return;
    this.known.add(node);
    for (const ref of this.refs) if (!ref.deref()) this.refs.delete(ref);
    this.refs.add(new WeakRef(node));
  }

  public drain(): T[] {
    const nodes: T[] = [];
    for (const ref of this.refs) {
      const node = ref.deref();
      if (node) nodes.push(node);
    }
    this.refs = new Set();
    this.known = new WeakSet();
    return nodes;
  }
}

/** Put the title back where the wrapper stood and drop the wrapper. */
function unwrapTitle(wrapper: HTMLElement): void {
  const parent = wrapper.parentNode;
  if (!parent) return;
  while (wrapper.firstChild) parent.insertBefore(wrapper.firstChild, wrapper);
  wrapper.remove();
}

/** Owns the nodes and listeners that stars add to native menus. */
export class DefaultStarView {
  private readonly stars = new InjectedNodes<HTMLElement>();
  private readonly titleWrappers = new InjectedNodes<HTMLElement>();
  private hostListeners: AbortController | null = null;

  public start(): void {
    this.hostListeners = new AbortController();
  }

  public stop(): void {
    this.hostListeners?.abort();
    this.hostListeners = null;
    for (const star of this.stars.drain()) star.remove();
    for (const wrapper of this.titleWrappers.drain()) unwrapTitle(wrapper);
  }

  public updateStarState(item: HTMLElement, isDefault: boolean, kind: 'model' | 'thinking') {
    const btn = item.querySelector('.gv-default-star-btn') as HTMLElement | null;
    if (!btn) return;
    this.bindStarOwnerHover(item, btn);
    if (!btn.hasAttribute('data-event-bound')) {
      btn.setAttribute('data-event-bound', 'true');
      btn.addEventListener('mousedown', (e) => e.stopPropagation());
      btn.addEventListener('click', (e) => e.stopPropagation());
    }
    if (isDefault) {
      btn.classList.add('is-default');
      btn.innerHTML = this.getStarIcon(true);
      btn.title = chrome.i18n.getMessage(
        kind === 'model' ? 'cancelDefaultModel' : 'cancelDefaultThinkingLevel',
      );
    } else {
      btn.classList.remove('is-default');
      btn.innerHTML = this.getStarIcon(false);
      btn.title = chrome.i18n.getMessage(
        kind === 'model' ? 'setAsDefaultModel' : 'setAsDefaultThinkingLevel',
      );
    }
  }

  public createStar(
    kind: 'model' | 'thinking',
    onClick: (button: HTMLButtonElement) => Promise<void>,
  ): HTMLButtonElement {
    const btn = document.createElement('button');
    btn.className = 'gv-default-star-btn';
    btn.dataset.gvDefaultKind = kind;
    this.stars.add(btn);
    btn.innerHTML = this.getStarIcon(false);
    btn.title = chrome.i18n.getMessage(
      kind === 'model' ? 'setAsDefaultModel' : 'setAsDefaultThinkingLevel',
    );
    btn.addEventListener('click', async (event) => {
      event.stopPropagation();
      event.preventDefault();
      await onClick(btn);
    });
    return btn;
  }

  public appendStar(
    item: HTMLElement,
    btn: HTMLElement,
    anchor: { container: HTMLElement | null; title: HTMLElement | null },
  ): void {
    const { container, title } = anchor;
    if (!container || !title) {
      (container ?? item).appendChild(btn);
      return;
    }
    const parent = title.parentElement;
    const candidate = container.querySelector<HTMLElement>(`.${TITLE_WRAPPER_CLASS}`);
    // A nested row's wrapper must not receive the outer row's preference button.
    let wrapper = candidate?.contains(title) ? candidate : null;
    if (!wrapper && parent?.classList.contains(TITLE_WRAPPER_CLASS)) wrapper = parent;
    if (!wrapper) {
      wrapper = document.createElement('div');
      wrapper.className = TITLE_WRAPPER_CLASS;
      wrapper.style.cssText = 'display: flex; align-items: center; width: 100%;';
      if (parent) parent.insertBefore(wrapper, title);
      else container.appendChild(wrapper);
      wrapper.appendChild(title);
    }
    // A wrapper found in place is unwrapped on stop too: it can only be ours.
    this.titleWrappers.add(wrapper);
    wrapper.appendChild(btn);
  }

  private bindStarOwnerHover(item: HTMLElement, btn: HTMLElement) {
    if (btn.hasAttribute('data-hover-bound')) return;
    // These listeners sit on Gemini's own item, which outlives the star:
    // removing the star alone would leave them behind.
    const signal = this.hostListeners?.signal;
    if (!signal) return;
    btn.setAttribute('data-hover-bound', 'true');

    item.addEventListener(
      'mouseenter',
      () => {
        btn.classList.add('is-owner-hovered');
      },
      { signal },
    );
    item.addEventListener(
      'mouseleave',
      () => {
        btn.classList.remove('is-owner-hovered');
      },
      { signal },
    );
    item.addEventListener(
      'focusin',
      () => {
        btn.classList.add('is-owner-hovered');
      },
      { signal },
    );
    item.addEventListener(
      'focusout',
      (event) => {
        const nextTarget = event.relatedTarget;
        if (!(nextTarget instanceof Node) || !item.contains(nextTarget)) {
          btn.classList.remove('is-owner-hovered');
        }
      },
      { signal },
    );
  }

  private getStarIcon(filled: boolean): string {
    if (filled) {
      return `<svg viewBox="0 0 24 24"><path d="M12 17.27L18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z" fill="currentColor"></path></svg>`;
    } else {
      return `<svg viewBox="0 0 24 24"><path d="M12 17.27L18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z" fill="none" stroke="currentColor" stroke-width="1.5"></path></svg>`;
    }
  }
}
