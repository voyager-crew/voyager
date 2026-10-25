/**
 * This protocol carries locator data only; query order and actions stay packaged.
 * Enterprise (`business.gemini.google`) is absent: it stops initialization before any turn owner.
 */
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

export interface GeminiSelectorFile {
  readonly format: 1;
  readonly site: 'gemini';
  readonly host: GeminiSelectorHost;
  readonly catalogRevision: number;
  readonly selectors: Readonly<Partial<Record<GeminiTurnProfileKey, readonly string[]>>>;
}

export interface GeminiTurnView {
  readonly profiles: GeminiTurnProfiles;
  readonly remoteKeys: ReadonlySet<GeminiTurnProfileKey>;
  readonly revision: number | null;
}

export interface GeminiTurnOperation<T> {
  readonly value: T;
  readonly view: GeminiTurnView;
}
