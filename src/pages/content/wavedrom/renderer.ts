import { isGenericLanguageLabel } from '../codeBlock';
import { resolveMermaidTheme } from '../mermaid/renderer';

/** WaveDrom theme policy (mirrors AionUi's WaveThemeMode). */
export type WaveThemeMode = 'auto' | 'light';

/** Resolve the effective diagram render theme from the policy + app theme. */
export const resolveWaveRenderTheme = (
  mode: WaveThemeMode,
  appTheme: 'light' | 'dark',
): 'light' | 'dark' => (mode === 'auto' ? appTheme : 'light');

/**
 * Hardcoded to 'light': the light diagram stays readable on any Gemini theme.
 * Flip to 'auto' to restore theme-following (and the dark skin's issues).
 */
export const WAVEDROM_THEME_MODE: WaveThemeMode = 'light';

/**
 * Deterministic backdrop colours paired to the skin.
 * Using the exact colour values instead of CSS tokens avoids the failure mode
 * where a token resolves to the wrong value (e.g. white strokes on white).
 */
export const PANEL_BG: Record<'light' | 'dark', string> = {
  light: '#f9fafb',
  dark: '#1a1a1a',
};

/**
 * The bundled dark skin's near-black fill classes (gap + multi-bit labels).
 * Remapped to mid-tone colours visible on the dark Gemini page.
 */
const DARK_SKIN_FILL_REMAP: Record<string, string> = {
  s6: '#4a4a4a', // gap (no signal)
  s8: '#5c5c5c', // multi-bit value '2'
  s9: '#3050b8', // '3'
  s10: '#4a8a2a', // '4'
  s11: '#b04a3a', // '5'
  s12: '#1a8a90', // '6'
  s13: '#8a3a8a', // '7'
  s14: '#7a7a7a', // '8'
  s15: '#7a4ac0', // '9'
};

/**
 * Replace the near-black `fill` values of the bundled dark skin's s6/s8–s15
 * classes with the dark-page-visible palette above.
 */
export const remapDarkSkinStyle = (styleText: string): string => {
  let remapped = styleText;
  for (const [className, fill] of Object.entries(DARK_SKIN_FILL_REMAP)) {
    remapped = remapped.replace(new RegExp(`\\.${className}\\{[^}]*\\}`, 'g'), (rule) =>
      rule.replace(/fill:\s*#[0-9a-fA-F]{3,8}/, `fill: ${fill}`),
    );
  }
  return remapped;
};

type WaveSkin = import('wavedrom').WaveSkin;
type OnmlTree = import('wavedrom').OnmlTree;
type WaveSource = import('wavedrom').WaveSource;

/** The subset of the WaveDrom API used by this renderer. */
interface WaveDromAPI {
  renderAny: (index: number, source: WaveSource, waveSkin?: WaveSkin) => OnmlTree;
  onml: { stringify: (tree: OnmlTree) => string };
}

interface WaveDromBundle {
  WaveDrom: WaveDromAPI;
  waveSkinDefault: WaveSkin;
  /** Bundled dark skin with near-black fills remapped for Gemini's dark page. */
  waveSkinDarkRemapped: WaveSkin;
}

/**
 * Strip fixed pixel `width`/`height` attributes from an SVG root that already
 * carries a `viewBox`, then inject `width="100%" height="100%"` so the diagram
 * fills its container (fullscreen overlay card).
 */
export const makeResponsiveSvg = (svg: string): string => {
  // Only rewrite the opening <svg …> tag.
  return svg.replace(/^(<svg\b[^>]*\bviewBox="[^"]*"[^>]*)>/, (match, attrs: string) => {
    const cleaned = attrs.replace(/\s+width="[^"]*"/g, '').replace(/\s+height="[^"]*"/g, '');
    return `${cleaned} width="100%" height="100%">`;
  });
};

/**
 * Return true when a code block is a WaveJSON timing diagram.
 * Requires a minimum length (to skip streaming/incomplete content) and
 * the presence of a `signal`, `assign`, or `reg` key (lenient JSON5 parse).
 */
export const isWaveJsonCode = (code: string): boolean => {
  const trimmed = code.trim();
  if (trimmed.length < 20) return false;
  // Fast path: the three top-level WaveJSON keys.
  if (!/["']?(signal|assign|reg)["']?\s*:/.test(trimmed)) return false;
  // Must look like a JSON object.
  if (!trimmed.startsWith('{')) return false;
  return true;
};

/**
 * Whether a code block is WaveDrom, from its language label (lowercase, null
 * when the block has none) and its source. Shared by Gemini and the `wavedrom`
 * plugin primitive, so every site decides the same way.
 */
export const shouldRenderWaveDrom = (language: string | null, code: string): boolean => {
  // Explicit WaveDrom labels always render.
  if (language === 'wavedrom' || language === 'wavejson') return true;
  // Specific language labels (json, typescript, …) skip WaveJSON detection:
  // WaveJSON is a niche format, and ordinary JSON output must not be
  // mistaken for a timing diagram.
  if (language && !isGenericLanguageLabel(language)) return false;
  // Content-based detection for unlabelled / generic blocks (Code snippet, 代码段, …).
  return isWaveJsonCode(code);
};

export const resolveGeminiTheme = (doc: Document, prefersDark: boolean): 'light' | 'dark' =>
  resolveMermaidTheme(doc, prefersDark) === 'dark' ? 'dark' : 'light';

export const getAppTheme = (): 'light' | 'dark' =>
  resolveGeminiTheme(document, window.matchMedia('(prefers-color-scheme: dark)').matches);

/** Owns the lazy bundle, load-failure latch and SVG IDs for this renderer lifetime. */
export const createWaveDromRenderer = () => {
  let bundleCache: WaveDromBundle | null = null;
  let bundleLoadFailed = false;
  let diagramIndex = 0;

  /**
   * Normalise a dynamically-imported CJS module to its `module.exports` object.
   * Bundlers wrap CJS `module.exports` as the namespace `.default`; the skins
   * files export skin *collections* (`{ default: <tree> }` / `{ dark: <tree> }`),
   * never a bare ONML tree — renderAny reads `skin.default` (or the first named
   * key) before indexing into the tree, so a bare array would select the first
   * node ('svg') and throw.
   */
  const asCjsExports = <T>(mod: unknown): T => {
    const exports = (mod as { default?: T }).default;
    return exports !== undefined ? exports : (mod as T);
  };

  /**
   * Dynamically load WaveDrom and its skins. Result is cached after the first
   * successful load; a failed load also short-circuits further attempts.
   */
  const loadWaveDrom = async (): Promise<WaveDromBundle | null> => {
    if (bundleCache) return bundleCache;
    if (bundleLoadFailed) return null;

    try {
      const [renderAnyMod, stringifyMod, darkMod, defaultMod] = await Promise.all([
        import('wavedrom/render-any'),
        import('onml/stringify.js'),
        import('wavedrom/skins/dark.js'),
        import('wavedrom/skins/default.js'),
      ]);

      const renderAny = asCjsExports<WaveDromAPI['renderAny']>(renderAnyMod);
      const stringify = asCjsExports<WaveDromAPI['onml']['stringify']>(stringifyMod);
      const WaveDrom: WaveDromAPI = { renderAny, onml: { stringify } };
      const waveSkinDefault = asCjsExports<WaveSkin>(defaultMod);
      const rawDarkSkin = asCjsExports<WaveSkin>(darkMod);

      // Remap the dark skin once; renderAny copies the style text verbatim so
      // remapping the shared tree covers every diagram surface.
      const waveSkinDarkRemapped = remapWaveSkinDark(rawDarkSkin);

      bundleCache = { WaveDrom, waveSkinDefault, waveSkinDarkRemapped };
      return bundleCache;
    } catch (err) {
      bundleLoadFailed = true;
      console.error('[Gemini Voyager] Failed to load WaveDrom library:', err);
      return null;
    }
  };

  /** Apply the fill remap to the bundled dark-skin OnmlTree. */
  const remapWaveSkinDark = (rawSkin: WaveSkin): WaveSkin => {
    const original = rawSkin.dark as unknown as OnmlTree | undefined;
    if (!original) return rawSkin;
    const styleElement = original[2];
    if (
      Array.isArray(styleElement) &&
      styleElement[0] === 'style' &&
      typeof styleElement[2] === 'string'
    ) {
      const tree = [...original] as OnmlTree;
      tree[2] = [styleElement[0], styleElement[1], remapDarkSkinStyle(styleElement[2])];
      return { dark: tree as unknown as Record<string, unknown> };
    }
    return rawSkin;
  };

  /**
   * Render WaveJSON source code into a sanitised SVG string, or null when the
   * code is not a valid waveform description. Parsing is lenient (JSON5) so
   * hand-written or LLM-generated WaveJSON with comments or trailing commas
   * still renders.
   */
  const render = async (code: string, isDark: boolean): Promise<string | null> => {
    const bundle = await loadWaveDrom();
    if (!bundle) return null;

    const { WaveDrom, waveSkinDefault, waveSkinDarkRemapped } = bundle;
    const skin = isDark ? waveSkinDarkRemapped : waveSkinDefault;

    try {
      const [JSON5Mod, DOMPurifyMod] = await Promise.all([import('json5'), import('dompurify')]);
      const parse = JSON5Mod.default?.parse ?? JSON5Mod.parse;
      const DOMPurify = DOMPurifyMod.default ?? DOMPurifyMod;
      const parsed: unknown = parse(code.trim());
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null;

      const source = parsed as WaveSource;
      const hasLanes =
        Array.isArray(source.signal) || Array.isArray(source.assign) || Array.isArray(source.reg);
      if (!hasLanes) return null;

      const tree = WaveDrom.renderAny(diagramIndex++, source, skin);
      const svgRaw = WaveDrom.onml.stringify(tree);
      // The SVG markup is library-generated from parsed WaveJSON, but the markup
      // still crosses innerHTML twice (inline container + fullscreen overlay), so
      // sanitise once here. The bundled dark-skin <style> block survives DOMPurify.
      const svgSanitized = DOMPurify.sanitize(svgRaw);
      return makeResponsiveSvg(svgSanitized);
    } catch {
      return null;
    }
  };

  /** Load the library ahead of the first render; false when it cannot load. */
  const load = async (): Promise<boolean> => (await loadWaveDrom()) !== null;

  return { render, load };
};

export type WaveDromRenderer = ReturnType<typeof createWaveDromRenderer>;
