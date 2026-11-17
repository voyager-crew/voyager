/**
 * Strict Markdown renderers keep a list in the previous paragraph unless a
 * blank line separates them. Grok's replies often omit that line. Fenced code
 * is left untouched, including a list-shaped line inside a sample.
 */

interface Fence {
  char: '`' | '~';
  len: number;
}

const TOP_LEVEL_ITEM = /^(?:[-+*]|\d{1,9}[.)])\s+\S/;
const LIST_ITEM = /^ {0,3}(?:[-+*]|\d{1,9}[.)])\s+\S/;

function fenceMark(line: string): (Fence & { rest: string }) | null {
  const match = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line);
  if (!match) return null;
  const marker = match[1];
  return { char: marker[0] as Fence['char'], len: marker.length, rest: match[2] };
}

/** Rewrite each line outside fenced code; `previous` is the raw line before it. */
export function mapOutsideFences(
  markdown: string,
  edit: (line: string, previous: string | undefined) => string,
): string {
  let open: Fence | null = null;
  const lines = markdown.split('\n');
  return lines
    .map((line, index) => {
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
      return edit(line, lines[index - 1]);
    })
    .join('\n');
}

/** Insert a blank line before a top-level list that follows a paragraph. */
export function separateMarkdownLists(markdown: string): string {
  return mapOutsideFences(markdown, (line, previous) =>
    TOP_LEVEL_ITEM.test(line) && previous?.trim() && !LIST_ITEM.test(previous) ? `\n${line}` : line,
  );
}
