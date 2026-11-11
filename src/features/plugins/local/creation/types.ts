/**
 * What Create mode reads from a chat it started: each code block of an AI
 * reply, classified by the local import gate. Pure data; the content script
 * finds the blocks and the panel re-checks a block before it installs it.
 */
import type { ManifestIssue } from '../../manifest/validate';

/** How an installable block relates to what is installed under its id. */
export type CreationInstall =
  | { readonly kind: 'new' }
  | { readonly kind: 'update'; readonly previousVersion: string | null }
  | { readonly kind: 'installed' };

export type CreationVerdict =
  /** Not JSON, or JSON that is not a plugin manifest. */
  | { readonly kind: 'none' }
  | {
      readonly kind: 'installable';
      /** Namespaced (`local.*`) id, as the import stores it. */
      readonly manifestId: string;
      readonly install: CreationInstall;
    }
  | {
      readonly kind: 'rejected';
      /** Namespaced id when the block carries a valid one. */
      readonly manifestId: string | null;
      readonly issues: readonly ManifestIssue[];
    };

/** A verdict worth a control on the page: every kind but `none`. */
export type CandidateVerdict = Exclude<CreationVerdict, { readonly kind: 'none' }>;

export interface CreationBlock {
  /** Random per block, so the panel can ask for exactly this one. */
  readonly id: string;
  /** The code block's text, at most `MAX_LOCAL_PLUGIN_IMPORT_CHARS`. */
  readonly text: string;
  readonly siteId: string;
  readonly verdict: CandidateVerdict;
}

export interface CreationCandidate extends CreationBlock {
  /** The last block in the chat with this manifest id; earlier ones are superseded. */
  readonly latest: boolean;
}
