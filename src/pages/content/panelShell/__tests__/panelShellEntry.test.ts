/**
 * The floating entry through the running shell: Prompt Manager keeps its
 * ball, the satellites fly out of it, "Hide" and its undo, and every way back.
 */
import { afterEach, beforeAll, describe, expect, it, onTestFinished, vi } from 'vitest';

import { keyboardShortcutService } from '@/core/services/KeyboardShortcutService';
import { StorageKeys } from '@/core/types/common';
import { DEFAULT_KEYBOARD_SHORTCUTS } from '@/core/types/keyboardShortcut';
import { PANEL_MESSAGE } from '@/features/panel/protocol';
import { setCachedLanguage } from '@/utils/i18n';

import { startPromptManager } from '../../prompt/index';
import { resolvePromptSiteAdapter } from '../../prompt/resolvePromptSiteAdapter';
import {
  PANEL_URL,
  type ShellPage,
  ball,
  bootstrapI18n,
  flush,
  hover,
  installShellPage,
  panel,
  pressAltV,
  recordAnimations,
  rect,
  satellite,
  stopRecordingAnimations,
} from './shellHarness';

vi.mock('webextension-polyfill', () => ({ default: globalThis.chrome }));
vi.mock('@/core/utils/userEvent', () => import('./forgedEvents'));

const GEMINI = 'https://gemini.google.com/app';
// A catalog site where Prompt Manager runs only while the user covers it.
const CLAUDE = 'https://claude.ai/new';

let page: ShellPage;
let manager: { destroy: () => void } | undefined;

beforeAll(bootstrapI18n);

afterEach(async () => {
  manager?.destroy();
  manager = undefined;
  await page.restore();
  stopRecordingAnimations();
  vi.restoreAllMocks();
});

function entry(): HTMLElement | null {
  return document.querySelector<HTMLElement>('.gv-ps-entry');
}

/** The one label the satellites share; it names whichever one is pointed at. */
function label(): HTMLElement | null {
  return document.querySelector<HTMLElement>('.gv-ps-entry .gv-ps-tip');
}

/** The panel frame's address. */
function frameSrc(): string | undefined {
  return document.querySelector<HTMLIFrameElement>('.gv-ps-frame')?.src;
}

function hidden(): boolean {
  return getComputedStyle(ball()!).display === 'none';
}

describe('floating entry', () => {
  it('keeps opening Prompt Manager from the ball, with both satellites on hover', async () => {
    page = installShellPage(GEMINI);
    await page.start();
    manager = await startPromptManager(resolvePromptSiteAdapter(location.href));
    await flush();

    ball()!.click();
    expect(document.querySelector('#gv-pm-panel')?.classList.contains('gv-hidden')).toBe(false);
    expect(page.sentOfType(PANEL_MESSAGE.tokenIssue)).toEqual([]);
    expect(panel()).toBeNull();

    hover(ball());
    expect(entry()?.classList.contains('gv-ps-open')).toBe(true);
    expect(ball()?.classList.contains('gv-ps-open')).toBe(true);
    expect(satellite('panel')?.hidden).toBe(false);
    expect(satellite('hide')?.hidden).toBe(false);
  });

  it('grows the panel out of the "Voyager panel" satellite', async () => {
    const animations = recordAnimations();
    page = installShellPage(GEMINI);
    await page.start();
    manager = await startPromptManager(resolvePromptSiteAdapter(location.href));
    await flush();

    hover(ball());
    satellite('panel')!.click();
    await flush();

    expect(panel()).not.toBeNull();
    expect(frameSrc()).toBe(PANEL_URL);
    expect(satellite('panel')?.getAttribute('aria-expanded')).toBe('true');
    const open = animations.find((animation) => animation.element === panel());
    expect(open?.keyframes[0]?.transform).toMatch(/^translate\(.+\) scale\(\.06\)$/);
    expect(open?.options.duration).toBe(640);
  });

  it('keeps the ball where Prompt Manager is off: it opens the panel and offers only "Hide"', async () => {
    page = installShellPage(CLAUDE);
    await page.start();
    expect(ball()).not.toBeNull();

    hover(ball());
    expect(satellite('panel')?.hidden).toBe(true);
    expect(satellite('hide')?.hidden).toBe(false);

    ball()!.click();
    await flush();
    expect(page.sentOfType(PANEL_MESSAGE.tokenIssue)).toHaveLength(1);
    expect(panel()).not.toBeNull();
    expect(frameSrc()).toBe(PANEL_URL);
  });

  it('waits for Prompt Manager once the user turns it on for the site', async () => {
    page = installShellPage(CLAUDE);
    await page.start();

    page.memory.external('sync', StorageKeys.PROMPT_CUSTOM_WEBSITES, ['claude.ai']);
    await flush();
    ball()!.click();
    await flush();

    // Prompt Manager owns the click again; until it mounts, the ball opens nothing.
    expect(page.sentOfType(PANEL_MESSAGE.tokenIssue)).toEqual([]);
    hover(ball());
    expect(satellite('panel')?.hidden).toBe(false);
  });

  it('hides the ball from "Hide", says how to get it back, and undo brings it back', async () => {
    page = installShellPage(CLAUDE);
    await page.start();

    hover(ball());
    satellite('hide')!.click();
    await flush();

    expect(page.memory.values.sync.get(StorageKeys.HIDE_PROMPT_MANAGER)).toBe(true);
    expect(hidden()).toBe(true);
    const toast = document.querySelector<HTMLElement>('.gv-ps-toast')!;
    expect(toast.classList.contains('gv-ps-toast-open')).toBe(true);
    expect(toast.getAttribute('role')).toBe('status');
    expect(toast.textContent).toContain('Floating button hidden. Press');
    expect(toast.querySelector('kbd')?.textContent).toMatch(/^(⌥V|Alt\+V)$/);

    toast.querySelector<HTMLButtonElement>('.gv-ps-toast-undo')!.click();
    await flush();

    // The key was never stored, so undo removes it rather than writing a default.
    expect(page.memory.values.sync.has(StorageKeys.HIDE_PROMPT_MANAGER)).toBe(false);
    expect(hidden()).toBe(false);
    expect(toast.classList.contains('gv-ps-toast-open')).toBe(false);
  });

  it('puts back the value a hide replaced, by undo or the shortcut, unless changed since', async () => {
    page = installShellPage(CLAUDE);
    page.memory.values.sync.set(StorageKeys.HIDE_PROMPT_MANAGER, false);
    await page.start();
    const hide = async (): Promise<void> => {
      hover(ball());
      satellite('hide')!.click();
      await flush();
      expect(hidden()).toBe(true);
    };

    await hide();
    document.querySelector<HTMLButtonElement>('.gv-ps-toast-undo')!.click();
    await flush();
    expect(page.memory.values.sync.get(StorageKeys.HIDE_PROMPT_MANAGER)).toBe(false);
    expect(hidden()).toBe(false);

    await hide();
    pressAltV(document.body);
    await flush();
    expect(page.memory.values.sync.get(StorageKeys.HIDE_PROMPT_MANAGER)).toBe(false);
    expect(hidden()).toBe(false);

    // Shown again from the popup before undo: that choice stands.
    page.memory.values.sync.delete(StorageKeys.HIDE_PROMPT_MANAGER);
    await hide();
    page.memory.external('sync', StorageKeys.HIDE_PROMPT_MANAGER, false);
    await flush();
    document.querySelector<HTMLButtonElement>('.gv-ps-toast-undo')!.click();
    await flush();
    expect(page.memory.values.sync.get(StorageKeys.HIDE_PROMPT_MANAGER)).toBe(false);
    expect(hidden()).toBe(false);
  });

  it('names a macOS Option binding by its key in the label, the toast and aria-keyshortcuts', async () => {
    vi.spyOn(navigator, 'platform', 'get').mockReturnValue('MacIntel');
    // The service outlives the page; later tests expect the default ⌥V.
    onTestFinished(() => keyboardShortcutService.resetToDefaults());
    page = installShellPage(CLAUDE);
    page.memory.values.sync.set(StorageKeys.TIMELINE_SHORTCUTS, {
      enabled: true,
      shortcuts: {
        ...DEFAULT_KEYBOARD_SHORTCUTS,
        panelToggle: { action: 'panel:toggle', modifiers: ['Alt'], key: '∫', code: 'KeyB' },
      },
    });
    await page.start();

    hover(ball());
    hover(satellite('panel'));
    expect(label()?.querySelector('kbd')?.textContent).toBe('⌥B');
    expect(satellite('panel')?.getAttribute('aria-keyshortcuts')).toBe('Alt+B');
    satellite('hide')!.click();
    await flush();
    expect(document.querySelector('.gv-ps-toast kbd')?.textContent).toBe('⌥B');
  });

  it('brings a hidden ball back when the popup or the panel turns the entry on', async () => {
    page = installShellPage(CLAUDE);
    page.memory.values.sync.set(StorageKeys.HIDE_PROMPT_MANAGER, true);
    await page.start();
    expect(hidden()).toBe(true);
    expect(entry()?.hidden).toBe(true);

    page.memory.external('sync', StorageKeys.HIDE_PROMPT_MANAGER, false);
    await flush();

    expect(hidden()).toBe(false);
    expect(entry()?.hidden).toBe(false);
  });

  it('brings a hidden ball back when the shortcut opens the panel, which scales in on its own', async () => {
    const animations = recordAnimations();
    page = installShellPage(CLAUDE);
    page.memory.values.sync.set(StorageKeys.HIDE_PROMPT_MANAGER, true);
    await page.start();

    pressAltV(document.body);
    await flush();

    expect(panel()).not.toBeNull();
    // Hidden from elsewhere, so nothing to put back: the default returns, with no stored value.
    expect(page.memory.values.sync.has(StorageKeys.HIDE_PROMPT_MANAGER)).toBe(false);
    expect(hidden()).toBe(false);
    const open = animations.find((animation) => animation.element === panel());
    expect(open?.keyframes[0]).toMatchObject({ transform: 'scale(.94)', filter: 'blur(6px)' });
    expect(open?.options.duration).toBe(420);
  });

  it('fans the satellites toward the page interior from a ball on the left edge', async () => {
    page = installShellPage(CLAUDE);
    await page.start();
    const element = ball()!;
    // jsdom lays nothing out: place the ball in the bottom-right corner, then drag it left.
    element.getBoundingClientRect = () => rect(window.innerWidth - 64, window.innerHeight - 64);
    element.style.bottom = '18px';
    await flush();
    expect(entry()?.dataset.fanX).toBe('left');
    expect(entry()?.dataset.fanY).toBe('up');

    element.getBoundingClientRect = () => rect(12, window.innerHeight - 64);
    element.style.left = '12px';
    await flush();

    expect(entry()?.dataset.fanX).toBe('right');
    expect(entry()?.dataset.fanY).toBe('up');
    expect(entry()?.style.left).toBe('12px');
  });

  it('follows a change of Voyager’s language without a reload', async () => {
    page = installShellPage(CLAUDE);
    await page.start();
    hover(ball());
    hover(satellite('hide'));

    try {
      await setCachedLanguage('zh');
      expect(satellite('panel')?.getAttribute('aria-label')).toBe('Voyager 面板');
      expect(label()?.textContent).toBe('隐藏');
      expect(ball()?.getAttribute('aria-label')).toBe('Voyager 面板');
    } finally {
      await setCachedLanguage('en');
    }
    expect(label()?.textContent).toBe('Hide');
  });
});
