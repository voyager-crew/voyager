/**
 * The DOM side of template variables: the in-place fill surface, and the chips
 * that let a saved prompt advertise itself as a template.
 *
 * Filling happens before the text reaches the composer. On the panel path that
 * means before insertion; on the slash path it means before the token expands
 * at send time. Either way the body never sits in the composer as editable text
 * with holes in it, so nothing here has to track a caret through an IME
 * composition or Gemini's own input handling.
 *
 * Takes its strings and callbacks explicitly. It holds no reference back to the
 * prompt manager, and owns the teardown of everything it binds.
 */

import {
  TEMPLATE_VARIABLE_SOURCE,
  fillPromptTemplate,
  parsePromptTemplate,
} from '@/features/prompt/model/promptTemplate';

export interface TemplateFillLabels {
  /** Button that inserts the resolved text. */
  insert: string;
  /** Button that inserts the body untouched, placeholders and all. */
  keepRaw: string;
  /** Describes what the surface is for, read by screen readers. */
  title: string;
}

export interface TemplateFillOptions {
  /** The prompt body, still containing its `{{name}}` placeholders. */
  text: string;
  /** User-authored prompt name, shown as the surface's heading when present. */
  name?: string;
  /** Element the surface is positioned against. */
  anchor: HTMLElement;
  /** `data-gv-theme` value copied from the panel so the surface matches it. */
  theme: string;
  labels: TemplateFillLabels;
  /** Receives the body with the supplied values substituted. */
  onSubmit: (filled: string) => void;
  onCancel?: () => void;
  /** The owner's teardown also releases a submitted fill's trailing-keystroke listeners. */
  signal?: AbortSignal;
}

export interface TemplateFillHandle {
  close: () => void;
  /** Test seam: the live inputs, in document order. */
  readonly slots: HTMLElement[];
}

const SURFACE_CLASS = 'gv-pm-fill';
const SLOT_CLASS = 'gv-pm-slot';
const VAR_CLASS = 'gv-pm-var';

/** Built from the parser's own pattern so the two cannot disagree. */
const VARIABLE_IN_TEXT = new RegExp(TEMPLATE_VARIABLE_SOURCE, 'gu');

/**
 * Replace `{{name}}` runs inside rendered markup with chips, so a prompt shows
 * in the list that it is a template and where its variables sit. Walks text
 * nodes only: the markup around them was already sanitised, and this must not
 * reinterpret it.
 */
export function highlightTemplateVariables(root: HTMLElement): void {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const targets: Text[] = [];
  let node: Node | null;
  while ((node = walker.nextNode()) !== null) {
    const text = node as Text;
    VARIABLE_IN_TEXT.lastIndex = 0;
    if (VARIABLE_IN_TEXT.test(text.data)) targets.push(text);
  }

  for (const text of targets) {
    const fragment = document.createDocumentFragment();
    let cursor = 0;
    VARIABLE_IN_TEXT.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = VARIABLE_IN_TEXT.exec(text.data)) !== null) {
      if (match.index > cursor) {
        fragment.append(text.data.slice(cursor, match.index));
      }
      const chip = document.createElement('span');
      chip.className = VAR_CLASS;
      chip.textContent = match[1];
      fragment.append(chip);
      cursor = match.index + match[0].length;
    }
    if (cursor < text.data.length) fragment.append(text.data.slice(cursor));
    text.replaceWith(fragment);
  }
}

/**
 * Open the fill surface for `text`. Returns a handle whose `close` tears down
 * every listener it bound; calling it twice is safe.
 */
export function openTemplateFill(options: TemplateFillOptions): TemplateFillHandle {
  const { text, name, anchor, theme, labels, onSubmit, onCancel } = options;

  const surface = document.createElement('div');
  surface.className = SURFACE_CLASS;
  surface.setAttribute('role', 'dialog');
  surface.setAttribute('aria-label', labels.title);
  surface.setAttribute('data-gv-theme', theme);

  if (name && name.trim()) {
    const heading = document.createElement('div');
    heading.className = 'gv-pm-fill-title';
    heading.textContent = name.trim();
    surface.appendChild(heading);
  }

  const doc = document.createElement('div');
  doc.className = 'gv-pm-fill-doc';

  const slots: HTMLElement[] = [];
  for (const segment of parsePromptTemplate(text)) {
    if (segment.kind === 'text') {
      doc.append(segment.value);
      continue;
    }
    // An editable span rather than an `<input>`. An input cannot wrap, so a
    // long value grew the slot past the surface that holds it - measured on
    // gemini.google.com, a 45-character value made a 465px slot inside a 460px
    // card, which then scrolled sideways and clipped its own text. A span flows
    // with the sentence it sits in, and needs no width of its own.
    const slot = document.createElement('span');
    slot.className = SLOT_CLASS;
    slot.setAttribute('contenteditable', 'true');
    slot.setAttribute('role', 'textbox');
    slot.setAttribute('aria-label', segment.name);
    slot.dataset.gvVar = segment.name;
    slot.dataset.gvPlaceholder = segment.name;
    doc.appendChild(slot);
    slots.push(slot);
  }
  surface.appendChild(doc);

  const actions = document.createElement('div');
  actions.className = 'gv-pm-fill-actions';
  const keepRaw = document.createElement('button');
  keepRaw.type = 'button';
  keepRaw.className = 'gv-pm-cancel';
  keepRaw.textContent = labels.keepRaw;
  const submit = document.createElement('button');
  submit.type = 'button';
  submit.className = 'gv-pm-save';
  submit.textContent = labels.insert;
  actions.append(keepRaw, submit);
  surface.appendChild(actions);

  const readValues = (): Record<string, string> => {
    // Null-prototype: a placeholder may legitimately be named `constructor`,
    // `toString` or `__proto__`, and on a plain object those read back as
    // inherited non-strings - the `.trim()` below then threw and took the whole
    // fill surface down before the prompt could be inserted.
    const values: Record<string, string> = Object.create(null);
    for (const slot of slots) {
      const key = slot.dataset.gvVar;
      if (!key) continue;
      // A repeated name is one question; the first slot carrying a value wins.
      if (!values[key] || !values[key].trim()) values[key] = slot.textContent ?? '';
    }
    return values;
  };

  let closed = false;

  function close(): void {
    if (closed) return;
    closed = true;
    window.removeEventListener('pointerdown', onOutsidePointerDown, true);
    window.removeEventListener('keydown', onKeyDown, true);
    surface.remove();
  }

  function commit(filled: string): void {
    close();
    onSubmit(filled);
  }

  function cancel(): void {
    close();
    onCancel?.();
  }

  /**
   * The composer takes focus the moment this surface commits, so anything left
   * of the physical keypress lands there instead. `preventDefault` on the
   * keydown suppresses `keypress` but never `keyup`, and Gemini sends on a bare
   * Enter - so the trailing half of the very keystroke that filled the template
   * would send the message the user had not finished reviewing. Swallow the
   * rest of this keystroke, then stand down on the next task.
   */
  function swallowRestOfKeystroke(): void {
    const swallow = (event: Event): void => {
      if ((event as KeyboardEvent).key !== 'Enter') return;
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
    };
    window.addEventListener('keyup', swallow, true);
    window.addEventListener('keypress', swallow, true);
    function release(): void {
      window.clearTimeout(timer);
      window.removeEventListener('keyup', swallow, true);
      window.removeEventListener('keypress', swallow, true);
      options.signal?.removeEventListener('abort', release);
    }
    const timer = window.setTimeout(release, 0);
    // Submission closes the card, but only owner teardown may end its same-task Enter guard early.
    options.signal?.addEventListener('abort', release, { once: true });
  }

  function onKeyDown(event: KeyboardEvent): void {
    if (!surface.isConnected) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      cancel();
      return;
    }
    // Enter commits from anywhere inside the surface. Shift+Enter is left alone
    // so a slot can still hold a newline if the user pastes one.
    if (event.key === 'Enter' && !event.shiftKey && surface.contains(event.target as Node)) {
      // An IME sends Enter to accept its candidate list, which is the common
      // way to type a CJK value into a slot. Committing there would submit a
      // half-typed word and hand the rest of the keystroke to the composer.
      // `isSendKeyboardEvent` guards the send path the same way.
      if (event.isComposing || event.keyCode === 229) return;
      event.preventDefault();
      event.stopPropagation();
      // Nothing else may act on this keystroke: `stopPropagation` alone still
      // lets another window-level capture listener run.
      event.stopImmediatePropagation();
      swallowRestOfKeystroke();
      commit(fillPromptTemplate(text, readValues()));
    }
  }

  function onOutsidePointerDown(event: PointerEvent): void {
    if (!surface.isConnected) return;
    if (surface.contains(event.target as Node)) return;
    cancel();
  }

  // Typing in one slot fills every slot that shares its name, so a repeated
  // variable stays one question rather than several.
  doc.addEventListener('input', (event) => {
    const slot = event.target as HTMLElement | null;
    const key = slot?.dataset?.gvVar;
    if (!slot || !key) return;
    for (const peer of slots) {
      if (peer === slot || peer.dataset.gvVar !== key) continue;
      peer.textContent = slot.textContent;
    }
  });

  // A span keeps whatever markup a paste carries; an input never did.
  doc.addEventListener('paste', (event) => {
    const slot = (event.target as HTMLElement | null)?.closest?.(`.${SLOT_CLASS}`);
    if (!slot) return;
    event.preventDefault();
    const plain = (event as ClipboardEvent).clipboardData?.getData('text/plain') ?? '';
    document.execCommand('insertText', false, plain.replace(/\s+/g, ' '));
  });

  submit.addEventListener('click', () => commit(fillPromptTemplate(text, readValues())));
  keepRaw.addEventListener('click', () => commit(text));

  window.addEventListener('pointerdown', onOutsidePointerDown, true);
  window.addEventListener('keydown', onKeyDown, true);

  document.body.appendChild(surface);
  positionAgainst(surface, anchor);
  slots[0]?.focus();

  return {
    close,
    get slots() {
      return slots;
    },
  };
}

/**
 * Prefer sitting over the anchor, fall back below when that would clip. Mirrors
 * the hover preview so the two floating surfaces behave the same way.
 */
function positionAgainst(surface: HTMLElement, anchor: HTMLElement): void {
  const pad = 8;
  const anchorRect = anchor.getBoundingClientRect();
  const rect = surface.getBoundingClientRect();
  const vw = window.innerWidth;
  const vh = window.innerHeight;

  let left = anchorRect.left;
  if (left + rect.width > vw - pad) left = vw - pad - rect.width;
  if (left < pad) left = pad;

  let top = anchorRect.top - rect.height - 6;
  if (top < pad) {
    top = anchorRect.bottom + 6;
    if (top + rect.height > vh - pad) top = Math.max(pad, vh - pad - rect.height);
  }

  surface.style.left = `${Math.round(left)}px`;
  surface.style.top = `${Math.round(top)}px`;
}
