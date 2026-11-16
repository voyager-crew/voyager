/**
 * Grok reply markdown. Cited sources (`cited*` fields and `citation_card`
 * placeholders, or a bare URL of one of those) become `[[n]](url)` and a
 * numbered **Sources** list. Search hits the reply does not cite are left
 * out. A `t.co` link and its expanded page are one target.
 */

const RENDER_PAIR = /<grok:render\b([^>]*)>[\s\S]*?<\/grok:render>/gi;
const RENDER_EMPTY = /<grok:render\b[^>]*\/>/gi;
const BARE_URL = /https?:\/\/[^\s<>)\]]+/g;
const TRAILING_PUNCT = /[.,;:!?。，、；：！？]+$/;
const CITATION_MARKER = /\[\[\d+\]\]\(https?:\/\/[^\s)]+\)/g;
const VIDEO_ID = /^[\w-]{11}$/;
const USERNAME = /^[A-Za-z0-9_]{1,15}$/;
const POST_ID = /^\d{5,25}$/;
const MAX_CARDS = 100;
const MAX_LINKS = 100;

const YOUTUBE_FALLBACK = 'YouTube video';
const EXPANDED_KEY = /^(?:expanded|canonical|unwound)_?url$/i;

interface LinkFact {
  url: string;
  title: string;
  identity: string;
  /** Identity of a t.co (or other) URL that should open this same target. */
  aliasFrom?: string;
}

interface CardLink {
  id: string;
  url?: string;
  title: string;
  cardType: string;
  type: string;
}

interface SourceLine {
  url: string;
  title: string;
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function httpUrl(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > 2_000) return null;
  try {
    const url = new URL(trimmed);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    return trimmed;
  } catch {
    return null;
  }
}

function plainTitle(value: unknown): string {
  if (typeof value !== 'string') return '';
  const trimmed = value.replace(/\s+/g, ' ').trim();
  if (!trimmed || /^https?:\/\//.test(trimmed)) return '';
  return trimmed.length > 180 ? `${trimmed.slice(0, 177)}...` : trimmed;
}

/** Markdown-safe link text. Brackets would close the link early. */
function linkLabel(text: string, fallback: string): string {
  const label = plainTitle(text) || fallback;
  return label.replace(/\\/g, '\\\\').replace(/\[/g, '\\[').replace(/\]/g, '\\]');
}

function hostOf(url: URL): string {
  return url.hostname.toLowerCase().replace(/^www\./, '');
}

/** watch?v=, youtu.be/ and shorts/ only. Anything else stays a normal link. */
export function youtubeVideoId(raw: string): string | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  const host = hostOf(url);
  if (host === 'youtu.be') {
    const id = url.pathname.split('/').filter(Boolean)[0] ?? '';
    return VIDEO_ID.test(id) ? id : null;
  }
  if (host !== 'youtube.com') return null;
  const shorts = /^\/shorts\/([\w-]{11})\/?$/.exec(url.pathname);
  if (shorts?.[1]) return shorts[1];
  if (url.pathname === '/watch') {
    const id = url.searchParams.get('v') ?? '';
    return VIDEO_ID.test(id) ? id : null;
  }
  return null;
}

function youtubeCover(title: string, id: string, url: string): string {
  const thumb = `https://img.youtube.com/vi/${id}/hqdefault.jpg`;
  return `[![${linkLabel(title, YOUTUBE_FALLBACK)}](${thumb})](${url})`;
}

interface FenceMark {
  char: '`' | '~';
  len: number;
  rest: string;
}

function fenceMark(line: string): FenceMark | null {
  const match = /^( {0,3})(`{3,}|~{3,})(.*)$/.exec(line);
  if (!match) return null;
  const marker = match[2] ?? '';
  const char = marker[0];
  if (char !== '`' && char !== '~') return null;
  return { char, len: marker.length, rest: match[3] ?? '' };
}

function mapOutsideFences(markdown: string, edit: (line: string) => string): string {
  let open: { char: '`' | '~'; len: number } | null = null;
  return markdown
    .split('\n')
    .map((line) => {
      const mark = fenceMark(line);
      if (open) {
        if (mark && mark.char === open.char && mark.len >= open.len && mark.rest.trim() === '') {
          open = null;
        }
        return line;
      }
      if (mark && (mark.char === '~' || !mark.rest.includes('`'))) {
        open = mark;
        return line;
      }
      return edit(line);
    })
    .join('\n');
}

function mapOutsideInlineCode(line: string, edit: (plain: string) => string): string {
  let out = '';
  let index = 0;
  while (index < line.length) {
    if (line[index] !== '`') {
      const next = line.indexOf('`', index);
      const end = next === -1 ? line.length : next;
      out += edit(line.slice(index, end));
      index = end;
      continue;
    }
    const ticks = /^`+/.exec(line.slice(index))?.[0] ?? '`';
    const close = line.indexOf(ticks, index + ticks.length);
    if (close === -1) {
      out += edit(line.slice(index));
      break;
    }
    out += line.slice(index, close + ticks.length);
    index = close + ticks.length;
  }
  return out;
}

function mapProse(markdown: string, edit: (segment: string) => string): string {
  return mapOutsideFences(markdown, (line) => mapOutsideInlineCode(line, edit));
}

function embedYouTubeSegment(
  segment: string,
  titles: ReadonlyMap<string, string>,
  seen: Set<string>,
): string {
  const linked = segment.replace(
    /(?<!!)\[([^[\]]*)\]\((https?:\/\/[^\s)]+)\)/g,
    (whole, label: string, url: string) => {
      const id = youtubeVideoId(url);
      if (!id) return whole;
      if (seen.has(id)) return whole;
      seen.add(id);
      return youtubeCover(plainTitle(label) || titles.get(id) || YOUTUBE_FALLBACK, id, url);
    },
  );
  return linked.replace(BARE_URL, (raw: string, offset: number, source: string) => {
    if (source.slice(Math.max(0, offset - 2), offset) === '](') return raw;
    const { url: trimmed, rest } = splitUrl(raw);
    const id = youtubeVideoId(trimmed);
    if (!id) return raw;
    if (seen.has(id)) return raw;
    seen.add(id);
    return `${youtubeCover(titles.get(id) || YOUTUBE_FALLBACK, id, trimmed)}${rest}`;
  });
}

export function embedYouTubeLinks(
  markdown: string,
  titles: ReadonlyMap<string, string> = new Map(),
): string {
  const seen = new Set<string>();
  return mapProse(markdown, (segment) => embedYouTubeSegment(segment, titles, seen));
}

function embedOutsideCitations(markdown: string, titles: ReadonlyMap<string, string>): string {
  const saved: string[] = [];
  const shielded = markdown.replace(CITATION_MARKER, (whole) => {
    const token = `\uE000${saved.length}\uE001`;
    saved.push(whole);
    return token;
  });
  return embedYouTubeLinks(shielded, titles).replace(
    /\uE000(\d+)\uE001/g,
    (_whole, index: string) => saved[Number(index)] ?? '',
  );
}

function splitUrl(raw: string): { url: string; rest: string } {
  const url = raw.replace(TRAILING_PUNCT, '');
  return { url, rest: raw.slice(url.length) };
}

function listOf(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  const results = record(value)?.results;
  return Array.isArray(results) ? results : [];
}

function parsedHttp(raw: string): URL | null {
  const text = httpUrl(raw);
  if (!text) return null;
  try {
    return new URL(text);
  } catch {
    return null;
  }
}

function identityOf(raw: string): string | null {
  const url = parsedHttp(raw);
  if (!url) return null;
  const host = hostOf(url);
  if (host === 't.co') {
    const code = url.pathname.split('/').filter(Boolean)[0] ?? '';
    return code ? `tco:${code}` : null;
  }
  const video = youtubeVideoId(url.href);
  if (video) return `yt:${video}`;
  if (
    host === 'x.com' ||
    host === 'twitter.com' ||
    host === 'mobile.x.com' ||
    host === 'mobile.twitter.com'
  ) {
    const parts = url.pathname.split('/').filter(Boolean);
    const id = parts[2] ?? '';
    if (parts[1]?.toLowerCase() === 'status' && POST_ID.test(id)) return `x:${id}`;
  }
  url.hash = '';
  let path = url.pathname;
  if (path.length > 1 && path.endsWith('/')) path = path.slice(0, -1);
  const search = url.searchParams.toString();
  return `${host}${path}${search ? `?${search}` : ''}`;
}

function displayHref(raw: string): string | null {
  const url = parsedHttp(raw);
  if (!url) return null;
  const host = hostOf(url);
  if (
    host === 'x.com' ||
    host === 'twitter.com' ||
    host === 'mobile.x.com' ||
    host === 'mobile.twitter.com'
  ) {
    const parts = url.pathname.split('/').filter(Boolean);
    const id = parts[2] ?? '';
    const user = parts[0] ?? '';
    if (parts[1]?.toLowerCase() === 'status' && POST_ID.test(id) && USERNAME.test(user)) {
      return `https://x.com/${user}/status/${id}`;
    }
  }
  url.hash = '';
  if (url.pathname.length > 1 && url.pathname.endsWith('/') && !url.search) {
    url.pathname = url.pathname.slice(0, -1);
  }
  return url.href;
}

function isShort(raw: string): boolean {
  return identityOf(raw)?.startsWith('tco:') ?? false;
}

function expandedTarget(data: Record<string, unknown>, from: string): string | undefined {
  for (const [key, value] of Object.entries(data)) {
    if (!EXPANDED_KEY.test(key)) continue;
    const url = httpUrl(value);
    if (url && identityOf(url) !== identityOf(from)) return displayHref(url) ?? undefined;
  }
  const urls = record(data.entities)?.urls;
  if (!Array.isArray(urls)) return undefined;
  const fromId = identityOf(from);
  for (const item of urls) {
    const row = record(item);
    const short = httpUrl(row?.url);
    const long = httpUrl(row?.expanded_url) ?? httpUrl(row?.expandedUrl);
    if (!short || !long || identityOf(short) !== fromId) continue;
    return displayHref(long) ?? undefined;
  }
  return undefined;
}

function take(raw: string, title: string, expanded?: string): LinkFact | null {
  const shown = displayHref(expanded && !isShort(expanded) ? expanded : raw);
  const identity = shown ? identityOf(shown) : null;
  const from = identityOf(raw);
  if (!shown || !identity) return null;
  return {
    url: shown,
    title,
    identity,
    ...(from && from !== identity ? { aliasFrom: from } : {}),
  };
}

function readWeb(value: unknown): LinkFact[] {
  const links: LinkFact[] = [];
  for (const item of listOf(value)) {
    if (links.length >= MAX_LINKS) break;
    const data = record(item);
    const raw = data ? httpUrl(data.url) : null;
    if (!data || !raw) continue;
    const link = take(raw, plainTitle(data.title), expandedTarget(data, raw));
    if (link) links.push(link);
  }
  return links;
}

function readPosts(value: unknown): LinkFact[] {
  const links: LinkFact[] = [];
  for (const item of listOf(value)) {
    if (links.length >= MAX_LINKS) break;
    const data = record(item);
    if (!data) continue;
    const username = typeof data.username === 'string' ? data.username.trim() : '';
    const postId =
      typeof data.postId === 'string'
        ? data.postId.trim()
        : typeof data.id === 'string' && POST_ID.test(data.id.trim())
          ? data.id.trim()
          : '';
    if (!USERNAME.test(username) || !POST_ID.test(postId)) continue;
    const status = `https://x.com/${username}/status/${postId}`;
    const direct = httpUrl(data.url);
    const expanded = direct ? expandedTarget(data, direct) : undefined;
    const title = plainTitle(data.text) || plainTitle(data.title);
    const post: LinkFact = { url: status, title, identity: `x:${postId}` };
    const from = direct ? identityOf(direct) : null;
    if (from?.startsWith('tco:')) {
      const page = expanded && !isShort(expanded) ? expanded : '';
      const pageId = page ? identityOf(page) : null;
      if (page && pageId) links.push({ url: page, title, identity: pageId, aliasFrom: from });
      else post.aliasFrom = from;
    }
    links.push(post);
  }
  return links;
}

function readCards(value: unknown): Map<string, CardLink> {
  const cards = new Map<string, CardLink>();
  for (const item of listOf(value).slice(0, MAX_CARDS)) {
    const parsed = typeof item === 'string' ? record(parseJson(item)) : record(item);
    if (!parsed) continue;
    const id = typeof parsed.id === 'string' ? parsed.id.trim() : '';
    if (!id || id.length > 80 || cards.has(id)) continue;
    const url = httpUrl(parsed.url) ?? httpUrl(parsed.link) ?? undefined;
    const cardType = typeof parsed.cardType === 'string' ? parsed.cardType : '';
    const type = typeof parsed.type === 'string' ? parsed.type : '';
    cards.set(id, { id, ...(url ? { url } : {}), title: plainTitle(parsed.title), cardType, type });
  }
  return cards;
}

function parseJson(value: string): unknown {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
}

function isCitation(card: CardLink): boolean {
  if (card.cardType === 'citation_card' || card.type === 'render_inline_citation') return true;
  return !card.cardType && !card.type && Boolean(card.url);
}

function resolveId(identity: string, aliases: ReadonlyMap<string, string>): string {
  let current = identity;
  const seen = new Set<string>();
  for (let hop = 0; hop < 4; hop++) {
    const next = aliases.get(current);
    if (!next || next === current || seen.has(next)) return current;
    seen.add(current);
    current = next;
  }
  return current;
}

function indexLinks(groups: readonly (readonly LinkFact[])[]): {
  catalog: LinkFact[];
  aliases: Map<string, string>;
} {
  const catalog = groups.flat();
  const aliases = new Map<string, string>();
  for (const link of catalog) {
    if (link.aliasFrom) aliases.set(link.aliasFrom, link.identity);
  }
  const owners = new Map<string, string | null>();
  for (const link of catalog) {
    const id = resolveId(link.identity, aliases);
    if (!link.title || id.startsWith('tco:')) continue;
    const prev = owners.get(link.title);
    owners.set(link.title, prev === undefined || prev === id ? id : null);
  }
  for (const link of catalog) {
    const id = resolveId(link.identity, aliases);
    if (!id.startsWith('tco:') || !link.title || aliases.has(id)) continue;
    const owner = owners.get(link.title);
    if (owner) aliases.set(id, owner);
  }
  return { catalog, aliases };
}

function youtubeTitles(
  links: readonly LinkFact[],
  cards: ReadonlyMap<string, CardLink>,
): Map<string, string> {
  const titles = new Map<string, string>();
  const add = (url: string, title: string) => {
    const id = youtubeVideoId(url);
    if (id && title && !titles.has(id)) titles.set(id, title);
  };
  for (const link of links) add(link.url, link.title);
  for (const card of cards.values()) {
    if (card.url) add(card.url, card.title);
  }
  return titles;
}

interface CitationIndex {
  order: SourceLine[];
  cited: Set<string>;
  marker: (identity: string, fallbackUrl: string, title: string) => string;
  ensure: (identity: string, fallbackUrl: string, title: string) => void;
  resolve: (identity: string) => string;
  show: (identity: string, fallbackUrl: string) => string;
}

function createCitations(
  catalog: readonly LinkFact[],
  aliases: ReadonlyMap<string, string>,
): CitationIndex {
  const order: SourceLine[] = [];
  const numbers = new Map<string, number>();
  const cited = new Set<string>();
  const resolve = (identity: string) => resolveId(identity, aliases);

  const show = (identity: string, fallbackUrl: string): string => {
    const id = resolve(identity);
    for (const link of catalog) {
      if (resolve(link.identity) !== id || isShort(link.url)) continue;
      return link.url;
    }
    return displayHref(fallbackUrl) ?? fallbackUrl;
  };

  const titleOf = (identity: string, fallback: string): string => {
    if (fallback) return fallback;
    const id = resolve(identity);
    for (const link of catalog) {
      if (resolve(link.identity) === id && link.title) return link.title;
    }
    return '';
  };

  const ensure = (identity: string, fallbackUrl: string, title: string): number | null => {
    const id = resolve(identity);
    const existing = numbers.get(id);
    if (existing) {
      const slot = order[existing - 1];
      if (slot && !slot.title) slot.title = titleOf(id, title);
      return existing;
    }
    if (order.length >= MAX_LINKS) return null;
    const n = order.length + 1;
    numbers.set(id, n);
    order.push({ url: show(id, fallbackUrl), title: titleOf(id, title) });
    return n;
  };

  // A card or post title pasted here swallowed the sentence; Sources keeps the title.
  const marker = (identity: string, fallbackUrl: string, title: string): string => {
    const n = ensure(identity, fallbackUrl, title);
    const url = n ? order[n - 1]!.url : show(identity, fallbackUrl);
    if (n) cited.add(resolve(identity));
    return n ? `[[${n}]](${url})` : url;
  };

  return { order, cited, marker, ensure, resolve, show };
}

function cardId(attrs: string): string | null {
  const match = /card_id=(?:"([^"]+)"|'([^']+)')/i.exec(attrs);
  return match?.[1] ?? match?.[2] ?? null;
}

function replaceRenderTags(
  raw: string,
  cards: ReadonlyMap<string, CardLink>,
  cite: CitationIndex,
): string {
  return raw.replace(RENDER_PAIR, (_whole, attrs: string) => {
    const id = cardId(attrs);
    const card = id ? cards.get(id) : undefined;
    if (!card?.url) return '';
    const identity = identityOf(card.url);
    if (!identity) return '';
    if (!isCitation(card)) return cite.show(identity, card.url);
    cite.cited.add(cite.resolve(identity));
    return cite.marker(identity, card.url, card.title);
  });
}

function replaceCitedUrls(segment: string, cite: CitationIndex): string {
  return segment.replace(BARE_URL, (raw: string, offset: number, source: string) => {
    if (source.slice(Math.max(0, offset - 2), offset) === '](') return raw;
    const { url: trimmed, rest } = splitUrl(raw);
    const identity = identityOf(trimmed);
    // A cited video stays a cover. Sources still lists it.
    if (!identity || youtubeVideoId(trimmed) || !cite.cited.has(cite.resolve(identity))) return raw;
    return `${cite.marker(identity, trimmed, '')}${rest}`;
  });
}

function appendBlock(body: string, block: string): string {
  if (!block) return body;
  return body ? `${body}\n\n${block}` : block;
}

function sourcesBlock(order: readonly SourceLine[]): string {
  if (order.length === 0) return '';
  const lines = order.map((source, index) =>
    source.title
      ? `${index + 1}. [${linkLabel(source.title, source.url)}](${source.url})`
      : `${index + 1}. ${source.url}`,
  );
  return `**Sources**\n\n${lines.join('\n')}`;
}

export function grokMessageMarkdown(facts: Record<string, unknown>): string {
  const message = typeof facts.message === 'string' ? facts.message : '';
  const query = typeof facts.query === 'string' ? facts.query : '';
  const raw = message.trim() ? message : query;
  const cards = readCards(facts.cardAttachmentsJson);
  const web = readWeb(facts.webSearchResults);
  const citedWeb = readWeb(facts.citedWebSearchResults);
  const posts = readPosts(facts.xposts);
  const citedPosts = readPosts(facts.citedXposts);
  const searchedPosts = readPosts(facts.xSearchResults);
  const { catalog, aliases } = indexLinks([web, citedWeb, posts, citedPosts, searchedPosts]);
  const cite = createCitations(catalog, aliases);
  for (const link of [...citedWeb, ...citedPosts]) cite.cited.add(cite.resolve(link.identity));

  const withRenders = replaceRenderTags(raw, cards, cite).replace(RENDER_EMPTY, '');
  const collapsed = withRenders.replace(/[ \t]{2,}/g, ' ').trim();
  const withBare = mapProse(collapsed, (segment) => replaceCitedUrls(segment, cite));
  const body = embedOutsideCitations(withBare, youtubeTitles(web, cards));

  for (const link of [...citedWeb, ...citedPosts]) cite.ensure(link.identity, link.url, link.title);
  return appendBlock(body, sourcesBlock(cite.order));
}
