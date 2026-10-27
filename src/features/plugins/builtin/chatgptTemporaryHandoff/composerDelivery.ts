import { hasComposerAttachments, readComposerText } from '@/core/services/composer/draft';
import { chatgptPageData } from '@/features/plugins/builtin/chatgptPageData';
import type { PluginScope } from '@/features/plugins/runtime/pluginScope';
import { insertTextIntoChatInput } from '@/pages/content/chatInput';

import { chatgptComposerRootOf, resolveChatgptComposer } from '../chatgptComposerTargets';
import { pickComposer } from './composerPick';
import type { HandoffDelivery } from './handoffPlan';
import { wait } from './handoffWait';

export { hasComposerAttachments, readComposerText } from '@/core/services/composer/draft';
import {
  CHATGPT_COMPOSER_SELECTORS,
  CHATGPT_GENERIC_COMPOSER_SELECTOR,
  CHATGPT_SEND_CONTROL_SELECTOR,
} from './selectors';

let internalComposerWrites = 0;

export function isInternalComposerWrite(): boolean {
  return internalComposerWrites > 0;
}

function runInternalComposerWrite<T>(write: () => T): T {
  internalComposerWrites += 1;
  try {
    return write();
  } finally {
    internalComposerWrites -= 1;
  }
}

function dispatchPaste(input: HTMLElement, text: string | null, file: File | null): boolean {
  if (typeof DataTransfer === 'undefined' || typeof ClipboardEvent === 'undefined') return false;
  try {
    const transfer = new DataTransfer();
    if (text) transfer.setData('text/plain', text);
    if (file) transfer.items.add(file);
    const event = new ClipboardEvent('paste', {
      clipboardData: transfer,
      bubbles: true,
      cancelable: true,
    });
    const validText = !text || event.clipboardData?.getData('text/plain') === text;
    const validFile = !file || (event.clipboardData?.files.length ?? 0) > 0;
    if (!validText || !validFile) return false;
    input.focus();
    runInternalComposerWrite(() => input.dispatchEvent(event));
    return true;
  } catch {
    return false;
  }
}

function normalizeComposerText(text: string): string {
  return text
    .replace(/[\u200b\u00a0]/g, ' ')
    .replace(/\r\n?/g, '\n')
    .replace(/[^\S\n]+/g, ' ')
    .replace(/ *\n+ */g, '\n')
    .trim();
}

function hasComposerSegment(input: HTMLElement, text: string): boolean {
  const existing = normalizeComposerText(readComposerText(input));
  const expected = normalizeComposerText(text);
  if (!expected) return true;
  return (
    existing === expected ||
    existing.startsWith(`${expected}\n`) ||
    existing.endsWith(`\n${expected}`) ||
    existing.includes(`\n${expected}\n`)
  );
}

function hasOrderedComposerSegments(input: HTMLElement, first: string, second: string): boolean {
  const existing = normalizeComposerText(readComposerText(input));
  const expectedFirst = normalizeComposerText(first);
  const expectedSecond = normalizeComposerText(second);
  if (!expectedSecond) return hasComposerSegment(input, first);
  const firstIndex = existing.indexOf(expectedFirst);
  if (firstIndex < 0) return false;
  const remainder = existing.slice(firstIndex + expectedFirst.length);
  const following = remainder.startsWith('\n') ? remainder.slice(1) : remainder;
  return following === expectedSecond || following.startsWith(`${expectedSecond}\n`);
}

type ComposerInsertionPlacement = 'start' | 'end';

function placeComposerCaret(input: HTMLElement, placement: ComposerInsertionPlacement): void {
  if (input instanceof HTMLTextAreaElement || input instanceof HTMLInputElement) {
    const offset = placement === 'start' ? 0 : input.value.length;
    input.setSelectionRange(offset, offset);
    return;
  }
  const selection = window.getSelection();
  if (!selection) return;
  const range = document.createRange();
  range.selectNodeContents(input);
  range.collapse(placement === 'start');
  selection.removeAllRanges();
  selection.addRange(range);
}

function insertComposerText(
  input: HTMLElement,
  text: string,
  placement: ComposerInsertionPlacement,
): boolean {
  input.focus();
  const existing = readComposerText(input).trim();
  placeComposerCaret(input, placement);
  const insertion = existing ? (placement === 'start' ? `${text}\n\n` : `\n\n${text}`) : text;
  if (!runInternalComposerWrite(() => insertTextIntoChatInput(insertion, input))) return false;
  return hasComposerSegment(input, text);
}

function ensureComposerText(
  input: HTMLElement,
  text: string,
  placement: ComposerInsertionPlacement,
): boolean {
  if (hasComposerSegment(input, text)) return true;
  return insertComposerText(input, text, placement);
}

export function hasAttachmentPreview(input: HTMLElement, filename: string): boolean {
  if (!input.isConnected) return false;
  const root = chatgptComposerRootOf(input);
  if (!root?.isConnected) return false;
  const normalizedFilename = filename.trim().toLowerCase();
  if (!normalizedFilename) return false;

  const fileInputs = root.querySelectorAll<HTMLInputElement>(chatgptPageData.fileInput);
  if (
    Array.from(fileInputs).some((fileInput) =>
      Array.from(fileInput.files || []).some(
        (candidate) => candidate.name.toLowerCase() === normalizedFilename,
      ),
    )
  ) {
    return true;
  }

  const labelledPreview = Array.from(
    root.querySelectorAll<HTMLElement>(chatgptPageData.attachmentPreview),
  ).some((candidate) => {
    const label =
      `${candidate.textContent || ''} ${candidate.getAttribute('aria-label') || ''} ${candidate.getAttribute('title') || ''}`
        .trim()
        .toLowerCase();
    return label.includes(normalizedFilename);
  });
  return labelledPreview || (root.textContent || '').toLowerCase().includes(normalizedFilename);
}

export function hasCurrentComposerAttachments(): boolean {
  const root = currentComposerRoot();
  return !!root?.isConnected && hasComposerAttachments(root);
}

export function isCurrentComposerAttachmentRemovalControl(target: Element): boolean {
  const control = target.closest<HTMLElement>(chatgptPageData.attachmentControl);
  const input = currentComposer();
  const form = input ? chatgptComposerRootOf(input) : null;
  if (!control || !form?.isConnected || !form.contains(control)) return false;

  const controlLabel = [
    control.dataset.testid,
    control.getAttribute('aria-label'),
    control.getAttribute('title'),
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  if (
    /(remove|delete|discard|close).*(attachment|file|upload)/.test(controlLabel) ||
    /(attachment|file|upload).*(remove|delete|discard|close)/.test(controlLabel)
  ) {
    return true;
  }

  const preview = control.closest<HTMLElement>(chatgptPageData.attachmentRemovalPreview);
  return preview !== null && preview !== control && form.contains(preview);
}

async function dispatchAttachmentAndVerify(
  scope: PluginScope,
  input: HTMLElement,
  file: File,
  isCancelled: () => boolean,
): Promise<HTMLElement | null> {
  if (isCancelled()) return null;
  if (hasAttachmentPreview(input, file.name)) return input;
  if (!dispatchPaste(input, null, file)) return null;
  if (isCancelled()) return null;
  const immediateComposer = currentComposer();
  if (immediateComposer && hasAttachmentPreview(immediateComposer, file.name)) {
    return immediateComposer;
  }

  const deadline = Date.now() + 1_200;
  while (Date.now() < deadline) {
    await wait(scope, 60);
    if (isCancelled()) return null;
    const liveComposer = currentComposer();
    if (liveComposer && hasAttachmentPreview(liveComposer, file.name)) return liveComposer;
  }
  return null;
}

export async function deliverOnce(
  scope: PluginScope,
  input: HTMLElement,
  delivery: HandoffDelivery,
  draft?: string,
  isCancelled: () => boolean = () => false,
): Promise<HTMLElement | null> {
  if (isCancelled()) return null;
  let deliveryInput = input;
  let initialText = normalizeComposerText(readComposerText(deliveryInput));
  const expectedDraft = draft ? normalizeComposerText(draft) : '';
  let draftAlreadyPresent = expectedDraft.length > 0 && initialText === expectedDraft;
  let delivered: boolean;
  if (delivery.mode === 'inline') {
    delivered = ensureComposerText(
      deliveryInput,
      delivery.text,
      draftAlreadyPresent ? 'start' : 'end',
    );
  } else {
    const file = new File([delivery.attachment], delivery.filename, { type: 'text/markdown' });
    const liveInput = await dispatchAttachmentAndVerify(scope, deliveryInput, file, isCancelled);
    if (!liveInput) return null;
    if (isCancelled()) return null;
    deliveryInput = liveInput;
    initialText = normalizeComposerText(readComposerText(deliveryInput));
    draftAlreadyPresent = expectedDraft.length > 0 && initialText === expectedDraft;
    delivered = ensureComposerText(
      deliveryInput,
      delivery.directive,
      draftAlreadyPresent ? 'start' : 'end',
    );
  }

  const deliveryText = delivery.mode === 'inline' ? delivery.text : delivery.directive;
  const draftPreserved =
    !expectedDraft ||
    hasOrderedComposerSegments(deliveryInput, deliveryText, draft!) ||
    insertComposerText(deliveryInput, draft!, 'end');
  return delivered && draftPreserved && !isCancelled() ? deliveryInput : null;
}

export function isDeliveryComplete(
  input: HTMLElement,
  delivery: HandoffDelivery,
  draft?: string,
): boolean {
  if (!input.isConnected) return false;
  const handoffPresent =
    delivery.mode === 'inline'
      ? hasComposerSegment(input, delivery.text)
      : hasAttachmentPreview(input, delivery.filename) &&
        hasComposerSegment(input, delivery.directive);
  if (!handoffPresent) return false;
  if (!draft?.trim()) return true;
  const deliveryText = delivery.mode === 'inline' ? delivery.text : delivery.directive;
  return hasOrderedComposerSegments(input, deliveryText, draft);
}

// Selector priority keeps an unrelated editor from outranking the real composer.
function readBundledComposer(): HTMLElement | null {
  for (const selector of CHATGPT_COMPOSER_SELECTORS) {
    const candidate = pickComposer(Array.from(document.querySelectorAll<HTMLElement>(selector)));
    if (candidate) return candidate;
  }

  return pickComposer(
    Array.from(document.querySelectorAll<HTMLElement>(CHATGPT_GENERIC_COMPOSER_SELECTOR)).filter(
      (candidate) => chatgptComposerRootOf(candidate)?.querySelector(CHATGPT_SEND_CONTROL_SELECTOR),
    ),
  );
}

export function currentComposer(): HTMLElement | null {
  return resolveChatgptComposer(readBundledComposer);
}

function currentComposerRoot(): HTMLElement | null {
  const input = currentComposer();
  return input ? chatgptComposerRootOf(input) : null;
}

export async function findComposer(
  scope: PluginScope,
  timeoutMs: number,
): Promise<HTMLElement | null> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (scope.signal.aborted) return null;
    const input = currentComposer();
    if (input) return input;
    await wait(scope, 120);
  }
  return null;
}

export function readCurrentComposerDraft(): string | undefined {
  const input = currentComposer();
  if (!input) return undefined;
  const draft = readComposerText(input);
  return draft.trim() ? draft : undefined;
}
