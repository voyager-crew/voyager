/**
 * `:switch:voyager.gemini-quote-reply:` markers in a release note: the switch
 * of a setting the note introduces, usable right there in the extension's
 * viewer and a plain mention on the docs site.
 *
 * Only the targets listed here can be embedded. Each is an official plugin
 * whose switch is an existing Voyager setting (a legacy enable binding), so the
 * viewer writes it exactly where the popup does; `__tests__/settingSwitch.test.ts`
 * fails a target without one. Free of extension APIs and `@/` imports: the docs
 * site reads this list at build time.
 */
import { GEMINI_QUOTE_REPLY_MANIFEST } from '../../../features/plugins/builtin/geminiQuoteReplyManifest';
import type { PluginManifest } from '../../../features/plugins/types';

export interface SwitchTarget {
  /** The plugin's manifest: its id is the marker's, its localized name the switch's label. */
  readonly manifest: PluginManifest;
}

export const CHANGELOG_SWITCH_TARGETS: Readonly<Record<string, SwitchTarget>> = {
  [GEMINI_QUOTE_REPLY_MANIFEST.id]: { manifest: GEMINI_QUOTE_REPLY_MANIFEST },
};

/** Captures the target id between `:switch:` and the closing colon. */
export const SWITCH_MARKER = /:switch:([a-z0-9][a-z0-9.-]*[a-z0-9]):/g;

export function switchTargetFor(id: string): SwitchTarget | null {
  return Object.hasOwn(CHANGELOG_SWITCH_TARGETS, id) ? CHANGELOG_SWITCH_TARGETS[id] : null;
}

/** The plugin's name in `lang`, as its popup row shows it; English where it has none. */
export function switchTargetName(target: SwitchTarget, lang: string): string {
  return target.manifest.i18n?.[lang]?.name ?? target.manifest.name;
}

/** Every marker id in `text` that is not a listed target, for checks that fail a bad note. */
export function unknownSwitchIds(text: string): string[] {
  return [...text.matchAll(SWITCH_MARKER)]
    .map((match) => match[1])
    .filter((id) => switchTargetFor(id) === null);
}
