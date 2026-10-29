/**
 * The `/` menu's entries after the prompts: "Manage prompts…" opens Prompt
 * Manager's panel and "Voyager panel…" opens the Voyager panel, each taking
 * the typed `/query` back out of the composer.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { resetPageUrl, setPageUrl } from '@/tests/pageUrl';

import { voyagerPanelOpener } from '../../panelShell/opener';
import { type PromptTrigger, mountPromptTrigger } from '../promptTrigger';
import { resolvePromptSiteAdapter } from '../resolvePromptSiteAdapter';
import { startPromptSlashCommand } from '../slashPrompt';
import {
  createContentEditable,
  createTextarea,
  press,
  prompts,
  typeInto,
  useSlashTestHarness,
} from './slashPromptTestHarness';

vi.mock('webextension-polyfill', () => ({ default: globalThis.chrome }));
vi.mock('../../changelog/index', () => ({
  hasUnreadChangelog: vi.fn(async () => false),
  showChangelogModalDirect: vi.fn(async () => true),
}));
vi.mock('../promptPrefs', () => ({
  readPromptPref: vi.fn(async (_key: string, fallback: unknown) => fallback),
  writePromptPref: vi.fn(async () => {}),
}));

const GEMINI = 'https://gemini.google.com/app';

let trigger: PromptTrigger | null = null;
let stopOpener: () => void = () => {};
let destroySlash: (() => void) | null = null;
const openPanel = vi.fn();
const openPromptManager = vi.fn();

/** The fixture composers replace the body: put the ball back beside them, then start. */
function start(): void {
  if (trigger) document.body.appendChild(trigger.element);
  destroySlash = startPromptSlashCommand({ scheme: () => 'light', initialItems: prompts }).destroy;
}

/** Replaces what the composer holds and puts the caret at its end, as typing would. */
function retype(input: HTMLElement, text: string): void {
  input.textContent = text;
  const range = document.createRange();
  range.selectNodeContents(input);
  range.collapse(false);
  window.getSelection()!.removeAllRanges();
  window.getSelection()!.addRange(range);
  typeInto(input);
}

function rows(): string[] {
  return Array.from(
    document.querySelectorAll<HTMLElement>('#gv-pm-slash-list .gv-pm-slash-option'),
    (row) => row.querySelector('.gv-pm-slash-option-name')?.textContent ?? '',
  );
}

function choose(label: string): void {
  const row = Array.from(document.querySelectorAll<HTMLElement>('.gv-pm-slash-action')).find(
    (candidate) => candidate.textContent === label,
  );
  row!.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0 }));
}

describe('slash menu entries', () => {
  useSlashTestHarness(() => {
    destroySlash?.();
    destroySlash = null;
  });

  beforeEach(async () => {
    setPageUrl(GEMINI);
    const site = resolvePromptSiteAdapter(GEMINI);
    trigger = await mountPromptTrigger({
      label: 'Prompt Manager',
      mascotLogo: false,
      hiddenByUser: false,
      attention: false,
      onAttentionChange: () => {},
      defaultSpot: (height) => site.defaultTriggerSpot(height),
    });
    trigger.enable(() => {}, openPromptManager);
    stopOpener = voyagerPanelOpener.provide(openPanel);
  });

  afterEach(() => {
    stopOpener();
    trigger?.destroy();
    trigger = null;
    openPanel.mockReset();
    openPromptManager.mockReset();
    resetPageUrl();
  });

  it('lists both entries after the prompts for a bare slash and after matching prompts', () => {
    const input = createContentEditable('/');
    start();
    typeInto(input);
    expect(rows()).toEqual(['Code Review', 'Translator', 'Manage prompts…', 'Voyager panel…']);

    retype(input, '/trans');
    expect(rows()).toEqual(['Translator', 'Manage prompts…', 'Voyager panel…']);
  });

  it('shows an entry alone when the typed name matches its label, and nothing for prose', () => {
    const input = createContentEditable('/voyager');
    start();
    typeInto(input);
    expect(rows()).toEqual(['Voyager panel…']);

    retype(input, '/usr/bin');
    expect(document.getElementById('gv-pm-slash-root')?.hidden).toBe(true);
  });

  it('opens the Voyager panel and takes the typed query back out of the composer', () => {
    const input = createTextarea('Draft /voy');
    start();
    typeInto(input);

    press(input, 'ArrowDown');
    expect(rows()).toEqual(['Voyager panel…']);
    press(input, 'Enter');

    expect(openPanel).toHaveBeenCalledTimes(1);
    expect(input.value).toBe('Draft ');
    expect(document.getElementById('gv-pm-slash-root')?.hidden).toBe(true);
  });

  it('opens Prompt Manager from "Manage prompts…" in a contenteditable composer', () => {
    const input = createContentEditable('/');
    start();
    typeInto(input);

    choose('Manage prompts…');

    expect(openPromptManager).toHaveBeenCalledTimes(1);
    expect(openPanel).not.toHaveBeenCalled();
    expect(input.textContent).toBe('');
  });

  it('offers only what can open: no "Manage prompts…" while the ball is hidden, no panel entry without the shell', () => {
    trigger!.setHiddenByUser(true);
    stopOpener();
    const input = createContentEditable('/');
    start();
    typeInto(input);

    expect(rows()).toEqual(['Code Review', 'Translator']);
  });
});
