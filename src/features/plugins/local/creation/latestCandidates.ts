import type { CreationBlock, CreationCandidate } from './types';

/**
 * Mark, for blocks in document order, the last one per manifest id as latest.
 * Blocks without a readable id share one group, so a later id-less draft
 * supersedes an earlier one.
 */
export function markLatestCandidates(blocks: readonly CreationBlock[]): CreationCandidate[] {
  const lastIndex = new Map<string | null, number>();
  blocks.forEach((block, index) => lastIndex.set(block.verdict.manifestId, index));
  return blocks.map((block, index) => ({
    ...block,
    latest: lastIndex.get(block.verdict.manifestId) === index,
  }));
}
