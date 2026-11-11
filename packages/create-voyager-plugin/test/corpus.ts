/**
 * Plugin folders the CLI's `check` and the in-process popup gate must judge
 * identically: plugins agents wrote cold from the skill, the probe's bad
 * cases, and the edge cases the gate's own tests cover (file reading, local
 * rules, sink guards). Each case is a folder as `{ fileName: text }`.
 */
export interface CorpusCase {
  readonly name: string;
  readonly files: Readonly<Record<string, string>>;
  /** Whether the popup would import it; parity is checked either way. */
  readonly imports: boolean;
}

type Manifest = Record<string, unknown>;

const SCHEMA = 'https://voyager.nagi.fun/plugin.schema.json';
const semantic = (key: string) => ({ kind: 'semantic', key });

function base(over: Manifest = {}): Manifest {
  return {
    id: 'me.case',
    name: 'Case',
    version: '1.0.0',
    description: 'A corpus case',
    author: 'me',
    category: 'layout',
    license: 'MIT',
    engine: '>=1.0.0',
    tier: 'declarative',
    matches: ['https://chatgpt.com/*'],
    contributes: { styles: [{ css: '.gv-plugin-case{color:red}' }] },
    ...over,
  };
}

function folder(
  name: string,
  imports: boolean,
  manifest: Manifest,
  css: Record<string, string> = {},
) {
  return { name, imports, files: { 'plugin.json': JSON.stringify(manifest, null, 2), ...css } };
}

const accent = (key: string) => [
  { op: 'addClass', target: semantic(key), className: 'gv-plugin-case' },
  { op: 'setStyle', target: semantic(key), styles: { '--gv-plugin-case-w': '{{width}}px' } },
];
const widthSetting = { width: { type: 'number', label: 'Width', default: 3, min: 1, max: 8 } };

/** Plugins written cold by agents that only had the skill. */
const COLDSTART: CorpusCase[] = [
  folder(
    'cold-chatgpt-compact-bubbles',
    true,
    base({
      $schema: SCHEMA,
      id: 'me.chatgpt-compact-bubbles',
      contributes: {
        settings: {
          maxWidth: { type: 'number', label: 'Max width (%)', default: 70, min: 30, max: 100 },
        },
        styles: [
          {
            css: '.gv-plugin-chatgpt-compact-bubbles [class*="user-message-bubble"]{max-width:var(--gv-plugin-chatgpt-compact-bubbles-max,70%)!important}',
          },
        ],
        domOps: [
          {
            op: 'addClass',
            target: semantic('userTurn'),
            className: 'gv-plugin-chatgpt-compact-bubbles',
          },
          {
            op: 'setStyle',
            target: semantic('userTurn'),
            styles: { '--gv-plugin-chatgpt-compact-bubbles-max': '{{maxWidth}}%' },
          },
        ],
      },
    }),
  ),
  folder(
    'cold-claude-hide-disclaimer',
    true,
    base({
      $schema: SCHEMA,
      matches: ['https://claude.ai/*'],
      contributes: {
        domOps: [
          {
            op: 'hide',
            target: {
              kind: 'css',
              selector: 'fieldset ~ div.text-center, [data-testid="chat-input-disclaimer"]',
            },
          },
        ],
      },
    }),
  ),
  // Written before color settings were refused: now the setting-type rule rejects it.
  folder(
    'cold-deepseek-code-accent-color',
    false,
    base({
      matches: ['https://chat.deepseek.com/*'],
      contributes: {
        settings: {
          accent: { type: 'color', label: 'Colour', default: '#4d6bfe' },
          ...widthSetting,
        },
        styles: [
          { css: '.gv-plugin-case pre{border-left:var(--gv-plugin-case-w,3px) solid #4d6bfe}' },
        ],
        domOps: accent('assistantTurn'),
      },
    }),
  ),
  folder(
    'cold-gemini-tall-composer',
    true,
    base({
      matches: ['https://gemini.google.com/*'],
      contributes: {
        settings: widthSetting,
        styles: [
          {
            css: '.gv-plugin-case .ql-editor{min-height:calc(var(--gv-plugin-case-w,3px)*40)!important}',
          },
        ],
        domOps: accent('composer'),
      },
    }),
  ),
  folder(
    'cold-chatgpt-reply-stats',
    true,
    base({
      contributes: {
        styles: [
          {
            css: '.gv-plugin-case{counter-reset:p}.gv-plugin-case p{counter-increment:p}.gv-plugin-case::after{content:counter(p) " paragraphs"}html[data-gv-scheme=\'dark\'] .gv-plugin-case::after{color:#b4b4b4}',
          },
        ],
        domOps: [
          { op: 'addClass', target: semantic('assistantTurn'), className: 'gv-plugin-case' },
        ],
      },
    }),
  ),
];

const sem = semantic('composer');

/** The probe's bad cases. */
const PROBE: CorpusCase[] = [
  folder(
    'b1-setattr-href',
    false,
    base({
      contributes: {
        domOps: [{ op: 'setAttribute', target: sem, name: 'href', value: 'https://x.test' }],
      },
    }),
  ),
  folder(
    'b2-import-in-cssfile',
    false,
    base({ contributes: { styles: [{ file: 'style.css' }] } }),
    {
      'style.css': "@import url('https://evil.test/a.css');\n.gv-x{color:red}",
    },
  ),
  folder('b3-matches-outside', false, base({ matches: ['https://example.com/*'] })),
  folder(
    'b4-closed-native-on-aistudio',
    false,
    base({
      engine: '>=1.4.0',
      matches: ['https://aistudio.google.com/*'],
      contributes: { domOps: [{ op: 'native', handler: 'vimInput', params: {} }] },
    }),
  ),
  folder(
    'opened-native-on-gemini',
    true,
    base({
      engine: '>=1.3.0',
      matches: ['https://gemini.google.com/*'],
      contributes: { domOps: [{ op: 'native', handler: 'formulaCopy', params: {} }] },
    }),
  ),
  folder('b5-tier-scripted', false, base({ tier: 'scripted' })),
  folder(
    'b5-scripted-with-source',
    false,
    base({ tier: 'scripted', contributes: { script: { source: 'document.title = "x";' } } }),
  ),
  folder(
    'b6-setting-renders-url',
    false,
    base({
      contributes: {
        settings: { bg: { type: 'string', label: 'bg', default: 'https://evil.test/a.png' } },
        domOps: [{ op: 'setStyle', target: sem, styles: { 'background-image': 'url({{bg}})' } }],
      },
    }),
  ),
  folder(
    'b7-theme-on-gemini',
    false,
    base({ matches: ['https://gemini.google.com/*'], theme: { brand: '#ff0000' } }),
  ),
  folder(
    'b8-style-file-missing',
    false,
    base({ contributes: { styles: [{ file: 'missing.css' }] } }),
  ),
  folder(
    'b9-native-engine-too-low',
    false,
    base({ contributes: { domOps: [{ op: 'native', handler: 'formulaCopy', params: {} }] } }),
  ),
  { name: 'b10-invalid-json', imports: false, files: { 'plugin.json': '{"id": "me.x",' } },
];

/** Edge cases from the gate's own tests. */
const EDGES: CorpusCase[] = [
  { name: 'not-an-object', imports: false, files: { 'plugin.json': '[1, 2]' } },
  { name: 'empty-manifest', imports: false, files: { 'plugin.json': '' } },
  folder(
    'style-file-beside-manifest',
    true,
    base({ contributes: { styles: [{ file: 'style.css' }, { file: 'dark.css' }] } }),
    {
      'style.css': '.gv-plugin-case{border-radius:12px}',
      'dark.css': "html[data-gv-scheme='dark'] .gv-plugin-case{outline:1px solid #fff2}",
      'unused.css': '.gv-plugin-unused{color:blue}',
    },
  ),
  folder(
    'style-file-in-subfolder',
    false,
    base({ contributes: { styles: [{ file: 'css/style.css' }] } }),
  ),
  folder(
    'style-file-escapes',
    false,
    base({ contributes: { styles: [{ file: '../style.css' }] } }),
  ),
  folder(
    'class-without-prefix',
    false,
    base({ contributes: { domOps: [{ op: 'addClass', target: sem, className: 'rounded' }] } }),
  ),
  folder(
    'two-classes',
    false,
    base({ contributes: { domOps: [{ op: 'addClass', target: sem, className: 'gv-a gv-b' }] } }),
  ),
  folder(
    'css-target-does-not-parse',
    false,
    base({ contributes: { domOps: [{ op: 'hide', target: 'nav[aria-label]]' }] } }),
  ),
  folder(
    'claude-thinking-block',
    false,
    base({
      matches: ['https://claude.ai/*'],
      contributes: { domOps: [{ op: 'hide', target: semantic('thinkingBlock') }] },
    }),
  ),
  folder(
    'deepseek-thinking-block',
    true,
    base({
      matches: ['https://chat.deepseek.com/*'],
      contributes: { domOps: [{ op: 'hide', target: semantic('thinkingBlock') }] },
    }),
  ),
  folder(
    'unknown-semantic-key',
    false,
    base({ contributes: { domOps: [{ op: 'hide', target: semantic('footer') }] } }),
  ),
  folder(
    'two-sites-one-lacks-code-block',
    false,
    base({
      matches: ['https://chatgpt.com/*', 'https://claude.ai/*'],
      contributes: { domOps: [{ op: 'hide', target: semantic('codeBlock') }] },
    }),
  ),
  folder(
    'mermaid-on-claude',
    false,
    base({
      engine: '>=1.7.0',
      matches: ['https://claude.ai/*'],
      contributes: { domOps: [{ op: 'native', handler: 'mermaid', params: {} }] },
    }),
  ),
  folder(
    'mermaid-on-chatgpt',
    true,
    base({
      engine: '>=1.7.0',
      theme: { brand: '#10a37f' },
      requires: { handlers: ['mermaid'] },
      contributes: { domOps: [{ op: 'native', handler: 'mermaid', params: {} }] },
    }),
  ),
  folder(
    'unknown-primitive',
    false,
    base({
      engine: '>=1.7.0',
      contributes: { domOps: [{ op: 'native', handler: 'confetti', params: {} }] },
    }),
  ),
  folder(
    'select-default-not-an-option',
    false,
    base({
      contributes: {
        settings: {
          size: {
            type: 'select',
            label: 'Size',
            default: 'xl',
            options: [
              { value: 's', label: 'S' },
              { value: 'm', label: 'M' },
            ],
          },
        },
        styles: [{ css: '.gv-plugin-case{zoom:1}' }],
      },
    }),
  ),
  folder(
    'select-and-boolean',
    true,
    base({
      contributes: {
        settings: {
          size: {
            type: 'select',
            label: 'Size',
            default: 'm',
            options: [
              { value: 's', label: 'S' },
              { value: 'm', label: 'M' },
            ],
          },
          on: { type: 'boolean', label: 'On', default: true },
        },
        styles: [{ css: ".gv-plugin-case[data-gv-on='true']{font-size:{{size}}}" }],
        domOps: [{ op: 'setAttribute', target: sem, name: 'data-gv-on', value: '{{on}}' }],
      },
    }),
  ),
  folder(
    'onclick-attribute',
    false,
    base({
      contributes: { domOps: [{ op: 'setAttribute', target: sem, name: 'onclick', value: 'x()' }] },
    }),
  ),
  folder(
    'remote-url-in-css',
    false,
    base({
      contributes: {
        styles: [{ css: '.gv-plugin-case{background:url(https://evil.test/a.png)}' }],
      },
    }),
  ),
  folder(
    'svg-data-uri',
    false,
    base({
      contributes: {
        styles: [{ css: '.gv-plugin-case{background:url("data:image/svg+xml,<svg></svg>")}' }],
      },
    }),
  ),
  folder('missing-required-fields', false, {
    tier: 'declarative',
    matches: ['https://chatgpt.com/*'],
    contributes: {},
  }),
  folder('already-local-prefixed-id', true, base({ id: 'local.me.case' })),
  folder('oversize-css', false, base({ contributes: { styles: [{ file: 'big.css' }] } }), {
    'big.css': `.gv-plugin-case{color:red}${' '.repeat(1_000_001)}`,
  }),
  folder('other-json-beside-manifest', true, base(), { 'package.json': '{"name": "x"}' }),
];

export const CORPUS: readonly CorpusCase[] = [...COLDSTART, ...PROBE, ...EDGES];
