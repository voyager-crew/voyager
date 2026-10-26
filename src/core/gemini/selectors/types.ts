import { GEMINI_MODEL_PICKER_PROFILE_KEYS } from './modelPickerKeys';
import { GEMINI_SIDEBAR_PROFILE_KEYS } from './sidebarKeys';

/** Locator data only; query algorithms, identity and actions remain packaged. */
export const GEMINI_SELECTOR_HOSTS = ['gemini.google.com'] as const;
export type GeminiSelectorHost = (typeof GEMINI_SELECTOR_HOSTS)[number];

export const GEMINI_TURN_PROFILE_KEYS = [
  'turn.user',
  'turn.userWithHosts',
  'turn.assistant',
  'turn.assistantFallback',
  'turn.assistantWithHosts',
] as const;
export type GeminiTurnProfileKey = (typeof GEMINI_TURN_PROFILE_KEYS)[number];
export type GeminiTurnProfiles = Readonly<Record<GeminiTurnProfileKey, readonly string[]>>;

/** v1's allowlist stays frozen; v2 adds only the explicitly reviewed locator names. */
export const GEMINI_SELECTOR_PROFILE_KEYS = [
  ...GEMINI_TURN_PROFILE_KEYS,
  ...GEMINI_SIDEBAR_PROFILE_KEYS,
  ...GEMINI_MODEL_PICKER_PROFILE_KEYS,
] as const;
export type GeminiSelectorProfileKey = (typeof GEMINI_SELECTOR_PROFILE_KEYS)[number];

/** Each surface adopts or drops its online fixes on its own; one bad group cannot void another. */
export const GEMINI_SELECTOR_PROFILE_GROUPS: readonly (readonly GeminiSelectorProfileKey[])[] = [
  GEMINI_TURN_PROFILE_KEYS,
  GEMINI_SIDEBAR_PROFILE_KEYS,
  GEMINI_MODEL_PICKER_PROFILE_KEYS,
];
export type GeminiSelectorProfiles = Readonly<Record<GeminiSelectorProfileKey, readonly string[]>>;

export interface GeminiSelectorFile {
  /** Format 1 is accepted only with the original five turn keys. */
  readonly format: 1 | 2;
  readonly site: 'gemini';
  readonly host: GeminiSelectorHost;
  readonly catalogRevision: number;
  readonly selectors: Readonly<Partial<Record<GeminiSelectorProfileKey, readonly string[]>>>;
}

export interface GeminiSelectorView {
  readonly profiles: GeminiSelectorProfiles;
  readonly remoteKeys: ReadonlySet<GeminiSelectorProfileKey>;
  readonly revision: number | null;
}

export interface GeminiSelectorOperation<T> {
  readonly value: T;
  readonly view: GeminiSelectorView;
}

/** Existing turn consumers share the same page snapshot, never a second hydration. */
export type GeminiTurnView = GeminiSelectorView;
export type GeminiTurnOperation<T> = GeminiSelectorOperation<T>;
