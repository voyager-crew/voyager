/**
 * The floating entry's satellites: "Voyager 面板" and "隐藏" ride a tight
 * orbit out of the ball on hover or keyboard focus (motion in `orbit.ts`).
 *
 * The ball stays Prompt Manager's own element (position, drag, clearance and
 * its click are untouched); this sits beside it, one layer below, and follows
 * where it is and whether it shows. Satellites fan toward the page interior
 * from wherever the ball sits.
 */
import { isUserEvent } from '@/core/utils/userEvent';

import { BALL_DRAGGING_CLASS } from '../prompt/promptBall';
import { createOrbitTrack, createShellIcon } from './icons';
import { type SatelliteSlot, createOrbit } from './orbit';
import { panelShortcutAria, panelShortcutLabel, shellText, shortcutCap } from './text';

const OPEN_CLASS = 'gv-ps-open';
/** On the ball while it is decorated: its hover scale and glow come from the shell's stylesheet. */
const BALL_CLASS = 'gv-ps-ball';

export type EntryAnchor = 'satellite' | 'ball';

export interface EntryOptions {
  /** "Voyager 面板" was clicked. */
  readonly onPanel: () => void;
  /** "隐藏" was clicked. */
  readonly onHide: () => void;
  /** A press began on the ball or a satellite, before it could take focus. */
  readonly onPress: () => void;
}

export interface Entry {
  readonly ball: HTMLElement;
  /** The satellites' layer, which hides and shows with the ball. */
  readonly element: HTMLElement;
  /** Where a panel opened from `anchor` grows out of; null while the ball does not show. */
  anchorCenter(anchor: EntryAnchor): { x: number; y: number } | null;
  contains(node: Node): boolean;
  /** Only "隐藏" shows: the ball itself opens the panel. */
  setHideOnly(hideOnly: boolean): void;
  setPanelOpen(open: boolean): void;
  relabel(): void;
  destroy(): void;
}

function span(className: string): HTMLSpanElement {
  const element = document.createElement('span');
  element.className = className;
  return element;
}

function satellite(slot: SatelliteSlot, icon: 'sliders' | 'eyeOff'): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'gv-ps-hit gv-ps-sat';
  button.dataset.slot = slot;
  button.append(createShellIcon(icon));
  return button;
}

/** What the shared label says for a satellite; the key cap only names the panel. */
function labelFor(slot: SatelliteSlot): Node[] {
  if (slot === 'hide') return [document.createTextNode(shellText('panelShellHide'))];
  return [document.createTextNode(shellText('panelShellPanel')), shortcutCap(panelShortcutLabel())];
}

function center(element: Element): { x: number; y: number } {
  const rect = element.getBoundingClientRect();
  return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
}

export function decorateBall(ball: HTMLElement, options: EntryOptions): Entry {
  const container = document.createElement('div');
  container.className = 'gv-ps-entry';
  const bridge = span('gv-ps-bridge');
  const track = createOrbitTrack();
  const panelHit = satellite('panel', 'sliders');
  const hideHit = satellite('hide', 'eyeOff');
  panelHit.setAttribute('aria-expanded', 'false');
  const label = span('gv-ps-tip');
  label.setAttribute('aria-hidden', 'true');
  container.append(bridge, track.svg, panelHit, hideHit, label);
  ball.after(container);
  ball.classList.add(BALL_CLASS);
  const orbit = createOrbit({
    layer: container,
    satellites: { panel: panelHit, hide: hideHit },
    track: track.path,
    trackFade: track.fade,
    label,
    labelFor,
  });

  const hovered = new Set<EventTarget>();
  let destroyed = false;
  let open = false;

  const shows = (): boolean =>
    ball.isConnected && !ball.hidden && getComputedStyle(ball).display !== 'none';

  const keyboardFocus = (): boolean => {
    const active = document.activeElement;
    if (active !== ball && active !== panelHit && active !== hideHit) return false;
    try {
      return active.matches(':focus-visible');
    } catch {
      return true;
    }
  };

  function relabel(): void {
    const panelLabel = shellText('panelShellPanel');
    panelHit.setAttribute('aria-label', panelLabel);
    const aria = panelShortcutAria();
    if (aria) panelHit.setAttribute('aria-keyshortcuts', aria);
    else panelHit.removeAttribute('aria-keyshortcuts');
    hideHit.setAttribute('aria-label', shellText('panelShellHideButton'));
    orbit.relabel();
  }

  /** `immediate` skips the pause before the satellites fold back. */
  function apply(immediate: boolean): void {
    const next =
      !destroyed &&
      !container.hidden &&
      !ball.classList.contains(BALL_DRAGGING_CLASS) &&
      (hovered.size > 0 || keyboardFocus());
    if (next && !open) relabel();
    if (next !== open) orbit.setOpen(next, { immediate });
    open = next;
    container.classList.toggle(OPEN_CLASS, next);
    ball.classList.toggle(OPEN_CLASS, next);
  }

  // Also an event listener: the event must not reach `apply` as its flag.
  const update = (): void => apply(false);

  /** Sit exactly on the ball's layout box (its hover scale is about its center). */
  function sync(): void {
    if (destroyed) return;
    container.hidden = !shows();
    if (container.hidden) {
      hovered.clear();
      update();
      // Nobody sees the layer: fold everything in without asking for frames.
      orbit.rest();
      return;
    }
    const rect = ball.getBoundingClientRect();
    const width = ball.offsetWidth || rect.width;
    const height = ball.offsetHeight || rect.height;
    const left = rect.left + (rect.width - width) / 2;
    const top = rect.top + (rect.height - height) / 2;
    container.style.left = `${Math.round(left)}px`;
    container.style.top = `${Math.round(top)}px`;
    container.style.width = `${width}px`;
    container.style.height = `${height}px`;
    const fanRight = left + width / 2 < window.innerWidth / 2;
    const fanDown = top + height / 2 < window.innerHeight / 2;
    container.dataset.fanX = fanRight ? 'right' : 'left';
    container.dataset.fanY = fanDown ? 'down' : 'up';
    orbit.setFan(fanRight ? 1 : -1, fanDown ? 1 : -1);
    update();
  }

  const onEnter = (event: Event): void => {
    if (event.currentTarget === ball) sync();
    if (event.currentTarget) hovered.add(event.currentTarget);
    update();
  };
  const onLeave = (event: Event): void => {
    if (event.currentTarget) hovered.delete(event.currentTarget);
    update();
  };
  const onPress = (): void => options.onPress();
  const keepFocus = (event: Event): void => event.preventDefault();
  // A page script's click() must not open the panel, nor hide the ball on every synced device.
  const onPanel = (event: Event): void => {
    if (isUserEvent(event)) options.onPanel();
  };
  const onHide = (event: Event): void => {
    if (!isUserEvent(event)) return;
    // The ball is leaving: fold the satellites back with it, without the usual pause.
    hovered.clear();
    apply(true);
    options.onHide();
  };

  const hoverTargets: readonly HTMLElement[] = [ball, bridge, panelHit, hideHit];
  for (const target of hoverTargets) {
    target.addEventListener('pointerenter', onEnter);
    target.addEventListener('pointerleave', onLeave);
  }
  for (const target of [ball, panelHit, hideHit]) {
    target.addEventListener('pointerdown', onPress);
    target.addEventListener('focusin', update);
    target.addEventListener('focusout', update);
  }
  for (const hit of [panelHit, hideHit]) hit.addEventListener('mousedown', keepFocus);
  panelHit.addEventListener('click', onPanel);
  hideHit.addEventListener('click', onHide);
  window.addEventListener('resize', sync, { passive: true });
  const observer = new MutationObserver(sync);
  observer.observe(ball, { attributes: true, attributeFilter: ['style', 'class', 'hidden'] });
  // The RTL class moves the ball through the stylesheet alone.
  if (document.body)
    observer.observe(document.body, { attributes: true, attributeFilter: ['class'] });

  relabel();
  sync();

  return {
    ball,
    element: container,
    anchorCenter(anchor) {
      if (destroyed || !shows()) return null;
      return center(anchor === 'satellite' && !panelHit.hidden ? panelHit : ball);
    },
    contains: (node) => container.contains(node),
    setHideOnly(hideOnly) {
      orbit.setSingle(hideOnly);
      panelHit.hidden = hideOnly;
      if (hideOnly) hovered.delete(panelHit);
      update();
    },
    setPanelOpen(isOpen) {
      panelHit.setAttribute('aria-expanded', String(isOpen));
    },
    relabel,
    destroy() {
      if (destroyed) return;
      destroyed = true;
      orbit.destroy();
      observer.disconnect();
      window.removeEventListener('resize', sync);
      for (const target of hoverTargets) {
        target.removeEventListener('pointerenter', onEnter);
        target.removeEventListener('pointerleave', onLeave);
      }
      for (const target of [ball, panelHit, hideHit]) {
        target.removeEventListener('pointerdown', onPress);
        target.removeEventListener('focusin', update);
        target.removeEventListener('focusout', update);
      }
      for (const hit of [panelHit, hideHit]) hit.removeEventListener('mousedown', keepFocus);
      panelHit.removeEventListener('click', onPanel);
      hideHit.removeEventListener('click', onHide);
      ball.classList.remove(BALL_CLASS, OPEN_CLASS);
      container.remove();
    },
  };
}
