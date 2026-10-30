import mermaid from 'mermaid';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { renderMermaidDocument } from '../render';
import { sanitizeMermaidSvg } from '../sanitize';

const URL = 'https://attacker.example/x.png';
const ATTACKER = 'attacker.example';

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

describe('isolated Mermaid document output', () => {
  it.each(ATTACKS)('returns no fetching markup: %s', async (_, source) => {
    const result = await renderMermaidDocument({
      id: 'mermaid-test',
      code: source,
      theme: 'light',
      lightExport: false,
    });
    expect(result?.errorMessage).toBeNull();
    expect(result?.svg).toMatch(/^<svg[\s>]/);
    const template = document.createElement('template');
    template.innerHTML = result!.svg;
    expect(template.content.querySelector('img, image, a, link, iframe')).toBeNull();
    expect(template.content.querySelector('style')?.textContent ?? '').not.toContain(
      'attacker.example',
    );
  });

  it.each(LEGIT)('preserves the diagram layout and theme: %s', async (_, source) => {
    const result = await renderMermaidDocument({
      id: 'mermaid-test',
      code: source,
      theme: 'light',
      lightExport: false,
    });
    expect(result?.errorMessage).toBeNull();
    expect(result?.svg).toMatch(/^<svg[\s>]/);
    // Compare the same id/random sequence with a direct library render. Only the
    // sanitization needed before host insertion is permitted to change its SVG.
    seed = 1;
    const direct = await mermaid.render(result!.id, source);
    expect(canonicalIds(result!.svg)).toBe(canonicalIds(await sanitizeMermaidSvg(direct.svg)));
  });
});
