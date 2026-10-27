// @vitest-environment jsdom
// @vitest-environment-options { "url": "https://chatgpt.com/" }
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { initializeSiteSelectors, type SiteSelectorLifetime } from '@/core/selectors';
import { chatgptAdapter } from '@/features/plugins/sites/adapters/chatgpt';

import {
  type ChatGptPageFixture,
  type PageOptions,
  mountChatGptPage,
} from '../__tests__/chatgptPageFixture';
import { type Harness, createHarness, errorCode } from '../__tests__/harness';
import {
  type LiveModelPicker,
  type PickerOptions,
  mountLiveModelPicker,
} from '../__tests__/liveModelPicker';
import { throttleChainedTimers } from '../__tests__/throttledTimers';
import type { WakeCounts } from '../wake';

vi.mock('@/utils/i18n', () => ({ getCurrentLanguage: vi.fn(async () => 'en') }));

let page: ChatGptPageFixture;
let picker: LiveModelPicker;
let bridge: Harness;
let locatorLifetime: SiteSelectorLifetime | undefined;

function mount(options: PickerOptions = {}, pageOptions: PageOptions = {}): void {
  page = mountChatGptPage(pageOptions);
  picker = mountLiveModelPicker(page.form, options);
  bridge = createHarness();
}

async function select(params: unknown, ms = 10_000): Promise<void> {
  bridge.start('model.select', params, { deadline: Date.now() + 25_000 });
  await vi.advanceTimersByTimeAsync(ms);
}

function details(): Record<string, unknown> | undefined {
  const outcome = bridge.outcome();
  return outcome && !outcome.ok ? outcome.error.details : undefined;
}

beforeEach(() => {
  vi.useFakeTimers();
  Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
});

afterEach(() => {
  locatorLifetime?.stop();
  const running = bridge?.runtime.runningTaskId;
  if (running) bridge.runtime.abort(running);
  vi.useRealTimers();
});

describe('Local Bridge model.select: reaching an effort', () => {
  it('moves GPT-6 from 中 to Pro one step at a time and closes the menu', async () => {
    mount({ effort: 1 });
    await select({ target: { preset: 'pro' }, capturePrevious: true });

    expect(bridge.outcome()).toMatchObject({
      ok: true,
      data: {
        changed: true,
        previous: { modelId: 'gpt-6', modelLabel: 'GPT-6', effortIndex: 1, effortMax: 4 },
        observed: { modelId: 'gpt-6', modelLabel: 'GPT-6', effortIndex: 4, effortMax: 4 },
      },
    });
    expect(picker.state()).toMatchObject({
      committed: 4,
      open: false,
      keydowns: 3,
      overlapping: 0,
    });
  });

  it("selects the model in a tab hidden for minutes, waking on the page's own changes instead of a timer", async () => {
    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
    const clock = throttleChainedTimers();
    try {
      page = mountChatGptPage();
      picker = mountLiveModelPicker(page.form, { effort: 1 });
      bridge = createHarness(undefined, chatgptAdapter, clock.defer);
      bridge.start(
        'model.select',
        { target: { preset: 'pro' } },
        { deadline: Date.now() + 25_000 },
      );
      await clock.advance(10_000);
    } finally {
      clock.restore();
    }

    const outcome = bridge.outcome();
    expect(outcome).toMatchObject({
      ok: true,
      data: { observed: { effortIndex: 4 }, evidence: { hidden: true } },
    });
    const { evidence } = (outcome?.ok ? outcome.data : {}) as { evidence?: { wakes: WakeCounts } };
    expect(evidence?.wakes.mutation).toBeGreaterThan(0);
    expect(picker.state()).toMatchObject({ effort: 4, open: false, overlapping: 0 });
  });

  it('waits for a picker that renders after the composer in a freshly opened tab', async () => {
    page = mountChatGptPage();
    bridge = createHarness();
    bridge.start('model.select', { target: { preset: 'pro' } }, { deadline: Date.now() + 25_000 });
    await vi.advanceTimersByTimeAsync(1_500);
    picker = mountLiveModelPicker(page.form, { effort: 2 });
    await vi.advanceTimersByTimeAsync(10_000);

    expect(bridge.outcome()).toMatchObject({ ok: true, data: { observed: { effortIndex: 4 } } });
  });

  it('finds its menu through the trigger although Voyager has a menu of its own on the page', async () => {
    mount({ effort: 0 });
    await select({ target: { preset: 'high' } });

    expect(bridge.outcome()).toMatchObject({ ok: true, data: { observed: { effortIndex: 2 } } });
    expect(picker.state().effort).toBe(2);
  });

  it('only opens and closes the menu when the page already shows the target', async () => {
    mount({ effort: 4 });
    await select({ target: { preset: 'pro' }, capturePrevious: true });

    expect(bridge.outcome()).toMatchObject({
      ok: true,
      data: { changed: false, previous: { effortIndex: 4 }, observed: { effortIndex: 4 } },
    });
    expect(picker.state()).toMatchObject({ pointerdowns: 1, keydowns: 0, open: false });
  });

  it('restores a captured effort index', async () => {
    mount({ effort: 4 });
    await select({ target: { mode: 'chat', model: 'gpt-6', effortIndex: 1 } });

    expect(bridge.outcome()).toMatchObject({
      ok: true,
      data: { changed: true, observed: { effortIndex: 1 } },
    });
    expect(picker.state()).toMatchObject({ effort: 1, open: false, keydowns: 3 });
  });
});

describe('Local Bridge model.select: UI languages the site data does not name', () => {
  const german = {
    triggerLabel: 'ChatGPT-Modell auswählen',
    stepLabels: ['Instant', 'Mittel', 'Hoch', 'Sehr hoch', 'Pro'],
    status: (label: string, position: number, count: number) =>
      `${label}, ${position} von ${count}.`,
  };

  it('reaches Pro on a German page by the trigger marker and the slider position', async () => {
    mount({ ...german, effort: 1 });
    await select({ target: { preset: 'pro' } });

    expect(bridge.outcome()).toMatchObject({
      ok: true,
      data: { changed: true, observed: { modelId: 'gpt-6', effortIndex: 4 } },
    });
    expect(picker.state().open).toBe(false);
  });

  it('takes extra-high by position although the page names it Sehr hoch', async () => {
    mount({ ...german, effort: 4 });
    await select({ target: { preset: 'extra-high' } });

    expect(bridge.outcome()).toMatchObject({ ok: true, data: { observed: { effortIndex: 3 } } });
  });

  it('reaches Pro in a tab that never rendered the effort slider, by its row and status', async () => {
    mount({ effort: 1, sliderRendered: false });
    await select({ target: { preset: 'pro' } });

    expect(bridge.outcome()).toMatchObject({
      ok: true,
      data: { changed: true, observed: { effortIndex: 4 } },
    });
    expect(picker.state()).toMatchObject({ effort: 4, open: false });
  });

  it('reaches Pro without the slider on a page whose status puts the count first', async () => {
    mount({
      ...german,
      effort: 1,
      sliderRendered: false,
      status: (label, position, count) => `${label}: ${count} Stufen, Stufe ${position}`,
    });
    await select({ target: { preset: 'pro' } });

    expect(bridge.outcome()).toMatchObject({ ok: true, data: { observed: { effortIndex: 4 } } });
  });

  it('still finds a trigger without the marker by its label', async () => {
    mount({ marked: false, effort: 1 });
    await select({ target: { preset: 'pro' } });

    expect(bridge.outcome()).toMatchObject({ ok: true, data: { observed: { effortIndex: 4 } } });
  });

  it('a renamed picker still applies Pro through its native accessible name and menu', async () => {
    mount({ ...german, marked: false, effort: 1 });
    picker.trigger.setAttribute('data-composer-picker', 'reasoning');
    picker.trigger.removeAttribute('aria-label');
    picker.trigger.setAttribute('aria-labelledby', 'model-label');
    page.form.insertAdjacentHTML('beforeend', '<span id="model-label">Select ChatGPT model</span>');
    locatorLifetime = initializeSiteSelectors('chatgpt', {
      host: 'chatgpt.com',
      doc: document,
      lifetime: new AbortController().signal,
      bundledRevision: 1,
      read: async () => ({
        id: 'chatgpt',
        catalogRevision: 2,
        pageHooks: {
          modelPickerTrigger: '[data-composer-picker="reasoning"]',
        },
      }),
    });
    await locatorLifetime.ready;
    await select({ target: { preset: 'pro' } });

    expect(bridge.outcome()).toMatchObject({ ok: true, data: { observed: { effortIndex: 4 } } });
    expect(picker.state()).toMatchObject({ effort: 4, open: false, pointerdowns: 1 });
  });

  it('finds no trigger when it carries neither the marker nor a known label', async () => {
    mount({ ...german, marked: false });
    await select({ target: { preset: 'pro' } });

    expect(errorCode(bridge.outcome())).toBe('selector-missing');
    expect(picker.state().pointerdowns).toBe(0);
  });
});

describe('Local Bridge model.select: a remounted composer', () => {
  it('opens the menu with the model button mounted anew after the route was rewritten', async () => {
    // The old button takes the press but is replaced before it opens anything, as when
    // `/c/<id>` moves to its project route and ChatGPT mounts the composer again.
    mount({ effort: 1, opens: false });
    let fresh: LiveModelPicker | null = null;
    picker.trigger.addEventListener('pointerdown', () => {
      setTimeout(() => {
        const form = page.form.cloneNode(true) as HTMLFormElement;
        form.querySelector('[aria-haspopup="menu"]')?.remove();
        page.form.replaceWith(form);
        fresh = mountLiveModelPicker(form, { effort: 1 });
      }, 300);
    });
    await select({ target: { preset: 'pro' } });

    expect(bridge.outcome()).toMatchObject({
      ok: true,
      data: { observed: { modelId: 'gpt-6', effortIndex: 4 } },
    });
    expect(fresh!.state()).toMatchObject({ effort: 4, open: false, pointerdowns: 1 });
  });

  it('still fails menu-not-found when the one button there never opens', async () => {
    mount({ effort: 1, opens: false });
    await select({ target: { preset: 'pro' } });

    expect(errorCode(bridge.outcome())).toBe('menu-not-found');
    expect(picker.state().pointerdowns).toBe(1);
  });

  it.each([
    ['hides the old one', 'hide'],
    ['removes the old one', 'remove'],
  ] as const)(
    'does not report Pro as applied when ChatGPT mounts the composer anew and %s with its menu open',
    async (_name, how) => {
      mount({ effort: 3 });
      let fresh: LiveModelPicker | null = null;
      const listening = new AbortController();
      document.addEventListener(
        'keydown',
        (event) => {
          if (event.key !== 'ArrowRight') return;
          // After the step lands: ChatGPT keeps an old page hidden, or drops it with its menu.
          setTimeout(() => {
            const old = page.form;
            const form = old.cloneNode(true) as HTMLFormElement;
            form.querySelector('[aria-haspopup="menu"]')?.remove();
            old.after(form);
            if (how === 'hide') old.style.setProperty('display', 'none', 'important');
            else {
              document.getElementById(picker.trigger.getAttribute('aria-controls')!)?.remove();
              old.remove();
            }
            fresh = mountLiveModelPicker(form, { effort: 3 });
          }, 500);
        },
        { signal: listening.signal },
      );
      await select({ target: { preset: 'pro' } });
      listening.abort();

      expect(errorCode(bridge.outcome())).toBe('unverified');
      expect(details()).toMatchObject({
        applied: false,
        menu: 'gone',
        previous: { effortIndex: 3 },
      });
      expect(details()).not.toHaveProperty('observed');
      expect(picker.state().committed).toBe(3);
      expect(fresh!.state()).toMatchObject({ committed: 3, pointerdowns: 0 });
    },
  );
});

describe('Local Bridge model.select: closing the menu', () => {
  it('does not report the requested effort as applied when the model menu never closes', async () => {
    mount({ effort: 0, escapesIgnored: Infinity });
    await select({ target: { preset: 'pro' }, capturePrevious: true });

    expect(errorCode(bridge.outcome())).toBe('unverified');
    expect(details()).toMatchObject({
      applied: false,
      menu: 'open',
      partial: true,
      previous: { effortIndex: 0 },
    });
    expect(details()).not.toHaveProperty('observed');
    expect(picker.state()).toMatchObject({ effort: 4, committed: 0, open: true });
  });

  it('closes the menu with a second Escape when a layer above it took the first', async () => {
    mount({ effort: 0, escapesIgnored: 1 });
    await select({ target: { preset: 'pro' } });

    expect(bridge.outcome()).toMatchObject({ ok: true, data: { observed: { effortIndex: 4 } } });
    expect(picker.state()).toMatchObject({ committed: 4, open: false });
  });

  it('fails when the closed picker still names the step it had before', async () => {
    mount({ effort: 0, discardsOnClose: true });
    await select({ target: { preset: 'pro' } });

    expect(errorCode(bridge.outcome())).toBe('unverified');
    expect(details()).toMatchObject({ applied: false, triggerText: '即时' });
    expect(details()).not.toHaveProperty('observed');
  });

  it('does not report Pro as applied when a German picker reverts to Sofort on close', async () => {
    // Neither "Sofort" nor the German status template is in the site data.
    mount({
      triggerLabel: 'ChatGPT-Modell auswählen',
      stepLabels: ['Sofort', 'Mittel', 'Hoch', 'Sehr hoch', 'Pro'],
      status: (label, position, count) => `${label}, ${position} von ${count}.`,
      effort: 0,
      discardsOnClose: true,
    });
    await select({ target: { preset: 'pro' } });

    expect(errorCode(bridge.outcome())).toBe('unverified');
    expect(details()).toMatchObject({ applied: false, triggerText: 'Sofort' });
    expect(details()).not.toHaveProperty('observed');
    expect(picker.state().committed).toBe(0);
  });
});

describe('Local Bridge model.select: refusals', () => {
  it('restores a captured effort although the page names that step in English', async () => {
    mount({ effort: 4, stepLabels: ['即时', '中', 'Higher', '极高', 'Pro'] });
    await select({ target: { mode: 'chat', model: 'gpt-6', effortIndex: 2 } });

    expect(bridge.outcome()).toMatchObject({ ok: true, data: { observed: { effortIndex: 2 } } });
  });

  it('takes Extra High, as the page names 极高 in English, for the extra-high preset', async () => {
    mount({ effort: 4, stepLabels: ['即时', '中', 'High', 'Extra High', 'Pro'] });
    await select({ target: { preset: 'extra-high' } });

    expect(bridge.outcome()).toMatchObject({ ok: true, data: { observed: { effortIndex: 3 } } });
  });

  it('does not restore onto a step the status names as another one', async () => {
    mount({ effort: 4, stepLabels: ['即时', '中', '极高', '极高', 'Pro'] });
    await select({ target: { mode: 'chat', model: 'gpt-6', effortIndex: 2 } });

    expect(errorCode(bridge.outcome())).toBe('effort-unavailable');
  });

  it('refuses Pro as effort-unavailable when the slider ends below it, without moving it', async () => {
    mount({ effort: 3, stepLabels: ['即时', '中', '高', '极高'] });
    await select({ target: { preset: 'pro' } });

    expect(errorCode(bridge.outcome())).toBe('effort-unavailable');
    expect(details()).toMatchObject({ available: ['极高'] });
    expect(picker.state()).toMatchObject({ effort: 3, keydowns: 0, open: false });
  });

  it('does not settle for Pro when the status names that step as another one', async () => {
    mount({ effort: 3, stepLabels: ['即时', '中', '高', '极高', '极高'] });
    await select({ target: { preset: 'pro' } });

    expect(errorCode(bridge.outcome())).toBe('effort-unavailable');
    expect(details()).toMatchObject({ available: ['极高'] });
    expect(picker.state().open).toBe(false);
  });

  it('stops after one key press when the slider does not move', async () => {
    mount({ effort: 1, stuck: true });
    await select({ target: { preset: 'pro' } });

    expect(errorCode(bridge.outcome())).toBe('unverified');
    expect(picker.state()).toMatchObject({ keydowns: 1, open: false });
  });

  it('reports model-not-found with the radio labels when another model is selected', async () => {
    mount({ model: 'GPT-5.6 Sol' });
    await select({ target: { preset: 'pro' } });

    expect(errorCode(bridge.outcome())).toBe('model-not-found');
    expect(details()).toMatchObject({
      available: ['GPT-6', 'GPT-5.6 Sol'],
      selected: 'GPT-5.6 Sol',
    });
    expect(picker.state()).toMatchObject({ keydowns: 0, open: false });
  });

  it('fails menu-not-found when the trigger does not open its menu', async () => {
    mount({ opens: false });
    await select({ target: { preset: 'pro' } });

    expect(errorCode(bridge.outcome())).toBe('menu-not-found');
    expect(picker.state().keydowns).toBe(0);
  });

  it.each([
    ['work', 'mode-unavailable'],
    ['unknown', 'mode-unknown'],
  ] as const)('never opens the menu on a page in %s mode', async (mode, code) => {
    mount({}, mode === 'work' ? { mode: 'work' } : {});
    if (mode === 'unknown') page.composer.setAttribute('aria-label', 'Ask anything');
    await select({ target: { preset: 'pro' } });

    expect(errorCode(bridge.outcome())).toBe(code);
    expect(picker.state().pointerdowns).toBe(0);
  });

  it('answers unsupported-data without touching the page when the site has no picker data', async () => {
    mount({ effort: 1 });
    bridge.runtime.attach({ ...chatgptAdapter, modelPicker: undefined });
    await select({ target: { preset: 'pro' } });

    expect(errorCode(bridge.outcome())).toBe('unsupported-data');
    expect(picker.state().pointerdowns).toBe(0);
  });

  it('refuses a preset the site data does not define before opening the menu', async () => {
    mount();
    await select({ target: { preset: 'ultra' } });

    expect(errorCode(bridge.outcome())).toBe('bad-request');
    expect(details()).toMatchObject({ presets: expect.arrayContaining(['pro', 'instant']) });
    expect(picker.state().pointerdowns).toBe(0);
  });
});
