import { textWithLatexSource } from '@/core/utils/userLatexSource';

/** The mounted turn's normalized DOM text is its shared summary and hash input. */
export function turnSummary(element: Element): string {
  // Rendered user LaTeX reads as its source, so rendering never changes a turn's id or star.
  return textWithLatexSource(element).replace(/\s+/g, ' ').trim();
}

/**
 * Content hash shared by every historical turn-id format:
 * legacy `c-<mountIndex>-<hash>`, current `c-<hash>` and `c-<hash>~<n>`.
 */
export function extractTurnHash(turnId: string): string {
  const base = turnId.split('~')[0];
  const segments = base.split('-');
  return segments[segments.length - 1] || base;
}
