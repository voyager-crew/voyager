/**
 * `:switch:voyager.gemini-quote-reply:` and
 * `:choice:voyager.gemini-usage-status:display:` markers in a release note: the
 * switch of a plugin the note introduces, or one of its declared settings,
 * usable right there in the extension's viewer and a plain mention on the docs
 * site.
 *
 * Only the targets listed here can be embedded. Each is an official plugin
 * whose switch is an existing Voyager setting (a legacy enable binding), and
 * each of its `choices` a manifest setting (a `select` or `boolean`) with a
 * legacy value binding, so the viewer writes it exactly where the popup does;
 * `__tests__/settingSwitch.test.ts` and `__tests__/settingChoice.test.ts` fail
 * a target without them. Free of extension APIs and `@/` imports: the docs
 * site reads this list at build time.
 */
import { GEMINI_QUOTE_REPLY_MANIFEST } from '../../../features/plugins/builtin/geminiQuoteReplyManifest';
import { GEMINI_USAGE_STATUS_MANIFEST } from '../../../features/plugins/builtin/geminiUsageStatusManifest';
import type { PluginManifest, SettingField } from '../../../features/plugins/types';

export interface SwitchTarget {
  /** The plugin's manifest: its id is the marker's, its localized name the switch's label. */
  readonly manifest: PluginManifest;
  /** The manifest settings a `:choice:` marker may embed for this plugin. */
  readonly choices?: readonly string[];
}

export const CHANGELOG_SWITCH_TARGETS: Readonly<Record<string, SwitchTarget>> = {
  [GEMINI_QUOTE_REPLY_MANIFEST.id]: { manifest: GEMINI_QUOTE_REPLY_MANIFEST },
  [GEMINI_USAGE_STATUS_MANIFEST.id]: {
    manifest: GEMINI_USAGE_STATUS_MANIFEST,
    choices: ['display'],
  },
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

/**
 * Captures the plugin id and the setting key of `:choice:<plugin id>:<setting>:`.
 * The id may contain dots and the key is a manifest key (letters and digits),
 * so the colon between them is the only split and the two never blur.
 */
export const CHOICE_MARKER = /:choice:([a-z0-9][a-z0-9.-]*[a-z0-9]):([A-Za-z][A-Za-z0-9]*):/g;

export interface ChoiceTarget {
  readonly target: SwitchTarget;
  readonly key: string;
  readonly field: SettingField & { readonly type: 'select' | 'boolean' };
}

/** A listed choice whose manifest declares it as a `select` or `boolean`; `null` otherwise. */
export function choiceTargetFor(id: string, key: string): ChoiceTarget | null {
  const target = switchTargetFor(id);
  if (!target?.choices?.includes(key)) return null;
  const settings = target.manifest.contributes.settings;
  const field = settings && Object.hasOwn(settings, key) ? settings[key] : undefined;
  if (field?.type !== 'select' && field?.type !== 'boolean') return null;
  return { target, key, field: field as ChoiceTarget['field'] };
}

/** The setting's label in `lang`, as its manifest localizes it; English where it has none. */
export function choiceTargetLabel(choice: ChoiceTarget, lang: string): string {
  return choice.target.manifest.i18n?.[lang]?.settings?.[choice.key]?.label ?? choice.field.label;
}

/** A `select` setting's options with labels in `lang`; English where one has none. */
export function choiceTargetOptions(
  choice: ChoiceTarget,
  lang: string,
): ReadonlyArray<{ readonly value: string; readonly label: string }> {
  const localized = choice.target.manifest.i18n?.[lang]?.settings?.[choice.key]?.options;
  return (choice.field.options ?? []).map((option) => ({
    value: option.value,
    label: localized?.[option.value] ?? option.label,
  }));
}

/** Anything shaped like a choice marker, a malformed one included, for the check below. */
const LOOSE_CHOICE_MARKER = /:choice:([^\s:]*)(?::([^\s:]*))?:/g;

/**
 * Every `:choice:` marker in `text` that is not a listed choice, as `id:key`,
 * for checks that fail a bad note; one missing its setting key counts too.
 */
export function unknownChoiceMarkers(text: string): string[] {
  return [...text.matchAll(LOOSE_CHOICE_MARKER)]
    .filter(([, id, key = '']) => choiceTargetFor(id, key) === null)
    .map(([, id, key = '']) => `${id}:${key}`);
}
