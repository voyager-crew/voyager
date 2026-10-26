import { hashString53 } from '@/core/utils/hash';
import {
  type ContentExtractor,
  type ExtractedContent,
  createContentExtractor,
} from '@/features/export/services/DOMContentExtractor';
import { stripExportArtifacts } from '@/features/export/services/exportDomPolicy';
import type { SiteAdapter } from '@/features/plugins/types';
import {
  DIAGRAM_OWNER_ATTR,
  provideDiagramExport,
  readDiagramExport,
} from '@/features/plugins/verbs/diagramExportRegistry';

import { exportSiteSnapshot } from '../adapter/exportSiteSnapshot';
import type { ExportPlatformAdapter } from '../adapter/platformAdapters';
import type { ExportSelectionOptions } from '../adapter/type';
import { throwIfExportCancelled } from '../exportCancellation';
import {
  type CatalogMountedSnapshot,
  type CatalogSnapshot,
  createCatalogSnapshotAccumulator,
} from './catalogReaderMerge';

export type { CatalogSnapshot } from './catalogReaderMerge';
export type CatalogCompleteness = 'complete' | 'partial' | 'unknown';
export type CatalogReadReason = 'generating' | 'route' | 'timeout' | 'identity' | 'top';

export interface CatalogReadResult {
  readonly snapshots: CatalogSnapshot[];
  readonly completeness: CatalogCompleteness;
  readonly reason?: CatalogReadReason;
}

export interface CatalogReadTiming {
  readonly pollMs: number;
  readonly stableSamples: number;
  readonly topTimeoutMs: number;
  readonly timeoutMs: number;
}

const DEFAULT_TIMING: CatalogReadTiming = {
  pollMs: 150,
  stableSamples: 3,
  topTimeoutMs: 6_000,
  timeoutMs: 120_000,
};
const EDGE_TOLERANCE = 2;
const STEP_VIEWPORT_FRACTION = 0.5;

function routeKey(url: string): string {
  const parsed = new URL(url, location.href);
  return `${parsed.origin}${parsed.pathname}${parsed.search}`;
}

/** Capture rich content while mounted; later recycling cannot change the exported body. */
function mountedSnapshots(
  site: SiteAdapter,
  root: ParentNode,
  extractor: ContentExtractor,
): CatalogMountedSnapshot[] {
  const user = site.selectors.userTurn;
  const assistant = site.selectors.assistantTurn;
  if (!user || !assistant) return [];
  const elements = Array.from(root.querySelectorAll<HTMLElement>(`${user}, ${assistant}`));
  // Complex :has selector lists must keep DOM order even in engines that group their matches.
  elements.sort((a, b) =>
    a === b ? 0 : a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1,
  );
  const ids = new Set<string>();
  return elements
    .filter((element) => !elements.some((other) => other !== element && other.contains(element)))
    .map((hostElement, index) => {
      const role = hostElement.matches(user) ? 'user' : 'assistant';
      const element = hostElement.cloneNode(true) as HTMLElement;
      const liveBlocks = Array.from(hostElement.querySelectorAll(`[${DIAGRAM_OWNER_ATTR}]`));
      const clonedBlocks = Array.from(element.querySelectorAll(`[${DIAGRAM_OWNER_ATTR}]`));
      stripExportArtifacts(element);
      element
        .querySelectorAll('.gv-export-msg-selector, [data-gv-component], [data-gv-layer]')
        .forEach((control) => control.remove());
      for (const node of [element, ...Array.from(element.querySelectorAll('*'))]) {
        node.classList.remove('gv-export-msg-host', 'gv-export-msg-selected', 'gv-export-msg-room');
      }
      element.querySelectorAll('[role="button"]').forEach((control) => control.remove());
      if (site.selectors.thinkingBlock) {
        element
          .querySelectorAll(site.selectors.thinkingBlock)
          .forEach((thought) => thought.remove());
      }
      const withdraw = clonedBlocks.map((block, index) => {
        const drawn = liveBlocks[index] ? readDiagramExport(liveBlocks[index]) : null;
        return drawn && element.contains(block)
          ? provideDiagramExport(block, () => drawn)
          : () => {};
      });
      let content: ExtractedContent;
      try {
        content =
          role === 'user'
            ? extractor.extractUserContent(element)
            : extractor.extractAssistantContent(element);
      } finally {
        withdraw.forEach((release) => release());
      }
      const messageKey = site.export?.messageKey;
      const messageValue = messageKey
        ? hostElement.closest(`[${messageKey}]`)?.getAttribute(messageKey)
        : undefined;
      const nativeKey =
        site.export?.read === 'mounted'
          ? site.turnKeyAttributes
              ?.map((attribute) => {
                const owner = hostElement.closest(`[${attribute}]`);
                const value =
                  owner?.getAttribute(attribute) ??
                  hostElement.querySelector(`[${attribute}]`)?.getAttribute(attribute);
                return value ? `${attribute}:${value}` : undefined;
              })
              .find((value) => value !== undefined)
          : undefined;
      const nativeId = messageValue
        ? `${messageKey}:${messageValue}`
        : nativeKey
          ? `${role}:${nativeKey}`
          : undefined;
      const fingerprint = hashString53(
        `${role}\u0000${content.text}\u0000${content.html}\u0000${JSON.stringify(content.attachments)}`,
      );
      const id = nativeId && !ids.has(nativeId) ? nativeId : `catalog-mounted-${index}`;
      ids.add(id);
      return {
        id,
        ...(nativeId ? { nativeId } : {}),
        role,
        content,
        text: content.text,
        fingerprint,
        element,
        host: new WeakRef(hostElement),
      } satisfies CatalogMountedSnapshot;
    });
}

/** Current window for reanchoring the selection UI after the host remounts its messages. */
export function captureCatalogWindow(
  site: SiteAdapter,
  adapter: ExportPlatformAdapter,
  root: ParentNode = document,
): CatalogSnapshot[] {
  return mountedSnapshots(exportSiteSnapshot(site), root, createContentExtractor(adapter));
}

function waitForSample(delay: number, signal?: AbortSignal): Promise<void> {
  throwIfExportCancelled(signal);
  return new Promise((resolve, reject) => {
    const abort = () => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
      reject(new DOMException('Export cancelled', 'AbortError'));
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', abort);
      resolve();
    }, delay);
    signal?.addEventListener('abort', abort, { once: true });
  });
}

/** Read a catalog site's mounted DOM or crawl its virtual list without retaining live bodies. */
export async function readCatalogConversation(
  provided: SiteAdapter,
  adapter: ExportPlatformAdapter,
  options: ExportSelectionOptions,
  timingOverrides: Partial<CatalogReadTiming> = {},
): Promise<CatalogReadResult> {
  const site = exportSiteSnapshot(provided);
  const timing = { ...DEFAULT_TIMING, ...timingOverrides };
  const descriptor = site.export;
  const selector = site.selectors.scrollContainer;
  if (!descriptor || !selector || !site.selectors.userTurn || !site.selectors.assistantTurn) {
    return { snapshots: [], completeness: 'unknown' };
  }
  if (descriptor.read === 'virtual' && !descriptor.messageKey)
    return { snapshots: [], completeness: 'unknown', reason: 'identity' };
  const doc = document;
  const scroller = doc.querySelector<HTMLElement>(selector);
  if (!scroller) return { snapshots: [], completeness: 'unknown' };
  const expectedRoute = routeKey(options.expectedUrl ?? location.href);
  const extractor = createContentExtractor(adapter);
  if (descriptor.read === 'mounted') {
    throwIfExportCancelled(options.signal);
    const reason =
      routeKey(location.href) !== expectedRoute
        ? 'route'
        : descriptor.generating && doc.querySelector(descriptor.generating)
          ? 'generating'
          : undefined;
    // One DOM pass preserves every mounted occurrence; it cannot prove historical completeness.
    return {
      snapshots: reason ? [] : mountedSnapshots(site, scroller, extractor),
      completeness: 'unknown',
      ...(reason ? { reason } : {}),
    };
  }
  const initialTop = scroller.scrollTop;
  const initialLeft = scroller.scrollLeft;
  const scrollBehavior = scroller.style.getPropertyValue('scroll-behavior');
  const scrollPriority = scroller.style.getPropertyPriority('scroll-behavior');
  scroller.style.setProperty('scroll-behavior', 'auto', 'important');
  const accumulator = createCatalogSnapshotAccumulator();
  const started = Date.now();
  let blocked: CatalogReadReason | undefined;
  let crawling = false;
  let topConfirmed = false;
  let bottomConfirmed = false;
  let latest: CatalogMountedSnapshot[] = [];
  const detectInterruption = (): CatalogReadReason | undefined => {
    throwIfExportCancelled(options.signal);
    if (blocked) return blocked;
    if (routeKey(location.href) !== expectedRoute) blocked = 'route';
    else if (descriptor.generating && doc.querySelector(descriptor.generating))
      blocked = 'generating';
    else if (Date.now() - started >= timing.timeoutMs) blocked = 'timeout';
    return blocked;
  };
  let dirty = true;
  let capturedPosition = Number.NaN;
  const capture = (): void => {
    if (detectInterruption()) return;
    if (dirty || capturedPosition !== scroller.scrollTop) {
      latest = mountedSnapshots(site, scroller, extractor);
      capturedPosition = scroller.scrollTop;
      dirty = false;
      if (latest.some((entry) => !entry.nativeId)) blocked = 'identity';
    }
    if (crawling) accumulator.collect(latest);
  };
  // Streaming mutations only invalidate the window; the existing poll coalesces extraction.
  const observer = new MutationObserver(() => {
    dirty = true;
  });
  observer.observe(doc.body, {
    childList: true,
    subtree: true,
    attributes: true,
    characterData: true,
  });
  try {
    capture();
    let previousTop = '';
    let stableTop = 0;
    const topStarted = Date.now();
    while (!detectInterruption() && Date.now() - topStarted < timing.topTimeoutMs) {
      scroller.scrollTop = 0;
      await waitForSample(timing.pollMs, options.signal);
      capture();
      if (blocked) break;
      const first = latest[0];
      const signature = `${scroller.scrollHeight}:${first?.nativeId ?? first?.fingerprint ?? ''}`;
      if (scroller.scrollTop <= EDGE_TOLERANCE && latest.length > 0 && signature === previousTop)
        stableTop++;
      else stableTop = 0;
      previousTop = signature;
      if (stableTop >= timing.stableSamples) {
        topConfirmed = true;
        break;
      }
    }
    accumulator.collect(latest);
    if (!topConfirmed && !blocked) blocked = 'top';
    crawling = true;
    let stableBottom = 0;
    let previousBottom = '';
    while (!detectInterruption() && topConfirmed && !bottomConfirmed) {
      const before = accumulator.snapshots().length;
      const step = Math.max(1, scroller.clientHeight * STEP_VIEWPORT_FRACTION);
      const maximum = Math.max(0, scroller.scrollHeight - scroller.clientHeight);
      scroller.scrollTop = Math.min(maximum, scroller.scrollTop + step);
      await waitForSample(timing.pollMs, options.signal);
      capture();
      if (blocked) break;
      const atBottom =
        scroller.clientHeight > 0 &&
        scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - EDGE_TOLERANCE;
      const signature = `${scroller.scrollHeight}:${accumulator.snapshots().length}:${latest.at(-1)?.fingerprint ?? ''}`;
      if (atBottom && before === accumulator.snapshots().length && signature === previousBottom)
        stableBottom++;
      else stableBottom = 0;
      previousBottom = signature;
      bottomConfirmed = stableBottom >= timing.stableSamples;
    }
    const uncertain = accumulator.uncertain();
    return {
      snapshots: accumulator.snapshots(),
      completeness:
        !blocked &&
        topConfirmed &&
        bottomConfirmed &&
        !uncertain &&
        descriptor.generating !== undefined
          ? 'complete'
          : blocked
            ? 'partial'
            : 'unknown',
      ...(blocked ? { reason: blocked } : uncertain ? { reason: 'identity' as const } : {}),
    };
  } finally {
    observer.disconnect();
    try {
      scroller.scrollTop = initialTop;
      scroller.scrollLeft = initialLeft;
      // A virtualizer may correct scroll asynchronously; resolve preparation only after restoration settles.
      const restoreStarted = Date.now();
      let stable = 0;
      let height = scroller.scrollHeight;
      while (
        scroller.isConnected &&
        stable < timing.stableSamples &&
        Date.now() - restoreStarted < timing.topTimeoutMs
      ) {
        await waitForSample(timing.pollMs);
        const top = Math.min(
          initialTop,
          Math.max(0, scroller.scrollHeight - scroller.clientHeight),
        );
        if (
          Math.abs(scroller.scrollTop - top) <= EDGE_TOLERANCE &&
          Math.abs(scroller.scrollLeft - initialLeft) <= EDGE_TOLERANCE &&
          height === scroller.scrollHeight
        ) {
          stable++;
        } else {
          stable = 0;
          scroller.scrollTop = top;
          scroller.scrollLeft = initialLeft;
        }
        height = scroller.scrollHeight;
      }
    } finally {
      if (scrollBehavior)
        scroller.style.setProperty('scroll-behavior', scrollBehavior, scrollPriority);
      else scroller.style.removeProperty('scroll-behavior');
    }
  }
}
