/**
 * The chat-mode model picker as captured on chatgpt.com (zh-CN) on 2026-10-18,
 * classes stripped:
 * - the trigger sits in the composer form; pointerdown then pointerup opens
 *   it (`aria-expanded`, `data-state`), and its `aria-controls` names the
 *   menu, which renders elsewhere in the body;
 * - Voyager's own export menu is another `role=menu` on the same page;
 * - the effort slider is an `aria-hidden` `role=slider` inside the 「强度」
 *   menuitem (`data-reasoning-slider`), which takes ArrowLeft/ArrowRight one
 *   step at a time and moves `aria-valuenow` and the `role=status` text about
 *   500 ms later. A bridge tab opened in the background rendered that row
 *   without the slider inside (`sliderRendered: false`);
 * - the model radios sit in a collapsed `aria-hidden` sub-panel;
 * - Escape on the menu closes it, and only then does ChatGPT save the step
 *   (measured 2026-10-21: one PATCH of `user_last_used_model_config` on close,
 *   none while the menu is open). The saved step is account-wide.
 *
 * Knobs model what was not measured (a lower `max`, a stuck slider, another
 * name in the status) so the engine's refusals can be proven.
 */
const DEFAULT_STEP_LABELS = ['即时', '中', '高', '极高', 'Pro'];
const STEP_DELAY_MS = 500;

export interface PickerOptions {
  readonly model?: 'GPT-6' | 'GPT-5.6 Sol';
  readonly effort?: number;
  /** Status names per step; its length decides `aria-valuemax`. */
  readonly stepLabels?: readonly string[];
  /** The slider ignores the arrow keys. */
  readonly stuck?: boolean;
  /** The trigger ignores pointer events. */
  readonly opens?: boolean;
  /** Presses the trigger ignores first, as before ChatGPT hydrates a never-shown tab. */
  readonly ignoredPresses?: number;
  /** The trigger's `aria-label`; ChatGPT translates it into each UI language. */
  readonly triggerLabel?: string;
  /** ChatGPT's `data-composer-navigation-target` marker on the trigger. */
  readonly marked?: boolean;
  /** False: the row renders without its `role=slider`, as in a tab that was never shown. */
  readonly sliderRendered?: boolean;
  /** The status line for a step, as another UI language words it. */
  readonly status?: (label: string, position: number, count: number) => string;
  /** Escapes the open menu ignores, as when another layer sits above it; Infinity: all. */
  readonly escapesIgnored?: number;
  /** Closing keeps the step saved before, and the trigger names that one again. */
  readonly discardsOnClose?: boolean;
}

export interface PickerState {
  readonly model: string;
  /** The slider's step. */
  readonly effort: number;
  /** The step ChatGPT saved: the slider's, taken only as the menu closes. */
  readonly committed: number;
  readonly open: boolean;
  readonly pointerdowns: number;
  readonly keydowns: number;
  /** Arrow keys that arrived while an earlier step had not landed yet. */
  readonly overlapping: number;
}

export interface LiveModelPicker {
  readonly trigger: HTMLButtonElement;
  state(): PickerState;
}

const TRIGGER_ID = 'radix-_r_a1_';
const MENU_ID = 'radix-_r_a2_';

function zhStatus(label: string, position: number, count: number): string {
  return `${label}，第 ${position} 项，共 ${count} 项。`;
}

/** Mount the picker into `form` (the composer's), plus Voyager's own menu as a decoy. */
export function mountLiveModelPicker(
  form: HTMLFormElement,
  options: PickerOptions = {},
): LiveModelPicker {
  const labels = options.stepLabels ?? DEFAULT_STEP_LABELS;
  const statusText = (names: readonly string[], index: number): string =>
    (options.status ?? zhStatus)(names[index], index + 1, names.length);
  const model = options.model ?? 'GPT-6';
  let effort = options.effort ?? labels.length - 1;
  let committed = effort;
  let escapesIgnored = options.escapesIgnored ?? 0;
  let pointerdowns = 0;
  let keydowns = 0;
  let overlapping = 0;
  let pending = false;
  let pressed = false;
  let menu: HTMLElement | null = null;

  const decoy = document.createElement('div');
  decoy.setAttribute('role', 'menu');
  decoy.className = 'gv-export-menu';
  decoy.innerHTML = '<div role="menuitem">JSON</div><div role="menuitem">Markdown</div>';
  document.body.prepend(decoy);

  const trigger = document.createElement('button');
  trigger.type = 'button';
  trigger.id = TRIGGER_ID;
  trigger.setAttribute('aria-label', options.triggerLabel ?? '选择 ChatGPT 模型');
  if (options.marked !== false) {
    trigger.setAttribute('data-composer-navigation-target', 'reasoning');
  }
  trigger.setAttribute('aria-haspopup', 'menu');
  trigger.setAttribute('aria-expanded', 'false');
  trigger.setAttribute('data-state', 'closed');
  const paintTrigger = (): void => {
    trigger.innerHTML = `<span><span aria-hidden="true"><span>思考强度</span></span><span><span><span>${labels[effort]}</span></span></span></span><svg aria-hidden="true"></svg>`;
  };
  paintTrigger();
  form.appendChild(trigger);

  const close = (): void => {
    menu?.remove();
    menu = null;
    if (options.discardsOnClose) effort = committed;
    else committed = effort;
    paintTrigger();
    trigger.setAttribute('aria-expanded', 'false');
    trigger.setAttribute('data-state', 'closed');
    trigger.removeAttribute('aria-controls');
  };

  const open = (): void => {
    menu = document.createElement('div');
    menu.setAttribute('role', 'menu');
    menu.id = MENU_ID;
    menu.setAttribute('aria-labelledby', TRIGGER_ID);
    menu.setAttribute('data-state', 'open');
    menu.innerHTML = `
      <div role="menuitem" aria-label="选择模型"><span>${labels[effort]}</span></div>
      <span aria-live="polite" role="status">${statusText(labels, effort)}</span>
      <span>使用左右方向键调整强度</span>
      <div role="menuitem" aria-keyshortcuts="ArrowLeft ArrowRight" aria-label="强度" data-reasoning-slider="true">
        ${
          options.sliderRendered === false
            ? '<span></span>'
            : `<canvas></canvas>
        <span role="slider" aria-valuemin="0" aria-valuemax="${labels.length - 1}" aria-valuenow="${effort}" aria-hidden="true" tabindex="-1"></span>`
        }
      </div>
      <div aria-hidden="true">
        <span>已锁定，打开访问权限选项</span>
        <div role="menuitemradio" aria-checked="${model === 'GPT-6'}"><span>GPT-6</span></div>
        <div role="menuitemradio" aria-checked="${model === 'GPT-5.6 Sol'}"><span>GPT-5.6 Sol</span></div>
      </div>`;
    const current = menu;
    const item = current.querySelector<HTMLElement>('[aria-label="强度"]')!;
    item.addEventListener('keydown', (event) => {
      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
      keydowns += 1;
      if (pending) overlapping += 1;
      if (options.stuck) return;
      pending = true;
      const delta = event.key === 'ArrowRight' ? 1 : -1;
      setTimeout(() => {
        pending = false;
        effort = Math.min(labels.length - 1, Math.max(0, effort + delta));
        current.querySelector('[role="slider"]')?.setAttribute('aria-valuenow', String(effort));
        current.querySelector('[role="status"]')!.textContent = statusText(labels, effort);
        paintTrigger();
      }, STEP_DELAY_MS);
    });
    current.addEventListener('keydown', (event) => {
      if (event.key !== 'Escape') return;
      if (escapesIgnored > 0) escapesIgnored -= 1;
      else close();
    });
    document.body.appendChild(current);
    trigger.setAttribute('aria-expanded', 'true');
    trigger.setAttribute('data-state', 'open');
    trigger.setAttribute('aria-controls', MENU_ID);
  };

  trigger.addEventListener('pointerdown', (event) => {
    pointerdowns += 1;
    pressed =
      options.opens !== false && pointerdowns > (options.ignoredPresses ?? 0) && event.button === 0;
  });
  trigger.addEventListener('pointerup', () => {
    if (!pressed) return;
    pressed = false;
    if (menu) close();
    else open();
  });

  return {
    trigger,
    state: () => ({
      model,
      effort,
      committed,
      open: menu !== null,
      pointerdowns,
      keydowns,
      overlapping,
    }),
  };
}
