import { describe, expect, it } from 'vitest';

import { sanitizeMermaidSvg } from '../sanitize';

async function sanitize(markup: string): Promise<HTMLTemplateElement> {
  const template = document.createElement('template');
  template.innerHTML = await sanitizeMermaidSvg(markup);
  return template;
}

describe('SVG returned from the isolated Mermaid document', () => {
  it.each([
    'fill: url("/**/#probe")',
    String.raw`fill: \75 rl("https://attacker.example/pixel")`,
    'background: image-set("https://attacker.example/pixel" 1x)',
    'background: image("relative-pixel.png")',
    '@import "https://attacker.example/theme.css";',
  ])('never hands a fetching stylesheet back to the page: %s', async (css) => {
    const template = await sanitize(
      `<svg><style>.node { ${css} }</style><text>Diagram</text></svg>`,
    );

    expect(template.content.querySelector('style')).toBeNull();
    expect(template.content.querySelector('text')?.textContent).toBe('Diagram');
  });

  it('removes fetching presentation attributes and inline CSS, preserving fragment markers', async () => {
    const template = await sanitize(`<svg>
      <path fill='url("/**/#probe")' stroke='url(#arrow)' style='background:image-set("pixel.png" 1x)'/>
      <path filter='url("https://attacker.example/filter")'/>
    </svg>`);
    const [first, second] = template.content.querySelectorAll('path');

    expect(first.hasAttribute('fill')).toBe(false);
    expect(first.getAttribute('stroke')).toBe('url(#arrow)');
    expect(first.getAttribute('style')).not.toContain('image-set');
    expect(second.hasAttribute('filter')).toBe(false);
  });

  it('cannot select a host font through stylesheet, inline, inherited or SVG font declarations', async () => {
    const template = await sanitize(`<svg font-family="HostDownload">
      <style>
        #chart { font-family: 'HostDownload'; fill: #ececff; }
        #chart text { font: italic bold 18px/1.4 'HostDownload' !important; }
        #chart tspan { f\\6f nt-family: var(--host-font) !important; }
      </style>
      <g id="chart"><text style="font: italic bold 18px/1.4 HostDownload">One</text>
      <text font-family="HostDownload">Two</text><text><tspan>Inherited</tspan></text></g>
    </svg>`);
    const style = template.content.querySelector('style')?.textContent;

    expect(template.innerHTML).not.toContain('HostDownload');
    expect(style).toContain('fill: #ececff');
    expect(style).toContain('18px');
    expect(style).toContain('bold');
    for (const element of template.content.querySelectorAll('svg, g, text, tspan')) {
      expect(element.getAttribute('style')).toContain('font-family: system-ui, sans-serif');
      expect(element.getAttribute('style')).toContain('!important');
    }
    expect(template.content.querySelector('text')?.style.fontSize).toBe('18px');
    expect(template.content.querySelector('text')?.style.fontWeight).toBe('bold');
  });

  it('keeps light and dark theme colors, layout styles and the sanitized label text', async () => {
    const template = await sanitize(`<svg viewBox="0 0 100 50">
      <style>
        #chart .node rect { fill: #ececff; stroke: #9370db; }
        #chart.dark .node rect { fill: #1f2020; stroke: #ccc; }
        div.mermaidTooltip { position: absolute; z-index: 100; }
        #chart text { font-family: system-ui, sans-serif; font-size: 16px; }
      </style>
      <g class="node"><rect width="50" height="20"/><text><tspan>Dosing &amp;amp; Distribution</tspan></text></g>
    </svg>`);
    const style = template.content.querySelector('style')?.textContent;

    expect(style).toContain('fill: #ececff');
    expect(style).toContain('fill: #1f2020');
    expect(style).toContain('z-index: 100');
    expect(template.content.querySelector('rect')?.getAttribute('width')).toBe('50');
    expect(template.content.querySelector('tspan')?.textContent).toBe('Dosing & Distribution');
  });

  it('strips remote media, links and handlers before the SVG crosses the boundary', async () => {
    const template = await sanitize(`<svg>
      <foreignObject><a href="https://attacker.example">Link</a><img src="https://attacker.example/pixel"/></foreignObject>
      <foreignObject><table background="https://attacker.example/background"><tr><td>Label</td></tr></table></foreignObject>
      <image href="https://attacker.example/pixel"/><g onload="alert(1)"><text>Safe</text></g>
    </svg>`);

    expect(template.content.querySelector('a, img, image, script, iframe')).toBeNull();
    expect(template.innerHTML).not.toContain('attacker.example');
    expect(template.innerHTML).not.toContain('onload');
    expect(template.content.querySelector('text')?.textContent).toBe('Safe');
  });
});
