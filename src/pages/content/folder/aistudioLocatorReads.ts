import {
  getBundledSiteSelectorView,
  getSiteSelectorView,
  resolveSiteSelectorOperationInView,
  type SiteSelectorView,
} from '@/core/selectors';
import packaged from '@/features/plugins/catalog/sites/aistudio/selector-data/navigation-packaged.json';
import { aistudioAdapter } from '@/features/plugins/sites/adapters/aistudio';

const packagedData = {
  ...packaged,
  'history.links': [aistudioAdapter.folders!.rows.row],
  'history.popovers': [aistudioAdapter.folders!.rows.portaled!],
  'navigation.sidebar': [aistudioAdapter.folders!.sidebar],
};

function accountPrefix(pathname: string): string {
  return /^\/u\/\d+(?=\/)/.exec(pathname)?.[0] ?? '';
}

/** Only changed online navigation adds account-prefix protection; the installed path is unchanged. */
export function aistudioLibraryFallbackPath(doc: Document = document): string {
  return getSiteSelectorView('aistudio').remoteKeys.has('navigation.libraryLink')
    ? `${accountPrefix(doc.location.pathname)}/library`
    : '/library';
}

/** Identity and URL checks do not use the remote locator's spelling. */
function nativePromptAnchor(anchor: Element): anchor is HTMLAnchorElement {
  if (!(anchor instanceof HTMLAnchorElement)) return false;
  try {
    const url = new URL(anchor.href, anchor.ownerDocument.location.href);
    return (
      url.origin === anchor.ownerDocument.location.origin &&
      accountPrefix(url.pathname) === accountPrefix(anchor.ownerDocument.location.pathname) &&
      /\/prompts\/[^/?#]+/.test(url.pathname)
    );
  } catch {
    return false;
  }
}

export const aistudioPackagedSelector = (key: keyof typeof packagedData): string =>
  packagedData[key].join(',');
export const aistudioPackagedList = (key: keyof typeof packagedData): readonly string[] =>
  packagedData[key];

export interface LibraryRowRead {
  readonly row: HTMLElement;
  readonly anchor: HTMLAnchorElement | null;
}
const same = <T>(a: readonly T[], b: readonly T[]): boolean =>
  a.length === b.length && a.every((item, index) => item === b[index]);

function readRows(doc: Document, view: SiteSelectorView, archive: boolean): LibraryRowRead[] {
  const rows = doc.querySelectorAll<HTMLElement>(
    view.profiles[archive ? 'library.archivableRows' : 'library.rows'].join(','),
  );
  const link = aistudioPackagedSelector(archive ? 'library.archivableLink' : 'history.links');
  const values = Array.from(rows, (row) => ({
    row,
    anchor: row.querySelector<HTMLAnchorElement>(link),
  }));
  return archive ? values : values.filter(({ anchor }) => Boolean(anchor));
}

/** Select the whole row/anchor collection before any title, drag payload or hidden class is written. */
export function readAIStudioLibraryRows(
  archive = false,
  doc: Document = document,
): LibraryRowRead[] {
  const bundle = getBundledSiteSelectorView('aistudio');
  const view = getSiteSelectorView('aistudio');
  const read = (candidate: SiteSelectorView) => readRows(doc, candidate, archive);
  if (
    !['library.rows', 'library.archivableRows', 'library.table'].some((key) =>
      view.remoteKeys.has(key),
    )
  )
    return read(bundle);
  const expected = read(bundle);
  return resolveSiteSelectorOperationInView(view, read, (actual) => {
    if (expected.length)
      return (
        same(
          actual.map((entry) => entry.row),
          expected.map((entry) => entry.row),
        ) &&
        same(
          actual.map((entry) => entry.anchor),
          expected.map((entry) => entry.anchor),
        )
      );
    const native = Array.from(
      doc.querySelectorAll<HTMLElement>(
        'table tr, [role="table"] [role="row"], mat-table [role="row"]',
      ),
    )
      .map((row) => ({
        row,
        anchors: Array.from(row.querySelectorAll('a[href]')).filter(nativePromptAnchor),
      }))
      .filter(({ anchors }) => anchors.length > 0);
    // Renamed rows still have exactly the table's independently owned prompt links, in order.
    return (
      actual.length > 0 &&
      same(
        actual.map((entry) => entry.row),
        native.map((entry) => entry.row),
      ) &&
      actual.every(
        (entry, index) =>
          native[index].anchors.length === 1 && entry.anchor === native[index].anchors[0],
      )
    );
  }).value;
}

/** Exact history mount ancestry has no independent page proof; this anchor stays installed. */
export function readAIStudioHistoryRoot(doc: Document = document): HTMLElement | null {
  return doc.querySelector<HTMLElement>(aistudioPackagedSelector('navigation.historyRoot'));
}

export function readAIStudioLibraryLink(doc: Document = document): HTMLAnchorElement | null {
  const bundle = getBundledSiteSelectorView('aistudio');
  const view = getSiteSelectorView('aistudio');
  const read = (candidate: SiteSelectorView) =>
    doc.querySelector<HTMLAnchorElement>(candidate.profiles['navigation.libraryLink'].join(','));
  if (!view.remoteKeys.has('navigation.libraryLink')) return read(bundle);
  const expected = read(bundle);
  return resolveSiteSelectorOperationInView(view, read, (link) => {
    if (expected) return link === expected;
    if (!(link instanceof HTMLAnchorElement) || !link.closest('nav')) return false;
    const candidates = Array.from(doc.querySelectorAll<HTMLAnchorElement>('nav a[href]')).filter(
      (anchor) => {
        try {
          const url = new URL(anchor.href, doc.location.href);
          return (
            url.origin === doc.location.origin &&
            accountPrefix(url.pathname) === accountPrefix(doc.location.pathname) &&
            /^\/(?:u\/\d+\/)?library\/?$/.test(url.pathname)
          );
        } catch {
          return false;
        }
      },
    );
    return candidates.length === 1 && candidates[0] === link;
  }).value;
}

export function readAIStudioLibraryTableSelector(doc: Document = document): string {
  const bundle = getBundledSiteSelectorView('aistudio');
  const view = getSiteSelectorView('aistudio');
  const read = (candidate: SiteSelectorView) => ({
    selector: candidate.profiles['library.table'].join(','),
    tables: Array.from(doc.querySelectorAll(candidate.profiles['library.table'].join(','))),
  });
  if (!view.remoteKeys.has('library.table')) return bundle.profiles['library.table'].join(',');
  const expected = read(bundle).tables;
  return resolveSiteSelectorOperationInView(view, read, ({ tables }) => {
    if (expected.length) return same(tables, expected);
    const native = Array.from(doc.querySelectorAll('table, [role="table"], mat-table')).filter(
      (table) => Array.from(table.querySelectorAll('a[href]')).some(nativePromptAnchor),
    );
    return tables.length > 0 && same(tables, native);
  }).value.selector;
}

export function isAIStudioLibraryRowDrag(target: Element): boolean {
  const view = getSiteSelectorView('aistudio');
  if (!view.remoteKeys.has('library.rows') && !view.remoteKeys.has('library.archivableRows')) {
    const row = target.closest(aistudioPackagedSelector('library.dropRows'));
    return Boolean(row?.querySelector(aistudioPackagedSelector('library.dropLink')));
  }
  return readAIStudioLibraryRows(true, target.ownerDocument).some(
    ({ row, anchor }) => row.contains(target) && Boolean(anchor),
  );
}
