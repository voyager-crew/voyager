/**
 * The selectors Voyager relies on for this page, and what each finds now:
 * the site's semantic keys, then for every running plugin the keys it reads,
 * the raw selectors of its DOM ops and primitive params, and the `folders`
 * section of `site.json` when one of its primitives reads it. Counting only
 * calls `querySelectorAll`, so the check writes nothing and reads no text.
 */
import { pageSemanticSelector } from '@/core/selectors';
import { hasPageSemanticFixes } from '@/core/selectors/semanticSnapshot';

import { isLocalPluginId } from '../../local/localPluginId';
import { requiredSemanticKeys, requiredSiteSections } from '../../runtime/pluginStatus';
import { resolveSemanticElements } from '../../runtime/semanticElements';
import { isTargetedOp } from '../../runtime/targetedOps';
import type { FoldersSection } from '../../sites/sections/foldersData';
import {
  SEMANTIC_KEY_PRESENCE,
  SEMANTIC_SELECTOR_KEYS,
  type SemanticKeyPresence,
  isSemanticSelectorKey,
} from '../../sites/semanticKeys';
import type { PluginManifest, SiteAdapter } from '../../types';
import { getPrimitiveContract } from '../contracts';
import type { PluginInspection } from '../types';

/** When an element is expected; raw selectors and section rules carry no such data. */
export type ProbeExpectation = SemanticKeyPresence | 'unknown';

/**
 *   ok          found at least one element
 *   missing     found nothing where the element is expected (likely broken)
 *   not-here    found nothing, and the element is expected only in a conversation
 *   not-judged  found nothing; the data cannot say whether it should exist now
 *   invalid     the selector does not parse in this browser
 *   unresolved  the site defines no selector for the key a plugin reads
 */
export type ProbeVerdict = 'ok' | 'missing' | 'not-here' | 'not-judged' | 'invalid' | 'unresolved';

export interface Probe {
  /** `site`, or the id of the plugin that relies on the selector. */
  readonly source: string;
  readonly name: string;
  /** Null when the key is unresolved on this site. */
  readonly selector: string | null;
  /** Count only inside elements this selector matches (the folders sidebar). */
  readonly within?: string;
  /** Count the `closest(selector)` ancestors of what this selector finds (a folders anchor step). */
  readonly closestOf?: string;
  readonly expect: ProbeExpectation;
  /** The user's own plugin: its selector text stays out of the report. */
  readonly local?: boolean;
  /** A semantic surface may need a checked operation instead of a raw CSS count. */
  readonly resolveElements?: (doc: Document) => readonly Element[] | null;
}

export interface ProbeResult extends Probe {
  readonly count: number;
  readonly verdict: ProbeVerdict;
}

const RUNNING = new Set(['mounted', 'no-effect']);

function semanticElements(doc: Document, adapter: SiteAdapter | null, key: string) {
  const native = resolveSemanticElements(doc, adapter, key);
  if (native !== null || !hasPageSemanticFixes(adapter, [key], doc)) return native;
  // Picking happens after the report: a captured alias must not label a later dialog as native UI.
  const selector = adapter && pageSemanticSelector(adapter, key, doc);
  return selector ? Array.from(doc.querySelectorAll(selector)) : [];
}

function siteProbes(adapter: SiteAdapter): Probe[] {
  return SEMANTIC_SELECTOR_KEYS.flatMap((key) => {
    const selector = adapter.selectors[key];
    return selector
      ? [
          {
            source: 'site',
            name: key,
            selector,
            expect: SEMANTIC_KEY_PRESENCE[key],
            resolveElements: (doc: Document) => semanticElements(doc, adapter, key),
          },
        ]
      : [];
  });
}

/** The `folders` rules that address the page, scoped the way the primitive reads them. */
export function folderProbes(folders: FoldersSection, source: string): Probe[] {
  const within = folders.sidebar;
  const probes: Probe[] = [
    { source, name: 'folders.sidebar', selector: within, expect: 'unknown' },
    { source, name: 'folders.rows.row', selector: folders.rows.row, within, expect: 'unknown' },
  ];
  if (folders.rows.link) {
    probes.push({
      source,
      name: 'folders.rows.link',
      selector: folders.rows.link,
      within,
      expect: 'unknown',
    });
  }
  for (const anchor of folders.mount?.anchors ?? []) {
    anchor.steps.forEach((step, index) => {
      const name = `folders.mount.${anchor.id}[${index}]`;
      probes.push({ source, name: `${name}.find`, selector: step.find, within, expect: 'unknown' });
      if (step.closest) {
        probes.push({
          source,
          name: `${name}.closest`,
          selector: step.closest,
          within,
          closestOf: step.find,
          expect: 'unknown',
        });
      }
    });
  }
  if (folders.hideFiled) {
    probes.push({
      source,
      name: 'folders.hideFiled.rows',
      selector: folders.hideFiled.rows,
      expect: 'unknown',
    });
  }
  if (folders.rowMenu) {
    probes.push({
      source,
      name: 'folders.rowMenu.trigger',
      selector: folders.rowMenu.trigger,
      within,
      expect: 'unknown',
    });
  }
  return probes;
}

function pluginProbes(manifest: PluginManifest, adapter: SiteAdapter | null): Probe[] {
  const source = manifest.id;
  const local = isLocalPluginId(manifest.id) ? { local: true } : {};
  const probes: Probe[] = requiredSemanticKeys(manifest).map((key) => ({
    source,
    name: key,
    selector: adapter?.selectors[key] ?? null,
    expect: isSemanticSelectorKey(key) ? SEMANTIC_KEY_PRESENCE[key] : 'unknown',
    resolveElements: (doc) => semanticElements(doc, adapter, key),
    ...local,
  }));
  (manifest.contributes.domOps ?? []).forEach((op, index) => {
    if (isTargetedOp(op)) {
      if (op.target.kind !== 'css') return;
      probes.push({
        source,
        name: `domOps[${index}] ${op.op}`,
        selector: op.target.selector,
        expect: 'unknown',
        ...local,
      });
      return;
    }
    const contract = getPrimitiveContract(op.handler);
    for (const [param, spec] of Object.entries(contract?.params ?? {})) {
      const value = op.params[param];
      // A `{{setting}}` value resolves per page; only literal selectors are probed.
      if (spec.type !== 'selector' || typeof value !== 'string' || value.includes('{{')) continue;
      probes.push({
        source,
        name: `${op.handler}.${param}`,
        selector: value,
        expect: 'unknown',
        ...local,
      });
    }
  });
  if (adapter?.folders && requiredSiteSections(manifest).has('folders')) {
    probes.push(...folderProbes(adapter.folders, source));
  }
  return probes;
}

/** Every probe for the page: the site's keys first, then each running plugin but `selfId`. */
export function collectProbes(
  adapter: SiteAdapter | null,
  inspection: PluginInspection | null,
  selfId: string,
): Probe[] {
  const probes = adapter ? siteProbes(adapter) : [];
  const manifests = new Map(inspection?.manifests.map((manifest) => [manifest.id, manifest]));
  for (const status of inspection?.statuses ?? []) {
    if (status.id === selfId || !RUNNING.has(status.kind)) continue;
    const manifest = manifests.get(status.id);
    if (manifest) probes.push(...pluginProbes(manifest, adapter));
  }
  return probes;
}

function queryAll(root: ParentNode, selector: string): Element[] {
  return Array.from(root.querySelectorAll(selector));
}

/** The elements a probe finds on `doc`; throws on a selector this browser rejects. */
export function probeElements(doc: Document, probe: Probe): ReadonlySet<Element> {
  const resolved = probe.resolveElements?.(doc);
  if (resolved) return new Set(resolved);
  if (!probe.selector) return new Set();
  const roots: ParentNode[] = probe.within ? queryAll(doc, probe.within) : [doc];
  const found = new Set<Element>();
  for (const root of roots) {
    if (probe.closestOf) {
      for (const start of queryAll(root, probe.closestOf)) {
        const ancestor = start.closest(probe.selector);
        if (ancestor) found.add(ancestor);
      }
    } else {
      for (const element of queryAll(root, probe.selector)) found.add(element);
    }
  }
  return found;
}

function verdictFor(count: number, expect: ProbeExpectation, conversation: boolean): ProbeVerdict {
  if (count > 0) return 'ok';
  if (expect === 'page') return 'missing';
  if (expect === 'conversation') return conversation ? 'missing' : 'not-here';
  return 'not-judged';
}

export interface CheckPage {
  readonly doc: Document;
  /** The route names a conversation (site pattern or an id-like segment). */
  readonly conversation: boolean;
}

/** Count every probe. A page that already shows user turns is judged as a conversation. */
export function runProbes(probes: readonly Probe[], page: CheckPage): ProbeResult[] {
  const counted = probes.map((probe) => {
    if (!probe.selector) return { probe, count: 0, state: 'unresolved' as const };
    try {
      return { probe, count: probeElements(page.doc, probe).size, state: 'counted' as const };
    } catch {
      return { probe, count: 0, state: 'invalid' as const };
    }
  });
  const userTurns = counted.find(
    ({ probe }) => probe.source === 'site' && probe.name === 'userTurn',
  );
  const conversation = page.conversation || (userTurns?.count ?? 0) > 0;
  return counted.map(({ probe, count, state }) => ({
    ...probe,
    count,
    verdict:
      state === 'counted' ? verdictFor(count, probe.expect, conversation) : (state as ProbeVerdict),
  }));
}

/** Whether `element` is one the probe finds; never throws. */
export function probeMatches(element: Element, probe: Probe): boolean {
  const resolved = probe.resolveElements?.(element.ownerDocument);
  if (resolved) return resolved.includes(element);
  if (!probe.selector || probe.closestOf) return false;
  try {
    return element.matches(probe.selector) && (!probe.within || !!element.closest(probe.within));
  } catch {
    return false;
  }
}
