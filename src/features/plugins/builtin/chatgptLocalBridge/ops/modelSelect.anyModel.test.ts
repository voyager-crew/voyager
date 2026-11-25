// @vitest-environment jsdom
// @vitest-environment-options { "url": "https://chatgpt.com/" }
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { mountChatGptPage } from '../__tests__/chatgptPageFixture';
import { type Harness, createHarness, errorCode } from '../__tests__/harness';
import {
  EN_US,
  type LiveModelPicker,
  NOV_2026_RADIOS,
  type PickerOptions,
  mountLiveModelPicker,
} from '../__tests__/liveModelPicker';

vi.mock('@/utils/i18n', () => ({ getCurrentLanguage: vi.fn(async () => 'en') }));

/** A new chat as ChatGPT opens it since 2026-11-24: Latest, which the site data does not name. */
const LATEST = {
  ...EN_US,
  model: 'Latest',
  radios: NOV_2026_RADIOS,
  modelSelection: { at: 4, short: '6', id: 'gpt-6-pro' },
} satisfies PickerOptions;

let picker: LiveModelPicker;
let bridge: Harness;

function mount(options: PickerOptions): void {
  picker = mountLiveModelPicker(mountChatGptPage().form, options);
  bridge = createHarness();
}

async function select(params: unknown): Promise<void> {
  bridge.start('model.select', params, { deadline: Date.now() + 25_000 });
  await vi.advanceTimersByTimeAsync(10_000);
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
  const running = bridge?.runtime.runningTaskId;
  if (running) bridge.runtime.abort(running);
  vi.useRealTimers();
});

describe('Local Bridge model.select: a preset on a model the site data does not name', () => {
  it('moves Latest from Medium to Pro and proves it by the step after "6" on the trigger', async () => {
    mount({ ...LATEST, effort: 1 });
    await select({ target: { preset: 'pro' }, capturePrevious: true });

    expect(bridge.outcome()).toMatchObject({
      ok: true,
      data: {
        changed: true,
        previous: { modelId: null, modelLabel: 'Latest', effortIndex: 1, effortMax: 4 },
        observed: { modelId: null, modelLabel: 'Latest', effortIndex: 4, effortMax: 4 },
        evidence: { triggerText: '6 Pro' },
      },
    });
    expect(picker.state()).toMatchObject({ committed: 4, open: false });
  });

  it('reaches Pro on a model whose slider starts at Medium, by the step names', async () => {
    mount({
      ...EN_US,
      model: 'GPT-6.2',
      radios: NOV_2026_RADIOS,
      stepLabels: ['Medium', 'High', 'Extra High', 'Pro'],
      effort: 0,
    });
    await select({ target: { preset: 'pro' } });

    expect(bridge.outcome()).toMatchObject({
      ok: true,
      data: { observed: { modelLabel: 'GPT-6.2', effortIndex: 3, effortMax: 3 } },
    });
    expect(picker.state()).toMatchObject({ committed: 3, keydowns: 3 });
  });

  it.each([
    ['without', undefined],
    ['after', { at: 3, short: '6', id: 'gpt-6-thinking' }],
  ])(
    'does not take a trigger reverted to Extra High, %s the model name, as High',
    async (_, modelSelection) => {
      mount({ ...LATEST, modelSelection, effort: 3, discardsOnClose: true });
      await select({ target: { preset: 'high' } });

      expect(errorCode(bridge.outcome())).toBe('unverified');
      expect(details()).toMatchObject({ applied: false });
      expect(details()?.triggerText).toMatch(/Extra High$/);
    },
  );

  it('fails a Pro that Latest reverts to Medium on close', async () => {
    mount({ ...LATEST, effort: 1, discardsOnClose: true });
    await select({ target: { preset: 'pro' } });

    expect(errorCode(bridge.outcome())).toBe('unverified');
    expect(details()).toMatchObject({ applied: false, triggerText: 'Medium' });
    expect(details()).not.toHaveProperty('observed');
  });

  it('refuses Pro, without moving, on a model whose slider ends below it', async () => {
    mount({ ...LATEST, model: 'GPT-6.2', stepLabels: EN_US.stepLabels.slice(0, 4), effort: 1 });
    await select({ target: { preset: 'pro' } });

    expect(errorCode(bridge.outcome())).toBe('effort-unavailable');
    expect(details()).toMatchObject({ selected: 'GPT-6.2', valueMax: 3 });
    expect(picker.state()).toMatchObject({ keydowns: 0, open: false });
  });

  it('refuses a preset on such a model when its status names no step the site data knows', async () => {
    mount({
      ...LATEST,
      stepLabels: ['Sofort', 'Mittel', 'Hoch', 'Sehr hoch', 'Pro'],
      status: (label, position, count) => `${label}, ${position} von ${count}.`,
      effort: 1,
    });
    await select({ target: { preset: 'pro' } });

    expect(errorCode(bridge.outcome())).toBe('effort-unavailable');
    expect(picker.state()).toMatchObject({ keydowns: 0, open: false });
  });

  it.each([
    ['an effort', { mode: 'chat', model: 'gpt-6', effort: 'pro' }],
    ['a captured step', { mode: 'chat', model: 'gpt-6', effortIndex: 1 }],
  ])('keeps model-not-found for %s on a named model that is not selected', async (_, target) => {
    mount({ ...LATEST, effort: 4 });
    await select({ target });

    expect(errorCode(bridge.outcome())).toBe('model-not-found');
    expect(details()).toMatchObject({ selected: 'Latest', available: [...NOV_2026_RADIOS] });
    expect(picker.state()).toMatchObject({ keydowns: 0, effort: 4, open: false });
  });
});
