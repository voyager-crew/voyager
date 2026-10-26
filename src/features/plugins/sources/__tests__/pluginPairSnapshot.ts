/**
 * Page snapshots for the plugin pair matrix (`pluginPairMatrix.ts`), and how
 * two of them differ.
 *
 * Pages are compared through `pageSnapshot`, which normalizes only what is not
 * observable to the page or to CSS:
 *  - class tokens are sorted and deduplicated, and an emptied `class` counts
 *    as absent (`classList.remove` of the last token leaves `class=""`);
 *  - inline style is compared as its sorted declarations, since declaration
 *    order depends on which plugin wrote first;
 *  - the engine's one-time base stylesheet and the shared KaTeX stylesheet
 *    (`core/utils/katexStyles.ts`) are skipped: both persist by design;
 *  - stylesheet text is reduced to a hash and length to keep diffs readable;
 *  - per-mount generated identifiers (`crypto.randomUUID()` instance classes,
 *    `*-owner` claim tokens with a serial and a random suffix) become numbered
 *    placeholders in order of appearance, so two elements sharing one id
 *    still compare as sharing it.
 * Attribute presence is otherwise strict (`style=""` versus no attribute
 * counts), text field values are included, and open shadow roots are walked.
 */
import { PLUGIN_BASE_STYLE_ID } from '../../constants';

function hash(text: string): string {
  let value = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    value ^= text.charCodeAt(i);
    value = Math.imul(value, 0x01000193);
  }
  return (value >>> 0).toString(16).padStart(8, '0');
}

/** Shared stylesheets kept for the document's lifetime by design, whoever added them first. */
const DOCUMENT_LIFETIME_IDS: ReadonlySet<string> = new Set([
  PLUGIN_BASE_STYLE_ID,
  'gv-katex-styles',
]);

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g;

/** Numbers generated identifiers by first appearance within one snapshot. */
class GeneratedIds {
  private readonly seen = new Map<string, string>();

  private placeholder(kind: string, raw: string): string {
    let name = this.seen.get(raw);
    if (name === undefined) {
      name = `<${kind}#${this.seen.size + 1}>`;
      this.seen.set(raw, name);
    }
    return name;
  }

  text(value: string): string {
    return value.replace(UUID, (raw) => this.placeholder('uuid', raw));
  }

  attribute(name: string, value: string): string {
    return name.endsWith('-owner') ? this.placeholder('owner', value) : this.text(value);
  }
}

function attributeText(el: Element, ids: GeneratedIds): string {
  const parts: string[] = [];
  const attributes = Array.from(el.attributes).sort((a, b) => a.name.localeCompare(b.name));
  for (const attribute of attributes) {
    if (attribute.name === 'class') {
      const tokens = [...new Set(ids.text(attribute.value).split(/\s+/).filter(Boolean))].sort();
      if (tokens.length > 0) parts.push(`class="${tokens.join(' ')}"`);
    } else if (attribute.name === 'style' && el instanceof HTMLElement) {
      const declarations: string[] = [];
      for (let i = 0; i < el.style.length; i += 1) {
        const prop = el.style.item(i);
        const priority = el.style.getPropertyPriority(prop);
        const value = ids.text(el.style.getPropertyValue(prop));
        declarations.push(`${prop}: ${value}${priority ? ' !' + priority : ''}`);
      }
      parts.push(`style="${declarations.sort().join('; ')}"`);
    } else {
      parts.push(
        `${attribute.name}=${JSON.stringify(ids.attribute(attribute.name, attribute.value))}`,
      );
    }
  }
  if (el instanceof HTMLTextAreaElement || el instanceof HTMLInputElement) {
    parts.push(`:value=${JSON.stringify(el.value)}`);
  }
  return parts.join(' ');
}

function serialize(node: Node, depth: number, out: string[], ids: GeneratedIds): void {
  const pad = '  '.repeat(depth);
  if (node.nodeType === Node.TEXT_NODE) {
    out.push(pad + JSON.stringify(ids.text(node.textContent ?? '')));
    return;
  }
  if (node.nodeType === Node.COMMENT_NODE) {
    out.push(`${pad}<!--${node.textContent ?? ''}-->`);
    return;
  }
  if (!(node instanceof Element) || DOCUMENT_LIFETIME_IDS.has(node.id)) return;
  const attributes = attributeText(node, ids);
  out.push(`${pad}<${node.localName}${attributes ? ' ' + attributes : ''}>`);
  if (node instanceof HTMLStyleElement) {
    const css = ids.text(node.textContent ?? '');
    out.push(`${pad}  css#${hash(css)} (${css.length} chars)`);
    return;
  }
  if (node.shadowRoot) {
    out.push(`${pad}  #shadow-root`);
    for (const child of node.shadowRoot.childNodes) serialize(child, depth + 2, out, ids);
  }
  for (const child of node.childNodes) serialize(child, depth + 1, out, ids);
}

/** The whole document, normalized as the module comment describes; one node per line. */
export function pageSnapshot(): string {
  const out: string[] = [];
  serialize(document.documentElement, 0, out, new GeneratedIds());
  return out.join('\n');
}

function clip(line: string): string {
  const text = line.trim();
  return text.length > 140 ? text.slice(0, 137) + '...' : text;
}

/** The nearest enclosing element line of `lines[index]`, by indentation. */
function parentLine(lines: readonly string[], index: number): string {
  const depth = lines[index].length - lines[index].trimStart().length;
  for (let i = index - 1; i >= 0; i -= 1) {
    if (lines[i].length - lines[i].trimStart().length < depth) return lines[i];
  }
  return '(document)';
}

/** Whether the snapshots hold the same nodes and differ only in `<head>` child order. */
export function onlyStylesheetOrder(a: string, b: string): boolean {
  const left = a.split('\n');
  const right = b.split('\n');
  if ([...left].sort().join('\n') !== [...right].sort().join('\n')) return false;
  const body = (lines: string[]) => lines.slice(lines.findIndex((line) => line === '  <body>'));
  return body(left).join('\n') === body(right).join('\n');
}

/** A compact account of how two snapshots differ: new nodes, or only sibling order. */
export function describeDifference(a: string, b: string, limit = 3): string {
  const left = a.split('\n');
  const right = b.split('\n');
  const rightSet = new Set(right);
  const leftSet = new Set(left);
  const onlyLeft = left.filter((line) => !rightSet.has(line)).map((line) => `- ${clip(line)}`);
  const onlyRight = right.filter((line) => !leftSet.has(line)).map((line) => `+ ${clip(line)}`);
  if (onlyLeft.length > 0 || onlyRight.length > 0) {
    return [...onlyLeft.slice(0, limit), ...onlyRight.slice(0, limit)]
      .map((line) => `    ${line}`)
      .join('\n');
  }
  const at = left.findIndex((line, index) => line !== right[index]);
  return `    sibling order under ${clip(parentLine(left, at))}: ${clip(left[at])} vs ${clip(right[at])}`;
}
