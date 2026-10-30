// @vitest-environment-options { "url": "chrome-extension://test-extension-id/src/pages/mermaidRenderer/index.html" }
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { renderMermaidDocument } from '../render';

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
let decodedSources: string[] = [];

beforeEach(() => {
  // jsdom has no layout, image decoding or canvas; give Mermaid what a browser would.
  const proto = SVGElement.prototype as Measurable;
  proto.getBBox = () => ({ x: 0, y: 0, width: 40, height: 20 });
  proto.getComputedTextLength = () => 40;
  decodedSources = [];
  (HTMLImageElement.prototype as Decodable).decode = function (this: HTMLImageElement) {
    const source = this.getAttribute('src') ?? '';
    decodedSources.push(source);
    return /^data:image\/gif;base64,R0lGODlh/i.test(source)
      ? Promise.resolve()
      : Promise.reject(new Error('Image source cannot decode in the isolated document'));
  };
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
});

afterEach(() => {
  const proto = SVGElement.prototype as Measurable;
  delete proto.getBBox;
  delete proto.getComputedTextLength;
  Reflect.deleteProperty(HTMLImageElement.prototype, 'decode');
  Object.defineProperty(HTMLImageElement.prototype, 'complete', originalComplete);
  HTMLCanvasElement.prototype.getContext = originalGetContext;
  window.getComputedStyle = originalGetComputedStyle;
  document.body.replaceChildren();
});

function parsedSvg(markup: string): SVGSVGElement | null {
  const template = document.createElement('template');
  template.innerHTML = markup;
  return template.content.querySelector('svg');
}

function nodeColors(markup: string): string {
  const css = parsedSvg(markup)
    ?.querySelector('style')
    ?.textContent?.replace(/\s+/g, '')
    .toLowerCase();
  return css?.match(/\.noderect[^{}]*\{([^}]+)\}/)?.[1] ?? '';
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

const LEGIT: Array<[string, string, readonly string[]]> = [
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
    // Mermaid's SVG Markdown renderer omits autolink tokens; keep the surrounding labels.
    ['See', 'src/app.ts', 'is text', 'literal @{ img:', '} syntax'],
  ],
  [
    'the literal shape-data label',
    'flowchart TD\n  A["literal @{ img: https://example.com } syntax"]-->B',
    ['literal @{ img:', '} syntax', 'B'],
  ],
  [
    'a sequence diagram with URL-like messages',
    'sequenceDiagram\n  participant A\n  participant B\n  A->>B: GET https://example.com/api/items\n  Note right of B: see src/app.ts\n  B-->>A: 200',
    ['GET https://example.com/api/items', 'see src/app.ts', '200'],
  ],
  [
    'a class diagram with a style',
    'classDiagram\n  class Animal {\n    +String name\n  }\n  Animal <|-- Dog\n  style Dog fill:#f9f,stroke:#333',
    ['Animal', 'Dog', 'String name'],
  ],
  [
    'a gantt chart',
    'gantt\n  title Plan\n  dateFormat YYYY-MM-DD\n  todayMarker off\n  section Build\n  Design :a1, 2024-01-01, 3d\n  Ship :after a1, 2d',
    ['Plan', 'Build', 'Design', 'Ship'],
  ],
  [
    'a mindmap',
    'mindmap\n  root((Voyager))\n    Timeline\n    Folders\n      Sync',
    ['Voyager', 'Timeline', 'Folders', 'Sync'],
  ],
];

describe('isolated Mermaid document output', () => {
  it.each([URL, 'avatar'])('keeps image-node labels when %s cannot be loaded', async (image) => {
    const result = await renderMermaidDocument({
      id: 'mermaid-image-fallback',
      code: `flowchart TD\n  A@{ img: "${image}", label: "Useful image label" }\n  A --> B[Next step]`,
      theme: 'light',
      lightExport: false,
    });
    expect(result.errorMessage).toBeNull();
    expect(decodedSources).toHaveLength(1);
    expect(decodedSources[0]).toMatch(/^data:image\/gif;base64,/);
    const template = document.createElement('template');
    template.innerHTML = result.svg;
    expect(template.content.querySelector('svg')?.textContent).toContain('Useful image label');
    expect(template.content.querySelector('svg')?.textContent).toContain('Next step');
  });

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

  it.each(LEGIT)('preserves the diagram labels: %s', async (_, source, labels) => {
    const result = await renderMermaidDocument({
      id: 'mermaid-test',
      code: source,
      theme: 'light',
      lightExport: false,
    });
    expect(result?.errorMessage).toBeNull();
    expect(result?.svg).toMatch(/^<svg[\s>]/);
    const svg = parsedSvg(result.svg);
    const text = Array.from(svg?.querySelectorAll('text, foreignObject') ?? [])
      .map((element) => element.textContent)
      .join(' ');
    for (const label of labels) expect(text).toContain(label);
  });

  it.each([
    { theme: 'light', fill: '#ececff', stroke: '#9370db' },
    { theme: 'dark', fill: '#1f2020', stroke: '#ccc' },
  ] as const)(
    'keeps classDef, node styles and $theme theme colors',
    async ({ theme, fill, stroke }) => {
      const result = await renderMermaidDocument({
        id: 'mermaid-themed',
        code: 'flowchart TD\n  A[Warm] --> B[Styled]\n  B --> C[Default]\n  classDef warm fill:#f96,stroke:#333,stroke-width:2px\n  class A warm\n  style B fill:#bbf,stroke:#f66',
        theme,
        lightExport: true,
      });
      expect(result.errorMessage).toBeNull();
      expect(nodeColors(result.svg)).toContain(`fill:${fill}`);
      expect(nodeColors(result.svg)).toContain(`stroke:${stroke}`);
      const svg = parsedSvg(result.svg);
      const css = svg?.querySelector('style')?.textContent?.replace(/\s+/g, '').toLowerCase() ?? '';
      expect(svg?.querySelector('.warm')?.textContent).toContain('Warm');
      expect(css).toMatch(/\.warm[^{}]*\{[^}]*fill:#f96/);
      expect(css).toMatch(/\.warm[^{}]*\{[^}]*stroke:#333/);
      const styledNode = Array.from(svg?.querySelectorAll('g.node') ?? []).find((node) =>
        node.textContent?.includes('Styled'),
      );
      const style =
        styledNode?.querySelector('rect')?.getAttribute('style')?.replace(/\s+/g, '') ?? '';
      expect(style).toContain('fill:#bbf');
      expect(style).toContain('stroke:#f66');
      if (theme === 'dark') {
        expect(nodeColors(result.lightExportSvg ?? '')).toContain('fill:#ececff');
        expect(nodeColors(result.lightExportSvg ?? '')).toContain('stroke:#9370db');
        expect(parsedSvg(result.lightExportSvg ?? '')?.textContent).toContain('Default');
      } else {
        expect(result.lightExportSvg).toBeNull();
      }
    },
  );
});
