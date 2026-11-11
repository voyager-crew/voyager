/**
 * Syntax colouring for code a person reviews before turning it on. Every token
 * is a contiguous slice of the source, in order, so the tokens always join
 * back to the exact source: colouring may be wrong on odd input, but it never
 * hides, reorders or changes a character. Nothing here parses; a construct it
 * cannot classify stays plain.
 */
export type CodeLanguage = 'javascript' | 'css';

export type CodeTokenKind = 'plain' | 'comment' | 'string' | 'number' | 'keyword' | 'property';

export interface CodeToken {
  readonly kind: CodeTokenKind;
  readonly text: string;
}

/**
 * Past this many characters the source shows as plain text. Scanning is
 * linear and cheap; the cost is a DOM node per token. Dense script at this
 * size is about 10k spans, near 100ms to mount and 40ms to open its fold on
 * a fast laptop, twice that at 100k, so a slow machine still does not stall.
 */
export const MAX_HIGHLIGHT_CHARS = 50_000;

interface Scan {
  readonly kind: CodeTokenKind;
  readonly end: number;
}

type Scanner = (source: string, pos: number) => Scan;

function codePointEnd(source: string, pos: number): number {
  const code = source.charCodeAt(pos);
  const low = source.charCodeAt(pos + 1);
  const pair = code >= 0xd800 && code <= 0xdbff && low >= 0xdc00 && low <= 0xdfff;
  return pos + (pair ? 2 : 1);
}

function stickyEnd(pattern: RegExp, source: string, pos: number): number | null {
  pattern.lastIndex = pos;
  return pattern.test(source) ? pattern.lastIndex : null;
}

function blockCommentEnd(source: string, pos: number): number {
  const close = source.indexOf('*/', pos + 2);
  return close === -1 ? source.length : close + 2;
}

/** A quoted string up to its closing quote, or up to the line's end when it has none. */
function quotedEnd(source: string, pos: number): number {
  const quote = source[pos];
  let index = pos + 1;
  while (index < source.length) {
    const char = source[index];
    if (char === '\\') index += 2;
    else if (char === quote) return index + 1;
    else if (char === '\n' || char === '\r') return index;
    else index += 1;
  }
  return source.length;
}

const WHITESPACE = /\s+/y;

const JS_KEYWORDS = new Set([
  'async',
  'await',
  'break',
  'case',
  'catch',
  'class',
  'const',
  'continue',
  'debugger',
  'default',
  'delete',
  'do',
  'else',
  'export',
  'extends',
  'false',
  'finally',
  'for',
  'function',
  'if',
  'import',
  'in',
  'instanceof',
  'let',
  'new',
  'null',
  'of',
  'return',
  'static',
  'super',
  'switch',
  'this',
  'throw',
  'true',
  'try',
  'typeof',
  'undefined',
  'var',
  'void',
  'while',
  'with',
  'yield',
]);
/** Words after which a `/` starts a regular expression rather than a division. */
const JS_REGEX_AFTER = new Set([
  'await',
  'case',
  'delete',
  'do',
  'else',
  'in',
  'instanceof',
  'new',
  'of',
  'return',
  'throw',
  'typeof',
  'void',
  'yield',
]);
const JS_LINE_COMMENT = /\/\/[^\r\n\u2028\u2029]*/y;
const JS_REGEX = /\/(?![*/])(?:\\[^\r\n]|\[(?:\\[^\r\n]|[^\]\\\r\n])*\]|[^/\\[\r\n])+\/[a-z]*/y;
const JS_NUMBER =
  /(?:0[xX][\da-fA-F_]+|0[bB][01_]+|0[oO][0-7_]+|(?:\d[\d_]*(?:\.[\d_]*)?|\.\d[\d_]*)(?:[eE][+-]?\d[\d_]*)?)n?/y;
const JS_WORD = /[A-Za-z_$][\w$]*/y;
const JS_WORD_CHAR = /[\w$]/;
const JS_WHOLE_WORD = /^[\w$]+$/;

/**
 * One frame per open template literal and per `${…}` inside one, so a
 * template nested in an expression closes where it began.
 */
type JsFrame = { readonly kind: 'template' } | { kind: 'expression'; depth: number };

function javascriptScanner(): Scanner {
  const frames: JsFrame[] = [];
  /** The last token that is not space or a comment, for telling a regex from a division. */
  let last: { kind: CodeTokenKind; text: string } | null = null;

  const regexAllowed = (): boolean => {
    if (!last) return true;
    if (last.kind === 'string' || last.kind === 'number') return false;
    if (JS_WHOLE_WORD.test(last.text)) {
      return last.kind === 'keyword' && JS_REGEX_AFTER.has(last.text);
    }
    return !/^[)\]}]$/.test(last.text);
  };

  /** Template text from `start`: up to and with its closing backtick, or up to a `${`. */
  const template = (source: string, start: number, from: number): Scan => {
    let index = from;
    while (index < source.length) {
      const char = source[index];
      if (char === '\\') index += 2;
      else if (char === '`') {
        frames.pop();
        return { kind: 'string', end: index + 1 };
      } else if (char === '$' && source[index + 1] === '{') {
        if (index > start) return { kind: 'string', end: index };
        frames.push({ kind: 'expression', depth: 0 });
        return { kind: 'plain', end: index + 2 };
      } else index += 1;
    }
    return { kind: 'string', end: source.length };
  };

  const code = (source: string, pos: number): Scan => {
    const char = source[pos];
    const space = stickyEnd(WHITESPACE, source, pos);
    if (space !== null) return { kind: 'plain', end: space };
    if (char === '/' && source[pos + 1] === '/') {
      return { kind: 'comment', end: stickyEnd(JS_LINE_COMMENT, source, pos) ?? source.length };
    }
    if (char === '/' && source[pos + 1] === '*') {
      return { kind: 'comment', end: blockCommentEnd(source, pos) };
    }
    if (char === '"' || char === "'") return { kind: 'string', end: quotedEnd(source, pos) };
    if (char === '`') {
      frames.push({ kind: 'template' });
      return template(source, pos, pos + 1);
    }
    const top = frames.at(-1);
    if (top?.kind === 'expression' && (char === '{' || char === '}')) {
      if (char === '{') top.depth += 1;
      else if (top.depth > 0) top.depth -= 1;
      else frames.pop();
      return { kind: 'plain', end: pos + 1 };
    }
    if (char === '/') {
      const regex = regexAllowed() ? stickyEnd(JS_REGEX, source, pos) : null;
      return regex === null ? { kind: 'plain', end: pos + 1 } : { kind: 'string', end: regex };
    }
    const previous = source[pos - 1] ?? '';
    if (!JS_WORD_CHAR.test(previous)) {
      const number = /[\d.]/.test(char) ? stickyEnd(JS_NUMBER, source, pos) : null;
      if (number !== null) return { kind: 'number', end: number };
      const word = stickyEnd(JS_WORD, source, pos);
      if (word !== null) {
        const text = source.slice(pos, word);
        const member = last?.text === '.' || last?.text === '?.';
        return { kind: !member && JS_KEYWORDS.has(text) ? 'keyword' : 'plain', end: word };
      }
    }
    if (char === '?' && source[pos + 1] === '.' && !/\d/.test(source[pos + 2] ?? '')) {
      return { kind: 'plain', end: pos + 2 };
    }
    return { kind: 'plain', end: codePointEnd(source, pos) };
  };

  return (source, pos) => {
    const scan =
      frames.at(-1)?.kind === 'template' ? template(source, pos, pos) : code(source, pos);
    const text = source.slice(pos, scan.end);
    if (scan.kind !== 'comment' && text.trim() !== '') last = { kind: scan.kind, text };
    return scan;
  };
}

const CSS_AT_RULE = /@[-\w]+/y;
const CSS_IMPORTANT = /!\s*important\b/iy;
const CSS_HEX = /#[\da-fA-F]{3,8}(?![-\w])/y;
const CSS_PROPERTY = /-{0,2}[A-Za-z_][-\w]*(?=\s*:)/y;
const CSS_WORD = /-{0,2}[A-Za-z_][-\w]*/y;
const CSS_NUMBER = /[+-]?(?:\d+(?:\.\d+)?|\.\d+)(?:[eE][+-]?\d+)?(?:%|[A-Za-z]+)?/y;

function cssScanner(): Scanner {
  let depth = 0;
  /** After a declaration's colon, until its `;` or the block's end. */
  let inValue = false;

  return (source, pos) => {
    const char = source[pos];
    const space = stickyEnd(WHITESPACE, source, pos);
    if (space !== null) return { kind: 'plain', end: space };
    if (char === '/' && source[pos + 1] === '*') {
      return { kind: 'comment', end: blockCommentEnd(source, pos) };
    }
    if (char === '"' || char === "'") return { kind: 'string', end: quotedEnd(source, pos) };
    if (char === '{' || char === '}' || char === ';') {
      if (char === '{') depth += 1;
      if (char === '}') depth = Math.max(0, depth - 1);
      inValue = false;
      return { kind: 'plain', end: pos + 1 };
    }
    if (char === ':' && depth > 0) inValue = true;
    const atRule = char === '@' ? stickyEnd(CSS_AT_RULE, source, pos) : null;
    if (atRule !== null) return { kind: 'keyword', end: atRule };
    if (inValue) {
      const important = char === '!' ? stickyEnd(CSS_IMPORTANT, source, pos) : null;
      if (important !== null) return { kind: 'keyword', end: important };
      const hex = char === '#' ? stickyEnd(CSS_HEX, source, pos) : null;
      if (hex !== null) return { kind: 'number', end: hex };
    } else if (depth > 0) {
      const property = stickyEnd(CSS_PROPERTY, source, pos);
      if (property !== null) return { kind: 'property', end: property };
    }
    const word = stickyEnd(CSS_WORD, source, pos);
    if (word !== null) return { kind: 'plain', end: word };
    const number = stickyEnd(CSS_NUMBER, source, pos);
    if (number !== null) return { kind: 'number', end: number };
    return { kind: 'plain', end: codePointEnd(source, pos) };
  };
}

const SCANNERS: Readonly<Record<CodeLanguage, () => Scanner>> = {
  javascript: javascriptScanner,
  css: cssScanner,
};

export function tokenizeCode(source: string, language: CodeLanguage): readonly CodeToken[] {
  if (source.length === 0) return [];
  if (source.length > MAX_HIGHLIGHT_CHARS) return [{ kind: 'plain', text: source }];
  const scan = SCANNERS[language]();
  const tokens: CodeToken[] = [];
  let pos = 0;
  while (pos < source.length) {
    const next = scan(source, pos);
    // Every step moves forward by at least one character and never past the end.
    const end = Math.min(source.length, Math.max(next.end, pos + 1));
    const text = source.slice(pos, end);
    const previous = tokens.at(-1);
    if (previous?.kind === next.kind)
      tokens[tokens.length - 1] = { kind: next.kind, text: previous.text + text };
    else tokens.push({ kind: next.kind, text });
    pos = end;
  }
  return tokens;
}
