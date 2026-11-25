/**
 * The `model.select` engine (spec §3.4, measured on chatgpt.com 2026-10-18):
 * open the picker, read what is selected, step the effort slider to the
 * target, verify, close. Every page event goes through the op context's
 * doors, and only after the menu is confirmed open.
 *
 * - Open: pointerdown + pointerup on the trigger (a bare `click()` does not
 *   always open it), then the trigger must say `aria-expanded=true` and its
 *   `aria-controls` must name a `role=menu`.
 * - Effort: one ArrowLeft/ArrowRight keydown on the focused slider at a time,
 *   waiting for `aria-valuenow` to change before the next. Keys sent in a
 *   burst once hung the page for 45 s. At most `max + 1` presses.
 * - Verify: the target model's radio is checked, the slider has as many steps
 *   as the site data, `aria-valuenow` is the target step, and the status does
 *   not name another step. Step names come from ChatGPT's servers, not the UI
 *   language (measured: a zh-CN page showing "Extra High"), so an unknown name
 *   or an unreadable status is fine. A target the page does not offer is
 *   `effort-unavailable`; nothing settles for a nearby step.
 * - A preset names a step, not a model (`stepTarget.ts`): it lands on that
 *   step of whatever model is selected, by name where the site data has not
 *   measured that model's steps. Switching the model itself was not measured
 *   (the radios sit in a collapsed sub-panel), so a target naming another
 *   model than the selected one is `model-not-found`.
 * - Close: Escape on the menu, confirmed by the trigger, and once more if the
 *   menu stays open. ChatGPT saves the choice only as the menu closes
 *   (measured 2026-10-21: one PATCH of `user_last_used_model_config` on close,
 *   none while the menu is open, none when the composer goes away with it), so
 *   a menu that never closed, or whose trigger went away, applied nothing. The
 *   closed trigger's step (`triggerStep`) must then name the target. A failure
 *   with the menu still open first steps the slider back to where it was, so it
 *   never closes (and saves) on another step.
 */
import type { ModelSelectResult, ModelSelection } from '@/features/bridge/protocol';
import {
  GRANT_MARGIN_MS,
  type OpContext,
} from '@/features/plugins/builtin/chatgptLocalBridge/opContext';
import type { ModelPickerSection } from '@/features/plugins/sites/sections/modelPickerData';
import { isRendered } from '@/pages/content/export/adapter/chatgptThread';

import {
  type PickerReading,
  findOpenMenu,
  findTrigger,
  mergedLabels,
  readPicker,
  triggerStep,
  triggerText,
} from './pickerDom';
import { type PageGoal, type ResolvedTarget, goalOnPage } from './stepTarget';

const OPEN_TIMEOUT_MS = 3_000;
/** Presses before the menu counts as not opening; the first can land before hydration. */
const OPEN_PRESSES = 3;
/** A step lands about 500 ms after its key press (measured). */
const STEP_TIMEOUT_MS = 2_500;
const TRIGGER_TIMEOUT_MS = 5_000;
const STATUS_TIMEOUT_MS = 1_500;
const CLOSE_TIMEOUT_MS = 1_500;
/** Radix dismisses only its topmost layer on Escape: anything stacked over the menu takes one. */
const CLOSE_ATTEMPTS = 2;
/** The least gap between two looks at the picker; a step lands about 500 ms after its key. */
const MIN_GAP_MS = 100;

/** What is left of the grant for page work, never more than `cap`. */
function budget(ctx: OpContext, cap: number): number {
  return Math.max(0, Math.min(cap, ctx.grant.deadline - GRANT_MARGIN_MS - ctx.now()));
}

function modelIdOf(data: ModelPickerSection, label: string): string | null {
  for (const [id, model] of Object.entries(data.models)) {
    if (mergedLabels(model.labels).has(label)) return id;
  }
  return null;
}

function selectionOf(data: ModelPickerSection, reading: PickerReading): ModelSelection {
  const checked = reading.radios.filter((radio) => radio.checked);
  const label = checked.length === 1 ? checked[0].label : '';
  return {
    modelId: label ? modelIdOf(data, label) : null,
    modelLabel: label,
    effortIndex: reading.slider?.now ?? null,
    effortMax: reading.slider?.max ?? null,
  };
}

function pointer(type: 'pointerdown' | 'pointerup'): PointerEvent {
  return new PointerEvent(type, {
    bubbles: true,
    cancelable: true,
    composed: true,
    pointerType: 'mouse',
    isPrimary: true,
    button: 0,
    buttons: type === 'pointerdown' ? 1 : 0,
  });
}

function key(name: 'ArrowLeft' | 'ArrowRight' | 'Escape'): KeyboardEvent {
  return new KeyboardEvent('keydown', { key: name, code: name, bubbles: true, cancelable: true });
}

export async function selectModel(
  ctx: OpContext,
  data: ModelPickerSection,
  target: ResolvedTarget,
  /** Where the trigger sits, read afresh: the composer may be mounted anew meanwhile. */
  scopeOf: () => ParentNode,
  triggerMarker?: string,
  effortControl?: string,
): Promise<Omit<ModelSelectResult, 'previous'> & { previous: ModelSelection }> {
  const awaitTrigger = (): Promise<HTMLElement | null> =>
    ctx.waitFor(() => findTrigger(scopeOf(), data, triggerMarker), {
      timeoutMs: budget(ctx, TRIGGER_TIMEOUT_MS),
      minGapMs: MIN_GAP_MS,
    });
  /** Whether `button` is no longer the page's trigger (removed, or another took its place). */
  const replaced = (button: HTMLElement): boolean => {
    if (!button.isConnected) return true;
    const current = findTrigger(scopeOf(), data, triggerMarker);
    return current !== null && current !== button;
  };
  const openWith = async (button: HTMLElement): Promise<HTMLElement | 'replaced' | null> => {
    const shown = findOpenMenu(button);
    if (shown) return shown;
    // A never-shown tab renders the trigger before ChatGPT hydrates it, and a press then
    // opens nothing (measured live 2026-10-31): press again while it stays closed.
    for (let press = 0; press < OPEN_PRESSES; press++) {
      // No time left to see a press land: one now would open the menu after the op gave up.
      if (press > 0 && budget(ctx, OPEN_TIMEOUT_MS) === 0) break;
      if (button.getAttribute('aria-expanded') !== 'true') {
        ctx.dispatch(button, pointer('pointerdown'));
        ctx.dispatch(button, pointer('pointerup'));
      }
      const outcome = await ctx.waitFor(
        () => findOpenMenu(button) ?? (replaced(button) ? 'replaced' : null),
        { timeoutMs: budget(ctx, OPEN_TIMEOUT_MS), minGapMs: MIN_GAP_MS },
      );
      if (outcome !== null) return outcome;
    }
    return null;
  };

  // A fresh tab renders the picker after the composer that made it ready (measured live).
  let trigger = await awaitTrigger();
  if (!trigger) ctx.fail('selector-missing', 'The ChatGPT model picker was not found.');
  let menu = await openWith(trigger);
  // Opening `/c/<id>` of a project chat moves to its project route and mounts the composer
  // anew: events on the old trigger open nothing. Press the new one, once.
  if (menu === 'replaced' || (menu === null && replaced(trigger))) {
    const again = await awaitTrigger();
    if (!again) ctx.fail('selector-missing', 'The ChatGPT model picker was not found.');
    trigger = again;
    menu = await openWith(trigger);
  }
  if (menu === null || menu === 'replaced') {
    ctx.fail('menu-not-found', 'The ChatGPT model menu did not open.', {
      expanded: trigger.getAttribute('aria-expanded'),
      remounted: menu === 'replaced',
    });
  }
  const openMenu = menu;
  const menuTrigger = trigger;

  let changed = false;
  const seenLabels: string[] = [];
  const read = (): PickerReading => {
    const reading = readPicker(openMenu, data, effortControl);
    const label = reading.status.label;
    if (label && !seenLabels.includes(label)) seenLabels.push(label);
    return reading;
  };

  /**
   * `gone`: the trigger was removed or hidden with its menu open, as when ChatGPT mounts the
   * composer anew. A detached menu is not a closed one: ChatGPT saved nothing through it.
   */
  const menuState = (): 'open' | 'closed' | 'gone' => {
    if (!isRendered(menuTrigger)) return 'gone';
    return menuTrigger.getAttribute('aria-expanded') === 'true' ? 'open' : 'closed';
  };
  const close = async (): Promise<'open' | 'closed' | 'gone'> => {
    for (let attempt = 0; attempt < CLOSE_ATTEMPTS && menuState() === 'open'; attempt += 1) {
      ctx.dispatch(findOpenMenu(menuTrigger) ?? openMenu, key('Escape'));
      await ctx.waitFor(() => menuState() !== 'open', {
        timeoutMs: budget(ctx, CLOSE_TIMEOUT_MS),
        minGapMs: MIN_GAP_MS,
      });
    }
    return menuState();
  };

  const before = read();
  const previous = selectionOf(data, before);
  let steps = 0;
  /** One arrow key on the slider, then its new step; null when it did not move. */
  const stepOnce = async (direction: -1 | 1): Promise<number | null> => {
    const current = readPicker(openMenu, data, effortControl).slider;
    if (!current) return null;
    ctx.guard();
    current.element.focus();
    ctx.dispatch(current.element, key(direction > 0 ? 'ArrowRight' : 'ArrowLeft'));
    steps += 1;
    changed = true;
    const from = current.now;
    const moved = await ctx.waitFor(
      () => {
        const value = read().slider?.now;
        return value !== undefined && value !== from ? { value } : null;
      },
      { timeoutMs: budget(ctx, STEP_TIMEOUT_MS), minGapMs: MIN_GAP_MS },
    );
    return moved?.value ?? null;
  };
  /**
   * Back to the step the menu opened on: ChatGPT saves the slider's step as the menu
   * closes, so a failed select must not close it on another step.
   */
  const restore = async (): Promise<boolean> => {
    const original = before.slider?.now;
    if (original === undefined) return false;
    for (let press = 0; press <= (before.slider?.max ?? 0) + 1; press += 1) {
      const now = readPicker(openMenu, data, effortControl).slider?.now;
      if (now === undefined) return false;
      if (now === original) return true;
      if ((await stepOnce(original > now ? 1 : -1)) === null) return false;
    }
    return readPicker(openMenu, data, effortControl).slider?.now === original;
  };
  const failClosed = async (
    code: Parameters<OpContext['fail']>[0],
    message: string,
    details: Readonly<Record<string, unknown>> = {},
  ): Promise<never> => {
    const restored = changed && menuState() === 'open' ? await restore() : null;
    await close();
    return ctx.fail(code, message, {
      ...details,
      previous,
      partial: changed && restored !== true,
      ...(restored === null ? {} : { restored }),
      statusText: readPicker(openMenu, data, effortControl).status.text,
    });
  };

  const checked = before.radios.filter((radio) => radio.checked);
  const radioLabels = before.radios.map((radio) => radio.label);
  if (checked.length !== 1) {
    await failClosed('selector-missing', 'No single model is selected in the ChatGPT menu.', {
      available: radioLabels,
    });
  }
  const selectedLabel = checked[0].label;
  if (
    target.kind === 'model' &&
    !mergedLabels(data.models[target.modelId].labels).has(selectedLabel)
  ) {
    await failClosed(
      'model-not-found',
      `ChatGPT has ${selectedLabel} selected; switching models is not supported yet.`,
      { available: radioLabels, selected: selectedLabel },
    );
  }

  /** The status at the target step, confirmed while the menu was open. */
  let targetStatus: PickerReading['status'] | null = null;
  let place: PageGoal | null = null;
  if (target.kind === 'step' || target.effortIndex !== null) {
    const slider = before.slider;
    place = slider
      ? goalOnPage(data, target, modelIdOf(data, selectedLabel), slider, before.status.label)
      : null;
    if (!slider || !place) {
      await failClosed('effort-unavailable', 'ChatGPT does not offer the requested effort.', {
        available: seenLabels,
        valueMax: slider?.max ?? null,
        selected: selectedLabel,
      });
    }
    const { named } = place!;
    let now = slider!.now;
    const stuck = (from: number): Promise<never> =>
      failClosed('unverified', 'The effort slider did not move after a key press.', {
        valueNow: from,
        steps,
      });
    if (place!.kind === 'index') {
      const { goal } = place!;
      while (now !== goal) {
        if (steps > slider!.max) {
          await failClosed('unverified', 'The effort slider did not reach the requested step.');
        }
        now = (await stepOnce(goal > now ? 1 : -1)) ?? (await stuck(now));
      }
    } else {
      // Walk by name: each step's status must name it before the next key press.
      const { direction, rank, target: goalRank } = place!;
      let label = before.status.label!;
      while (!named(label)) {
        const at = rank(label);
        const next = now + direction;
        if (at < 0 || (at - goalRank) * direction > 0 || next < 0 || next > slider!.max) {
          await failClosed('effort-unavailable', 'ChatGPT does not offer the requested effort.', {
            available: seenLabels,
            valueMax: slider!.max,
            selected: selectedLabel,
          });
        }
        now = (await stepOnce(direction)) ?? (await stuck(now));
        const from = label;
        const reached = now;
        const status = await ctx.waitFor(
          () => {
            const shown = read().status;
            const fresh =
              shown.label !== null &&
              shown.label !== from &&
              (shown.position === null || shown.position === reached + 1);
            return fresh ? shown : null;
          },
          { timeoutMs: budget(ctx, STATUS_TIMEOUT_MS), minGapMs: MIN_GAP_MS },
        );
        if (!status) {
          await failClosed('effort-unavailable', 'ChatGPT does not name the requested effort.', {
            available: seenLabels,
            valueNow: now,
          });
        }
        label = status!.label!;
      }
    }
    const goal = now;

    const confirmed = await ctx.waitFor(
      () => {
        const reading = read();
        const status = reading.status;
        const ok =
          reading.slider?.now === goal &&
          named(status.label) &&
          (status.position === null || status.position === goal + 1);
        return ok ? reading : null;
      },
      { timeoutMs: budget(ctx, STATUS_TIMEOUT_MS), minGapMs: MIN_GAP_MS },
    );
    if (!confirmed) {
      await failClosed('effort-unavailable', 'ChatGPT does not name the requested effort.', {
        available: seenLabels,
        valueNow: read().slider?.now ?? null,
      });
    }
    targetStatus = confirmed!.status;
  }

  const after = read();
  const observed = selectionOf(data, after);
  const nowSelected = after.radios.filter((radio) => radio.checked);
  if (nowSelected.length !== 1 || nowSelected[0].label !== selectedLabel) {
    await failClosed('unverified', 'The model selection changed while it was being set.', {
      shown: observed,
    });
  }
  // What the open menu showed is no selection until the menu closes: a failure from here on
  // carries `applied: false`, and no failure carries `observed`, which reads as applied.
  const notApplied = { applied: false, partial: changed, previous, statusText: after.status.text };
  const closed = await close();
  if (closed !== 'closed') {
    ctx.fail(
      'unverified',
      closed === 'open'
        ? 'The ChatGPT model menu did not close.'
        : 'The ChatGPT model picker went away before its menu closed.',
      { ...notApplied, menu: closed },
    );
  }
  let shown = triggerText(menuTrigger);
  if (place && targetStatus) {
    const status = targetStatus;
    const { labels, named } = place;
    // No slider backs the closed trigger, so a name is proof only as the step the status named
    // at the target: a revert to a name the data lacks ("Sofort") must not pass as unknown.
    const names = (text: string): boolean =>
      text !== '' &&
      named(text) &&
      (status.label ? text === status.label || labels.has(text) : status.text.includes(text));
    // The closed trigger names the saved step; it may repaint a moment after `aria-expanded`.
    const settled = await ctx.waitFor(
      () => {
        const text = triggerStep(menuTrigger);
        return names(text) ? { text: triggerText(menuTrigger) } : null;
      },
      { timeoutMs: budget(ctx, STATUS_TIMEOUT_MS), minGapMs: MIN_GAP_MS },
    );
    if (!settled) {
      ctx.fail('unverified', 'ChatGPT does not name the requested effort after its menu closed.', {
        ...notApplied,
        triggerText: triggerText(menuTrigger),
      });
    }
    shown = settled.text;
  }
  const evidence = { statusText: after.status.text, seenLabels, steps, triggerText: shown };
  return { changed, previous, observed, evidence };
}
