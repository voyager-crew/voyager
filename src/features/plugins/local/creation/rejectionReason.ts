import type { ManifestIssue } from '../../manifest/validate';

/** One plain sentence for why a reply block cannot be installed; the issue list goes to the AI. */
export type RejectionReason =
  | 'createModeReasonNotPlugin'
  | 'createModeReasonNoSite'
  | 'createModeReasonBadSite'
  | 'createModeReasonNoChange'
  | 'createModeReasonBadChange'
  | 'createModeReasonOther';

/** First match wins, by issue path as `validateLocalManifest` reports it. */
const BY_PATH: readonly (readonly [(path: string) => boolean, RejectionReason])[] = [
  [(path) => path === '', 'createModeReasonNotPlugin'],
  [(path) => path === 'matches', 'createModeReasonNoSite'],
  [(path) => path.startsWith('matches'), 'createModeReasonBadSite'],
  [(path) => path === 'contributes', 'createModeReasonNoChange'],
  [(path) => path.startsWith('contributes'), 'createModeReasonBadChange'],
];

/**
 * The first problem in the user's words. A block missing both `matches` and
 * `contributes` is in a format of the AI's own, and says so instead of naming
 * whichever required field the gate happened to list first.
 */
export function rejectionReason(issues: readonly ManifestIssue[]): RejectionReason {
  const paths = issues.map((issue) => issue.path);
  if (paths.includes('matches') && paths.includes('contributes'))
    return 'createModeReasonNotPlugin';
  for (const path of paths) {
    const match = BY_PATH.find(([test]) => test(path));
    if (match) return match[1];
  }
  return 'createModeReasonOther';
}
