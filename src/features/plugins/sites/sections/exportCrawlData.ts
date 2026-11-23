/**
 * The optional `exportThread` and `exportCrawl` sections of a `site.json`:
 * switches between export behaviours ChatGPT has already shipped with, so a
 * ChatGPT redesign that breaks one of them is answered by publishing data, not
 * a release. Every value names a code path the extension already carries and
 * tests; none describes a step, a selector or anything that runs.
 *
 * Each is its own top-level section: a client reads an unknown top-level
 * section as absent, but drops a whole known section that gains a key it does
 * not know. Here a problem never invalidates the adapter: an unusable section
 * reads as absent, and a bad field reads as that field's default. Both are
 * reported in `sectionIssues`, so `catalog:build` refuses to publish them;
 * an unknown key is reported too and otherwise ignored.
 *
 * Format 1:
 * - `exportThread.order`: where the whole conversation is read from, in turn:
 *   `["crawl", "api"]` (the default) walks the page and reads the conversation
 *   endpoint when the walk fails; `["api"]` reads only the endpoint;
 *   `["crawl"]` only walks the page.
 * - `exportCrawl`: how the page walk measures and scrolls the thread. `extent`
 *   (`outermostBox` default, `directChild` before November 2026),
 *   `upwardScroll` (`wheelRelease` default, `plain` before November 2026),
 *   `direction` (`auto` default, `normal`, `reverse`), and the timing fields
 *   `pollMs`, `settleMs`, `mountTimeoutMs`, `historyIdleMs` and
 *   `historyStallMs`, integers within {@link EXPORT_CRAWL_TIMING_RANGES}.
 */
import type { ManifestIssue } from '../../manifest/validate';

export const EXPORT_THREAD_SOURCES = ['crawl', 'api'] as const;
export type ExportThreadSource = (typeof EXPORT_THREAD_SOURCES)[number];

/** The orders a publisher may choose; anything else reads as the default. */
const EXPORT_THREAD_ORDERS: readonly (readonly ExportThreadSource[])[] = [
  ['crawl', 'api'],
  ['api'],
  ['crawl'],
];
export const DEFAULT_EXPORT_THREAD_ORDER: readonly ExportThreadSource[] = ['crawl', 'api'];

export interface ExportThreadSection {
  readonly format: 1;
  readonly order: readonly ExportThreadSource[];
}

export const EXPORT_CRAWL_EXTENTS = ['outermostBox', 'directChild'] as const;
export type ExportCrawlExtent = (typeof EXPORT_CRAWL_EXTENTS)[number];
export const EXPORT_CRAWL_UPWARD_SCROLLS = ['wheelRelease', 'plain'] as const;
export type ExportCrawlUpwardScroll = (typeof EXPORT_CRAWL_UPWARD_SCROLLS)[number];
export const EXPORT_CRAWL_DIRECTIONS = ['auto', 'normal', 'reverse'] as const;
export type ExportCrawlDirection = (typeof EXPORT_CRAWL_DIRECTIONS)[number];

/** Inclusive bounds, in milliseconds; each holds the crawl's packaged default. */
export const EXPORT_CRAWL_TIMING_RANGES = {
  pollMs: [10, 1_000],
  settleMs: [50, 5_000],
  mountTimeoutMs: [500, 30_000],
  historyIdleMs: [200, 10_000],
  historyStallMs: [1_000, 60_000],
} as const satisfies Record<string, readonly [number, number]>;
export type ExportCrawlTimingKey = keyof typeof EXPORT_CRAWL_TIMING_RANGES;

/** Only the fields the data set validly; the crawl's own defaults fill the rest. */
export type ExportCrawlSection = {
  readonly format: 1;
  readonly extent?: ExportCrawlExtent;
  readonly upwardScroll?: ExportCrawlUpwardScroll;
  readonly direction?: ExportCrawlDirection;
} & { readonly [key in ExportCrawlTimingKey]?: number };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isTimingKey(key: string): key is ExportCrawlTimingKey {
  return Object.hasOwn(EXPORT_CRAWL_TIMING_RANGES, key);
}

function oneOf<T extends string>(options: readonly T[], value: unknown): value is T {
  return typeof value === 'string' && (options as readonly string[]).includes(value);
}

/** Read `site.exportThread`. Absent or unusable reads as no section: the default order. */
export function readExportThreadSection(
  raw: unknown,
  path = 'exportThread',
): { readonly exportThread?: ExportThreadSection; readonly issues: readonly ManifestIssue[] } {
  if (raw === undefined) return { issues: [] };
  if (!isRecord(raw)) return { issues: [{ path, message: 'must be an object' }] };
  if (raw.format !== 1) return { issues: [{ path: `${path}.format`, message: 'unknown format' }] };
  const issues: ManifestIssue[] = Object.keys(raw)
    .filter((key) => key !== 'format' && key !== 'order')
    .map((key) => ({ path: `${path}.${key}`, message: 'unknown key' }));
  const listed = raw.order;
  const order = Array.isArray(listed)
    ? EXPORT_THREAD_ORDERS.find(
        (known) =>
          known.length === listed.length && known.every((source, i) => listed[i] === source),
      )
    : undefined;
  if (!order) {
    issues.push({
      path: `${path}.order`,
      message: 'must be ["crawl", "api"], ["api"] or ["crawl"]',
    });
    return { issues };
  }
  return { exportThread: { format: 1, order: [...order] }, issues };
}

/** Read `site.exportCrawl`. A bad field reads as its default; an unusable section as absent. */
export function readExportCrawlSection(
  raw: unknown,
  path = 'exportCrawl',
): { readonly exportCrawl?: ExportCrawlSection; readonly issues: readonly ManifestIssue[] } {
  if (raw === undefined) return { issues: [] };
  if (!isRecord(raw)) return { issues: [{ path, message: 'must be an object' }] };
  if (raw.format !== 1) return { issues: [{ path: `${path}.format`, message: 'unknown format' }] };
  const issues: ManifestIssue[] = [];
  const section: { -readonly [key in keyof ExportCrawlSection]: ExportCrawlSection[key] } = {
    format: 1,
  };
  for (const [key, value] of Object.entries(raw)) {
    const at = `${path}.${key}`;
    if (key === 'format') continue;
    if (key === 'extent') {
      if (oneOf(EXPORT_CRAWL_EXTENTS, value)) section.extent = value;
      else issues.push({ path: at, message: `must be one of ${EXPORT_CRAWL_EXTENTS.join(', ')}` });
    } else if (key === 'upwardScroll') {
      if (oneOf(EXPORT_CRAWL_UPWARD_SCROLLS, value)) section.upwardScroll = value;
      else
        issues.push({
          path: at,
          message: `must be one of ${EXPORT_CRAWL_UPWARD_SCROLLS.join(', ')}`,
        });
    } else if (key === 'direction') {
      if (oneOf(EXPORT_CRAWL_DIRECTIONS, value)) section.direction = value;
      else
        issues.push({ path: at, message: `must be one of ${EXPORT_CRAWL_DIRECTIONS.join(', ')}` });
    } else if (isTimingKey(key)) {
      const [min, max] = EXPORT_CRAWL_TIMING_RANGES[key];
      if (typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max) {
        section[key] = value;
      } else {
        issues.push({ path: at, message: `must be an integer from ${min} to ${max}` });
      }
    } else {
      issues.push({ path: at, message: 'unknown key' });
    }
  }
  return { exportCrawl: section, issues };
}
