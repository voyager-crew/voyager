export interface SiteKnowledgeSource {
  readonly file: string;
  readonly text: string;
}

export type SiteKnowledgeOwner =
  | {
      readonly kind: 'directory' | 'file';
      readonly path: string;
      readonly site: string;
      readonly reason: string;
    }
  | {
      readonly kind: 'table';
      readonly path: string;
      readonly sites: readonly string[];
      readonly reason: string;
    };

export interface SiteKnowledgeException {
  readonly kind:
    | 'serialized-value'
    | 'presentation'
    | 'platform-branch'
    | 'owner-read'
    | 'site-owned-module';
  readonly file: string;
  readonly values: Readonly<Record<string, number>>;
  readonly reason: string;
}

export interface SiteKnowledgeOccurrence {
  readonly file: string;
  readonly line: number;
  readonly site: string;
  readonly form: 'literal' | 'key';
}

export interface SiteKnowledgeDiagnostic {
  readonly kind: 'config' | 'unreviewed' | 'growth' | 'stale';
  readonly file: string;
  readonly line: number;
  readonly reason: string;
}

export interface SiteKnowledgeTable<Entry> {
  readonly file: string;
  readonly entries: readonly Entry[];
}

export interface SiteKnowledgeTables {
  readonly owners: SiteKnowledgeTable<SiteKnowledgeOwner>;
  readonly exceptions: readonly SiteKnowledgeTable<SiteKnowledgeException>[];
}

export interface SiteKnowledgeInput extends SiteKnowledgeTables {
  readonly sources: readonly SiteKnowledgeSource[];
  readonly siteIds: readonly string[];
}

export interface SiteKnowledgeResult {
  readonly diagnostics: readonly SiteKnowledgeDiagnostic[];
  readonly occurrences: readonly SiteKnowledgeOccurrence[];
  readonly sharedOccurrences: readonly SiteKnowledgeOccurrence[];
  readonly scannedFiles: number;
}
