/**
 * Grok reply text for export.
 *
 * `load-responses` bodies carry the markdown in `message` plus, when Grok
 * searched or unfurled a card, `webSearchResults`, `citedWebSearchResults`,
 * `xposts` / `citedXposts` / `xSearchResults`, and `cardAttachmentsJson`.
 * Public clients (ai-vault, grok2api) read those names. A YouTube link in the
 * markdown has no title there, so the cover uses the search/card title or
 * "YouTube video". Citation widgets stay out of the sentence unless the card
 * payload names a URL.
 */

const RENDER_PAIR = /<grok:render\b([^>]*)>[\s\S]*?<\/grok:render>/gi;
const RENDER_EMPTY = /<grok:render\b[^>]*\/>/gi;
const BARE_URL = /https?:\/\/[^\s<>)\]]+/g;
const VIDEO_ID = /^[\w-]{11}$/;
const USERNAME = /^[A-Za-z0-9_]{1,15}$/;
const POST_ID = /^\d{5,25}$/;
const MAX_CARDS = 100;
const MAX_LINKS = 100;

const YOUTUBE_FALLBACK = 'YouTube video';

interface SourceLink {
  url: string;
  title: string;
}

interface XPostLink {
  url: string;
  postId: string;
  username: string;
  text: string;
}

interface CardLink {
  id: string;
  url?: string;
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
  } catch {
    return null;
  }
  return trimmed;
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

/** watch?v=, youtu.be/ and shorts/ only. Anything else stays a normal link. */
export function youtubeVideoId(raw: string): string | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  const host = url.hostname.toLowerCase().replace(/^(?:www|m)\./, '');
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

function embedYouTubeSegment(segment: string, titles: ReadonlyMap<string, string>): string {
  const linked = segment.replace(
    /(?<!!)\[([^[\]]*)\]\((https?:\/\/[^\s)]+)\)/g,
    (whole, label: string, url: string) => {
      const id = youtubeVideoId(url);
      if (!id) return whole;
      const name = plainTitle(label);
      return youtubeCover(name || titles.get(id) || YOUTUBE_FALLBACK, id, url);
    },
  );
  return linked.replace(BARE_URL, (raw: string, offset: number, source: string) => {
    if (source.slice(Math.max(0, offset - 2), offset) === '](') return raw;
    const trimmed = raw.replace(/[.,;:!?]+$/g, '');
    const rest = raw.slice(trimmed.length);
    const id = youtubeVideoId(trimmed);
    if (!id) return raw;
    return `${youtubeCover(titles.get(id) || YOUTUBE_FALLBACK, id, trimmed)}${rest}`;
  });
}

/** Turn bare and linked YouTube URLs into cover images, leaving code alone. */
export function embedYouTubeLinks(
  markdown: string,
  titles: ReadonlyMap<string, string> = new Map(),
): string {
  return mapOutsideFences(markdown, (line) =>
    mapOutsideInlineCode(line, (segment) => embedYouTubeSegment(segment, titles)),
  );
}

function listOf(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  const results = record(value)?.results;
  return Array.isArray(results) ? results : [];
}

function readSources(facts: Record<string, unknown>): SourceLink[] {
  const seen = new Set<string>();
  const sources: SourceLink[] = [];
  for (const key of ['webSearchResults', 'citedWebSearchResults'] as const) {
    for (const item of listOf(facts[key])) {
      if (sources.length >= MAX_LINKS) return sources;
      const data = record(item);
      const url = httpUrl(data?.url);
      if (!data || !url || seen.has(url)) continue;
      seen.add(url);
      sources.push({ url, title: plainTitle(data.title) });
    }
  }
  return sources;
}

function readPosts(facts: Record<string, unknown>): XPostLink[] {
  const seen = new Set<string>();
  const posts: XPostLink[] = [];
  for (const key of ['xposts', 'citedXposts', 'xSearchResults'] as const) {
    for (const item of listOf(facts[key])) {
      if (posts.length >= MAX_LINKS) return posts;
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
      const url = `https://x.com/${username}/status/${postId}`;
      if (seen.has(url)) continue;
      seen.add(url);
      posts.push({ url, postId, username, text: plainTitle(data.text) });
    }
  }
  return posts;
}

function readCards(value: unknown): Map<string, CardLink> {
  const cards = new Map<string, CardLink>();
  for (const item of listOf(value).slice(0, MAX_CARDS)) {
    const parsed = typeof item === 'string' ? record(parseJson(item)) : record(item);
    if (!parsed) continue;
    const id = typeof parsed.id === 'string' ? parsed.id.trim() : '';
    if (!id || id.length > 80 || cards.has(id)) continue;
    const url = httpUrl(parsed.url) ?? httpUrl(parsed.link);
    cards.set(id, { id, ...(url ? { url } : {}), title: plainTitle(parsed.title) });
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

function youtubeTitles(
  sources: readonly SourceLink[],
  cards: ReadonlyMap<string, CardLink>,
): Map<string, string> {
  const titles = new Map<string, string>();
  const add = (url: string | undefined, title: string) => {
    if (!url || !title) return;
    const id = youtubeVideoId(url);
    if (id && !titles.has(id)) titles.set(id, title);
  };
  for (const source of sources) add(source.url, source.title);
  for (const card of cards.values()) add(card.url, card.title);
  return titles;
}

function cardId(attrs: string): string | null {
  const match = /card_id=(?:"([^"]+)"|'([^']+)')/i.exec(attrs);
  return match?.[1] ?? match?.[2] ?? null;
}

function replaceRenderTags(
  raw: string,
  cards: ReadonlyMap<string, CardLink>,
  sources: readonly SourceLink[],
): string {
  return raw.replace(RENDER_PAIR, (_whole, attrs: string) => {
    const id = cardId(attrs);
    const card = id ? cards.get(id) : undefined;
    if (!card?.url) return '';
    const title = card.title || sources.find((source) => source.url === card.url)?.title || '';
    return title ? `[${linkLabel(title, card.url)}](${card.url})` : card.url;
  });
}

function titleKnownPosts(body: string, posts: readonly XPostLink[]): string {
  return mapOutsideFences(body, (line) =>
    mapOutsideInlineCode(line, (segment) => {
      let next = segment;
      for (const post of posts) {
        if (!post.text || !next.includes(post.url) || next.includes(`](${post.url})`)) continue;
        next = next.replace(
          post.url,
          `[${linkLabel(post.text, `@${post.username}`)}](${post.url})`,
        );
      }
      return next;
    }),
  );
}

function appendBlock(body: string, block: string): string {
  if (!block) return body;
  return body ? `${body}\n\n${block}` : block;
}

/**
 * The exported markdown for one Grok response. Code fences are unchanged.
 * Search results and X posts already written in the body are not repeated.
 */
export function grokMessageMarkdown(facts: Record<string, unknown>): string {
  const message = typeof facts.message === 'string' ? facts.message : '';
  const query = typeof facts.query === 'string' ? facts.query : '';
  const raw = message.trim() ? message : query;
  const cards = readCards(facts.cardAttachmentsJson);
  const sources = readSources(facts);
  const posts = readPosts(facts);
  const titles = youtubeTitles(sources, cards);
  const body = embedYouTubeLinks(
    replaceRenderTags(raw, cards, sources)
      .replace(RENDER_EMPTY, '')
      .replace(/[ \t]{2,}/g, ' ')
      .trim(),
    titles,
  );
  const withPosts = titleKnownPosts(body, posts);
  const postLines = posts
    .filter(
      (post) => !withPosts.includes(post.url) && !withPosts.includes(`/status/${post.postId}`),
    )
    .map((post) =>
      post.text
        ? `- [${linkLabel(post.text, `@${post.username}`)}](${post.url})`
        : `- [@${post.username}](${post.url})`,
    );
  const sourceLines = sources
    .filter((source) => !withPosts.includes(source.url))
    .map((source) =>
      source.title
        ? `- [${linkLabel(source.title, source.url)}](${source.url})`
        : `- ${source.url}`,
    );
  const sourcesBlock = sourceLines.length > 0 ? `**Sources**\n\n${sourceLines.join('\n')}` : '';
  return appendBlock(appendBlock(withPosts, postLines.join('\n')), sourcesBlock);
}
