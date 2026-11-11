import { describe, expect, it } from 'vitest';

import { type CodeLanguage, type CodeToken, MAX_HIGHLIGHT_CHARS, tokenizeCode } from './codeTokens';

const joined = (tokens: readonly CodeToken[]) => tokens.map((token) => token.text).join('');
/** The kind of the one token holding all of `text`'s first occurrence; undefined when it is split. */
function kindOf(tokens: readonly CodeToken[], text: string): string | undefined {
  const at = joined(tokens).indexOf(text);
  let start = 0;
  for (const token of tokens) {
    const end = start + token.text.length;
    if (at >= start && at < end) return at + text.length <= end ? token.kind : undefined;
    start = end;
  }
  return undefined;
}

const LONG_LINE = `const x = "${'a'.repeat(40_000)}"; // ${'/'.repeat(20_000)}`;

/** Inputs a reviewer could be shown that a naive highlighter would drop, reorder or mangle. */
const ADVERSARIAL: readonly string[] = [
  '',
  '"unterminated string',
  "'unterminated\nnext line",
  '/* unterminated comment',
  '`unterminated template ${a + `inner ${b',
  '`a ${ `b ${ `c ${d}` }` } e`',
  '`${{ a: 1 }.a}` + `${"}"}`',
  'const t = `}${x}}`; }}}',
  'a = b / c / d; e = /re[/]gex/g.test(f) / 2',
  'x = (y) / 2 / /[/]/.source.length',
  'return /unclosed regex',
  'let a = 1 /* c */ / 2',
  'line one\r\nline two\r\n// crlf comment\r\n"str"\r\n',
  'const s = "\u{1F600} astral \u{1D4B3} and \\u{1F600}"; // \u{1F600}',
  'const \u{1D4B3} = "\\\u{1F600}"; \u{1F600}',
  '\uD83D lone high, lone low \uDE00 end',
  'if (accessLevel != "user\u202E \u2066// Check if admin\u2069 \u2066") {',
  'const a\u200B = 1; // zero width',
  '"\\',
  '`\\',
  'a\u2028b\u2029c // separators\u2028after',
  '0x1F 0b101 0o17 1_000n .5e-3 1.e2 5..toString()',
  'a?.b ?. c ? .5 : 1',
  "<!-- html comment --> ${'$'}{",
  '\\\\\\',
  LONG_LINE,
];

const CSS_ADVERSARIAL: readonly string[] = [
  '/* unterminated',
  'a { content: "unterminated }',
  '@media (min-width: 1200px) { .a { color: #fff !important } }',
  'a:hover{color:red}b::before{content:"\\201C"}',
  '}}}{{{ ; : ; color: : #zz #12345678901',
  '.x { --custom-prop: calc(100% - -2px) ; margin: -.5em 1e3px }',
  'a{b:c}\r\n/* crlf */\r\n',
  '.\u{1F600} { content: "\u{1D4B3}" }',
  `.long { content: "${'x'.repeat(30_000)}" }`,
];

describe('tokenizeCode', () => {
  it.each(ADVERSARIAL.map((source) => [source.slice(0, 40), source]))(
    'joins back to the exact javascript source: %j',
    (_label, source) => {
      expect(joined(tokenizeCode(source, 'javascript'))).toBe(source);
    },
  );

  it.each(CSS_ADVERSARIAL.map((source) => [source.slice(0, 40), source]))(
    'joins back to the exact css source: %j',
    (_label, source) => {
      expect(joined(tokenizeCode(source, 'css'))).toBe(source);
    },
  );

  it('joins back to any random mix of code characters, in either language', () => {
    const alphabet = [
      '/',
      '*',
      '`',
      '$',
      '{',
      '}',
      '"',
      "'",
      '\\',
      '\n',
      '\r',
      ' ',
      'a',
      '1',
      '.',
      ':',
      ';',
      '#',
      '@',
      '!',
      '[',
      ']',
      '(',
      ')',
      '\u{1F600}',
      '\u202E',
      '\uD83D',
      'return',
      'important',
    ];
    let seed = 7;
    const random = () => {
      seed = (seed * 1_103_515_245 + 12_345) % 2 ** 31;
      return seed / 2 ** 31;
    };
    for (let round = 0; round < 400; round += 1) {
      const length = Math.floor(random() * 60);
      const source = Array.from(
        { length },
        () => alphabet[Math.floor(random() * alphabet.length)],
      ).join('');
      for (const language of ['javascript', 'css'] satisfies CodeLanguage[]) {
        expect(joined(tokenizeCode(source, language))).toBe(source);
      }
    }
  });

  it('never splits an astral character across two tokens', () => {
    const tokens = tokenizeCode(
      'a\u{1F600}b "\u{1F600}" /*\u{1F600}*/ `\u{1F600}${x}\u{1F600}` \u{1F600}\u{1F600}',
      'javascript',
    );
    const startsWithLowSurrogate = tokens.filter((token) => /^[\uDC00-\uDFFF]/.test(token.text));
    expect(startsWithLowSurrogate).toEqual([]);
    expect(joined(tokens)).toContain('\u{1F600}\u{1F600}');
  });

  it('keeps a // inside a string as one string token', () => {
    const tokens = tokenizeCode('fetch("https://example.com/x"); // go', 'javascript');
    expect(kindOf(tokens, '"https://example.com/x"')).toBe('string');
    expect(kindOf(tokens, '// go')).toBe('comment');
  });

  it('keeps a block comment that spans lines as one comment token', () => {
    const tokens = tokenizeCode('a();\n/* one\n   two */\nb();', 'javascript');
    expect(kindOf(tokens, '/* one\n   two */')).toBe('comment');
    expect(tokens.filter((token) => token.kind === 'comment')).toHaveLength(1);
  });

  it('tells a regular expression from a division', () => {
    const tokens = tokenizeCode(
      'const n = total / count / 2;\nif (/^a\\/b$/.test(s)) {}',
      'javascript',
    );
    expect(tokens.filter((token) => token.kind === 'string').map((token) => token.text)).toEqual([
      '/^a\\/b$/',
    ]);
  });

  it('colours the code inside a template expression as code, nested templates included', () => {
    const tokens = tokenizeCode('`a ${typeof `b ${c}`} d`', 'javascript');
    expect(kindOf(tokens, 'typeof')).toBe('keyword');
    expect(kindOf(tokens, 'c')).toBe('plain');
    expect(tokens.at(-1)).toEqual({ kind: 'string', text: ' d`' });
  });

  it('does not treat a property named like a keyword as a keyword', () => {
    expect(kindOf(tokenizeCode('options.default = new Map();', 'javascript'), 'default')).toBe(
      'plain',
    );
  });

  it('marks css at-rules, properties, numbers and !important', () => {
    const tokens = tokenizeCode(
      '@media (min-width: 1200px) {\n  a { max-width: 92vw !important; color: #fff }\n}',
      'css',
    );
    expect(kindOf(tokens, '@media')).toBe('keyword');
    expect(kindOf(tokens, 'max-width')).toBe('property');
    expect(kindOf(tokens, '92vw')).toBe('number');
    expect(kindOf(tokens, '!important')).toBe('keyword');
    expect(kindOf(tokens, '#fff')).toBe('number');
    expect(kindOf(tokens, ' a { ')).toBe('plain');
  });

  it('shows a source past the size bound as one plain token', () => {
    const source = 'x'.repeat(MAX_HIGHLIGHT_CHARS + 1);
    expect(tokenizeCode(source, 'javascript')).toEqual([{ kind: 'plain', text: source }]);
  });
});
