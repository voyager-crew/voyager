import mermaid from 'mermaid';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { MermaidRenderer } from '../renderer';

const ATTACKER = 'attacker.example';
const URL = `https://${ATTACKER}/x.png`;

/** A URL the browser can use without a request: none, a fragment, or inline data. */
const loadsNothing = (value: string) => /^\s*(?:$|#|data:|blob:)/i.test(value);
const URL_ATTRIBUTES = /^(?:src|srcset|href|poster|data|background|action|formaction)$/i;
const CSS_ATTRIBUTES =
  /^(?:style|fill|stroke|filter|clip-path|mask|marker-start|marker-mid|marker-end|cursor)$/i;
/** CSS that fetches: an `@import`, or a `url()` that is not inline data or a fragment. */
const cssFetches = (css: string) =>
  css.toLowerCase().includes(ATTACKER) || /@import|url\(\s*['"]?\s*(?!#|data:|blob:)/i.test(css);

type Write = { kind: 'url' | 'css' | 'markup'; value: string };

/** Markup is parsed where nothing loads, then judged by its attributes and stylesheets; text is inert. */
function markupFetches(markup: string): boolean {
  const parsed = new DOMParser().parseFromString(markup, 'text/html');
  return Array.from(parsed.querySelectorAll('*')).some(
    (element) =>
      (element.localName === 'style' && cssFetches(element.textContent ?? '')) ||
      Array.from(element.attributes).some((attribute) =>
        fetches(attributeWrite(attribute.name, attribute.value)),
      ),
  );
}

function attributeWrite(name: string, value: string): Write {
  const local = name.slice(name.indexOf(':') + 1);
  if (URL_ATTRIBUTES.test(local)) return { kind: 'url', value };
  return {
    kind: CSS_ATTRIBUTES.test(local) ? 'css' : 'markup',
    value: CSS_ATTRIBUTES.test(local) ? value : '',
  };
}

function fetches({ kind, value }: Write): boolean {
  if (kind === 'url') return !loadsNothing(value);
  if (kind === 'css') return cssFetches(value);
  return value !== '' && markupFetches(value);
}

/**
 * Records what reaches the DOM's own sinks in the page document while Mermaid renders.
 * Installed before the renderer runs, so it sees values after any guard has handled them.
 */
function recordPageWrites() {
  const writes: Write[] = [];
  const restores: Array<() => void> = [];
  const inPage = (node: unknown) => (node as Node).ownerDocument === document;
  const isStyle = (node: unknown) => (node as Element).localName === 'style';

  const wrapSetter = (
    proto: object,
    name: string,
    sink: (self: unknown, value: unknown) => void,
  ) => {
    const descriptor = Object.getOwnPropertyDescriptor(proto, name)!;
    Object.defineProperty(proto, name, {
      ...descriptor,
      set(value: unknown) {
        sink(this, value);
        descriptor.set!.call(this, value);
      },
    });
    restores.push(() => Object.defineProperty(proto, name, descriptor));
  };
  const wrapMethod = <A extends unknown[]>(
    proto: object,
    name: string,
    sink: (self: unknown, ...args: A) => void,
  ) => {
    const original = (proto as Record<string, (...args: A) => unknown>)[name];
    (proto as Record<string, unknown>)[name] = function (this: unknown, ...args: A) {
      sink(this, ...args);
      return original.apply(this, args);
    };
    restores.push(() => {
      (proto as Record<string, unknown>)[name] = original;
    });
  };
  const attribute = (self: unknown, name: string, value: unknown) => {
    if (inPage(self)) writes.push(attributeWrite(name, String(value)));
  };
  const markup = (self: unknown, value: unknown) => {
    if (inPage(self)) writes.push({ kind: isStyle(self) ? 'css' : 'markup', value: String(value) });
  };

  for (const name of ['src', 'srcset']) {
    wrapSetter(HTMLImageElement.prototype, name, (self, value) => {
      if (inPage(self)) writes.push({ kind: 'url', value: String(value) });
    });
  }
  wrapMethod(Element.prototype, 'setAttribute', (self, name: string, value: unknown) =>
    attribute(self, name, value),
  );
  wrapMethod(
    Element.prototype,
    'setAttributeNS',
    (self, _ns: string | null, name: string, value: unknown) => attribute(self, name, value),
  );
  wrapSetter(Element.prototype, 'innerHTML', markup);
  wrapSetter(Element.prototype, 'outerHTML', (self, value) => {
    if (inPage(self)) writes.push({ kind: 'markup', value: String(value) });
  });
  wrapMethod(Element.prototype, 'insertAdjacentHTML', (self, _where: string, value: string) =>
    markup(self, value),
  );
  // Text is only fetched from when it is a stylesheet.
  wrapSetter(Node.prototype, 'textContent', (self, value) => {
    if (inPage(self) && isStyle(self)) writes.push({ kind: 'css', value: String(value) });
  });
  wrapMethod(CSSStyleDeclaration.prototype, 'setProperty', (_self, _name: string, value: unknown) =>
    writes.push({ kind: 'css', value: String(value) }),
  );
  wrapSetter(CSSStyleDeclaration.prototype, 'cssText', (_self, value) =>
    writes.push({ kind: 'css', value: String(value) }),
  );

  return {
    /** Every write that would make the page request something other than inline data. */
    external: () => writes.filter(fetches),
    restore: () => restores.reverse().forEach((restore) => restore()),
  };
}

type Measurable = SVGElement & { getBBox?: unknown; getComputedTextLength?: unknown };
type Decodable = HTMLImageElement & { decode?: unknown };
const canvasContext = new Proxy(
  {},
  {
    get: (_target, key) =>
      key === 'measureText'
        ? () => ({ width: 40 })
        : key === 'canvas'
          ? undefined
          : () => undefined,
  },
);
const originalGetContext = HTMLCanvasElement.prototype.getContext;
const originalGetComputedStyle = window.getComputedStyle;
const originalComplete = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, 'complete')!;

/** Rough.js and layouts draw from Math.random; a fixed sequence makes two renders comparable. */
let seed = 1;
const seededRandom = () => {
  seed = (seed * 16807) % 2147483647;
  return (seed - 1) / 2147483646;
};

let recorder: ReturnType<typeof recordPageWrites> | null = null;

beforeEach(() => {
  // jsdom has no layout, image decoding or canvas; give Mermaid what a browser would.
  const proto = SVGElement.prototype as Measurable;
  proto.getBBox = () => ({ x: 0, y: 0, width: 40, height: 20 });
  proto.getComputedTextLength = () => 40;
  (HTMLImageElement.prototype as Decodable).decode = () => Promise.resolve();
  Object.defineProperty(HTMLImageElement.prototype, 'complete', {
    configurable: true,
    get: () => true,
  });
  HTMLCanvasElement.prototype.getContext = (() =>
    canvasContext) as unknown as typeof HTMLCanvasElement.prototype.getContext;
  // Cytoscape sizes its container from computed padding, which jsdom leaves empty.
  window.getComputedStyle = ((element: Element, pseudo?: string | null) => {
    const style = originalGetComputedStyle.call(window, element, pseudo);
    return new Proxy(style, {
      get(target, key) {
        if (key === 'getPropertyValue') {
          return (name: string) =>
            target.getPropertyValue(name) || (name.startsWith('padding') ? '0px' : '');
        }
        const value: unknown = Reflect.get(target, key);
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });
  }) as typeof window.getComputedStyle;
  seed = 1;
  vi.spyOn(Math, 'random').mockImplementation(seededRandom);
});

afterEach(() => {
  recorder?.restore();
  recorder = null;
  const proto = SVGElement.prototype as Measurable;
  delete proto.getBBox;
  delete proto.getComputedTextLength;
  Reflect.deleteProperty(HTMLImageElement.prototype, 'decode');
  Object.defineProperty(HTMLImageElement.prototype, 'complete', originalComplete);
  HTMLCanvasElement.prototype.getContext = originalGetContext;
  window.getComputedStyle = originalGetComputedStyle;
  vi.restoreAllMocks();
  document.body.replaceChildren();
});

async function renderRecorded(source: string) {
  const renderer = new MermaidRenderer(() => 'light');
  await renderer.initialize();
  recorder = recordPageWrites();
  const result = await renderer.render(source, { lightExport: false });
  const external = recorder.external();
  recorder.restore();
  recorder = null;
  return { result, external };
}

/**
 * Sequence and class diagrams number some ids from counters that survive between renders,
 * so ids are compared by order of appearance.
 */
function canonicalIds(svg: string): string {
  const ids = [...new Set(Array.from(svg.matchAll(/\bid="([^"]+)"/g), (match) => match[1]))];
  const ordinal = new Map(ids.map((id, index) => [id, `gv-id-${index}`]));
  const escaped = ids
    .sort((a, b) => b.length - a.length)
    .map((id) => id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  if (escaped.length === 0) return svg;
  return svg.replace(new RegExp(`(?<![\\w-])(?:${escaped.join('|')})(?![\\w-])`, 'g'), (id) =>
    ordinal.get(id)!,
  );
}

const ATTACKS: Array<[string, string]> = [
  [
    'a flowchart image node',
    `flowchart TD\n  A@{ img: "${URL}", label: "pic", pos: "t", h: 60 }\n  A --> B`,
  ],
  ['an unquoted image node', `flowchart TD\n  A@{ img: ${URL} }\n  A --> B`],
  [
    'an escaped image node',
    `flowchart TD\n  A@{ img: "https:\\/\\/${ATTACKER}/x.png" }\n  A --> B`,
  ],
  [
    'a sequence participant icon',
    `sequenceDiagram\n  participant A\n  properties A: {"class": "internal-service-actor", "icon": "${URL}"}\n  A->>A: hi`,
  ],
  [
    'an escaped participant icon',
    `sequenceDiagram\n  participant A\n  properties A: {"\\u0069con": "https:\\/\\/${ATTACKER}/x.png"}\n  A->>A: hi`,
  ],
  ['an <img> in a label', `flowchart TD\n  A["<img src='${URL}'> pic"] --> B`],
  [
    'an <img> in an HTML label',
    `%%{init: {"flowchart": {"htmlLabels": true}}}%%\nflowchart TD\n  A["<img src='${URL}'> pic"] --> B`,
  ],
  [
    'a themeCSS directive',
    `%%{init: {"themeCSS": ".node rect { fill: url(${URL}) }"}}%%\nflowchart TD\n  A --> B`,
  ],
  [
    'a themeCSS front matter',
    `---\nconfig:\n  themeCSS: ".node rect { fill: url(${URL}) }"\n---\nflowchart TD\n  A --> B`,
  ],
  [
    'a themeCSS url hiding a path behind comment-like text',
    `---\nconfig:\n  themeCSS: '.node rect { fill: url("/**/#probe") }'\n---\nflowchart TD\n  A --> B`,
  ],
  ['a click link', `flowchart TD\n  A --> B\n  click A href "${URL}" _blank`],
  [
    'an image node after a quoted brace',
    `flowchart TD\n  A@{ label: "foo } bar", img: "${URL}" }\n  A --> B`,
  ],
  ['an image node naming a relative path', 'flowchart TD\n  A@{ img: avatar }\n  A --> B'],
  [
    'a participant icon naming a relative path',
    'sequenceDiagram\n  participant A\n  properties A: {"icon": "avatar"}\n  A->>A: hi',
  ],
  [
    'a class style with a url fill',
    `classDiagram\n  class A\n  style A fill:url(https://${ATTACKER}/x.svg)`,
  ],
  [
    'a class with a url fill',
    `classDiagram\n  class A:::pic\n  classDef pic fill:url(//${ATTACKER}/x.svg)`,
  ],
  [
    'a state classDef with a url fill',
    `stateDiagram-v2\n  classDef pic fill:url(${URL})\n  A --> B\n  class A pic`,
  ],
  [
    'an <img> in a label with HTML labels on',
    `%%{init: {"htmlLabels": true}}%%\nflowchart TD\n  A["<img src='${URL}'> pic"] --> B`,
  ],
];

const LEGIT: Array<[string, string]> = [
  [
    'a flowchart with classes, styles, a callback and URL-like labels',
    [
      'flowchart TD',
      '  A["See https://example.com/docs and src/app.ts"] --> B("http://example.org is text")',
      '  B --> C["literal @{ img: https://example.com } syntax"]',
      '  classDef warm fill:#f96,stroke:#333,stroke-width:2px',
      '  class A warm',
      '  style B fill:#bbf,stroke:#f66',
      '  click A callback "Open the docs"',
    ].join('\n'),
  ],
  [
    'the literal shape-data label',
    'flowchart TD\n  A["literal @{ img: https://example.com } syntax"]-->B',
  ],
  [
    'a sequence diagram with URL-like messages',
    'sequenceDiagram\n  participant A\n  participant B\n  A->>B: GET https://example.com/api/items\n  Note right of B: see src/app.ts\n  B-->>A: 200',
  ],
  [
    'a class diagram with a style',
    'classDiagram\n  class Animal {\n    +String name\n  }\n  Animal <|-- Dog\n  style Dog fill:#f9f,stroke:#333',
  ],
  [
    'a gantt chart',
    'gantt\n  title Plan\n  dateFormat YYYY-MM-DD\n  todayMarker off\n  section Build\n  Design :a1, 2024-01-01, 3d\n  Ship :after a1, 2d',
  ],
  ['a mindmap', 'mindmap\n  root((Voyager))\n    Timeline\n    Folders\n      Sync'],
];

describe('mermaid external resources', () => {
  it.each(ATTACKS)(
    'a mermaid diagram renders without requesting anything external: %s',
    async (_, source) => {
      const { result, external } = await renderRecorded(source);

      expect(result?.errorMessage).toBeNull();
      expect(result?.svg).toMatch(/^<svg[\s>]/);
      expect(external).toEqual([]);
      expect(markupFetches(result!.svg)).toBe(false);
    },
  );

  it.each(LEGIT)('a diagram that loads nothing renders as before: %s', async (_, source) => {
    const { result, external } = await renderRecorded(source);
    expect(result?.errorMessage).toBeNull();
    expect(result?.svg).toMatch(/^<svg[\s>]/);
    expect(external).toEqual([]);

    // The same diagram with the same id and random sequence, straight through Mermaid unguarded.
    seed = 1;
    Math.random();
    const before = await mermaid.render(result!.id, source);
    expect(canonicalIds(result!.svg)).toBe(canonicalIds(before.svg));
  });

  it('an image elsewhere on the page keeps its URL while a diagram renders', async () => {
    // Mermaid waits for an image node to decode mid-render; hold it there.
    let finishDecoding = () => {};
    let decodeStarted = false;
    const decoding = new Promise<void>((resolve) => (finishDecoding = resolve));
    (HTMLImageElement.prototype as Decodable).decode = () => {
      decodeStarted = true;
      return decoding;
    };
    const pageImage = document.body.appendChild(document.createElement('img'));
    const renderer = new MermaidRenderer(() => 'light');
    await renderer.initialize();

    const pending = renderer.render(`flowchart TD\n  A@{ img: "${URL}" }`, { lightExport: false });
    const detached = new Image();
    try {
      await vi.waitFor(() => expect(decodeStarted).toBe(true));
      detached.src = URL;
      pageImage.src = 'https://example.com/avatar.png';
      pageImage.setAttribute('srcset', 'https://example.com/avatar-2x.png 2x');
    } finally {
      finishDecoding();
    }
    const result = await pending;

    expect(detached.getAttribute('src')).toMatch(/^data:/);
    expect(result?.errorMessage).toBeNull();
    expect(pageImage.getAttribute('src')).toBe('https://example.com/avatar.png');
    expect(pageImage.getAttribute('srcset')).toBe('https://example.com/avatar-2x.png 2x');
  });

  it('a guard that fails to install leaves page writes untouched', async () => {
    const original = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, 'src');
    vi.resetModules();
    const { renderWithoutExternalLoads } = await import('../renderGuard');
    const failure = new Error('install failed');
    const createDocument = vi
      .spyOn(document.implementation, 'createHTMLDocument')
      .mockImplementation(() => {
        throw failure;
      });
    try {
      await expect(renderWithoutExternalLoads('x', async () => 'drawn')).rejects.toBe(failure);
    } finally {
      createDocument.mockRestore();
    }

    expect(Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, 'src')).toEqual(original);
    const image = new Image();
    image.src = URL;
    expect(image.getAttribute('src')).toBe(URL);
    await expect(renderWithoutExternalLoads('y', async () => 'drawn')).resolves.toBe('drawn');
    image.src = URL;
    expect(image.getAttribute('src')).toBe(URL);
  });

  it('concurrent renders stay guarded and leave nothing guarded afterwards', async () => {
    const renderer = new MermaidRenderer(() => 'light');
    await renderer.initialize();
    recorder = recordPageWrites();

    const results = await Promise.all([
      renderer.render('flowchart TD\n  A -->', { lightExport: false }),
      ...ATTACKS.slice(0, 4).map(([, source]) => renderer.render(source, { lightExport: false })),
    ]);
    const external = recorder.external();
    recorder.restore();
    recorder = null;

    expect(results[0]?.errorMessage).not.toBeNull();
    expect(results.slice(1).map((result) => result?.errorMessage)).toEqual([
      null,
      null,
      null,
      null,
    ]);
    expect(external).toEqual([]);
    const image = new Image();
    image.src = URL;
    const box = document.createElement('div');
    box.setAttribute('style', `background: url(${URL})`);
    box.innerHTML = `<img src="${URL}">`;
    expect(image.getAttribute('src')).toBe(URL);
    expect(box.getAttribute('style')).toContain(ATTACKER);
    expect(box.querySelector('img')?.getAttribute('src')).toBe(URL);
  });
});
