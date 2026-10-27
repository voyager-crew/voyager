/** A single site's frozen catalog snapshot. Query and action policies remain in the package. */
export interface SiteSelectorView<Key extends string = string> {
  readonly siteId: string;
  /** OFF preserves pre-migration cached semantics; namespaced profiles still use the bundle. */
  readonly semanticSource?: 'adapter' | 'snapshot';
  readonly profiles: Readonly<Record<Key, readonly string[]>>;
  readonly remoteKeys: ReadonlySet<Key>;
  readonly revision: number | null;
}

export interface SiteSelectorOperation<T, Key extends string = string> {
  readonly value: T;
  readonly view: SiteSelectorView<Key>;
}

export interface SiteSelectorFile {
  readonly file: string;
  readonly keys: readonly string[];
}

export interface SiteSelectorContract {
  /** Literal remote vocabulary. A packaged locator is deliberately absent. */
  readonly keys: readonly string[];
  readonly groups: readonly (readonly string[])[];
  readonly files: readonly SiteSelectorFile[];
}
