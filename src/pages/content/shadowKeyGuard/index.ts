/**
 * Keeps keys typed into a Voyager shadow surface away from the host page.
 *
 * A page listener sees a shadow host, not the field inside it, as the key's
 * target, and `document.activeElement` is the host too. A page "type anywhere to
 * focus the prompt" or single-key shortcut therefore takes keystrokes meant for a
 * Voyager panel field. A listener inside the shadow root can stop page listeners
 * in the bubble phase only; a page listener on `window` in the capture phase runs
 * before anything in the shadow tree.
 *
 * This guard listens on `window` in the capture phase. It must be registered
 * before the page's own listeners, so it is installed from a `document_start`
 * entry. For a key from a text field or tree/menu in a marked surface it stops
 * propagation and replays a non-composed copy on the origin: the copy runs the
 * panel's own handlers (Enter, Escape) and stops at the shadow root. Browser
 * defaults remain intact unless a handler cancels the copy, which cancels the
 * original too. Widget Tab and Escape stay composed for document-level focus and
 * dismissal handlers; text fields keep their existing boundary for every key.
 *
 * Firefox's `KeyboardEvent` constructor ignores `composed: false` (a keydown
 * stays composed). Replaying that event hits this guard again and never reaches
 * the field, so Enter in a folder name does nothing. A plain `Event` does honor
 * `composed`, and the field only reads the key fields copied onto it.
 */

/** Host attribute that marks a shadow surface whose fields and widgets are protected. */
export const SHADOW_SURFACE_ATTR = 'data-gv-shadow-surface';

const KEY_EVENTS = ['keydown', 'keypress', 'keyup'] as const;
const WIDGET_SELECTOR =
  '[role="tree"], [role="treeitem"], [role="menu"], [role="menuitem"], [role="menuitemradio"], [role="menuitemcheckbox"], .gv-floating-folder-panel__tree-row';

function isTextField(node: EventTarget | undefined): boolean {
  return (
    node instanceof HTMLInputElement ||
    node instanceof HTMLTextAreaElement ||
    (node instanceof HTMLElement && node.isContentEditable)
  );
}

function isInMarkedSurface(field: HTMLElement): boolean {
  const root = field.getRootNode();
  return root instanceof ShadowRoot && root.host.hasAttribute(SHADOW_SURFACE_ATTR);
}

function keyboardInit(event: KeyboardEvent): KeyboardEventInit {
  return {
    key: event.key,
    code: event.code,
    location: event.location,
    repeat: event.repeat,
    isComposing: event.isComposing,
    ctrlKey: event.ctrlKey,
    shiftKey: event.shiftKey,
    altKey: event.altKey,
    metaKey: event.metaKey,
    keyCode: event.keyCode,
    charCode: event.charCode,
    bubbles: true,
    cancelable: true,
    // Not composed: the copy stops at the shadow root and never reaches the page.
    composed: false,
  };
}

/** Key fields a panel handler reads. A plain Event has none of them. */
const KEY_FIELDS = [
  'key',
  'code',
  'location',
  'repeat',
  'isComposing',
  'ctrlKey',
  'shiftKey',
  'altKey',
  'metaKey',
  'keyCode',
  'charCode',
  'which',
] as const;

function copyInsideShadow(event: KeyboardEvent): Event {
  const keyboard = new KeyboardEvent(event.type, keyboardInit(event));
  // Firefox ignores composed:false on KeyboardEvent, so this copy would re-enter
  // the guard and the rename field would never see Enter.
  if (!keyboard.composed) return keyboard;
  const copy = new Event(event.type, { bubbles: true, cancelable: true, composed: false });
  for (const name of KEY_FIELDS) {
    Object.defineProperty(copy, name, { value: event[name] });
  }
  Object.defineProperty(copy, 'getModifierState', {
    value: (key: string) => event.getModifierState(key),
  });
  return copy;
}

/** Install the guard on `win`; the returned function removes it. */
export function installShadowKeyGuard(win: Window = window): () => void {
  // Set while a copy is being dispatched, so a composed replay cannot re-enter.
  let replaying = false;
  const guard = (event: Event) => {
    if (!(event instanceof KeyboardEvent) || replaying) return;
    const origin = event.composedPath()[0];
    if (!(origin instanceof HTMLElement) || !isInMarkedSurface(origin)) return;
    if (
      !isTextField(origin) &&
      (event.key === 'Tab' || event.key === 'Escape' || !origin.closest(WIDGET_SELECTOR))
    )
      return;
    event.stopImmediatePropagation();
    const copy = copyInsideShadow(event);
    replaying = true;
    try {
      origin.dispatchEvent(copy);
    } finally {
      replaying = false;
    }
    if (copy.defaultPrevented) event.preventDefault();
  };
  for (const type of KEY_EVENTS) win.addEventListener(type, guard, true);
  return () => {
    for (const type of KEY_EVENTS) win.removeEventListener(type, guard, true);
  };
}
