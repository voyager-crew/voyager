import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

/**
 * Pre-commit size gate: every staged file an agent writes stays under
 * 5,000 tokens, counted as bytes / 4. Only the staged content is measured.
 * Files nobody writes by hand are skipped: lockfiles, binaries, build output,
 * Xcode project data, snapshots, Chrome locale catalogs (Chrome requires
 * one messages.json per locale, so they cannot be split) and the privacy page
 * in each language (one page each; the English source sets its length, and some
 * translations run longer).
 */

export const TOKEN_LIMIT = 5000;
export const BYTES_PER_TOKEN = 4;

const IGNORED = [
  /(^|\/)[^/]*\.lock$/,
  /(^|\/)(package-lock\.json|pnpm-lock\.yaml|yarn\.lock|Package\.resolved)$/,
  /(^|\/)dist(_[^/]+)?\//,
  /\.pbxproj$/,
  /(^|\/)__snapshots__\//,
  /\.svg$/,
  /(^|\/)LICENSE[^/]*$/,
  /^src\/locales\/[^/]+\/messages\.json$/,
  /^docs\/([^/]+\/)?privacy\.md$/,
];

export function isIgnored(path) {
  return IGNORED.some((pattern) => pattern.test(path));
}

export function tokensFor(bytes) {
  return Math.ceil(bytes / BYTES_PER_TOKEN);
}

function git(args, options = {}) {
  return execFileSync('git', args, { maxBuffer: 64 * 1024 * 1024, ...options });
}

/** Staged files added, copied, modified or renamed, with their blob id; symlinks and submodules left out. */
function stagedFiles(cwd) {
  const raw = git(
    ['diff', '--cached', '--raw', '-z', '--no-abbrev', '--no-renames', '--diff-filter=ACMR'],
    {
      cwd,
    },
  ).toString('utf8');
  const parts = raw.split('\0');
  const files = [];
  for (let i = 0; i + 1 < parts.length; i += 2) {
    const [, newMode, , blob] = parts[i].split(' ');
    if (newMode !== '100644' && newMode !== '100755') continue;
    files.push({ path: parts[i + 1], blob });
  }
  return files;
}

function isBinary(blob, cwd) {
  const head = git(['cat-file', 'blob', blob], { cwd }).subarray(0, 8000);
  return head.includes(0);
}

export function findOversized(cwd = process.cwd()) {
  const oversized = [];
  for (const { path, blob } of stagedFiles(cwd)) {
    if (isIgnored(path)) continue;
    const bytes = Number(git(['cat-file', '-s', blob], { cwd }).toString().trim());
    if (tokensFor(bytes) <= TOKEN_LIMIT || isBinary(blob, cwd)) continue;
    oversized.push({ path, bytes, tokens: tokensFor(bytes) });
  }
  return oversized;
}

export function report(oversized) {
  const limitBytes = TOKEN_LIMIT * BYTES_PER_TOKEN;
  return [
    `Commit blocked: staged files over ${TOKEN_LIMIT} tokens (tokens = bytes / ${BYTES_PER_TOKEN}, so ${limitBytes} bytes):`,
    ...oversized.map((file) => `  ${file.path}  ${file.tokens} tokens (${file.bytes} bytes)`),
    '',
    'Split each file until every part is under the limit, then stage the parts and commit again:',
    '1. Find the seams by responsibility, not by line count: one file per cohesive job (a data',
    '   operation, a lifecycle, a UI piece, a group of related helpers). Name each new file after its job.',
    '2. Code (.ts, .tsx, .js, .mjs, .vue): move the extracted functions and types into a new sibling',
    '   file and import them back. Keep the original path exporting what callers already import',
    '   (re-export if needed) so no caller changes. Give extracted helpers explicit inputs instead of',
    '   passing the whole parent object or manager.',
    '3. Tests: split by describe block into <name>.<topic>.test.ts; move shared setup and builders',
    '   into a helper file next to them.',
    '4. CSS: split by component or surface into separate files, each imported where the old one was.',
    '5. Markdown: split by top-level section into separate pages and link them from a short index.',
    '6. JSON or other data: split by top-level key into several files and merge them where loaded.',
    '7. A split is a move: behaviour must not change. Run `bun run test:changed`, `bun run typecheck`',
    '   and `bun run lint:check`, and `bun run filesize:update` if a baselined file shrank.',
    '',
    'Lockfiles, binaries, build output, Xcode project data, snapshots and src/locales/*/messages.json',
    'are not checked.',
  ].join('\n');
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const oversized = findOversized();
  if (oversized.length > 0) {
    console.error(report(oversized));
    process.exit(1);
  }
}
