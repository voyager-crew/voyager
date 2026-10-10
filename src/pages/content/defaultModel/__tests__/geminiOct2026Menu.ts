import { vi } from 'vitest';

// Sanitized capture of gemini.google.com's model menu (October 2026). The CDK
// overlay now renders as a `popover="manual"` element next to the trigger
// instead of under `.cdk-overlay-container`; thinking strength is three inline
// rows sharing the jslog id 323336; jslog metadata is base64-encoded.

export const OCT_2026_MODEL_IDS = {
  flashLite: '8c46e95b1a07cecc',
  flash: '56fdd199312815e2',
  pro: 'e6fa609c3fa255c0',
} as const;

/** `BardVeMetadataKey` payload as Gemini now encodes it. */
export function encodeJslogMetadata(entry: unknown[]): string {
  return btoa(JSON.stringify([...Array<null>(22).fill(null), entry]));
}

type RowSpec = { label: string; sublabel: string; selected?: boolean };

function buildRow(
  spec: RowSpec,
  attrs: Record<string, string>,
): HTMLElement & { click: ReturnType<typeof vi.fn> } {
  const item = document.createElement('gem-menu-item');
  for (const [name, value] of Object.entries(attrs)) item.setAttribute(name, value);
  item.setAttribute('role', 'menuitem');
  item.setAttribute('tabindex', '-1');
  item.setAttribute('aria-haspopup', 'false');
  item.setAttribute('aria-disabled', 'false');
  if (spec.selected) item.classList.add('selected');
  item.innerHTML = `
    <gem-menu-item-content class="checkmark-only${spec.selected ? ' selected' : ''}">
      <div class="leading-container">${
        spec.selected ? '<gem-icon aria-label="Selected"></gem-icon>' : ''
      }</div>
      <div class="label-container">
        <span class="label"> ${spec.label} </span>
        <div class="sublabel">${spec.sublabel}</div>
      </div>
      <div class="trailing-container"></div>
    </gem-menu-item-content>
  `;
  item.click = vi.fn();
  return item as HTMLElement & { click: ReturnType<typeof vi.fn> };
}

export function buildOct2026Trigger(pillText = 'Flash') {
  const switcher = document.createElement('bard-mode-switcher');
  const pillContainer = document.createElement('div');
  pillContainer.className = 'pill-ui-logo-container gem-menu-redesign under-input';
  const trigger = document.createElement('button');
  trigger.setAttribute('data-test-id', 'bard-mode-menu-button');
  trigger.setAttribute('aria-haspopup', 'true');
  trigger.setAttribute('aria-expanded', 'false');
  trigger.setAttribute('aria-controls', 'ng-menu-oct2026-1');
  trigger.setAttribute('aria-label', `Open mode picker, currently ${pillText}`);
  trigger.className = 'mdc-button mat-mdc-button-base input-area-switch mat-mdc-button';
  trigger.innerHTML = `
    <span class="mdc-button__label">
      <div data-test-id="logo-pill-label-container" class="logo-pill-label-container input-area-switch-label">
        <span class="gds-body-m picker-primary-text">${pillText}</span>
        <gem-icon fonticonname="keyboard_arrow_down" class="dropdown-icon"></gem-icon>
      </div>
    </span>
  `;
  const click = vi.fn();
  trigger.click = click;
  pillContainer.appendChild(trigger);
  switcher.appendChild(pillContainer);
  document.body.appendChild(switcher);
  return { switcher, pillContainer, trigger: Object.assign(trigger, { click }) };
}

export function buildOct2026Menu(
  host: HTMLElement,
  options: { selectedModel?: keyof typeof OCT_2026_MODEL_IDS; selectedLevel?: number } = {},
) {
  const { selectedModel = 'flash', selectedLevel = 0 } = options;
  const modelFor = OCT_2026_MODEL_IDS[selectedModel];

  const popover = document.createElement('div');
  popover.setAttribute('popover', 'manual');
  popover.className = 'cdk-overlay-popover cdk-overlay-connected-position-bounding-box';
  const pane = document.createElement('div');
  pane.id = 'cdk-overlay-0';
  pane.className = 'cdk-overlay-pane';
  const container = document.createElement('div');
  container.className = 'container';
  const popoverMenu = document.createElement('div');
  popoverMenu.className = 'popover-menu';
  popoverMenu.setAttribute('data-test-id', 'bard-mode-desktop-gem-menu');
  const menu = document.createElement('gem-menu');
  menu.id = 'ng-menu-oct2026-1';
  menu.setAttribute('role', 'menu');
  menu.setAttribute('data-test-id', 'gem-mode-menu');
  menu.setAttribute('jslog', '306026;track:impression');

  const modelRow = (key: keyof typeof OCT_2026_MODEL_IDS, label: string, sublabel: string) =>
    buildRow(
      { label, sublabel, selected: key === selectedModel },
      {
        'data-mode-id': OCT_2026_MODEL_IDS[key],
        'data-test-id': `bard-mode-option-${OCT_2026_MODEL_IDS[key]}`,
        jslog: `242569;track:generic_click,impression;BardVeMetadataKey:${encodeJslogMetadata([
          OCT_2026_MODEL_IDS[key],
        ])}`,
      },
    );

  const flashLite = modelRow('flashLite', '3.5 Flash-Lite', 'Fastest answers');
  const flash = modelRow('flash', '3.8 Flash', 'All-around help');
  const pro = modelRow('pro', '3.1 Pro', 'Advanced reasoning');

  const divider = document.createElement('mat-divider');
  divider.setAttribute('role', 'separator');

  // Level codes observed in the jslog payload: Low = 1, Medium = 4, High = 2.
  const levelRow = (index: number, label: string, sublabel: string, code: number) =>
    buildRow(
      { label, sublabel, selected: index === selectedLevel },
      {
        jslog: `323336;track:generic_click,impression;BardVeMetadataKey:${encodeJslogMetadata([
          modelFor,
          code,
          1,
        ])}`,
      },
    );
  const low = levelRow(0, 'Low', 'Quick and efficient', 1);
  const medium = levelRow(1, 'Medium', 'Balanced depth', 4);
  const high = levelRow(2, 'High', 'Extra thorough', 2);

  menu.append(flashLite, flash, pro, divider, low, medium, high);
  popoverMenu.appendChild(menu);
  container.appendChild(popoverMenu);
  pane.appendChild(container);
  popover.appendChild(pane);
  host.appendChild(popover);

  return { popover, pane, menu, flashLite, flash, pro, low, medium, high };
}

/** Trigger plus a menu that mounts beside it when clicked, as Gemini does now. */
export function mountOct2026Picker(
  pillText: string,
  options: Parameters<typeof buildOct2026Menu>[1] = {},
) {
  const { pillContainer, trigger } = buildOct2026Trigger(pillText);
  const rows = buildOct2026Menu(pillContainer, options);
  // Closed until the trigger is clicked; the same rows re-mount on every open.
  rows.popover.remove();
  trigger.click.mockImplementation(() => {
    if (!rows.popover.isConnected) pillContainer.appendChild(rows.popover);
    trigger.setAttribute('aria-expanded', 'true');
  });
  return { trigger, rows };
}
