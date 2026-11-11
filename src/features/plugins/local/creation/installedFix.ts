/**
 * The message "Ask it to fix" puts in a new chat for an installed creation:
 * the localized request, what Voyager saw on the page, the page outline when
 * the user leaves it on, and the plugin as installed, indented so that no
 * composer turns it into a code box. Never a triple backtick.
 */
import { MAX_CREATION_FIX_LINE_CHARS } from './fixMessage';

/** Past this, the manifest is left out rather than pasted into a composer. */
export const MAX_FIX_MANIFEST_CHARS = 200_000;
const MAX_LISTED = 8;

/** What the page showed: style rules and page-change targets that found nothing, or a frozen load. */
export interface InstalledFixFacts {
  readonly quietRules: readonly string[];
  readonly quietTargets: readonly string[];
  readonly froze: boolean;
}

function listed(label: string, items: readonly string[]): string[] {
  if (items.length === 0) return [];
  const shown = items.slice(0, MAX_LISTED).join(' | ');
  const more = items.length > MAX_LISTED ? ` (+${items.length - MAX_LISTED})` : '';
  const line = `- ${label}: ${shown}${more}`;
  return [
    line.length > MAX_CREATION_FIX_LINE_CHARS
      ? `${line.slice(0, MAX_CREATION_FIX_LINE_CHARS - 1)}…`
      : line,
  ];
}

function factLines(facts: InstalledFixFacts): string[] {
  return [
    ...listed('Style rules that match no element on this page', facts.quietRules),
    ...listed('Page changes whose target matches no element on this page', facts.quietTargets),
    ...(facts.froze
      ? ['- A page it ran on never finished loading, so Voyager turned it off.']
      : []),
  ];
}

/**
 * The manifest as indented JSON. A backtick only occurs inside JSON strings,
 * where ``` is the same character, so the text never holds a fence.
 */
export function indentedManifest(manifest: unknown): string | null {
  const json = JSON.stringify(manifest, null, 2).replaceAll('`', '\\u0060');
  if (json.length > MAX_FIX_MANIFEST_CHARS) return null;
  return json
    .split('\n')
    .map((line) => `    ${line}`)
    .join('\n');
}

export function buildInstalledFixMessage({
  intro,
  facts,
  outline,
  manifest,
}: {
  /** `createModeFixInstalledIntro`, filled. */
  readonly intro: string;
  readonly facts: InstalledFixFacts;
  /** The outline intro and outline, or null when the user left it out. */
  readonly outline: string | null;
  readonly manifest: unknown;
}): string {
  const lines = factLines(facts);
  const json = indentedManifest(manifest);
  return [
    intro.trim(),
    ...(lines.length > 0 ? [lines.join('\n')] : []),
    ...(outline ? [outline] : []),
    json ?? '(The plugin is too long to include here; ask me for it.)',
  ].join('\n\n');
}
