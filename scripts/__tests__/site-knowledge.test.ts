import { describe, expect, it } from 'vitest';

import { inspectSiteKnowledge } from '../lib/siteKnowledge';
import type {
  SiteKnowledgeException,
  SiteKnowledgeInput,
  SiteKnowledgeOwner,
} from '../lib/siteKnowledgeTypes';

function inspect({
  owners = [],
  exceptions = [],
  sources = [],
  siteIds = ['gemini', 'claude'],
}: Partial<Pick<SiteKnowledgeInput, 'sources' | 'siteIds'>> & {
  owners?: readonly SiteKnowledgeOwner[];
  exceptions?: readonly SiteKnowledgeException[];
}) {
  return inspectSiteKnowledge({
    siteIds,
    sources,
    owners: { file: 'fixture/owners.ts', entries: owners },
    exceptions: [{ file: 'fixture/reviews.ts', entries: exceptions }],
  });
}

describe('site-knowledge ownership and exact reviews', () => {
  const owners = [
    {
      kind: 'directory',
      path: 'src/owners/gemini',
      site: 'gemini',
      reason: 'Native identity policy.',
    },
    {
      kind: 'file',
      path: 'src/owners/claude.ts',
      site: 'claude',
      reason: 'Native identity policy.',
    },
    {
      kind: 'table',
      path: 'src/owners/registry.ts',
      sites: ['gemini', 'claude'],
      reason: 'Adapter registration.',
    },
  ] as const;

  it('accepts a site owner and a table naming their permitted sites', () => {
    const result = inspect({
      owners,
      sources: [
        { file: 'src/owners/gemini/read.ts', text: 'read("gemini");' },
        { file: 'src/owners/claude.ts', text: 'read("claude");' },
        { file: 'src/owners/registry.ts', text: 'const table = { gemini, claude };' },
      ],
    });
    expect(result.diagnostics).toEqual([]);
    expect(result.occurrences).toHaveLength(4);
  });

  it('reports a new shared literal at its source line with a remedy', () => {
    const { diagnostics } = inspect({
      sources: [{ file: 'src/shared.ts', text: '// header\nread("gemini");' }],
    });
    expect(diagnostics).toEqual([
      expect.objectContaining({ kind: 'unreviewed', file: 'src/shared.ts', line: 2 }),
    ]);
    expect(diagnostics[0].reason).toContain('"gemini" (literal)');
    expect(diagnostics[0].reason).toContain('move the knowledge to an owner');
    expect(diagnostics[0].reason).toContain('add a reviewed exception');
  });

  it('rejects a foreign site inside a single-site owner and a site absent from a table', () => {
    const { diagnostics } = inspect({
      owners: [
        owners[0],
        {
          kind: 'table',
          path: 'src/owners/limited.ts',
          sites: ['claude'],
          reason: 'One supported adapter.',
        },
      ],
      sources: [
        { file: 'src/owners/gemini/read.ts', text: 'read("claude");' },
        { file: 'src/owners/limited.ts', text: 'read("gemini");' },
      ],
    });
    expect(diagnostics.map(({ kind }) => kind)).toEqual(['unreviewed', 'unreviewed']);
  });

  it('does not extend directory or file permission to similarly named paths', () => {
    expect(
      inspect({
        owners: [owners[0], owners[1]],
        sources: [
          { file: 'src/owners/gemini/native.ts', text: '' },
          { file: 'src/owners/claude.ts', text: '' },
          { file: 'src/owners/geminiExtra/read.ts', text: 'read("gemini");' },
          { file: 'src/owners/claude.tsx', text: 'read("claude");' },
        ],
      }).diagnostics,
    ).toHaveLength(2);
  });

  const exceptions: readonly SiteKnowledgeException[] = [
    {
      kind: 'platform-branch',
      file: 'src/shared.ts',
      values: { gemini: 2 },
      reason: 'Existing platform defaults.',
    },
  ];

  it('accepts only the reviewed count, shared by literals and keys of that site', () => {
    expect(
      inspect({
        exceptions,
        sources: [{ file: 'src/shared.ts', text: 'read("gemini"); table.gemini;' }],
      }).diagnostics,
    ).toEqual([]);
  });

  it('rejects growth and a new site despite another site having a review', () => {
    const { diagnostics } = inspect({
      exceptions,
      sources: [
        { file: 'src/shared.ts', text: 'read("gemini"); table.gemini; ({gemini, claude});' },
      ],
    });
    expect(diagnostics.filter(({ kind }) => kind === 'growth')).toHaveLength(3);
    expect(diagnostics.filter(({ kind }) => kind === 'unreviewed')).toHaveLength(1);
    expect(diagnostics[0].reason).toContain('3 occurrences, 2 reviewed');
  });

  it('reports a shrunk entry as stale and asks for a lower count', () => {
    const { diagnostics } = inspect({
      exceptions,
      sources: [{ file: 'src/shared.ts', text: '\nread("gemini");' }],
    });
    expect(diagnostics).toEqual([expect.objectContaining({ kind: 'stale', line: 2 })]);
    expect(diagnostics[0].reason).toContain('1 occurrences, 2 reviewed');
    expect(diagnostics[0].reason).toContain('lower the reviewed count');
  });

  it.each([
    { name: 'file', sources: [] },
    { name: 'last occurrence', sources: [{ file: 'src/shared.ts', text: 'read("unrelated");' }] },
  ])('retires the review when its $name disappears', ({ sources }) => {
    const { diagnostics } = inspect({ exceptions, sources });
    expect(diagnostics).toEqual([
      expect.objectContaining({ kind: 'stale', file: 'src/shared.ts', line: 1 }),
    ]);
    expect(diagnostics[0].reason).toContain('0 occurrences');
    expect(diagnostics[0].reason).toContain('remove this value');
    expect(diagnostics[0].reason.includes('file is gone')).toBe(sources.length === 0);
  });

  it.each([
    { text: 'read("gemini");', forms: '(literal)' },
    { text: 'table.gemini;', forms: '(key)' },
    { text: 'read("gemini"); table.gemini;', forms: '(literal and key)' },
  ])('reports all remaining stale forms: $forms', ({ text, forms }) => {
    const { diagnostics } = inspect({
      exceptions: [{ ...exceptions[0], values: { gemini: 3 } }],
      sources: [{ file: 'src/shared.ts', text }],
    });
    expect(diagnostics).toEqual([
      expect.objectContaining({ kind: 'stale', reason: expect.stringContaining(forms) }),
    ]);
  });

  it('does not let a review in one file authorize another file', () => {
    const { diagnostics } = inspect({
      exceptions,
      sources: [{ file: 'src/other.ts', text: 'read("gemini");' }],
    });
    expect(diagnostics.map(({ kind }) => kind)).toEqual(['unreviewed', 'stale']);
  });

  it('uses the supplied vocabulary instead of a built-in site list', () => {
    const result = inspect({
      siteIds: ['newsite'],
      sources: [{ file: 'src/new.ts', text: 'read("newsite"); table.newsite; read("gemini");' }],
    });
    expect(result.diagnostics).toHaveLength(2);
    expect(result.occurrences.map(({ site }) => site)).toEqual(['newsite', 'newsite']);
  });
});

describe('production scan boundary', () => {
  it('scans production TS/TSX, including a feature directory named tests', () => {
    const { diagnostics } = inspect({
      sources: [
        { file: 'src/features/tests/native.ts', text: 'read("gemini");' },
        { file: 'src/ui/Screen.tsx', text: '<Widget site="claude" />;' },
      ],
    });
    expect(diagnostics).toHaveLength(2);
  });

  it.each([
    'scripts/helper.ts',
    'src/feature.js',
    'src/generated.d.ts',
    'src/tests/setup.ts',
    'src/locales/helper.ts',
    'src/feature/__tests__/case.ts',
    'src/feature/__fixtures__/page.tsx',
    'src/feature.case.test.ts',
    'src/feature.spec.tsx',
    'src/feature.fixtures.ts',
  ])('ignores non-production source %s', (file) => {
    expect(inspect({ sources: [{ file, text: 'read("gemini");' }] }).diagnostics).toEqual([]);
  });
});
