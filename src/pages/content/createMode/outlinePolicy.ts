/**
 * What the page outline may say about an element: the one whitelist for what
 * leaves the page in a creation message. Never text, never a URL, never an
 * attribute value outside `VALUE_ATTRIBUTES`, and only values, class tokens
 * and attribute names that look like a developer wrote them: no ids, emails,
 * long numbers or hashes.
 */

/** Attributes whose value is shown, when the value passes `isStructuralToken`. */
export const VALUE_ATTRIBUTES: ReadonlySet<string> = new Set([
  'role',
  'type',
  'contenteditable',
  'data-testid',
  'data-test-id',
]);

/** Attributes shown by name only, besides `data-*` and `aria-*` names that pass `isStructuralName`. */
export const NAME_ONLY_ATTRIBUTES: ReadonlySet<string> = new Set(['id', 'hidden']);

/** Elements shown without their children: their insides are content, media or code. */
export const LEAF_TAGS: ReadonlySet<string> = new Set([
  'audio',
  'canvas',
  'code',
  'iframe',
  'img',
  'input',
  'math',
  'noscript',
  'picture',
  'pre',
  'script',
  'select',
  'style',
  'svg',
  'template',
  'textarea',
  'video',
]);

/** Voyager's own classes and attributes say nothing about the site. */
const VOYAGER_PREFIX = /^(?:data-)?gv-/;
const TOKEN = /^[A-Za-z][A-Za-z0-9_-]{0,39}$/;
const NAME = /^(?:data|aria)-[a-z][a-z0-9-]{0,47}$/;
const TAG = /^[a-z][a-z0-9-]{0,39}$/;

/**
 * A piece of a token that reads as data rather than a name: four digits in a
 * row, or eight or more characters mixing letters and digits (a hash, an id).
 */
function looksLikeData(part: string): boolean {
  if (/\d{4}/.test(part)) return true;
  return part.length >= 8 && /\d/.test(part) && /[a-z]/i.test(part);
}

/** A class token or attribute value a developer wrote: short, plain, no ids or hashes. */
export function isStructuralToken(value: string): boolean {
  if (!TOKEN.test(value) || VOYAGER_PREFIX.test(value)) return false;
  return !value.split(/[-_]/).some(looksLikeData);
}

/** A `data-*` or `aria-*` attribute name worth showing. */
export function isStructuralName(name: string): boolean {
  if (!NAME.test(name) || VOYAGER_PREFIX.test(name)) return false;
  return !name.split('-').some(looksLikeData);
}

/** The element's tag as the outline prints it; an odd one reads as `element`. */
export function outlineTag(element: Element): string {
  const tag = element.localName;
  return TAG.test(tag) ? tag : 'element';
}

/** Class tokens and attributes, CSS-style: `.a.b[data-x][role="list"]`. */
export function outlineAttributes(
  element: Element,
  { maxClasses = 3, maxAttributes = 6 } = {},
): string {
  const classes = Array.from(element.classList).filter(isStructuralToken).slice(0, maxClasses);
  const attributes: string[] = [];
  for (const { name, value } of Array.from(element.attributes)) {
    if (attributes.length >= maxAttributes) break;
    if (name === 'class') continue;
    if (VALUE_ATTRIBUTES.has(name)) {
      attributes.push(isStructuralToken(value) ? `[${name}="${value}"]` : `[${name}]`);
    } else if (NAME_ONLY_ATTRIBUTES.has(name) || isStructuralName(name)) {
      attributes.push(`[${name}]`);
    }
  }
  return `${classes.map((token) => `.${token}`).join('')}${attributes.join('')}`;
}

/** An element Voyager put there itself: only Voyager classes, nothing of the site's. */
export function isVoyagerElement(element: Element): boolean {
  if (element.localName.startsWith('gv-')) return true;
  const classes = Array.from(element.classList);
  if (classes.length === 0 || !classes.every((token) => VOYAGER_PREFIX.test(token))) return false;
  return Array.from(element.attributes).every(
    ({ name }) => name === 'class' || name === 'style' || VOYAGER_PREFIX.test(name),
  );
}
