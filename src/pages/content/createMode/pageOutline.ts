/**
 * How the page is built, for the AI that writes a creation for it: which of
 * Voyager's anchors match here and how many, then a pruned outline around the
 * last reply and the last user message. Structure only; `outlinePolicy.ts`
 * decides what an element may show. Same page, same text: DOM order only,
 * bounded by `MAX_PAGE_OUTLINE_CHARS`.
 */
import { pageSemanticSelector } from '@/core/selectors/semanticSnapshot';
import { replyLocator } from '@/features/plugins/local/authoring/replyLocator';
import { siteAnchors } from '@/features/plugins/local/authoring/siteFacts';
import { MAX_PAGE_OUTLINE_CHARS } from '@/features/plugins/local/creation/messages';
import type { SiteAdapter } from '@/features/plugins/types';

import { isRendered } from '../export/adapter/chatgptThread';
import { LEAF_TAGS, isVoyagerElement, outlineAttributes, outlineTag } from './outlinePolicy';

const INDENT = '  ';
const MAX_LINE_CHARS = 160;
const ANCESTOR_LEVELS = 3;
const SUBTREE_DEPTH = 4;
const MAX_CHILD_GROUPS = 6;
const MAX_SAMPLE_LINES = 24;
const COMPOSER = 'composer';

interface Anchor {
  readonly name: string;
  readonly selector: string;
}

function queryAll(doc: Document, selector: string): Element[] {
  try {
    return Array.from(doc.querySelectorAll(selector));
  } catch {
    return [];
  }
}

function matches(element: Element, selector: string): boolean {
  try {
    return element.matches(selector);
  } catch {
    return false;
  }
}

/** The site's declared anchors as this page resolves them, plus the reply locator when it differs. */
function pageAnchors(doc: Document, site: SiteAdapter): Anchor[] {
  const anchors: Anchor[] = [];
  for (const key of siteAnchors(site)) {
    const selector = pageSemanticSelector(site, key, doc) ?? site.selectors[key];
    if (selector) anchors.push({ name: key, selector });
  }
  const reply = replyLocator(site);
  if (reply && reply !== site.selectors.assistantTurn)
    anchors.push({ name: 'reply', selector: reply });
  return anchors;
}

/** The path with every segment the site does not name as a route word replaced by `*`. */
export function pathShape(url: string, site: SiteAdapter): string {
  let path: string;
  try {
    path = new URL(url).pathname;
  } catch {
    return '/';
  }
  const words = new Set(site.routeWords ?? []);
  const segments = path.split('/').filter(Boolean);
  return `/${segments.map((segment) => (words.has(segment) ? segment : '*')).join('/')}`;
}

function clip(line: string): string {
  return line.length > MAX_LINE_CHARS ? `${line.slice(0, MAX_LINE_CHARS - 1)}…` : line;
}

class Outliner {
  constructor(private readonly anchors: readonly Anchor[]) {}

  private marks(element: Element): string[] {
    return this.anchors
      .filter((anchor) => matches(element, anchor.selector))
      .map((anchor) => anchor.name);
  }

  /** The tag, its allowed attributes, and the anchors it matches. */
  label(element: Element): string {
    const marks = this.marks(element);
    const composer = marks.includes(COMPOSER) ? '; contents left out' : '';
    const note = marks.length > 0 ? `  (${marks.join(', ')}${composer})` : '';
    return `${outlineTag(element)}${outlineAttributes(element)}${note}`;
  }

  /** The element's own lines, its children indented under it; repeated siblings fold into `× n`. */
  subtree(element: Element, depth: number): string[] {
    const label = this.label(element);
    // Nothing inside the composer leaves the page: it holds what the user is typing.
    const closed =
      depth === 0 || LEAF_TAGS.has(element.localName) || this.marks(element).includes(COMPOSER);
    const children = closed
      ? []
      : Array.from(element.children).filter((child) => !isVoyagerElement(child));
    if (closed || children.length === 0) return [label];
    const groups: { lines: string[]; key: string; count: number }[] = [];
    for (const child of children) {
      const lines = this.subtree(child, depth - 1);
      const key = lines.join('\n');
      const last = groups.at(-1);
      if (last?.key === key) last.count += 1;
      else groups.push({ lines, key, count: 1 });
    }
    const shown = groups.slice(0, MAX_CHILD_GROUPS).flatMap(({ lines, count }) => {
      const [first, ...rest] = lines;
      return [count > 1 ? `${first}  × ${count}` : first, ...rest].map((line) => INDENT + line);
    });
    const hidden = groups.slice(MAX_CHILD_GROUPS).reduce((sum, group) => sum + group.count, 0);
    return [label, ...shown, ...(hidden > 0 ? [`${INDENT}… ${hidden} more`] : [])];
  }

  /** A few ancestors, one line each, then the element's own subtree under the last of them. */
  around(element: Element): string[] {
    const chain: Element[] = [];
    for (
      let node = element.parentElement;
      node && chain.length < ANCESTOR_LEVELS && node.localName !== 'body';
      node = node.parentElement
    )
      chain.unshift(node);
    const lines = [
      ...chain.map((node, level) => INDENT.repeat(level) + this.label(node)),
      ...this.subtree(element, SUBTREE_DEPTH).map((line) => INDENT.repeat(chain.length) + line),
    ];
    return lines.length > MAX_SAMPLE_LINES
      ? [...lines.slice(0, MAX_SAMPLE_LINES - 1), `${INDENT.repeat(chain.length)}…`]
      : lines;
  }
}

function lastRendered(doc: Document, selector: string | undefined): Element | null {
  if (!selector) return null;
  return queryAll(doc, selector).findLast(isRendered) ?? null;
}

/** The outline of the page `doc` shows, at most `MAX_PAGE_OUTLINE_CHARS` long. */
export function buildPageOutline(doc: Document, site: SiteAdapter, url: string): string {
  const anchors = pageAnchors(doc, site);
  const outliner = new Outliner(anchors);
  const selectorOf = (name: string) => anchors.find((anchor) => anchor.name === name)?.selector;
  const head = [
    `Site: ${site.label}. Path: ${pathShape(url, site)}`,
    'Anchors on this page now (element count):',
    ...anchors.map((anchor) =>
      anchor.name === 'reply'
        ? `- reply, one per AI reply (${anchor.selector}): ${queryAll(doc, anchor.selector).length}`
        : `- ${anchor.name}: ${queryAll(doc, anchor.selector).length}`,
    ),
  ];
  const sample = (title: string, missing: string, element: Element | null) =>
    element ? ['', `${title}:`, ...outliner.around(element)] : ['', missing];
  const reply = lastRendered(doc, selectorOf('reply') ?? selectorOf('assistantTurn'));
  const user = lastRendered(doc, selectorOf('userTurn'));
  const lines = [
    ...head,
    ...sample('Around the last AI reply', 'No AI reply on this page.', reply),
    ...sample('Around the last user message', 'No user message on this page.', user),
  ].map(clip);
  const text = lines.join('\n');
  if (text.length <= MAX_PAGE_OUTLINE_CHARS) return text;
  // Over the ceiling: drop lines from the end, never the anchor counts.
  while (lines.length > head.length && `${lines.join('\n')}\n…`.length > MAX_PAGE_OUTLINE_CHARS)
    lines.pop();
  return `${lines.join('\n')}\n…`.slice(0, MAX_PAGE_OUTLINE_CHARS);
}
