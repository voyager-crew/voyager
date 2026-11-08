/**
 * Turn the component markup in a ChatGPT reply's source into plain Markdown.
 *
 * ChatGPT's conversation endpoint returns replies as Markdown mixed with UI
 * components the page renders as cards, badges and citation chips (sampled
 * live over 40 conversations, November 2026): `<Cite ref="turn0search0"/>`,
 * `<Link url="…" title="…"/>`, `<Entity category="people" value="…"/>`,
 * `<AsyncImage query="…"/>`, `<icon name="…"/>`, `<divider/>`, layout and
 * form blocks such as `<box>`, `<row>`, `<grid-item>`, `<badge>`,
 * `<table-cell>` and `<radio>`, and `<CodeBlock language="…">` for code.
 * Interactive widgets add script attributes (`onClick={() => …}`) and
 * template lines (`{@body const [a, setA] = DIL.useState(…)}`, `{#each …}`);
 * a document keeps only their text. Fenced and inline code keep theirs as
 * written, so a reply that writes about such tags stays intact.
 */

/** Components that render nothing worth keeping in a document. */
const DROPPED = new Set(['Cite', 'AsyncImage', 'AsyncImageGroup', 'icon', 'divider', 'favicon']);
/** Components whose children are the text; the tag itself goes. */
const UNWRAPPED = new Set([
  'box',
  'row',
  'grid',
  'grid-item',
  'text',
  'title',
  'badge',
  'caption',
  'label',
  'table',
  'table-row',
  'table-cell',
  'radio-group',
  'radio',
  'button',
  'form',
  'slider',
  'checkbox',
  'segmented-control',
  'Entity',
  'Link',
]);

interface Tag {
  readonly name: string;
  readonly closing: boolean;
  readonly selfClosing: boolean;
  readonly attributes: string;
  readonly end: number;
}

/**
 * Read the component tag at `start`, skipping `>` inside quoted strings and
 * `{…}` expressions. Null when no known component starts there.
 */
function readTag(text: string, start: number): Tag | null {
  const head = /^<(\/?)([A-Za-z][\w-]*)/.exec(text.slice(start, start + 64));
  if (!head) return null;
  const name = head[2]!;
  if (!DROPPED.has(name) && !UNWRAPPED.has(name)) return null;
  let depth = 0;
  let quote = '';
  for (let index = start + head[0].length; index < text.length; index++) {
    const char = text[index]!;
    if (quote) {
      if (char === quote && text[index - 1] !== '\\') quote = '';
    } else if (char === '"' || char === "'" || char === '`') {
      quote = char;
    } else if (char === '{') {
      depth++;
    } else if (char === '}') {
      depth = Math.max(0, depth - 1);
    } else if (char === '<' && depth === 0) {
      return null;
    } else if (char === '>' && depth === 0) {
      return {
        name,
        closing: head[1] === '/',
        selfClosing: text[index - 1] === '/',
        attributes: text.slice(start + head[0].length, index),
        end: index + 1,
      };
    }
  }
  return null;
}

function attribute(attributes: string, name: string): string {
  return attributes.match(new RegExp(`(?:^|\\s)${name}="([^"]*)"`))?.[1] ?? '';
}

function link(attributes: string, label: string): string {
  const url = attribute(attributes, 'url');
  const name = label.trim() || attribute(attributes, 'title') || url;
  return url ? `[${name}](${url})` : name;
}

/** Marks a line that held markup, whose indentation was the markup's. */
const MARK = '\u0001';
/** Where a table cell ended; the next cell of the row joins it. */
const CELL = '\u0002';
const CELL_END = new RegExp(`${CELL}[\\s${MARK}]*$`);
/** A widget's template line: `{@body …}`, `{#each …}`, `{:else}`, `{/each}`. */
const TEMPLATE_LINE = /^\s*\{[@#:/][^\n]*\}\s*$/;

function convertProse(prose: string): string {
  let output = '';
  let depth = 0;
  let dropping: { name: string; depth: number } | null = null;
  let linkOpen: { attributes: string; from: number } | null = null;
  let changed = false;
  let index = 0;
  while (index < prose.length) {
    const tag = prose[index] === '<' ? readTag(prose, index) : null;
    if (!tag) {
      if (!dropping) {
        const char = prose[index]!;
        output += depth > 0 && char === '\n' ? `\n${MARK}` : char;
      }
      index++;
      continue;
    }
    changed = true;
    index = tag.end;
    output += MARK;
    if (dropping) {
      if (tag.name === dropping.name && !tag.selfClosing) {
        dropping.depth += tag.closing ? -1 : 1;
        if (dropping.depth === 0) dropping = null;
      }
      continue;
    }
    if (DROPPED.has(tag.name)) {
      if (!tag.selfClosing && !tag.closing) dropping = { name: tag.name, depth: 1 };
      continue;
    }
    if (tag.name === 'Entity' && tag.selfClosing) {
      output += attribute(tag.attributes, 'value');
    } else if (tag.name === 'Link') {
      if (tag.selfClosing) output += link(tag.attributes, '');
      else if (!tag.closing) linkOpen = { attributes: tag.attributes, from: output.length };
      else if (linkOpen) {
        const label = output.slice(linkOpen.from).replaceAll(MARK, '');
        output = output.slice(0, linkOpen.from) + link(linkOpen.attributes, label);
        linkOpen = null;
      }
    } else if (tag.name === 'table-row') {
      output = output.replace(CELL_END, '');
    } else if (tag.name === 'table-cell') {
      // A table row reads as its cells side by side.
      if (tag.closing) output += CELL;
      else output = output.replace(CELL_END, ` | ${MARK}`);
    }
    if (!tag.selfClosing) depth = Math.max(0, depth + (tag.closing ? -1 : 1));
  }
  if (!changed) return prose;
  return (
    output
      .replaceAll(CELL, '')
      .split('\n')
      // A reply with components is a widget's source; its template lines are script.
      .filter((line) => !TEMPLATE_LINE.test(line.replaceAll(MARK, '')))
      .map((line) => (line.includes(MARK) ? line.replaceAll(MARK, '').trim() : line))
      .join('\n')
      .replace(/\n{3,}/g, '\n\n')
  );
}

/** Code spans and fences, which keep their text as written. */
const CODE = /```[\s\S]*?(?:```|$)|~~~[\s\S]*?(?:~~~|$)|`[^`\n]+`/g;
/** `<CodeBlock language="ts" editable>…</CodeBlock>`, ChatGPT's own code block. */
const CODE_BLOCK = /<CodeBlock(\s[^<>]*?)?>\n?([\s\S]*?)\n?<\/CodeBlock>/g;
/** Stands for the code span of its index while the markup is converted. */
const SLOT = '\u0003';
const CODE_SLOT = new RegExp(`${SLOT}(\\d+)${SLOT}`, 'g');

export function plainReplyMarkdown(source: string): string {
  const code: string[] = [];
  // Code is set aside rather than split around, so a widget's template string
  // (`onClick={() => f(`…`)}`) cannot cut its tag in two.
  const prose = source
    .replace(
      CODE_BLOCK,
      (_block, attributes: string | undefined, body: string) =>
        `\`\`\`${attribute((attributes ?? '').trim(), 'language')}\n${body}\n\`\`\``,
    )
    .replace(CODE, (span) => `${SLOT}${code.push(span) - 1}${SLOT}`);
  return convertProse(prose)
    .replace(CODE_SLOT, (_slot, index: string) => code[Number(index)] ?? '')
    .trim();
}
