import packaged from '@/features/plugins/catalog/sites/gemini/selector-data/vim-packaged.json';

import type { VimMode } from './vimCommands';
import { getVimComposerMount } from './vimComposerMount';
import { getCaretOffset } from './vimDomEditor';
import { isEditPromptInput, isVisibleHudMount } from './vimInputTargets';
import { getCharacterRect, getCaretRect } from './vimLayout';
import { clamp } from './vimMotions';

interface DisplayContext {
  activeInput: HTMLElement | null;
  isEnabled: boolean;
  mode: VimMode;
  buffer: string;
  composerSelector: string | null;
  acceptedComposerSelector?: (input: HTMLElement | null) => string | null;
}

interface HudMountTarget {
  element: HTMLElement;
  input: HTMLElement | null;
  placement: 'composer' | 'floating' | 'edit' | 'edit-floating' | 'inline';
}

const HUD_CLASS = 'gv-input-vim-hud';
const HUD_MOUNT_CLASS = 'gv-input-vim-hud-mount';
const HUD_COMPOSER_MOUNT_CLASS = 'gv-input-vim-hud-composer-mount';
const HUD_MODE_CLASS = 'gv-input-vim-hud-mode';
const HUD_BUFFER_CLASS = 'gv-input-vim-hud-buffer';
const CURSOR_CLASS = 'gv-input-vim-cursor';
const CURSOR_MOVING_CLASS = 'gv-input-vim-cursor-moving';
const NORMAL_CURSOR_WIDTH = 9;
const CURSOR_MOVE_FLASH_MS = 70;

export function createVimPresentation(
  readContext: () => DisplayContext,
  findVimInput: (options?: { requireVisible?: boolean }) => HTMLElement | null,
) {
  let hudElement: HTMLElement | null = null;
  let hudMountElement: HTMLElement | null = null;
  let cursorElement: HTMLElement | null = null;
  let cursorUpdateRaf: number | null = null;
  let cursorMoveFlashTimer: number | null = null;
  let lastCursorBox: {
    top: number;
    left: number;
    width: number;
    height: number;
    mode: VimMode;
  } | null = null;
  let hudRetryTimer: number | null = null;
  let hudRetryAttempts = 0;

  function queryHudMountCandidates(): HTMLElement[] {
    const selectors = packaged['vim.hud'];

    const candidates: HTMLElement[] = [];
    const seen = new Set<HTMLElement>();

    for (const selector of selectors) {
      for (const element of Array.from(document.querySelectorAll<HTMLElement>(selector))) {
        if (seen.has(element)) continue;
        seen.add(element);
        candidates.push(element);
      }
    }

    return candidates;
  }

  function getCrossSiteEditMount(input: HTMLElement | null): HTMLElement | null {
    if (!input?.matches('textarea[aria-label="Edit message"]')) return null;

    let candidate = input.parentElement;
    for (let depth = 0; candidate && candidate !== document.body && depth < 8; depth++) {
      if (candidate.querySelectorAll('button').length >= 2) {
        return candidate;
      }
      candidate = candidate.parentElement;
    }

    return input.parentElement;
  }

  function getHudMount(): HudMountTarget | null {
    if (typeof document === 'undefined') return null;

    const { activeInput } = readContext();
    const input =
      (activeInput?.isConnected ? activeInput : null) ??
      findVimInput() ??
      findVimInput({ requireVisible: false });
    const editForm =
      input && isEditPromptInput(input)
        ? input.closest<HTMLElement>(packaged['vim.editForm'].join(','))
        : null;

    if (editForm?.isConnected) {
      return { element: editForm, input, placement: 'edit' };
    }

    const crossSiteEdit = getCrossSiteEditMount(input);
    if (crossSiteEdit?.isConnected) {
      return { element: crossSiteEdit, input, placement: 'edit-floating' };
    }

    const context = readContext();
    const crossSiteComposer = getVimComposerMount(input, context.composerSelector);

    if (crossSiteComposer?.isConnected) {
      return { element: crossSiteComposer, input, placement: 'floating' };
    }

    const composer = input?.closest<HTMLElement>(packaged['vim.host'].join(','));

    if (composer?.isConnected) {
      return { element: composer, input, placement: 'composer' };
    }

    // Existing mounts keep parity; only a repaired composer needs its accepted new wrapper.
    const repairedMount = getVimComposerMount(
      input,
      context.acceptedComposerSelector?.(input) ?? null,
      true,
    );
    if (repairedMount?.isConnected) {
      return { element: repairedMount, input, placement: 'floating' };
    }

    const candidates = queryHudMountCandidates();
    const visibleCandidate = candidates.find(isVisibleHudMount);
    if (visibleCandidate) {
      return { element: visibleCandidate, input, placement: 'inline' };
    }

    const fallbackCandidate = candidates.find((element) => element.isConnected);
    if (fallbackCandidate) {
      return { element: fallbackCandidate, input, placement: 'inline' };
    }

    const inputFallback = document.querySelector<HTMLElement>(
      packaged['vim.inputFallback'].join(','),
    )?.parentElement;
    return inputFallback instanceof HTMLElement
      ? { element: inputFallback, input, placement: 'inline' }
      : null;
  }

  function updateHudPlacement(
    hud: HTMLElement,
    mount: HTMLElement,
    input: HTMLElement | null,
    placement: HudMountTarget['placement'],
  ): void {
    hud.dataset.placement = placement;

    if (placement === 'inline' || !input) {
      hud.style.removeProperty('--gv-input-vim-hud-left');
      return;
    }

    const mountRect = mount.getBoundingClientRect();
    const inputRect = input.getBoundingClientRect();
    const left = clamp(inputRect.left - mountRect.left, 0, mountRect.width);
    hud.style.setProperty('--gv-input-vim-hud-left', `${Math.round(left)}px`);
  }

  function clearHudMountClasses(mount: HTMLElement | null): void {
    if (!mount) return;
    // A successor content script (its own copy of this module) may share the
    // mount; while its HUD is there, the mount classes are its too.
    const hostsAnotherHud = Array.from(mount.children).some(
      (child) => child !== hudElement && child.classList.contains(HUD_CLASS),
    );
    if (hostsAnotherHud) return;
    mount.classList.remove(HUD_MOUNT_CLASS, HUD_COMPOSER_MOUNT_CLASS);
  }

  function updateHudMountClass(mount: HTMLElement, placement: HudMountTarget['placement']): void {
    mount.classList.toggle(HUD_MOUNT_CLASS, placement === 'inline');
    mount.classList.toggle(HUD_COMPOSER_MOUNT_CLASS, placement !== 'inline');
  }

  function ensureHud(): HTMLElement | null {
    const target = getHudMount();
    if (!target) {
      return hudElement?.isConnected ? hudElement : null;
    }

    const { element: mount, input, placement } = target;

    if (hudElement?.isConnected) {
      if (hudElement.parentElement !== mount) {
        clearHudMountClasses(hudMountElement);
        mount.appendChild(hudElement);
        hudMountElement = mount;
      }
      updateHudMountClass(mount, placement);
      updateHudPlacement(hudElement, mount, input, placement);
      return hudElement;
    }

    const hud = document.createElement('div');
    hud.className = HUD_CLASS;
    hud.innerHTML = `
    <span class="${HUD_MODE_CLASS}"></span>
    <span class="${HUD_BUFFER_CLASS}"></span>
  `;
    updateHudMountClass(mount, placement);
    mount.appendChild(hud);
    hudMountElement = mount;
    hudElement = hud;
    updateHudPlacement(hud, mount, input, placement);
    return hud;
  }

  function stopHudRetry(): void {
    if (hudRetryTimer !== null) {
      clearTimeout(hudRetryTimer);
      hudRetryTimer = null;
    }
  }

  function scheduleHudRetry(): void {
    if (!readContext().isEnabled || typeof document === 'undefined') return;
    if (hudRetryTimer !== null || hudElement?.isConnected) return;
    if (hudRetryAttempts >= 20) return;

    hudRetryTimer = window.setTimeout(() => {
      hudRetryTimer = null;
      hudRetryAttempts++;
      updateHud();

      if (!hudElement?.isConnected) {
        scheduleHudRetry();
      }
    }, 250);
  }

  function updateHud(): void {
    if (typeof document === 'undefined') return;

    const hud = ensureHud();
    if (!hud) {
      scheduleHudRetry();
      return;
    }

    stopHudRetry();

    const modeElement = hud.querySelector<HTMLElement>(`.${HUD_MODE_CLASS}`);
    const bufferElement = hud.querySelector<HTMLElement>(`.${HUD_BUFFER_CLASS}`);

    const { activeInput, isEnabled, mode, buffer } = readContext();
    const isActive = Boolean(activeInput && isEnabled);
    hud.dataset.mode = isActive ? mode : 'off';
    hud.dataset.active = String(isActive);

    if (modeElement) {
      modeElement.textContent = isActive ? mode.toUpperCase() : 'VIM';
    }

    if (bufferElement) {
      bufferElement.textContent = buffer;
      bufferElement.hidden = buffer.length === 0;
    }
  }

  function ensureCursor(): HTMLElement {
    if (cursorElement?.isConnected) return cursorElement;

    const cursor = document.createElement('div');
    cursor.className = CURSOR_CLASS;
    cursor.setAttribute('aria-hidden', 'true');
    document.body.appendChild(cursor);
    cursorElement = cursor;
    return cursor;
  }

  function hideCursor(): void {
    if (cursorElement) {
      cursorElement.hidden = true;
      cursorElement.classList.remove(CURSOR_MOVING_CLASS);
    }
    lastCursorBox = null;
    if (cursorMoveFlashTimer !== null) {
      clearTimeout(cursorMoveFlashTimer);
      cursorMoveFlashTimer = null;
    }
  }

  function updateCursorMotion(cursor: HTMLElement, box: NonNullable<typeof lastCursorBox>): void {
    const previousBox = lastCursorBox;
    lastCursorBox = box;

    if (!previousBox || cursor.hidden) return;

    const moved =
      previousBox.mode !== box.mode ||
      previousBox.top !== box.top ||
      previousBox.left !== box.left ||
      previousBox.width !== box.width ||
      previousBox.height !== box.height;

    if (!moved) return;

    cursor.classList.remove(CURSOR_MOVING_CLASS);
    cursor.classList.add(CURSOR_MOVING_CLASS);

    if (cursorMoveFlashTimer !== null) {
      clearTimeout(cursorMoveFlashTimer);
    }
    cursorMoveFlashTimer = window.setTimeout(() => {
      cursorMoveFlashTimer = null;
      cursor.classList.remove(CURSOR_MOVING_CLASS);
    }, CURSOR_MOVE_FLASH_MS);
  }

  function updateCursor(): void {
    const { activeInput, mode } = readContext();
    if (!activeInput || mode === 'insert' || !activeInput.isConnected) {
      hideCursor();
      return;
    }

    const cursor = ensureCursor();
    const caretOffset = getCaretOffset(activeInput);
    const characterRect =
      mode === 'normal'
        ? (getCharacterRect(activeInput, caretOffset) ??
          getCharacterRect(activeInput, caretOffset, -1))
        : null;
    const rect = characterRect ?? getCaretRect(activeInput, caretOffset);
    if (!rect) {
      hideCursor();
      return;
    }

    const inputRect = activeInput.getBoundingClientRect();
    const height = Math.max(16, rect.height || inputRect.height || 18);
    const top = Number.isFinite(rect.top) ? rect.top : inputRect.top;
    const left = Number.isFinite(rect.left) ? rect.left : inputRect.left;
    const width =
      mode === 'visual'
        ? 2
        : Math.max(NORMAL_CURSOR_WIDTH, Math.round(characterRect?.width ?? NORMAL_CURSOR_WIDTH));
    const box = {
      top: Math.round(top),
      left: Math.round(left),
      width,
      height: Math.round(height),
      mode,
    };

    updateCursorMotion(cursor, box);
    cursor.hidden = false;
    cursor.dataset.mode = mode;
    cursor.style.top = `${box.top}px`;
    cursor.style.left = `${box.left}px`;
    cursor.style.height = `${box.height}px`;
    cursor.style.width = `${box.width}px`;
  }

  function scheduleCursorUpdate(): void {
    if (cursorUpdateRaf !== null) {
      if (typeof cancelAnimationFrame === 'function') {
        cancelAnimationFrame(cursorUpdateRaf);
      } else {
        clearTimeout(cursorUpdateRaf);
      }
    }

    const schedule =
      typeof requestAnimationFrame === 'function'
        ? requestAnimationFrame
        : (callback: FrameRequestCallback) => window.setTimeout(() => callback(Date.now()), 0);

    cursorUpdateRaf = schedule(() => {
      cursorUpdateRaf = null;
      updateCursor();
    });
  }

  function start(): void {
    document.addEventListener('selectionchange', scheduleCursorUpdate);
    window.addEventListener('resize', updateCursor, { passive: true });
    window.addEventListener('scroll', updateCursor, { passive: true });
    hudRetryAttempts = 0;
    updateHud();
  }

  function pause(): void {
    document.removeEventListener('selectionchange', scheduleCursorUpdate);
    window.removeEventListener('resize', updateCursor);
    window.removeEventListener('scroll', updateCursor);
    if (cursorUpdateRaf !== null) {
      cancelAnimationFrame(cursorUpdateRaf);
      cursorUpdateRaf = null;
    }
    stopHudRetry();
    hideCursor();
  }

  function dispose(): void {
    pause();
    hudElement?.remove();
    cursorElement?.remove();
    clearHudMountClasses(hudMountElement);
    hudElement = null;
    hudMountElement = null;
    cursorElement = null;
  }

  return { start, pause, dispose, updateHud, scheduleCursorUpdate, hideCursor };
}
