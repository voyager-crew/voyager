import { isGenericLanguageLabel } from '../codeBlock';

/**
 * Chart series types understood by the renderer. Anything outside this set is
 * not treated as an ECharts chart, so ordinary JSON output is never mistaken
 * for one (the same philosophy as the WaveDrom renderer's detection).
 */
const CHART_TYPES = new Set([
  'line',
  'bar',
  'pie',
  'scatter',
  'effectscatter',
  'radar',
  'tree',
  'treemap',
  'sunburst',
  'boxplot',
  'candlestick',
  'heatmap',
  'graph',
  'lines',
  'funnel',
  'gauge',
  'sankey',
  'parallel',
  'pictorialbar',
  'themeriver',
  'custom',
]);

/**
 * Chart types that render without any axis/coordinate-system key, so a single
 * strong feature (the series type) is enough to recognise them.
 */
const AXIS_FREE_TYPES = new Set([
  'pie',
  'gauge',
  'funnel',
  'treemap',
  'sunburst',
  'graph',
  'tree',
  'sankey',
]);

/** Coordinate systems available in the intentionally narrow modular runtime. */
const SUPPORTED_COORDINATE_SYSTEMS = new Set([
  'cartesian2d',
  'polar',
  'radar',
  'calendar',
  'parallel',
  'singleaxis',
  'matrix',
  'none',
  'view',
]);

/** Coordinate-system / structure keys that anchor axis-based charts. */
const STRUCTURE_KEYS = [
  'xAxis',
  'yAxis',
  'radar',
  'polar',
  'angleAxis',
  'radiusAxis',
  'grid',
  'timeline',
  'calendar',
  'parallel',
  'parallelAxis',
  'singleAxis',
  'matrix',
] as const;

const STRUCTURE_KEY_PATTERN = new RegExp(`["']?(?:${STRUCTURE_KEYS.join('|')})["']?\\s*:`);

/**
 * Strip JS variable-assignment wrappers and fence markers from ECharts source
 * (e.g. `option = {...}`, `const option = {...};`, `export default option;`),
 * leaving the object literal itself.
 *
 * @internal Exported for testing.
 */
export const stripEChartsAssignment = (raw: string): string => {
  let text = raw.trim();

  // Remove leading/trailing markdown code fence markers if present.
  text = text.replace(/^```(?:echarts?|chart)?\s*/i, '').replace(/\s*```$/, '');

  // Strip leading comments and variable/export assignment prefixes.
  text = text.replace(
    /^(?:\s*\/\/[^\n]*\n|\s*\/\*[\s\S]*?\*\/\s*)*(?:const|let|var)?\s*\w+\s*=\s*/m,
    '',
  );

  // Strip trailing export statements or semicolons.
  text = text.replace(/export\s+default\s+\w+\s*;?$/, '');
  text = text.trim().replace(/;+$/, '');

  return text;
};

/**
 * Strong-shape check: an ECharts option (or timeline `baseOption`) must carry
 * one or more known series types, plus a registered structure key for
 * axis-based charts. Unsupported coordinates are rejected across timeline and
 * responsive overrides before ECharts sees them.
 *
 * @internal Exported for testing.
 */
export const isEChartsOptionObject = (obj: unknown): obj is Record<string, unknown> => {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return false;
  const o = obj as Record<string, unknown>;
  if (containsEChartsImageSource(o)) return false;
  const baseOption = o['baseOption'];
  const validationRoot =
    baseOption !== null && typeof baseOption === 'object' && !Array.isArray(baseOption)
      ? (baseOption as Record<string, unknown>)
      : o;

  const timelineOptions = Array.isArray(o['options']) ? o['options'] : [];
  const mediaOptions = Array.isArray(o['media'])
    ? o['media'].map((entry) =>
        entry !== null && typeof entry === 'object' && !Array.isArray(entry)
          ? (entry as Record<string, unknown>)['option']
          : undefined,
      )
    : [];
  const optionLayers = [o, validationRoot, ...timelineOptions, ...mediaOptions].filter(
    (entry): entry is Record<string, unknown> =>
      entry !== null && typeof entry === 'object' && !Array.isArray(entry),
  );
  const hasUnsupportedRuntimeSeries = optionLayers.some((layer) => {
    // GeoComponent is deliberately absent from the extension-safe runtime.
    if ('geo' in layer) return true;

    const layerSeries = layer['series'];
    const entries = Array.isArray(layerSeries) ? layerSeries : [layerSeries];
    return entries.some((entry) => {
      if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) return false;
      const seriesOption = entry as Record<string, unknown>;
      const type = seriesOption['type'];
      if (
        type !== undefined &&
        (typeof type !== 'string' || !CHART_TYPES.has(type.toLowerCase()))
      ) {
        return true;
      }
      const coordinateSystem = seriesOption['coordinateSystem'];
      return (
        coordinateSystem !== undefined &&
        (typeof coordinateSystem !== 'string' ||
          !SUPPORTED_COORDINATE_SYSTEMS.has(coordinateSystem.toLowerCase()))
      );
    });
  });
  if (hasUnsupportedRuntimeSeries) return false;

  const candidateLayers =
    'series' in validationRoot
      ? [validationRoot]
      : [...timelineOptions, ...mediaOptions].filter(
          (layer): layer is Record<string, unknown> =>
            layer !== null &&
            typeof layer === 'object' &&
            !Array.isArray(layer) &&
            'series' in layer,
        );

  return candidateLayers.some((layer) => {
    const series = layer['series'];
    const seriesEntries = Array.isArray(series) ? series : [series];
    if (seriesEntries.length === 0) return false;

    const chartTypes: string[] = [];
    for (const entry of seriesEntries) {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return false;
      const type = (entry as Record<string, unknown>)['type'];
      if (typeof type !== 'string') return false;
      const normalizedType = type.toLowerCase();
      if (!CHART_TYPES.has(normalizedType)) return false;
      chartTypes.push(normalizedType);
    }

    if (chartTypes.some((type) => AXIS_FREE_TYPES.has(type))) return true;
    const structureLayers = layer === validationRoot ? optionLayers : [validationRoot, layer];
    return STRUCTURE_KEYS.some((key) => structureLayers.some((entry) => key in entry));
  });
};

/**
 * JSON chart options must never trigger an implicit image request. ECharts can
 * load images from both `image://…` symbols and object properties named
 * `image` (for example `graphic.style.image`). Reject those options entirely;
 * image-backed charts are outside this renderer's deliberately narrow scope.
 */
const containsEChartsImageSource = (value: unknown, key = ''): boolean => {
  if (typeof value === 'string') {
    return key.toLowerCase() === 'image' || /^image:\/\//i.test(value.trim());
  }
  if (Array.isArray(value)) return value.some((entry) => containsEChartsImageSource(entry));
  if (value === null || typeof value !== 'object') return false;
  return Object.entries(value).some(([entryKey, entry]) =>
    containsEChartsImageSource(entry, entryKey),
  );
};

const stripTitleLinksInLayer = (option: Record<string, unknown>): Record<string, unknown> => {
  const stripLinkFields = (entry: unknown): unknown => {
    if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) return entry;
    const safeEntry = { ...(entry as Record<string, unknown>) };
    delete safeEntry['link'];
    delete safeEntry['sublink'];
    delete safeEntry['target'];
    delete safeEntry['subtarget'];
    return safeEntry;
  };

  const title = option['title'];
  if (Array.isArray(title)) return { ...option, title: title.map(stripLinkFields) };
  if (title !== null && typeof title === 'object') {
    return { ...option, title: stripLinkFields(title) };
  }
  return option;
};

const stripDataViewInLayer = (option: Record<string, unknown>): Record<string, unknown> => {
  const stripFeature = (entry: unknown): unknown => {
    if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) return entry;
    const toolbox = entry as Record<string, unknown>;
    const feature = toolbox['feature'];
    if (feature === null || typeof feature !== 'object' || Array.isArray(feature)) return entry;
    const safeFeature = { ...(feature as Record<string, unknown>) };
    delete safeFeature['dataView'];
    return { ...toolbox, feature: safeFeature };
  };

  const toolbox = option['toolbox'];
  if (Array.isArray(toolbox)) return { ...option, toolbox: toolbox.map(stripFeature) };
  if (toolbox !== null && typeof toolbox === 'object') {
    return { ...option, toolbox: stripFeature(toolbox) };
  }
  return option;
};

const stripSeriesNavigationInLayer = (option: Record<string, unknown>): Record<string, unknown> => {
  const stripDataNavigation = (entry: unknown): unknown => {
    if (Array.isArray(entry)) return entry.map(stripDataNavigation);
    if (entry === null || typeof entry !== 'object') return entry;
    const safeEntry = { ...(entry as Record<string, unknown>) };
    delete safeEntry['link'];
    delete safeEntry['target'];
    if ('children' in safeEntry) {
      safeEntry['children'] = stripDataNavigation(safeEntry['children']);
    }
    return safeEntry;
  };

  const stripSeriesNavigation = (entry: unknown): unknown => {
    if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) return entry;
    const safeEntry = { ...(entry as Record<string, unknown>) };
    if (safeEntry['nodeClick'] === 'link') delete safeEntry['nodeClick'];
    if ('data' in safeEntry) safeEntry['data'] = stripDataNavigation(safeEntry['data']);
    return safeEntry;
  };

  const series = option['series'];
  if (Array.isArray(series)) {
    return { ...option, series: series.map(stripSeriesNavigation) };
  }
  if (series !== null && typeof series === 'object') {
    return { ...option, series: stripSeriesNavigation(series) };
  }
  return option;
};

const forceRichTextTooltipsInLayer = (option: Record<string, unknown>): Record<string, unknown> => {
  const tooltip = option['tooltip'];
  const series = option['series'];
  const seriesEntries = Array.isArray(series) ? series : [series];
  const hasSeriesTooltip = seriesEntries.some(
    (entry) =>
      entry !== null && typeof entry === 'object' && !Array.isArray(entry) && 'tooltip' in entry,
  );

  const forceTooltipRenderMode = (entry: unknown): unknown => {
    if (Array.isArray(entry)) return entry.map(forceTooltipRenderMode);
    return entry !== null && typeof entry === 'object'
      ? { ...(entry as Record<string, unknown>), renderMode: 'richText' }
      : entry;
  };

  const forceSeriesTooltip = (entry: unknown): unknown => {
    if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) return entry;
    const seriesEntry = entry as Record<string, unknown>;
    return 'tooltip' in seriesEntry
      ? { ...seriesEntry, tooltip: forceTooltipRenderMode(seriesEntry['tooltip']) }
      : entry;
  };

  const safeOption = hasSeriesTooltip
    ? {
        ...option,
        series: Array.isArray(series) ? series.map(forceSeriesTooltip) : forceSeriesTooltip(series),
      }
    : option;

  if (Array.isArray(tooltip)) {
    return {
      ...safeOption,
      tooltip: forceTooltipRenderMode(tooltip),
    };
  }

  if (tooltip !== null && typeof tooltip === 'object') {
    return { ...safeOption, tooltip: forceTooltipRenderMode(tooltip) };
  }

  return hasSeriesTooltip ? { ...safeOption, tooltip: { renderMode: 'richText' } } : safeOption;
};

const enableAriaInLayer = (option: Record<string, unknown>): Record<string, unknown> => {
  const aria = option['aria'];
  return {
    ...option,
    aria:
      aria !== null && typeof aria === 'object' && !Array.isArray(aria)
        ? { ...(aria as Record<string, unknown>), enabled: true }
        : { enabled: true },
  };
};

export const sanitizeEChartsOption = (
  option: Record<string, unknown>,
  backgroundColor: string,
): Record<string, unknown> => {
  const sanitizeLayer = (layer: Record<string, unknown>): Record<string, unknown> => ({
    ...enableAriaInLayer(
      forceRichTextTooltipsInLayer(
        stripSeriesNavigationInLayer(stripTitleLinksInLayer(stripDataViewInLayer(layer))),
      ),
    ),
    backgroundColor,
  });

  let safeOption = sanitizeLayer(option);
  const baseOption = option['baseOption'];
  if (baseOption !== null && typeof baseOption === 'object' && !Array.isArray(baseOption)) {
    safeOption = {
      ...safeOption,
      baseOption: sanitizeLayer(baseOption as Record<string, unknown>),
    };
  }

  const timelineOptions = option['options'];
  if (Array.isArray(timelineOptions)) {
    safeOption = {
      ...safeOption,
      options: timelineOptions.map((entry) =>
        entry !== null && typeof entry === 'object' && !Array.isArray(entry)
          ? sanitizeLayer(entry as Record<string, unknown>)
          : entry,
      ),
    };
  }

  const media = option['media'];
  if (Array.isArray(media)) {
    safeOption = {
      ...safeOption,
      media: media.map((entry) => {
        if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) return entry;
        const mediaEntry = entry as Record<string, unknown>;
        const mediaOption = mediaEntry['option'];
        return mediaOption !== null &&
          typeof mediaOption === 'object' &&
          !Array.isArray(mediaOption)
          ? {
              ...mediaEntry,
              option: sanitizeLayer(mediaOption as Record<string, unknown>),
            }
          : entry;
      }),
    };
  }
  return safeOption;
};

/**
 * Fast, synchronous content check for unlabelled / generically-labelled code
 * blocks. Uses regex only (no JSON5 parse) so the MutationObserver pass stays
 * cheap; the full parse happens later in the render path.
 *
 * @internal Exported for testing.
 */
export const isEChartsOptionCode = (code: string): boolean => {
  const trimmed = code.trim();
  if (trimmed.length < 20) return false;
  if (/["']?geo["']?\s*:/.test(trimmed)) return false;
  if (/image:\/\//i.test(trimmed) || /["']?image["']?\s*:/.test(trimmed)) return false;

  const coordinateSystems = [
    ...trimmed.matchAll(/["']?coordinateSystem["']?\s*:\s*["']([a-zA-Z0-9]+)["']/g),
  ].map((match) => match[1].toLowerCase());
  if (coordinateSystems.some((value) => !SUPPORTED_COORDINATE_SYSTEMS.has(value))) return false;

  // Fast path: top-level series key.
  if (!/["']?series["']?\s*:/.test(trimmed)) return false;

  // Any `type` value in the block must be a known chart type (axis types like
  // 'value'/'category' never match, so axis-only JSON is rejected).
  const chartTypes = [...trimmed.matchAll(/["']?type["']?\s*:\s*["']([a-zA-Z]+)["']/g)]
    .map((match) => match[1].toLowerCase())
    .filter((t) => CHART_TYPES.has(t));
  if (chartTypes.length === 0) return false;

  // Axis-free chart types are recognised by their type alone; the rest need a
  // coordinate-system key.
  if (chartTypes.some((t) => AXIS_FREE_TYPES.has(t))) return true;
  return STRUCTURE_KEY_PATTERN.test(trimmed);
};

/**
 * Parse ECharts option source into a validated option object, or null when it
 * is not a chart configuration. JSON5-lenient with a brace-extraction
 * fallback; never evaluates code.
 *
 * @internal Exported for testing.
 */
export const parseEChartsOption = async (code: string): Promise<Record<string, unknown> | null> => {
  if (!code) return null;
  const cleaned = stripEChartsAssignment(code);

  const JSON5Mod = await import('json5');
  const parse = JSON5Mod.default?.parse ?? JSON5Mod.parse;

  try {
    const parsed = parse(cleaned);
    if (isEChartsOptionObject(parsed)) return parsed;
  } catch {
    // Not directly parseable — fall through to the brace-extraction fallback.
  }

  // Fallback: extract the first object literal when leading text (e.g.
  // a comment or a broken assignment prefix) precedes the option.
  const firstBrace = cleaned.indexOf('{');
  const lastBrace = cleaned.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    try {
      const parsedSub = parse(cleaned.slice(firstBrace, lastBrace + 1));
      if (isEChartsOptionObject(parsedSub)) return parsedSub;
    } catch {
      // Not a parseable option; the block stays in code view.
    }
  }
  return null;
};

export function getCodeBlockLanguage(codeEl: Element): string | null {
  const codeBlock = codeEl.closest('.code-block, code-block');
  if (!codeBlock) return null;
  const decoration = codeBlock.querySelector('.code-block-decoration');
  if (!decoration) return null;
  const langSpan = decoration.querySelector(':scope > span');
  const language = langSpan?.textContent?.trim().toLowerCase();
  return language || null;
}

export function isEChartsLanguageEligible(codeEl: Element): boolean {
  const language = getCodeBlockLanguage(codeEl);
  return (
    !language ||
    language === 'echarts' ||
    language === 'echart' ||
    language === 'chart' ||
    isGenericLanguageLabel(language)
  );
}

/**
 * Whether a code block is an ECharts option, from its language label
 * (lowercase, null when the block has none) and its source. Shared by Gemini
 * and the `echarts` plugin primitive, so every site decides the same way.
 */
export const shouldRenderECharts = (language: string | null, code: string): boolean => {
  // Explicit ECharts labels always render.
  if (language === 'echarts' || language === 'echart' || language === 'chart') return true;
  // Specific language labels (json, typescript, …) skip chart detection: ECharts
  // options are a niche format, and ordinary JSON output must not be mistaken for a chart.
  if (language && !isGenericLanguageLabel(language)) return false;
  // Unlabelled or generic blocks (Code snippet, 代码段, …): detect from the content.
  return isEChartsOptionCode(code);
};
