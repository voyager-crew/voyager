/** The satellites' icons: bundled Lucide paths, the same the prototype draws (17px, stroke 2.2). */
const PATHS = {
  sliders:
    '<line x1="21" x2="14" y1="4" y2="4"/><line x1="10" x2="3" y1="4" y2="4"/><line x1="21" x2="12" y1="12" y2="12"/><line x1="8" x2="3" y1="12" y2="12"/><line x1="21" x2="16" y1="20" y2="20"/><line x1="12" x2="3" y1="20" y2="20"/><line x1="14" x2="14" y1="2" y2="6"/><line x1="8" x2="8" y1="10" y2="14"/><line x1="16" x2="16" y1="18" y2="22"/>',
  eyeOff:
    '<path d="M10.733 5.076a10.744 10.744 0 0 1 11.205 6.575 1 1 0 0 1 0 .696 10.747 10.747 0 0 1-1.444 2.49"/><path d="M14.084 14.158a3 3 0 0 1-4.242-4.242"/><path d="M17.479 17.499a10.75 10.75 0 0 1-15.417-5.151 1 1 0 0 1 0-.696 10.75 10.75 0 0 1 4.446-5.143"/><path d="m2 2 20 20"/>',
} as const;

const SVG_NS = 'http://www.w3.org/2000/svg';

export function createShellIcon(name: keyof typeof PATHS): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg');
  for (const [attribute, value] of Object.entries({
    width: '17',
    height: '17',
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    'stroke-width': '2.2',
    'stroke-linecap': 'round',
    'stroke-linejoin': 'round',
    'aria-hidden': 'true',
  })) {
    svg.setAttribute(attribute, value);
  }
  // Static, bundled markup: parsed in the SVG namespace, never from page data.
  svg.innerHTML = PATHS[name];
  return svg;
}

export interface OrbitTrack {
  readonly svg: SVGSVGElement;
  readonly path: SVGPathElement;
  readonly fade: SVGLinearGradientElement;
}

const TRACK_FADE_ID = 'gv-ps-track-fade';

function svgNode<K extends keyof SVGElementTagNameMap>(
  tag: K,
  attributes: Record<string, string>,
): SVGElementTagNameMap[K] {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [attribute, value] of Object.entries(attributes)) node.setAttribute(attribute, value);
  return node;
}

/**
 * The orbit the satellites ride: one arc centred on the ball, faded at both
 * ends by a gradient along its chord. Attributes are explicit so a host's
 * global `svg` or `path` rules cannot restyle it.
 */
export function createOrbitTrack(): OrbitTrack {
  const svg = svgNode('svg', {
    class: 'gv-ps-orbit',
    width: '200',
    height: '200',
    viewBox: '-100 -100 200 200',
    'aria-hidden': 'true',
    focusable: 'false',
  });
  const fade = svgNode('linearGradient', { id: TRACK_FADE_ID, gradientUnits: 'userSpaceOnUse' });
  for (const [offset, opacity] of [
    ['0', '0'],
    ['0.2', '1'],
    ['0.8', '1'],
    ['1', '0'],
  ]) {
    fade.append(svgNode('stop', { offset, class: 'gv-ps-orbit-stop', 'stop-opacity': opacity }));
  }
  const defs = svgNode('defs', {});
  defs.append(fade);
  const path = svgNode('path', {
    class: 'gv-ps-orbit-track',
    fill: 'none',
    stroke: `url(#${TRACK_FADE_ID})`,
    'stroke-width': '1.5',
    'stroke-linecap': 'butt',
    pathLength: '1',
  });
  svg.append(defs, path);
  return { svg, path, fade };
}
