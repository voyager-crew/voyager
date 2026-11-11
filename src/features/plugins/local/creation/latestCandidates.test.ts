import { describe, expect, it } from 'vitest';

import { markLatestCandidates } from './latestCandidates';
import type { CandidateVerdict, CreationBlock } from './types';

function installable(manifestId: string): CandidateVerdict {
  return { kind: 'installable', manifestId, install: { kind: 'new' } };
}

function rejected(manifestId: string | null): CandidateVerdict {
  return { kind: 'rejected', manifestId, issues: [{ path: 'name', message: 'required' }] };
}

function block(id: string, verdict: CandidateVerdict): CreationBlock {
  return { id, text: '{}', siteId: 'gemini', verdict };
}

function latestIds(blocks: readonly CreationBlock[]): string[] {
  return markLatestCandidates(blocks)
    .filter((candidate) => candidate.latest)
    .map((candidate) => candidate.id);
}

describe('marking the latest block per plugin', () => {
  it('keeps only the last block of each manifest id', () => {
    const blocks = [
      block('a1', installable('local.a')),
      block('b1', installable('local.b')),
      block('a2', installable('local.a')),
    ];
    expect(latestIds(blocks)).toEqual(['b1', 'a2']);
  });

  it('lets a fixed block supersede a rejected draft of the same id, and the reverse', () => {
    expect(
      latestIds([block('r', rejected('local.a')), block('ok', installable('local.a'))]),
    ).toEqual(['ok']);
    expect(
      latestIds([block('ok', installable('local.a')), block('r', rejected('local.a'))]),
    ).toEqual(['r']);
  });

  it('treats blocks without a readable id as one plugin', () => {
    expect(latestIds([block('x', rejected(null)), block('y', rejected(null))])).toEqual(['y']);
  });

  it('keeps every block, in order', () => {
    const blocks = [block('a1', installable('local.a')), block('a2', installable('local.a'))];
    expect(markLatestCandidates(blocks).map((candidate) => candidate.id)).toEqual(['a1', 'a2']);
  });
});
