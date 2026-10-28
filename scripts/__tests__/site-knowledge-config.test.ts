import { describe, expect, it } from 'vitest';

import { inspectSiteKnowledge } from '../lib/siteKnowledge';
import { siteKnowledgeIds } from '../lib/siteKnowledgeCatalog';
import type {
  SiteKnowledgeException,
  SiteKnowledgeInput,
  SiteKnowledgeOwner,
} from '../lib/siteKnowledgeTypes';

function inspect({
  owners = [],
  exceptions = [],
  sources = [],
  siteIds = ['gemini'],
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

const review: SiteKnowledgeException = {
  kind: 'serialized-value',
  file: 'src/shared.ts',
  values: { gemini: 1 },
  reason: 'Serialized platform value.',
};

describe('bundled site vocabulary', () => {
  it('reads id fields rather than directory names or a fixed vocabulary', () => {
    expect(
      siteKnowledgeIds([
        { file: 'fixture/sites/old-name/site.json', text: '{"id":"newsite"}' },
        { file: 'fixture/sites/another/site.json', text: '{"id":"other"}' },
      ]),
    ).toEqual(['newsite', 'other']);
  });

  it('fails closed for missing, invalid or duplicate bundled ids', () => {
    expect(() => siteKnowledgeIds([])).toThrow();
    for (const text of ['{', '{}', '{"id":5}', '{"id":" "}'])
      expect(() => siteKnowledgeIds([{ file: 'fixture/site.json', text }])).toThrow(
        'fixture/site.json:1',
      );
    expect(() =>
      siteKnowledgeIds([
        { file: 'fixture/one/site.json', text: '{"id":"newsite"}' },
        { file: 'fixture/two/site.json', text: '{"id":"newsite"}' },
      ]),
    ).toThrow('duplicate');
  });
});

describe('site-knowledge configuration errors', () => {
  const owner: SiteKnowledgeOwner = {
    kind: 'file',
    path: 'src/owner.ts',
    site: 'gemini',
    reason: 'Native identity policy.',
  };

  it('retains an existing file owner even when it names no site today', () => {
    expect(
      inspect({
        owners: [owner],
        sources: [{ file: owner.path, text: 'export const ready = true;' }],
      }).diagnostics,
    ).toEqual([]);
  });

  it.each([
    [{ ...owner, reason: ' \n ' }, 'empty reason'],
    [{ ...owner, path: 'src/*.ts' }, 'without globs/trailing slash'],
    [{ ...owner, path: 'src/owner/' }, 'without globs/trailing slash'],
    [
      { kind: 'table', path: owner.path, sites: [], reason: 'Empty registry.' },
      'at least one site id',
    ],
    [
      { kind: 'directory', path: 'src/shared', site: 'gemini', reason: 'Overbroad permission.' },
      'directory owner must end with its site id',
    ],
    [{ ...owner, path: 'src/missing.ts' }, 'matches no scanned source file'],
    [{ ...owner, path: 'src/owner.test.ts' }, 'matches no scanned source file'],
  ] satisfies readonly (readonly [SiteKnowledgeOwner, string])[])(
    'rejects invalid owner %j in its table',
    (entry, message) => {
      const { diagnostics } = inspect({
        owners: [entry],
        sources: [
          { file: owner.path, text: '' },
          { file: 'src/shared/reader.ts', text: '' },
          { file: 'src/owner.test.ts', text: '' },
        ],
      });
      expect(diagnostics).toContainEqual(
        expect.objectContaining({
          kind: 'config',
          file: 'fixture/owners.ts',
          reason: expect.stringContaining(message),
        }),
      );
    },
  );

  it('does not let an unscanned directory hide a stale owner', () => {
    const { diagnostics } = inspect({
      owners: [
        {
          kind: 'directory',
          path: 'src/owners/gemini',
          site: 'gemini',
          reason: 'Native identity.',
        },
      ],
      sources: [{ file: 'src/owners/gemini/__tests__/reader.ts', text: 'read("gemini");' }],
    });
    expect(diagnostics).toEqual([
      expect.objectContaining({
        kind: 'config',
        file: 'fixture/owners.ts',
        reason: expect.stringContaining('matches no scanned source file'),
      }),
    ]);
  });

  it('rejects duplicate entries even when their site values differ', () => {
    const { diagnostics } = inspect({
      siteIds: ['gemini', 'claude'],
      exceptions: [review, { ...review, values: { claude: 1 } }],
    });
    expect(diagnostics).toContainEqual(
      expect.objectContaining({ kind: 'config', reason: expect.stringContaining('duplicate') }),
    );
  });

  it.each([
    [{ ...review, reason: ' \n ' }, 'empty reason'],
    [{ ...review, values: { gemini: 0 } }, 'positive integer'],
    [{ ...review, values: { gemini: -1 } }, 'positive integer'],
    [{ ...review, values: { gemini: 1.5 } }, 'positive integer'],
    [{ ...review, values: { gemini: Number.NaN } }, 'positive integer'],
    [{ ...review, values: { gemini: Number.POSITIVE_INFINITY } }, 'positive integer'],
    [{ ...review, values: { unknownSite: 1 } }, 'unknown site id'],
    [{ ...review, values: {} }, 'empty site-knowledge exception'],
    [{ ...review, file: 'src/shared.test.ts' }, 'outside the production scan set'],
  ] satisfies readonly (readonly [SiteKnowledgeException, string])[])(
    'reports invalid exception %j',
    (exception, message) => {
      expect(inspect({ exceptions: [exception] }).diagnostics).toContainEqual(
        expect.objectContaining({
          kind: 'config',
          file: 'fixture/reviews.ts',
          reason: expect.stringContaining(message),
        }),
      );
    },
  );

  it('rejects a review that duplicates an owner permission', () => {
    const { diagnostics } = inspect({
      exceptions: [review],
      owners: [
        { kind: 'table', path: 'src/shared.ts', sites: ['gemini'], reason: 'Site registry.' },
      ],
      sources: [{ file: 'src/shared.ts', text: '' }],
    });
    expect(diagnostics).toContainEqual(
      expect.objectContaining({
        kind: 'config',
        reason: expect.stringContaining("owner's own permission"),
      }),
    );
  });

  it('does not let invalid owner ids create an unchecked permission', () => {
    const { diagnostics } = inspect({
      owners: [{ kind: 'file', path: 'src/owner.ts', site: 'unknownSite', reason: 'Site policy.' }],
      sources: [{ file: 'src/owner.ts', text: '' }],
    });
    expect(diagnostics).toEqual([
      expect.objectContaining({
        kind: 'config',
        file: 'fixture/owners.ts',
        reason: expect.stringContaining('unknown site id'),
      }),
    ]);
  });

  it('attributes errors to the actual exception domain table', () => {
    const { diagnostics } = inspectSiteKnowledge({
      siteIds: ['gemini'],
      sources: [],
      owners: { file: 'fixture/owners.ts', entries: [] },
      exceptions: [
        { file: 'fixture/first-domain.ts', entries: [review] },
        { file: 'fixture/second-domain.ts', entries: [{ ...review, reason: '' }] },
      ],
    });
    expect(diagnostics.filter(({ kind }) => kind === 'config')).toEqual([
      expect.objectContaining({
        file: 'fixture/second-domain.ts',
        reason: expect.stringContaining('duplicate'),
      }),
      expect.objectContaining({
        file: 'fixture/second-domain.ts',
        reason: expect.stringContaining('empty reason'),
      }),
    ]);
  });
});
