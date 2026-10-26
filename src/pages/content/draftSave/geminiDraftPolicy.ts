/**
 * Gemini's native drafts as a `DraftPolicy`: `gvDraft_<pathname>` keys (the
 * pathname keeps `/u/<n>/` and `/gem/...`), Voyager's folder project
 * instructions stripped at input, store and restore, and the main composer
 * found by Gemini's own four candidates rather than the generic chat finder.
 */
import { findGeminiDraftInput } from '@/core/gemini/composer/draft';
import { detectAccountContextFromDocument } from '@/core/services/AccountIsolationService';
import { isGeminiEnterpriseEnvironment } from '@/core/utils/gemini';
import packaged from '@/features/plugins/catalog/sites/gemini/selector-data/composer-draft-packaged.json';
import type {
  DraftPolicy,
  DraftSanitizeStage,
} from '@/features/plugins/verbs/draftSave/draftPolicy';

import { stripInstructionBlock } from '../folderProject/instructionBlock';
import { setInputText } from '../utils/inputHelper';

/** Storage key prefix for Gemini draft entries in chrome.storage.local */
export const GEMINI_DRAFT_PREFIX = 'gvDraft_';

/**
 * `stripInstructionBlock` folds every `\n\n` into `\n`, so each stage that runs
 * it changes blank lines again; dropping or adding a stage changes stored drafts.
 */
const SANITIZE_STAGES: ReadonlySet<DraftSanitizeStage> = new Set(['input', 'store', 'restore']);

/**
 * Get the text content of the chat input.
 */
function getInputText(input: HTMLElement): string {
  if (input instanceof HTMLTextAreaElement) {
    return input.value;
  }
  return input.innerText ?? input.textContent ?? '';
}

/**
 * Check if input content is effectively empty.
 */
function isInputEffectivelyEmpty(input: HTMLElement): boolean {
  const text = getInputText(input).trim();
  if (text.length === 0) return true;

  // Check if the text is just placeholder text
  const richTextarea = input.closest(packaged['composer.draftPlaceholderHost']);
  const placeholders = [
    input.getAttribute('data-placeholder'),
    input.getAttribute('aria-placeholder'),
    input.getAttribute('placeholder'),
    richTextarea?.getAttribute('data-placeholder'),
    richTextarea?.getAttribute('aria-placeholder'),
    richTextarea?.getAttribute('placeholder'),
  ].filter((v): v is string => Boolean(v));

  return placeholders.some((p) => p.trim() === text);
}

export function geminiDraftPolicy(): DraftPolicy {
  return {
    // The same Enterprise detection that keeps the native module off those pages at startup.
    eligible: (loc, doc) =>
      loc.hostname === 'gemini.google.com' && !isGeminiEnterpriseEnvironment(loc, doc),
    store: { prefix: GEMINI_DRAFT_PREFIX },
    keyFor: (loc) => loc.pathname,
    findInput: findGeminiDraftInput,
    readText: getInputText,
    isEmpty: isInputEffectivelyEmpty,
    write(field, text) {
      setInputText(field, text);
      // The native restore never checked the result; checking it would retry and keep the old baseline.
      return true;
    },
    sanitize: { fn: stripInstructionBlock, stages: SANITIZE_STAGES },
    sendDetection: { kind: 'gemini' },
    flushOnPageHide: true,
    restoreIdentity(doc) {
      const href = doc.defaultView?.location.href ?? location.href;
      const { routeUserId, email } = detectAccountContextFromDocument(href, doc);
      return `${routeUserId ?? ''}|${email ?? ''}`;
    },
  };
}
