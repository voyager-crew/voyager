/**
 * Turn the `:kbd:` and `:switch:` markers in the rendered changelog into a key
 * cap in the reader's notation and a working setting switch. Built from DOM
 * nodes, like the platform marks, so the sanitiser's allow-list stays as it is.
 *
 * A marker in inline code or a code block stays as written: that is how a note
 * shows the marker syntax itself.
 */
import { logger } from '@/core/services/LoggerService';

import { createSettingSwitch } from './settingSwitch';
import { SHORTCUT_MARKER, formatShortcut, parseShortcut } from './shortcutMarks';
import { SWITCH_MARKER, switchTargetFor, switchTargetName } from './switchTargets';

export interface ChangelogMarkOptions {
  /** The reader's system, from the shared `isMac()`. */
  readonly mac: boolean;
  /** The note's language, for each switch's label. */
  readonly lang: string;
  /** What a switch does, in the reader's language (`changelog_switch_hint`). */
  readonly switchHint: string;
}

const ANY_MARKER_SOURCE = `${SHORTCUT_MARKER.source}|${SWITCH_MARKER.source}`;
const ANY_MARKER = new RegExp(ANY_MARKER_SOURCE, 'g');
/** Stateless, unlike the global one: `test` on a global regex moves its `lastIndex`. */
const HAS_MARKER = new RegExp(ANY_MARKER_SOURCE);

function inCode(node: Node): boolean {
  return Boolean(node.parentElement?.closest('code, pre'));
}

function shortcutNode(doc: Document, spec: string, mac: boolean): Node {
  const shortcut = parseShortcut(spec);
  if (!shortcut) {
    logger.warn('changelog: unknown shortcut marker', { spec });
    return doc.createTextNode(spec);
  }
  const kbd = doc.createElement('kbd');
  kbd.className = 'gv-changelog-kbd';
  kbd.textContent = formatShortcut(shortcut, mac ? 'mac' : 'other');
  return kbd;
}

/**
 * Replace every marker under `root` in place. Returns the teardown for the
 * switches' storage listeners; the viewer runs it when it closes.
 */
export function renderChangelogMarks(root: HTMLElement, options: ChangelogMarkOptions): () => void {
  const doc = root.ownerDocument;
  const disposers: Array<() => void> = [];

  const switchNode = (id: string): Node => {
    const target = switchTargetFor(id);
    // Not on the allow-list: never a control, only the id as text (a test fails such a note).
    if (!target) {
      logger.warn('changelog: switch marker for an unlisted target', { id });
      return doc.createTextNode(id);
    }
    const name = switchTargetName(target, options.lang);
    const control = createSettingSwitch(doc, id, { name, hint: options.switchHint });
    if (!control) return doc.createTextNode(name);
    disposers.push(control.dispose);
    return control.element;
  };

  const walker = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const pending: Text[] = [];
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (node instanceof Text && !inCode(node) && HAS_MARKER.test(node.data)) pending.push(node);
  }
  // Collected first: replacing a node while walking invalidates the walker.
  for (const text of pending) {
    const value = text.data;
    const fragment = doc.createDocumentFragment();
    let cursor = 0;
    for (const match of value.matchAll(ANY_MARKER)) {
      if (match.index > cursor) fragment.append(value.slice(cursor, match.index));
      const [, shortcutSpec, switchId] = match;
      fragment.append(
        shortcutSpec !== undefined
          ? shortcutNode(doc, shortcutSpec, options.mac)
          : switchNode(switchId),
      );
      cursor = match.index + match[0].length;
    }
    if (cursor < value.length) fragment.append(value.slice(cursor));
    text.replaceWith(fragment);
  }

  return () => {
    for (const dispose of disposers.splice(0)) dispose();
  };
}
