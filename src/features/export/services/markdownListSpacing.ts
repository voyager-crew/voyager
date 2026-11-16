/**
 * Strict Markdown renderers keep a list in the previous paragraph unless a
 * blank line separates them. Grok's replies often omit that line. Fenced code
 * is left untouched, including a list-shaped line inside a sample.
 */

interface FenceMark {
  char: '`' | '~';
  len: number;
  rest: string;
}

const LIST_ITEM = /^(?:[-+*]|\d{1,9}[.)])\s+\S/;

function fenceMark(line: string): FenceMark | null {
  const match = /^( {0,3})(`{3,}|~{3,})(.*)$/.exec(line);
  if (!match) return null;
  const marker = match[2] ?? '';
  const char = marker[0];
  if (char !== '`' && char !== '~') return null;
  return { char, len: marker.length, rest: match[3] ?? '' };
}

function isListItem(line: string): boolean {
  return /^ {0,3}(?:[-+*]|\d{1,9}[.)])\s+\S/.test(line);
}

/** Insert a blank line before a top-level list that follows a paragraph. */
export function separateMarkdownLists(markdown: string): string {
  let open: { char: '`' | '~'; len: number } | null = null;
  const out: string[] = [];
  for (const line of markdown.split('\n')) {
    const mark = fenceMark(line);
    if (open) {
      if (mark && mark.char === open.char && mark.len >= open.len && mark.rest.trim() === '') {
        open = null;
      }
      out.push(line);
      continue;
    }
    if (mark && (mark.char === '~' || !mark.rest.includes('`'))) {
      open = mark;
      out.push(line);
      continue;
    }
    const previous = out.length > 0 ? out[out.length - 1] : '';
    if (
      LIST_ITEM.test(line) &&
      previous !== undefined &&
      previous.trim() !== '' &&
      !isListItem(previous)
    ) {
      out.push('');
    }
    out.push(line);
  }
  return out.join('\n');
}
