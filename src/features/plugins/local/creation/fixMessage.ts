import type { ManifestIssue } from '../../manifest/validate';

/** Ceiling on the whole message Voyager places in the composer. */
export const MAX_CREATION_FIX_CHARS = 4000;
/** Ceiling on one issue line, so one long message cannot crowd out the rest. */
export const MAX_CREATION_FIX_LINE_CHARS = 300;

function issueLine(issue: ManifestIssue): string {
  const line = issue.path ? `${issue.path}: ${issue.message}` : issue.message;
  return line.length > MAX_CREATION_FIX_LINE_CHARS
    ? `${line.slice(0, MAX_CREATION_FIX_LINE_CHARS - 1)}…`
    : line;
}

/**
 * The reply that sends the gate's problems back to the AI: `intro`, then one
 * `path: message` line per issue as the popup lists them. Issues past the
 * length ceiling are counted on a last `… (+N)` line instead.
 */
export function buildCreationFixMessage(issues: readonly ManifestIssue[], intro: string): string {
  const lines = [intro.trim().slice(0, MAX_CREATION_FIX_LINE_CHARS)];
  let length = lines[0].length;
  for (const [index, issue] of issues.entries()) {
    const line = issueLine(issue);
    const rest = issues.length - index;
    const reserve = rest > 1 ? `\n… (+${rest})`.length : 0;
    if (length + 1 + line.length + reserve > MAX_CREATION_FIX_CHARS) {
      lines.push(`… (+${rest})`);
      break;
    }
    lines.push(line);
    length += 1 + line.length;
  }
  return lines.join('\n');
}
