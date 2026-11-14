import { act } from 'react';
import { type Root, createRoot } from 'react-dom/client';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { PopupSectionId } from '../../hooks/usePopupSections';
import { PopupToc } from '../PopupToc';

const SECTIONS: PopupSectionId[] = ['cloudSync', 'folder', 'keyboardShortcuts', 'general'];
const VIEW_PX = 300;
const CONTENT_PX = 600;

describe('PopupToc for a mouse', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  /** Renders a bar whose links run twice as wide as its view, scrolled to its start. */
  async function renderBar(dir?: 'rtl') {
    await act(async () => root.render(<PopupToc sections={SECTIONS} dir={dir} t={(key) => key} />));
    const nav = container.querySelector('nav')!;
    let left = 0;
    Object.defineProperties(nav, {
      clientWidth: { configurable: true, get: () => VIEW_PX },
      scrollWidth: { configurable: true, get: () => CONTENT_PX },
      scrollLeft: {
        configurable: true,
        get: () => left,
        set: (value: number) => {
          const max = CONTENT_PX - VIEW_PX;
          left =
            dir === 'rtl' ? Math.min(0, Math.max(-max, value)) : Math.min(max, Math.max(0, value));
        },
      },
    });
    const settle = async () => {
      await act(async () => nav.dispatchEvent(new Event('scroll')));
    };
    await settle();
    const wheel = async (deltaY: number, deltaMode = 0) => {
      const event = new WheelEvent('wheel', { deltaY, deltaMode, cancelable: true, bubbles: true });
      nav.dispatchEvent(event);
      await settle();
      return event.defaultPrevented;
    };
    const arrows = () =>
      [...container.querySelectorAll<HTMLElement>('[data-page-arrow]')].map(
        (arrow) => arrow.dataset.pageArrow,
      );
    return { nav, wheel, arrows };
  }

  it('turns the wheel sideways until the end, then lets the settings scroll', async () => {
    const { nav, wheel, arrows } = await renderBar();
    expect(arrows()).toEqual(['right']);

    expect(await wheel(100)).toBe(true);
    expect(nav.scrollLeft).toBe(100);
    expect(arrows()).toEqual(['left', 'right']);

    // Firefox reports a mouse wheel in lines.
    expect(await wheel(3, 1)).toBe(true);
    expect(nav.scrollLeft).toBe(148);

    nav.scrollLeft = CONTENT_PX - VIEW_PX;
    expect(await wheel(100)).toBe(false);
    expect(arrows()).toEqual(['left']);
    expect(await wheel(-100)).toBe(true);
  });

  it('moves a right-to-left bar toward its end on a downward wheel', async () => {
    const { nav, wheel, arrows } = await renderBar('rtl');
    expect(arrows()).toEqual(['left']);
    expect(await wheel(100)).toBe(true);
    expect(nav.scrollLeft).toBe(-100);
    expect(arrows()).toEqual(['left', 'right']);
    expect(await wheel(-500)).toBe(true);
    expect(nav.scrollLeft).toBe(0);
    expect(await wheel(-100)).toBe(false);
  });

  it('keeps the arrows out of the links and the tab order', async () => {
    await renderBar();
    const nav = container.querySelector('nav')!;
    expect(nav.querySelectorAll('[data-page-arrow]')).toHaveLength(0);
    for (const arrow of container.querySelectorAll<HTMLElement>('[data-page-arrow]')) {
      expect(arrow.tabIndex).toBe(-1);
    }
  });
});
