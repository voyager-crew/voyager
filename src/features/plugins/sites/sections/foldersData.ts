/**
 * The optional `folders` section of a `site.json`: where the `folders`
 * primitive finds the site's sidebar, its conversation rows, the place its
 * folder section goes, the rows it may hide, the row menu it extends and the
 * page's title rules. Like `projects`, a broken section is reported and
 * dropped (`sectionIssues`) while the rest of the adapter survives, and
 * `catalog:build` refuses to publish one.
 *
 * The section holds page facts only. Storage keys, bucket ids, account rules,
 * Drive file names and every other thing that decides what is written stay in
 * the core folder table (`features/folder/sites/folderSiteTable.ts`), so a
 * remote `site.json` can never redirect or reshape folder data.
 *
 * Format 1:
 * - `sidebar`: the host's sidebar root, observed for row passes (document);
 * - `transientSidebar`: matches an ancestor of the folder section while the
 *   sidebar only shows for a moment (a hover peek); the one-time guide waits;
 * - `rows`: inside `sidebar`, a conversation `row`; inside a row its `link`
 *   (the row itself when omitted), ordered `title` candidates, `idSources`
 *   read before the link route (an attribute plus a safe regex whose group 1
 *   is the id), attributes to `observe`, rows `portaled` outside the sidebar
 *   (document) and how a row is dragged (`pointer`, `link` or `html5`);
 * - `mount`: ordered `anchors`, each a list of `find` / `closest` steps
 *   searched inside `sidebar` (the first that finds wins), with ids equal to the stored anchor preference values, the
 *   `default` anchor id, and `open`, present while the sidebar is shown;
 * - `hideFiled`: the rows that may be hidden and those that never are;
 * - `rowMenu`: the row's menu `trigger`, the `menu` and its `item`s, how it
 *   opens (`expanded`: `aria-expanded` flips; `press`: a press starts a short
 *   look), where the entry goes, the attributes stripped from a cloned item,
 *   the element whose glyph becomes the folder icon and the native rename item;
 * - `page`: placeholder titles (any language or by UI language), a safe regex
 *   removed from `document.title`, and the site's own new-chat link. Optional
 *   here; the shared folder section of catalog sites has no folders without it.
 */
import type { ManifestIssue } from '../../manifest/validate';
import { isSafeRegexSource } from '../safeRegex';

export const FOLDERS_FORMATS = [1] as const;
export type FoldersFormat = (typeof FOLDERS_FORMATS)[number];

export const FOLDERS_ROW_DRAGS = ['pointer', 'link', 'html5'] as const;
export type FoldersRowDrag = (typeof FOLDERS_ROW_DRAGS)[number];

export const FOLDERS_MENU_OPENS = ['expanded', 'press'] as const;
export type FoldersMenuOpen = (typeof FOLDERS_MENU_OPENS)[number];

export const FOLDERS_MENU_PLACEMENTS = ['firstSubmenu', 'lastSubmenu', 'end'] as const;
export type FoldersMenuPlacement = (typeof FOLDERS_MENU_PLACEMENTS)[number];

export interface FoldersIdSource {
  readonly attribute: string;
  /** Safe regex over the attribute value; group 1 is the conversation id. */
  readonly pattern: string;
  /** Read the attribute from the row's descendants too. */
  readonly descendants?: boolean;
}

export interface FoldersRows {
  readonly row: string;
  readonly link?: string;
  readonly title?: readonly string[];
  readonly idSources?: readonly FoldersIdSource[];
  readonly observe?: readonly string[];
  readonly portaled?: string;
  readonly drag: FoldersRowDrag;
}

export interface FoldersAnchorStep {
  readonly find: string;
  readonly closest?: string;
}

export interface FoldersAnchor {
  /** What the anchor preference stores, e.g. `above-recents`. */
  readonly id: string;
  readonly steps: readonly FoldersAnchorStep[];
}

export interface FoldersMount {
  readonly anchors: readonly FoldersAnchor[];
  readonly default?: string;
  readonly open?: string;
}

export interface FoldersHideFiled {
  readonly rows: string;
  readonly keepShown?: readonly string[];
}

export interface FoldersRowMenu {
  readonly trigger: string;
  readonly menu: string;
  readonly item: string;
  readonly open: FoldersMenuOpen;
  readonly template?: string;
  readonly after: FoldersMenuPlacement;
  readonly strip?: readonly string[];
  readonly iconHolder?: string;
  readonly rename?: { readonly plainItem: number };
}

export interface FoldersPlaceholderTitles {
  readonly any?: readonly string[];
  readonly byLanguage?: Readonly<Record<string, readonly string[]>>;
  readonly fallbackLanguage?: string;
}

export interface FoldersPage {
  readonly placeholderTitles: FoldersPlaceholderTitles;
  readonly titleSuffix?: string;
  readonly newChat?: string;
}

export interface FoldersSection {
  readonly format: FoldersFormat;
  readonly sidebar: string;
  /** Matches an ancestor of the section while the sidebar is transient (e.g. a hover peek). */
  readonly transientSidebar?: string;
  readonly rows: FoldersRows;
  readonly mount?: FoldersMount;
  readonly hideFiled?: FoldersHideFiled;
  readonly rowMenu?: FoldersRowMenu;
  /** Required by the shared folder section (`siteFoldersFromData`); AI Studio's own runtime reads none. */
  readonly page?: FoldersPage;
}

export interface FoldersSectionRead {
  readonly folders?: FoldersSection;
  readonly issues: readonly ManifestIssue[];
}

const MAX_SELECTOR_LENGTH = 1_000;
const MAX_TITLE_LENGTH = 100;
const MAX_PATTERN_LENGTH = 200;
const MAX_ENTRIES = 16;
const MAX_TITLES = 32;
const MAX_MENU_ITEM_INDEX = 15;
const ATTRIBUTE_NAME = /^[a-z][a-z0-9-]{0,63}$/;
const ANCHOR_ID = /^[a-z][a-z0-9-]{0,39}$/;
const LANGUAGE = /^[a-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

class Reader {
  readonly issues: ManifestIssue[] = [];

  constructor(private readonly isSelector: (selector: string) => boolean) {}

  issue(path: string, message: string): void {
    this.issues.push({ path, message });
  }

  record(raw: unknown, path: string, allowed: readonly string[]): Record<string, unknown> {
    if (!isRecord(raw)) {
      this.issue(path, 'must be an object');
      return {};
    }
    for (const key of Object.keys(raw)) {
      if (!allowed.includes(key)) this.issue(`${path}.${key}`, 'unknown key');
    }
    return raw;
  }

  text(raw: unknown, path: string, max: number): string {
    if (typeof raw !== 'string' || raw.trim() === '' || raw.length > max) {
      this.issue(path, `must be a non-empty string of up to ${max} chars`);
      return '';
    }
    return raw;
  }

  selector(raw: unknown, path: string): string {
    const text = this.text(raw, path, MAX_SELECTOR_LENGTH);
    if (text && !this.isSelector(text)) this.issue(path, 'must be a valid CSS selector');
    return text;
  }

  optionalSelector(raw: unknown, path: string): string | undefined {
    return raw === undefined ? undefined : this.selector(raw, path);
  }

  attribute(raw: unknown, path: string): string {
    const text = this.text(raw, path, 64);
    if (text && !ATTRIBUTE_NAME.test(text)) this.issue(path, 'must be a lower-case attribute name');
    return text;
  }

  oneOf<T extends string>(raw: unknown, path: string, allowed: readonly T[]): T {
    if (typeof raw === 'string' && (allowed as readonly string[]).includes(raw)) return raw as T;
    this.issue(path, `must be one of ${allowed.join(', ')}`);
    return allowed[0];
  }

  /** A safe regex; `groups` is the exact number of capturing groups it must have. */
  pattern(raw: unknown, path: string, groups?: number): string {
    const text = this.text(raw, path, MAX_PATTERN_LENGTH);
    if (!text) return text;
    if (!isSafeRegexSource(text)) {
      this.issue(path, 'must be a safe regular expression');
      return text;
    }
    try {
      const found = (new RegExp(`${text}|`).exec('')?.length ?? 1) - 1;
      if (groups !== undefined && found !== groups) {
        this.issue(path, `must have exactly ${groups} capturing group${groups === 1 ? '' : 's'}`);
      }
    } catch {
      this.issue(path, 'must be a valid regular expression');
    }
    return text;
  }

  list<T>(
    raw: unknown,
    path: string,
    read: (value: unknown, at: string) => T,
    max = MAX_ENTRIES,
  ): readonly T[] {
    if (!Array.isArray(raw) || raw.length === 0 || raw.length > max) {
      this.issue(path, `must be an array of 1-${max} entries`);
      return [];
    }
    return raw.map((value, index) => read(value, `${path}[${index}]`));
  }

  optionalList<T>(
    raw: unknown,
    path: string,
    read: (value: unknown, at: string) => T,
    max = MAX_ENTRIES,
  ): readonly T[] | undefined {
    return raw === undefined ? undefined : this.list(raw, path, read, max);
  }

  titles(raw: unknown, path: string): readonly string[] {
    return this.list(raw, path, (value, at) => this.text(value, at, MAX_TITLE_LENGTH), MAX_TITLES);
  }
}

function readRows(reader: Reader, raw: unknown, path: string): FoldersRows {
  const rows = reader.record(raw, path, [
    'row',
    'link',
    'title',
    'idSources',
    'observe',
    'portaled',
    'drag',
  ]);
  const idSources = reader.optionalList(rows.idSources, `${path}.idSources`, (value, at) => {
    const source = reader.record(value, at, ['attribute', 'pattern', 'descendants']);
    if (source.descendants !== undefined && typeof source.descendants !== 'boolean') {
      reader.issue(`${at}.descendants`, 'must be a boolean');
    }
    return {
      attribute: reader.attribute(source.attribute, `${at}.attribute`),
      pattern: reader.pattern(source.pattern, `${at}.pattern`, 1),
      ...(source.descendants === true ? { descendants: true } : {}),
    };
  });
  const link = reader.optionalSelector(rows.link, `${path}.link`);
  const title = reader.optionalList(rows.title, `${path}.title`, (value, at) =>
    reader.selector(value, at),
  );
  const observe = reader.optionalList(rows.observe, `${path}.observe`, (value, at) =>
    reader.attribute(value, at),
  );
  const portaled = reader.optionalSelector(rows.portaled, `${path}.portaled`);
  return {
    row: reader.selector(rows.row, `${path}.row`),
    ...(link !== undefined ? { link } : {}),
    ...(title ? { title } : {}),
    ...(idSources ? { idSources } : {}),
    ...(observe ? { observe } : {}),
    ...(portaled !== undefined ? { portaled } : {}),
    drag: reader.oneOf(rows.drag, `${path}.drag`, FOLDERS_ROW_DRAGS),
  };
}

function readMount(reader: Reader, raw: unknown, path: string): FoldersMount {
  const mount = reader.record(raw, path, ['anchors', 'default', 'open']);
  const anchors = reader.list(mount.anchors, `${path}.anchors`, (value, at) => {
    const anchor = reader.record(value, at, ['id', 'steps']);
    const id = reader.text(anchor.id, `${at}.id`, 40);
    if (id && !ANCHOR_ID.test(id)) reader.issue(`${at}.id`, 'must match ^[a-z][a-z0-9-]*$');
    const steps = reader.list(anchor.steps, `${at}.steps`, (stepValue, stepAt) => {
      const step = reader.record(stepValue, stepAt, ['find', 'closest']);
      const closest = reader.optionalSelector(step.closest, `${stepAt}.closest`);
      return {
        find: reader.selector(step.find, `${stepAt}.find`),
        ...(closest !== undefined ? { closest } : {}),
      };
    });
    return { id, steps };
  });
  const ids = anchors.map((anchor) => anchor.id);
  if (new Set(ids).size !== ids.length) reader.issue(`${path}.anchors`, 'ids must be unique');
  let fallback: string | undefined;
  if (mount.default !== undefined) {
    fallback = reader.text(mount.default, `${path}.default`, 40);
    if (fallback && !ids.includes(fallback)) {
      reader.issue(`${path}.default`, 'must name one of the anchors');
    }
  }
  const open = reader.optionalSelector(mount.open, `${path}.open`);
  return {
    anchors,
    ...(fallback !== undefined ? { default: fallback } : {}),
    ...(open !== undefined ? { open } : {}),
  };
}

function readHideFiled(reader: Reader, raw: unknown, path: string): FoldersHideFiled {
  const hide = reader.record(raw, path, ['rows', 'keepShown']);
  const keepShown = reader.optionalList(hide.keepShown, `${path}.keepShown`, (value, at) =>
    reader.selector(value, at),
  );
  return {
    rows: reader.selector(hide.rows, `${path}.rows`),
    ...(keepShown ? { keepShown } : {}),
  };
}

function readRowMenu(reader: Reader, raw: unknown, path: string): FoldersRowMenu {
  const menu = reader.record(raw, path, [
    'trigger',
    'menu',
    'item',
    'open',
    'template',
    'after',
    'strip',
    'iconHolder',
    'rename',
  ]);
  const template = reader.optionalSelector(menu.template, `${path}.template`);
  const strip = reader.optionalList(menu.strip, `${path}.strip`, (value, at) =>
    reader.attribute(value, at),
  );
  const iconHolder = reader.optionalSelector(menu.iconHolder, `${path}.iconHolder`);
  let rename: { plainItem: number } | undefined;
  if (menu.rename !== undefined) {
    const index = reader.record(menu.rename, `${path}.rename`, ['plainItem']).plainItem;
    if (
      typeof index !== 'number' ||
      !Number.isInteger(index) ||
      index < 0 ||
      index > MAX_MENU_ITEM_INDEX
    ) {
      reader.issue(`${path}.rename.plainItem`, `must be an integer 0-${MAX_MENU_ITEM_INDEX}`);
    }
    rename = { plainItem: typeof index === 'number' ? index : 0 };
  }
  return {
    trigger: reader.selector(menu.trigger, `${path}.trigger`),
    menu: reader.selector(menu.menu, `${path}.menu`),
    item: reader.selector(menu.item, `${path}.item`),
    open: reader.oneOf(menu.open, `${path}.open`, FOLDERS_MENU_OPENS),
    ...(template !== undefined ? { template } : {}),
    after: reader.oneOf(menu.after, `${path}.after`, FOLDERS_MENU_PLACEMENTS),
    ...(strip ? { strip } : {}),
    ...(iconHolder !== undefined ? { iconHolder } : {}),
    ...(rename ? { rename } : {}),
  };
}

function readPage(reader: Reader, raw: unknown, path: string): FoldersPage {
  const page = reader.record(raw, path, ['placeholderTitles', 'titleSuffix', 'newChat']);
  const at = `${path}.placeholderTitles`;
  const placeholders = reader.record(page.placeholderTitles, at, [
    'any',
    'byLanguage',
    'fallbackLanguage',
  ]);
  const any =
    placeholders.any === undefined ? undefined : reader.titles(placeholders.any, `${at}.any`);
  let byLanguage: Record<string, readonly string[]> | undefined;
  if (placeholders.byLanguage !== undefined) {
    const languages = reader.record(
      placeholders.byLanguage,
      `${at}.byLanguage`,
      isRecord(placeholders.byLanguage) ? Object.keys(placeholders.byLanguage) : [],
    );
    const entries = Object.entries(languages);
    if (entries.length === 0 || entries.length > MAX_TITLES) {
      reader.issue(`${at}.byLanguage`, `must name 1-${MAX_TITLES} languages`);
    }
    byLanguage = {};
    for (const [language, titles] of entries) {
      if (!LANGUAGE.test(language)) {
        reader.issue(`${at}.byLanguage.${language}`, 'must be a language such as zh-CN');
      }
      byLanguage[language] = reader.titles(titles, `${at}.byLanguage.${language}`);
    }
  }
  let fallbackLanguage: string | undefined;
  if (placeholders.fallbackLanguage !== undefined) {
    fallbackLanguage = reader.text(placeholders.fallbackLanguage, `${at}.fallbackLanguage`, 20);
    if (fallbackLanguage && !byLanguage?.[fallbackLanguage]) {
      reader.issue(`${at}.fallbackLanguage`, 'must name a byLanguage entry');
    }
  }
  if (!any && !byLanguage) reader.issue(at, 'must have any or byLanguage');
  const titleSuffix =
    page.titleSuffix === undefined
      ? undefined
      : reader.pattern(page.titleSuffix, `${path}.titleSuffix`);
  const newChat = reader.optionalSelector(page.newChat, `${path}.newChat`);
  return {
    placeholderTitles: {
      ...(any ? { any } : {}),
      ...(byLanguage ? { byLanguage } : {}),
      ...(fallbackLanguage !== undefined ? { fallbackLanguage } : {}),
    },
    ...(titleSuffix !== undefined ? { titleSuffix } : {}),
    ...(newChat !== undefined ? { newChat } : {}),
  };
}

/**
 * Read `site.folders`. `isSelector` is the site validator's selector check
 * (passed in so this module does not import the validator that imports it).
 * Any issue drops the whole section: a half-read recipe would place the
 * folder section or hide rows by guesswork.
 */
export function readFoldersSection(
  raw: unknown,
  isSelector: (selector: string) => boolean,
  path = 'folders',
): FoldersSectionRead {
  if (raw === undefined) return { issues: [] };
  if (!isRecord(raw)) return { issues: [{ path, message: 'must be an object' }] };
  if (!FOLDERS_FORMATS.some((known) => known === raw.format)) {
    return { issues: [{ path: `${path}.format`, message: 'unknown format' }] };
  }
  const reader = new Reader(isSelector);
  reader.record(raw, path, [
    'format',
    'sidebar',
    'transientSidebar',
    'rows',
    'mount',
    'hideFiled',
    'rowMenu',
    'page',
  ]);
  const transientSidebar = reader.optionalSelector(
    raw.transientSidebar,
    `${path}.transientSidebar`,
  );
  const section: FoldersSection = {
    format: 1,
    sidebar: reader.selector(raw.sidebar, `${path}.sidebar`),
    ...(transientSidebar !== undefined ? { transientSidebar } : {}),
    rows: readRows(reader, raw.rows, `${path}.rows`),
    ...(raw.mount !== undefined ? { mount: readMount(reader, raw.mount, `${path}.mount`) } : {}),
    ...(raw.hideFiled !== undefined
      ? { hideFiled: readHideFiled(reader, raw.hideFiled, `${path}.hideFiled`) }
      : {}),
    ...(raw.rowMenu !== undefined
      ? { rowMenu: readRowMenu(reader, raw.rowMenu, `${path}.rowMenu`) }
      : {}),
    ...(raw.page !== undefined ? { page: readPage(reader, raw.page, `${path}.page`) } : {}),
  };
  if (reader.issues.length > 0) return { issues: reader.issues };
  return { folders: section, issues: [] };
}
