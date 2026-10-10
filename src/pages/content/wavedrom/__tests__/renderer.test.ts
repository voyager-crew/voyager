import { describe, expect, it, vi } from 'vitest';

import {
  resolveWaveRenderTheme,
  remapDarkSkinStyle,
  makeResponsiveSvg,
  isWaveJsonCode,
  resolveGeminiTheme,
  sanitizeWaveSvg,
} from '../renderer';
import { DARK_SKIN_STYLE, createWaveDromFixture } from './fixture';

const fixture = createWaveDromFixture();

describe('resolveWaveRenderTheme', () => {
  it('follows the app theme in auto mode', () => {
    expect(resolveWaveRenderTheme('auto', 'dark')).toBe('dark');
    expect(resolveWaveRenderTheme('auto', 'light')).toBe('light');
  });

  it('stays light in light-only mode regardless of the app theme', () => {
    expect(resolveWaveRenderTheme('light', 'dark')).toBe('light');
    expect(resolveWaveRenderTheme('light', 'light')).toBe('light');
  });
});

describe('remapDarkSkinStyle', () => {
  it('rewrites near-black s6 fill to mid-tone', () => {
    const result = remapDarkSkinStyle('.s6{fill:#000000;stroke:none}');
    expect(result).toContain('fill: #4a4a4a');
    expect(result).not.toContain('#000000');
  });

  it('rewrites all targeted classes', () => {
    const result = remapDarkSkinStyle(DARK_SKIN_STYLE);
    expect(result).toContain('fill: #4a4a4a'); // s6
    expect(result).toContain('fill: #5c5c5c'); // s8
    expect(result).toContain('fill: #3050b8'); // s9
    expect(result).toContain('fill: #4a8a2a'); // s10
    expect(result).toContain('fill: #b04a3a'); // s11
    expect(result).toContain('fill: #1a8a90'); // s12
    expect(result).toContain('fill: #8a3a8a'); // s13
    expect(result).toContain('fill: #7a7a7a'); // s14
    expect(result).toContain('fill: #7a4ac0'); // s15
  });

  it('does not contain any of the original near-black fills', () => {
    const result = remapDarkSkinStyle(DARK_SKIN_STYLE);
    expect(result).not.toMatch(
      /(\.s[0-9]+)\{[^}]*fill:\s*#(?:000000|000|0010c0|2d6500|870500|007a80|680066|5f5f5f|2e005e)/,
    );
  });

  it('leaves the light skin (no matching classes) unchanged', () => {
    const lightStyle = '.s0{fill:#ffffff}.s1{stroke:#000000}';
    expect(remapDarkSkinStyle(lightStyle)).toBe(lightStyle);
  });
});

describe('remapDarkSkinStyle against the real bundled dark skin', () => {
  it('remaps every near-black fill of the real bundled dark skin', async () => {
    const actual =
      await vi.importActual<typeof import('wavedrom/skins/dark.js')>('wavedrom/skins/dark.js');
    const tree = actual.default.dark as unknown as [string, unknown, [string, unknown, string]];
    const remapped = remapDarkSkinStyle(tree[2][2]);
    expect(remapped).toContain('fill: #4a4a4a');
    expect(remapped).toContain('fill: #3050b8');
    expect(remapped).toContain('fill: #7a4ac0');
    expect(remapped).not.toMatch(
      /(\.s[0-9]+)\{[^}]*fill:\s*#(?:000000|000|0010c0|2d6500|870500|007a80|680066|5f5f5f|2e005e)/,
    );
  });
});

describe('makeResponsiveSvg', () => {
  it('replaces fixed pixel dimensions with 100% on SVGs that have a viewBox', () => {
    const input =
      '<svg xmlns="http://www.w3.org/2000/svg" width="800" height="200" viewBox="0 0 800 200"><g/></svg>';
    const result = makeResponsiveSvg(input);
    expect(result).toContain('width="100%"');
    expect(result).toContain('height="100%"');
    expect(result).not.toMatch(/width="800"/);
    expect(result).not.toMatch(/height="200"/);
  });

  it('leaves SVGs without a viewBox untouched', () => {
    const input = '<svg width="800" height="200"><g/></svg>';
    expect(makeResponsiveSvg(input)).toBe(input);
  });

  it('preserves all other attributes', () => {
    const input =
      '<svg xmlns="http://www.w3.org/2000/svg" id="foo" width="100" height="50" viewBox="0 0 100 50"><g/></svg>';
    const result = makeResponsiveSvg(input);
    expect(result).toContain('xmlns="http://www.w3.org/2000/svg"');
    expect(result).toContain('id="foo"');
    expect(result).toContain('viewBox="0 0 100 50"');
  });
});

describe('isWaveJsonCode', () => {
  it('detects a minimal valid WaveJSON object', () => {
    expect(isWaveJsonCode('{"signal": [{"name":"clk","wave":"p..."}]}')).toBe(true);
  });

  it('detects assign-based WaveJSON', () => {
    expect(isWaveJsonCode('{"assign": [["out",["and","a","b"]]]}')).toBe(true);
  });

  it('detects reg-based WaveJSON', () => {
    expect(isWaveJsonCode('{"reg": [{"bits":8}]}')).toBe(true);
  });

  it('rejects plain JSON without signal/assign/reg', () => {
    expect(isWaveJsonCode('{"foo": "bar", "baz": 42}')).toBe(false);
  });

  it('rejects Mermaid code', () => {
    expect(isWaveJsonCode('graph LR\n  A-->B\n  B-->C')).toBe(false);
  });

  it('rejects strings too short to be complete', () => {
    expect(isWaveJsonCode('{"signal":[{}')).toBe(false);
  });

  it('rejects non-object JSON', () => {
    expect(isWaveJsonCode('[{"signal": []}]')).toBe(false);
  });
});

describe('resolveGeminiTheme', () => {
  const make = (html: string): Document => {
    const doc = document.implementation.createHTMLDocument();
    doc.body.innerHTML = html;
    return doc;
  };

  it('returns dark for an explicit .theme-host.dark-theme element', () => {
    const doc = make('<div class="theme-host dark-theme"></div>');
    expect(resolveGeminiTheme(doc, false)).toBe('dark');
  });

  it('returns light for an explicit .theme-host.light-theme element', () => {
    const doc = make('<div class="theme-host light-theme"></div>');
    expect(resolveGeminiTheme(doc, true)).toBe('light');
  });

  it('falls back to the media query when no explicit marker is present', () => {
    expect(resolveGeminiTheme(document.implementation.createHTMLDocument(), true)).toBe('dark');
    expect(resolveGeminiTheme(document.implementation.createHTMLDocument(), false)).toBe('light');
  });
});

describe('WaveDrom renderer sanitisation', () => {
  it('strips script and event handlers from library-generated SVG', async () => {
    const stringifyMod = await import('onml/stringify.js');
    vi.mocked(stringifyMod.default).mockReturnValue(
      '<svg viewBox="0 0 100 50"><script>alert(1)</script><g onload="alert(2)"><text>ok</text></g></svg>',
    );
    const svg = await fixture.renderer.render('{"signal": [{"name":"clk","wave":"p..."}]}', false);
    expect(svg).not.toBeNull();
    expect(svg).not.toContain('<script');
    expect(svg).not.toContain('onload');
    expect(svg).toContain('viewBox="0 0 100 50"');
    expect(svg).toContain('<text>ok</text>');
  });

  it('keeps the dark-skin <style> block when sanitising', async () => {
    const stringifyMod = await import('onml/stringify.js');
    vi.mocked(stringifyMod.default).mockReturnValue(
      '<svg viewBox="0 0 100 50"><defs><style>.s6{fill:#000000}</style></defs><g/></svg>',
    );
    const svg = await fixture.renderer.render('{"signal": [{"name":"clk","wave":"p..."}]}', true);
    expect(svg).not.toBeNull();
    expect(svg).toContain('<style>');
  });
});

describe('WaveDrom renderer skin collections', () => {
  it('passes skin collections (not bare trees) to renderAny', async () => {
    const renderAnyMod = await import('wavedrom/render-any');
    const renderAnyMock = vi.mocked(renderAnyMod.default);
    const code = '{"signal": [{"name":"clk","wave":"p..."}]}';

    await fixture.renderer.render(code, false);
    const lightSkin = renderAnyMock.mock.calls[0]?.[2] as Record<string, unknown>;
    // renderAny reads `skin.default` / the first named key before indexing the
    // tree; a bare ONML array would select the first node ('svg') and throw.
    expect(lightSkin).toEqual(expect.objectContaining({ default: expect.any(Array) }));

    await fixture.renderer.render(code, true);
    const darkSkin = renderAnyMock.mock.calls[1]?.[2] as Record<string, unknown>;
    expect(darkSkin).toEqual(expect.objectContaining({ dark: expect.any(Array) }));
  });
});

describe('sanitizeWaveSvg', () => {
  it('keeps same-document wave bricks and drops references to other documents', async () => {
    const DOMPurify = (await import('dompurify')).default;
    const svg = sanitizeWaveSvg(
      DOMPurify,
      '<svg><defs><g id="pclk"></g></defs><g id="wavelane_draw_0_0">' +
        '<use xlink:href="#pclk"></use><use href="https://elsewhere.example/a.svg#b"></use>' +
        '<use xlink:href="data:image/svg+xml,x#a"></use></g></svg>',
    );
    const lane = new DOMParser()
      .parseFromString(svg, 'text/html')
      .querySelector('[id="wavelane_draw_0_0"]');
    const hrefs = [...(lane?.querySelectorAll('use') ?? [])].map(
      (use) => use.getAttribute('xlink:href') ?? use.getAttribute('href'),
    );
    expect(hrefs).toEqual(['#pclk']);
  });
});
