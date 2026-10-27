/**
 * What differs between drafts on a catalog site and Gemini's native drafts:
 * where a draft is stored, which field it reads, when its text is cleaned and
 * how a send is detected. The session around it (debounce, restore, route
 * changes) is shared. A policy is chosen by package code from a verified
 * adapter; manifests, params and settings never supply a prefix, key or
 * sanitizer.
 */
import { findComposer, insertIntoComposer, readComposer } from '@/core/services/composer';
import { setTextFieldValue } from '@/core/services/composer/textField';
import type { SiteAdapter } from '@/features/plugins/types';

import { draftKeyFor, siteDraftPrefix } from './draftKey';

export type DraftSanitizeStage = 'input' | 'store' | 'restore';

export type DraftSendDetection =
  /** Enter, the adapter's send button or the form, then the composer emptying. */
  | { readonly kind: 'catalog'; readonly sendButton: string | undefined }
  /** Verified native Gemini main-composer sends, shared with the rollback module. */
  | { readonly kind: 'gemini' };

export interface DraftPolicy {
  /** Trusted check, repeated before every key and every storage write. */
  eligible(loc: Location, doc: Document): boolean;
  /** Every stored key is `<prefix><key>`; pruning only counts keys under it. */
  readonly store: { readonly prefix: string };
  /** The draft key for this page, or `null` when nothing here may be saved. */
  keyFor(loc: Location): string | null;
  findInput(doc: Document): HTMLElement | null;
  readText(field: HTMLElement): string;
  isEmpty(field: HTMLElement): boolean;
  /** Writes a stored draft into the empty field; `true` when the field took it. */
  write(field: HTMLElement, text: string): boolean;
  /**
   * The sanitizer and the stages that run it. It need not be idempotent, so
   * the number of stages is part of the stored format, not an implementation detail.
   */
  readonly sanitize: {
    fn(text: string): string;
    readonly stages: ReadonlySet<DraftSanitizeStage>;
  };
  readonly sendDetection: DraftSendDetection;
  /** Saves the debounced tail when the page is hidden. */
  readonly flushOnPageHide: boolean;
  /** Captured when a restore starts and compared before it lands; never part of the key. */
  restoreIdentity(doc: Document): string;
}

/** The policy's sanitizer applied at `stage`, or the text unchanged when that stage does not run it. */
export function sanitizeDraftAt(
  policy: DraftPolicy,
  stage: DraftSanitizeStage,
  text: string,
): string {
  return policy.sanitize.stages.has(stage) ? policy.sanitize.fn(text) : text;
}

const NO_SANITIZE_STAGES: ReadonlySet<DraftSanitizeStage> = new Set();

function isTextField(field: HTMLElement): field is HTMLTextAreaElement | HTMLInputElement {
  return field instanceof HTMLTextAreaElement || field instanceof HTMLInputElement;
}

/** Drafts on a catalog site: per site and conversation id, the text exactly as typed. */
export function catalogDraftPolicy(adapter: SiteAdapter): DraftPolicy {
  return {
    eligible: () => true,
    store: { prefix: siteDraftPrefix(adapter.id) },
    keyFor: (loc) => draftKeyFor(adapter, loc.href),
    findInput: (doc) => findComposer(adapter, { doc }),
    readText: readComposer,
    isEmpty: (field) => readComposer(field).trim() === '',
    write(field, text) {
      if (isTextField(field)) {
        // A plain field takes the value without focus, as Gemini's draft restore does.
        setTextFieldValue(field, text);
        return readComposer(field).trim() !== '';
      }
      const doc = field.ownerDocument;
      const previous = doc.activeElement;
      // Rich editors need the selection inside them for a native editing command.
      const written = insertIntoComposer(field, text, 'replace');
      if (previous instanceof HTMLElement && previous !== doc.body && !field.contains(previous)) {
        previous.focus();
      }
      return written;
    },
    sanitize: { fn: (text) => text, stages: NO_SANITIZE_STAGES },
    sendDetection: {
      kind: 'catalog',
      // An alias can move after activation; the adapter proves it again at the actual click.
      get sendButton() {
        return adapter.selectors.sendButton;
      },
    },
    flushOnPageHide: true,
    restoreIdentity: () => '',
  };
}
