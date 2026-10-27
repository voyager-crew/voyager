import {
  COPY_IMAGE_BUTTON_TEST_ID,
  resolveResponseActionTargets,
  type ResponseActionTarget,
} from './responseActionTargets';

export type ResponseActionCopyImageOptions = {
  label: string;
  tooltip: string;
  onClick: (button: HTMLElement) => void;
};

const ACTION_BUTTON_SELECTOR = 'button, gem-icon-button, [role="button"]';

type BoundCopyImageButton = HTMLElement & {
  __gvCopyImageHandler?: (event: Event) => void;
};

function updateButtonLabelAndTooltip(
  button: HTMLElement,
  label: string,
  tooltip: string,
): HTMLElement {
  const interactive = button.matches('button')
    ? button
    : ((button.querySelector(ACTION_BUTTON_SELECTOR) as HTMLElement | null) ?? button);

  interactive.setAttribute('aria-label', tooltip);
  interactive.title = tooltip;
  interactive.removeAttribute('aria-describedby');
  button.setAttribute('aria-label', tooltip);
  button.title = tooltip;
  button.setAttribute('data-gv-copy-image-label', label);
  button.setAttribute('data-gv-inline-figure', '1');

  return interactive;
}

// The native Copy button we clone may itself be disabled at the moment we
// clone (e.g., mid-stream, before the reply finishes). Image-generation
// replies don't even have a copy-button; we fall back to cloning the
// share-image button, which on this page actually carries Material's
// `mat-mdc-button-disabled` class. The class alone sets `pointer-events: none`
// via Material CSS, so clearing only the `disabled`/`aria-disabled` attributes
// isn't enough — the button still swallows clicks (we see only a ripple, no
// handler runs) and renders dim. Strip every disabled marker Material uses.
const DISABLED_CLASSES = [
  'mat-mdc-button-disabled',
  'mdc-icon-button--disabled',
  'mat-mdc-icon-button-disabled',
  'mdc-button--disabled',
  'cdk-disabled',
  // Gemini's own gem-button family uses its own disabled marker (e.g., the
  // share-button on image responses carries it); clear it too so a cloned
  // sibling-button stays clickable.
  'gem-button-disabled',
];

function ensureButtonEnabled(button: HTMLElement, interactive: HTMLElement): void {
  for (const el of [button, interactive]) {
    el.removeAttribute('disabled');
    el.setAttribute('aria-disabled', 'false');
    if (el instanceof HTMLButtonElement) el.disabled = false;
    for (const cls of DISABLED_CLASSES) el.classList.remove(cls);
    // Defensive: a stray inline `pointer-events:none` left over from a
    // template clone would also block clicks.
    if (el.style.pointerEvents === 'none') el.style.pointerEvents = '';
  }
}

// Material Symbols "image" path (viewBox: 0 -960 960 960). Inline SVG is the
// only reliable approach for this button: the cloned native Copy icon uses
// Gemini's `lumi-symbols` font, which has no `image` glyph; switching the font
// family to Google Symbols doesn't help because that font isn't loaded on
// Gemini's page — the browser falls back to a system font and renders the
// literal letters "image", which is the broken-icon symptom from #711.
const COPY_IMAGE_SVG_PATH =
  'M200-120q-33 0-56.5-23.5T120-200v-560q0-33 23.5-56.5T200-840h560q33 0 56.5 23.5T840-760v560q0 33-23.5 56.5T760-120H200Zm0-80h560v-560H200v560Zm40-80h480L570-480 450-320l-90-120-120 160Zm-40 80v-560 560Z';
const LUMI_ICON_CLASS_PATTERN = /^lm-icon-|^lumi-/;

function updateButtonIcon(button: HTMLElement): void {
  const icon = button.querySelector('mat-icon');
  if (!(icon instanceof HTMLElement)) return;

  // Strip everything that would otherwise pull in Gemini's icon font (which
  // doesn't have the `image` glyph) and replace the content with an inline
  // SVG that inherits the surrounding `currentColor`. We deliberately do NOT
  // change mat-icon's display/vertical-align — the cloned sibling's existing
  // `gem-icon` parent already flex-centers the icon at the right size; adding
  // our own centering hacks fights that and shifts the SVG off-center.
  icon.removeAttribute('fonticon');
  icon.removeAttribute('data-mat-icon-name');
  icon.removeAttribute('data-mat-icon-namespace');
  icon.removeAttribute('data-mat-icon-type');
  Array.from(icon.classList)
    .filter((cls) => LUMI_ICON_CLASS_PATTERN.test(cls) || cls === 'mat-ligature-font')
    .forEach((cls) => icon.classList.remove(cls));
  icon.classList.add('gv-copy-image-icon');
  icon.style.fontFamily = '';
  // Standard Material practice: icons inside an icon-button should be
  // click-through so the button itself receives every click uniformly. Without
  // this, clicks on the SVG's painted area (the icon glyph) hit the SVG/icon
  // and — for reasons that vary between gem-icon-button variants — sometimes
  // get swallowed before reaching our click handler on the button. Clicks on
  // the padding around the icon still work via the touch-target overlay; the
  // user-visible symptom is "click works on the edge of the circle but not on
  // the icon itself". Setting pointer-events:none on mat-icon (and the SVG)
  // makes every pixel inside the button equally clickable.
  icon.style.pointerEvents = 'none';
  icon.setAttribute('aria-hidden', 'true');
  // SVG fills mat-icon's full box and is centered by mat-icon's parent
  // (`gem-icon` inline-flex container). `display:block` removes the inline
  // baseline gap that would otherwise nudge the glyph down a pixel.
  // `pointer-events:none` mirrors the parent — defense-in-depth in case a
  // theme override re-enables them on mat-icon.
  icon.innerHTML = `<svg viewBox="0 -960 960 960" fill="currentColor" aria-hidden="true" focusable="false" style="width: 100%; height: 100%; display: block; pointer-events: none;"><path d="${COPY_IMAGE_SVG_PATH}"/></svg>`;
}

function bindButtonClick(
  button: HTMLElement,
  interactive: HTMLElement,
  onClick: (button: HTMLElement) => void,
): void {
  const typed = button as BoundCopyImageButton;
  if (typed.__gvCopyImageHandler) {
    interactive.removeEventListener('click', typed.__gvCopyImageHandler);
  }

  const handler = (event: Event) => {
    try {
      event.preventDefault();
    } catch {}
    try {
      event.stopPropagation();
    } catch {}
    onClick(button);
  };

  typed.__gvCopyImageHandler = handler;
  interactive.addEventListener('click', handler);
}

function ensureButtonPosition(
  container: HTMLElement,
  copyImageButton: HTMLElement,
  moreButton: HTMLElement,
): void {
  if (!moreButton.parentElement) {
    if (!container.contains(copyImageButton)) container.appendChild(copyImageButton);
    return;
  }

  if (copyImageButton !== moreButton.previousElementSibling) {
    moreButton.parentElement.insertBefore(copyImageButton, moreButton);
  }
}

function injectIntoActionContainer(
  { container, moreButton, cloneSource }: ResponseActionTarget,
  options: ResponseActionCopyImageOptions,
): HTMLElement | null {
  const existing = container.querySelector<HTMLElement>(
    `[data-test-id="${COPY_IMAGE_BUTTON_TEST_ID}"]`,
  );
  if (existing) {
    const interactive = updateButtonLabelAndTooltip(existing, options.label, options.tooltip);
    ensureButtonEnabled(existing, interactive);
    updateButtonIcon(existing);
    bindButtonClick(existing, interactive, options.onClick);
    ensureButtonPosition(container, existing, moreButton);
    return existing;
  }
  if (!cloneSource) return null;

  const cloned = cloneSource.cloneNode(true) as HTMLElement;
  cloned.setAttribute('data-test-id', COPY_IMAGE_BUTTON_TEST_ID);
  cloned.removeAttribute('id');
  // Strip telemetry / framework identifiers tied to the source action
  // (jslog/jscontroller etc.) so click telemetry isn't attributed to the
  // source button.
  ['jslog', 'jscontroller', 'jsaction', 'jsname', 'aria-describedby'].forEach((attr) =>
    cloned.removeAttribute(attr),
  );

  const interactive = updateButtonLabelAndTooltip(cloned, options.label, options.tooltip);
  ensureButtonEnabled(cloned, interactive);
  updateButtonIcon(cloned);
  bindButtonClick(cloned, interactive, options.onClick);

  ensureButtonPosition(container, cloned, moreButton);
  return cloned;
}

export function injectResponseActionCopyImageButtons(
  root: ParentNode,
  options: ResponseActionCopyImageOptions,
): HTMLElement[] {
  const targets = resolveResponseActionTargets(root);
  return targets
    .map((target) => injectIntoActionContainer(target, options))
    .filter((button): button is HTMLElement => button !== null);
}

/** Remove every copy-as-image button injected under `root`. */
export function removeResponseActionCopyImageButtons(root: ParentNode = document): void {
  root
    .querySelectorAll(`[data-test-id="${COPY_IMAGE_BUTTON_TEST_ID}"]`)
    .forEach((button) => button.remove());
}
