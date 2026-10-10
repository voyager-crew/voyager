/**
 * Mermaid draws into the live page before `sanitizeMermaidSvg` sees its SVG,
 * and the diagram text decides some of what it writes there: an image node's
 * `img` goes to `new Image().src` and an `<image href>`, a participant icon to
 * an `xlink:href`, a `style` or `classDef` into CSS. Mermaid's grammar is too
 * rich to rewrite safely, so instead every DOM sink those values reach is
 * guarded for the length of one render: a URL that is not inline data, a blob,
 * a same-document fragment or the extension's own becomes a blank image (or an
 * empty document) before the browser can request it.
 *
 * Mermaid itself runs in the content script's isolated world, so the patches
 * never touch the host page's own scripts. Element writes are only rewritten on
 * elements of this document that are detached or inside the render container,
 * which leaves the rest of Voyager's UI alone while a render is in flight.
 */

const BLANK_IMAGE =
  'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
/** For elements that would load a whole document or stylesheet, even from `data:`. */
const BLANK_DOCUMENT = 'data:,';

/** Attributes whose value is fetched or navigated to. */
const URL_ATTRIBUTES = new Set([
  'action',
  'archive',
  'background',
  'codebase',
  'data',
  'dynsrc',
  'formaction',
  'href',
  'icon',
  'longdesc',
  'lowsrc',
  'manifest',
  'ping',
  'poster',
  'src',
]);
const URL_LIST_ATTRIBUTES = new Set(['imagesrcset', 'srcset']);
/** Attributes parsed as CSS, where `url()` fetches. */
const CSS_ATTRIBUTES = new Set([
  'clip-path',
  'cursor',
  'fill',
  'filter',
  'marker-end',
  'marker-mid',
  'marker-start',
  'mask',
  'stroke',
  'style',
]);
/** Elements whose `data:` resource is a document that can load more on its own. */
const DOCUMENT_ELEMENTS = new Set(['embed', 'frame', 'iframe', 'link', 'object', 'script', 'use']);
/** Inline style properties that take an image or a URL. */
const CSS_URL_PROPERTIES = [
  'background',
  'backgroundImage',
  'background-image',
  'borderImage',
  'border-image',
  'borderImageSource',
  'border-image-source',
  'clipPath',
  'clip-path',
  'content',
  'cursor',
  'fill',
  'filter',
  'listStyle',
  'list-style',
  'listStyleImage',
  'list-style-image',
  'marker',
  'markerEnd',
  'marker-end',
  'markerMid',
  'marker-mid',
  'markerStart',
  'marker-start',
  'mask',
  'maskImage',
  'mask-image',
  'shapeOutside',
  'shape-outside',
  'stroke',
  'webkitMaskImage',
  '-webkit-mask-image',
];

function extensionBase(): string | null {
  try {
    return chrome.runtime.getURL('') || null;
  } catch {
    return null;
  }
}

/** Mirrors URL parsing: surrounding C0 controls and spaces go, tabs and newlines vanish. */
function trimUrl(value: string): string {
  let start = 0;
  let end = value.length;
  while (start < end && value.charCodeAt(start) <= 0x20) start++;
  while (end > start && value.charCodeAt(end - 1) <= 0x20) end--;
  return value.slice(start, end).replace(/[\t\n\r]/g, '');
}

function isOwnExtensionUrl(url: string): boolean {
  const base = extensionBase();
  return base !== null && url.startsWith(base);
}

/** True when the browser can use `value` as a URL without any request. */
function isInertUrl(value: string): boolean {
  const url = trimUrl(value);
  return (
    url === '' || url.startsWith('#') || /^(?:data|blob):/i.test(url) || isOwnExtensionUrl(url)
  );
}

function decodeCssEscapes(value: string): string {
  return value.replace(/\\([0-9a-f]{1,6}\s?|[\s\S])/gi, (_match, escaped: string) => {
    const hex = escaped.trim();
    if (/^[0-9a-f]{1,6}$/i.test(hex)) {
      const codePoint = Number.parseInt(hex, 16);
      return codePoint > 0 && codePoint <= 0x10ffff ? String.fromCodePoint(codePoint) : '';
    }
    return escaped;
  });
}

const CSS_URL_FUNCTION =
  /\b(?:url|src)\s*\(\s*(?:"((?:[^"\\]|\\[\s\S])*)"|'((?:[^'\\]|\\[\s\S])*)'|([^)]*?))\s*\)/gi;

function urlFunctionTarget(double?: string, single?: string, bare?: string): string {
  return decodeCssEscapes(double ?? single ?? bare ?? '');
}

const isCssWhitespace = (ch: string | undefined) => ch !== undefined && /[ \t\n\r\f]/.test(ch);
const isCssNameChar = (ch: string | undefined) =>
  ch !== undefined && (/[\w-]/.test(ch) || ch.charCodeAt(0) >= 0x80);
const isCssEscape = (css: string, i: number) =>
  css[i] === '\\' && i + 1 < css.length && !/[\n\r\f]/.test(css[i + 1]);

/** The character escaped at `css[i]` (a backslash) and the index after the escape. */
function readCssEscape(css: string, i: number): [string, number] {
  const hex = /^[0-9a-f]{1,6}/i.exec(css.slice(i + 1, i + 7))?.[0];
  if (!hex) return [css[i + 1] ?? '�', i + 2];
  let end = i + 1 + hex.length;
  if (isCssWhitespace(css[end])) end += css[end] === '\r' && css[end + 1] === '\n' ? 2 : 1;
  const codePoint = Number.parseInt(hex, 16);
  const valid =
    codePoint > 0 && codePoint <= 0x10ffff && (codePoint < 0xd800 || codePoint > 0xdfff);
  return [valid ? String.fromCodePoint(codePoint) : '�', end];
}

/** A quoted string starting at `css[i]`: its value and the index after it. */
function readCssString(css: string, i: number): [string, number] {
  const quote = css[i];
  let value = '';
  let j = i + 1;
  while (j < css.length && css[j] !== quote && !/[\n\r\f]/.test(css[j])) {
    if (css[j] !== '\\') value += css[j++];
    else if (j + 1 < css.length && /[\n\r\f]/.test(css[j + 1])) j += 2;
    else {
      const [escaped, next] = readCssEscape(css, j);
      value += escaped;
      j = next;
    }
  }
  return [value, css[j] === quote ? j + 1 : j];
}

function readCssName(css: string, i: number): [string, number] {
  let name = '';
  let j = i;
  while (isCssNameChar(css[j]) || isCssEscape(css, j)) {
    if (css[j] !== '\\') name += css[j++];
    else {
      const [escaped, next] = readCssEscape(css, j);
      name += escaped;
      j = next;
    }
  }
  return [name, j];
}

function readUnquotedCssUrl(css: string, i: number): [string, number] {
  let value = '';
  let j = i;
  while (j < css.length && css[j] !== ')') {
    if (css[j] !== '\\') value += css[j++];
    else {
      const [escaped, next] = readCssEscape(css, j);
      value += escaped;
      j = next;
    }
  }
  return [value, j + 1];
}

/**
 * Tokenizes like a CSS parser: comments only count outside strings and URLs, and
 * escapes are decoded once: comment-like text inside a quoted URL stays part of its path.
 */
function cssFetches(css: string): boolean {
  let i = 0;
  while (i < css.length) {
    const ch = css[i];
    if (ch === '/' && css[i + 1] === '*') {
      const end = css.indexOf('*/', i + 2);
      i = end === -1 ? css.length : end + 2;
    } else if (ch === '"' || ch === "'") {
      i = readCssString(css, i)[1];
    } else if (ch === '@') {
      const [name, next] = readCssName(css, i + 1);
      if (name.toLowerCase() === 'import') return true;
      i = next;
    } else if (isCssNameChar(ch) || isCssEscape(css, i)) {
      const [name, next] = readCssName(css, i);
      i = next;
      if (css[i] !== '(') continue;
      const fn = name.toLowerCase();
      // Too nested to judge: `image()`, `image-set()`.
      if (/^(?:-webkit-)?image(?:-set)?$/.test(fn)) return true;
      if (fn !== 'url' && fn !== 'src') continue;
      let start = i + 1;
      while (isCssWhitespace(css[start])) start++;
      const quoted = css[start] === '"' || css[start] === "'";
      if (!quoted && fn === 'src') return true;
      const [target, after] = quoted ? readCssString(css, start) : readUnquotedCssUrl(css, start);
      if (!isInertUrl(target)) return true;
      i = after;
    } else {
      i++;
    }
  }
  return false;
}

/** `css` with each fetching `url()` replaced by `none`; empty if a fetch would survive that. */
function neutralizeCss(css: string): string {
  if (!cssFetches(css)) return css;
  const rewritten = css
    .replace(/@import[^;{}]*;?/gi, '')
    .replace(/(?:-webkit-)?image-set\s*\((?:[^()]|\([^()]*\))*\)/gi, 'none')
    .replace(CSS_URL_FUNCTION, (match, double?: string, single?: string, bare?: string) =>
      isInertUrl(urlFunctionTarget(double, single, bare)) ? match : 'none',
    );
  return cssFetches(rewritten) ? '' : rewritten;
}

/** The value `element` may receive for attribute `name`: unchanged unless it would fetch. */
function neutralizeAttribute(element: Element, name: string, value: string): string {
  const local = name.slice(name.indexOf(':') + 1).toLowerCase();
  const tag = element.localName.toLowerCase();
  if (local === 'srcdoc' || (tag === 'meta' && local === 'content')) return '';
  if (URL_LIST_ATTRIBUTES.has(local)) return value.trim() === '' ? value : BLANK_IMAGE;
  if (URL_ATTRIBUTES.has(local)) {
    if (!DOCUMENT_ELEMENTS.has(tag)) return isInertUrl(value) ? value : BLANK_IMAGE;
    const url = trimUrl(value);
    const inert =
      url === '' ||
      url === BLANK_DOCUMENT ||
      (tag === 'use' && url.startsWith('#')) ||
      isOwnExtensionUrl(url);
    return inert ? value : BLANK_DOCUMENT;
  }
  return CSS_ATTRIBUTES.has(local) ? neutralizeCss(value) : value;
}

const isStyleElement = (node: unknown): boolean =>
  node instanceof Element && node.localName === 'style';

/** Neutralizes every attribute and stylesheet under `root`; true if anything changed. */
function neutralizeSubtree(root: Element): boolean {
  let changed = false;
  for (const element of Array.from(root.querySelectorAll('*'))) {
    for (const attribute of Array.from(element.attributes)) {
      const next = neutralizeAttribute(element, attribute.name, attribute.value);
      if (next === attribute.value) continue;
      attribute.value = next;
      changed = true;
    }
    if (isStyleElement(element)) {
      const css = element.textContent ?? '';
      const next = neutralizeCss(css);
      if (next !== css) {
        element.textContent = next;
        changed = true;
      }
    }
  }
  return changed;
}

type Setter = (this: unknown, value: unknown) => void;
type Method = (this: unknown, ...args: unknown[]) => unknown;

interface Patches {
  restore: Array<() => void>;
}

function findOwner(sample: object, name: string): [object, PropertyDescriptor] | null {
  for (let owner: object | null = sample; owner; owner = Object.getPrototypeOf(owner)) {
    const descriptor = Object.getOwnPropertyDescriptor(owner, name);
    if (descriptor) return descriptor.configurable ? [owner, descriptor] : null;
  }
  return null;
}

function patchSetter(
  patches: Patches,
  sample: object,
  name: string,
  wrap: (set: Setter) => Setter,
): Setter | null {
  const found = findOwner(sample, name);
  if (!found?.[1].set) return null;
  const [owner, descriptor] = found;
  const set = descriptor.set as Setter;
  Object.defineProperty(owner, name, { ...descriptor, set: wrap(set) });
  patches.restore.push(() => Object.defineProperty(owner, name, descriptor));
  return set;
}

function patchMethod(patches: Patches, sample: object, name: string, wrap: (fn: Method) => Method) {
  const found = findOwner(sample, name);
  if (typeof found?.[1].value !== 'function') return;
  const [owner, descriptor] = found;
  Object.defineProperty(owner, name, { ...descriptor, value: wrap(descriptor.value as Method) });
  patches.restore.push(() => Object.defineProperty(owner, name, descriptor));
}

let inertDocument: Document | null = null;

/** Patches the sinks Mermaid writes through, for elements `inScope` accepts, recording each undo. */
function patchSinks(patches: Patches, inScope: (element: Element) => boolean): Patches {
  const guarded = (node: unknown): node is Element => node instanceof Element && inScope(node);
  const sampleElement = document.createElement('div');

  for (const name of ['src', 'srcset']) {
    patchSetter(
      patches,
      document.createElement('img'),
      name,
      (set) =>
        function (this: unknown, value: unknown) {
          set.call(this, guarded(this) ? neutralizeAttribute(this, name, String(value)) : value);
        },
    );
  }

  patchMethod(
    patches,
    sampleElement,
    'setAttribute',
    (setAttribute) =>
      function (this: unknown, ...args: unknown[]) {
        const [name, value] = args;
        if (!guarded(this)) return setAttribute.apply(this, args);
        return setAttribute.call(
          this,
          name,
          neutralizeAttribute(this, String(name), String(value)),
        );
      },
  );
  patchMethod(
    patches,
    sampleElement,
    'setAttributeNS',
    (setAttributeNS) =>
      function (this: unknown, ...args: unknown[]) {
        const [namespace, name, value] = args;
        if (!guarded(this)) return setAttributeNS.apply(this, args);
        const next = neutralizeAttribute(this, String(name), String(value));
        return setAttributeNS.call(this, namespace, name, next);
      },
  );

  // Markup is parsed first in a document without a browsing context, which loads nothing.
  inertDocument ??= document.implementation.createHTMLDocument('');
  const inert = inertDocument;
  let setInnerHTML: Setter | null = null;
  const parseNeutralized = (context: Element, markup: string): Node[] | null => {
    if (!setInnerHTML) return null;
    const parsed = inert.createElementNS(context.namespaceURI, context.localName);
    setInnerHTML.call(parsed, markup);
    return neutralizeSubtree(parsed) ? Array.from(parsed.childNodes) : null;
  };

  const setNeutralizedHTML = (element: Element, value: unknown, set: Setter) => {
    const markup = String(value);
    if (isStyleElement(element)) return set.call(element, neutralizeCss(markup));
    const nodes = parseNeutralized(element, markup);
    if (nodes) element.replaceChildren(...nodes);
    else set.call(element, value);
  };
  setInnerHTML = patchSetter(
    patches,
    sampleElement,
    'innerHTML',
    (set) =>
      function (this: unknown, value: unknown) {
        if (guarded(this) && this.localName !== 'template') setNeutralizedHTML(this, value, set);
        else set.call(this, value);
      },
  );
  patchSetter(
    patches,
    sampleElement,
    'outerHTML',
    (set) =>
      function (this: unknown, value: unknown) {
        const parent = guarded(this) ? this.parentElement : null;
        const nodes = parent ? parseNeutralized(parent, String(value)) : null;
        if (nodes && this instanceof Element) this.replaceWith(...nodes);
        else set.call(this, value);
      },
  );
  patchMethod(
    patches,
    sampleElement,
    'insertAdjacentHTML',
    (insertAdjacentHTML) =>
      function (this: unknown, ...args: unknown[]) {
        const [position, markup] = args;
        if (!guarded(this)) return insertAdjacentHTML.apply(this, args);
        const where = String(position).toLowerCase();
        const outside = where === 'beforebegin' || where === 'afterend';
        const context = outside ? this.parentElement : this;
        const nodes = context ? parseNeutralized(context, String(markup)) : null;
        if (!nodes) return insertAdjacentHTML.apply(this, args);
        if (where === 'beforebegin') this.before(...nodes);
        else if (where === 'afterbegin') this.prepend(...nodes);
        else if (where === 'beforeend') this.append(...nodes);
        else this.after(...nodes);
      },
  );
  patchSetter(
    patches,
    sampleElement,
    'textContent',
    (set) =>
      function (this: unknown, value: unknown) {
        const css = isStyleElement(this) && guarded(this) && value != null;
        set.call(this, css ? neutralizeCss(String(value)) : value);
      },
  );

  // A style declaration does not name its element, so URL values are neutralized for all of them.
  const style = sampleElement.style;
  patchMethod(
    patches,
    style,
    'setProperty',
    (setProperty) =>
      function (this: unknown, ...args: unknown[]) {
        const [name, value, priority] = args;
        if (typeof value !== 'string') return setProperty.apply(this, args);
        return setProperty.call(this, name, neutralizeCss(value), priority);
      },
  );
  for (const name of ['cssText', ...CSS_URL_PROPERTIES]) {
    patchSetter(
      patches,
      style,
      name,
      (set) =>
        function (this: unknown, value: unknown) {
          set.call(this, typeof value === 'string' ? neutralizeCss(value) : value);
        },
    );
  }

  return patches;
}

/** Undoes every patch, newest first, even when one undo throws; rethrows the first failure. */
function restoreAll(patches: Patches): void {
  const failures: unknown[] = [];
  for (const restore of patches.restore.splice(0).reverse()) {
    try {
      restore();
    } catch (error) {
      failures.push(error);
    }
  }
  if (failures.length > 0) throw failures[0];
}

/**
 * Installs the guard as one step. A failure part-way rolls back the patches
 * already made, or they would outlive the render and blank ordinary page writes.
 */
function installGuard(inScope: (element: Element) => boolean): () => void {
  const patches: Patches = { restore: [] };
  try {
    patchSinks(patches, inScope);
  } catch (error) {
    try {
      restoreAll(patches);
    } catch {
      // The install failure is the one to report.
    }
    throw error;
  }
  return () => restoreAll(patches);
}

let queue: Promise<unknown> = Promise.resolve();

/**
 * Runs `render` — a `mermaid.render(id, …)` call — with external loads blocked
 * for every element it creates. Renders are serialized so one render's undo
 * can never strip another's guard.
 */
export function renderWithoutExternalLoads<T>(id: string, render: () => Promise<T>): Promise<T> {
  // Mermaid wraps the SVG it draws for `id` in a `d${id}` div in the page.
  const container = `[id^="d${id.replace(/["\\]/g, '')}"]`;
  const inScope = (element: Element) =>
    element.ownerDocument === document && (!element.isConnected || !!element.closest(container));
  const run = queue.then(async () => {
    // Mermaid writes diagram-chosen URLs into the live page mid-render, before the SVG is sanitized.
    const restore = installGuard(inScope);
    try {
      return await render();
    } finally {
      restore();
    }
  });
  queue = run.catch(() => undefined);
  return run;
}
