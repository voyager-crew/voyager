import type { Result } from '@/core/types/common';

import type { ManifestIssue } from '../manifest/validate';
import type { CodeBlockDiagramParams } from './codeBlockDiagram';

const SELECTOR_PARAMS: readonly string[] = ['turn', 'codeBlock', 'code', 'codeLine', 'language'];
const BOOLEAN_PARAMS: readonly string[] = ['copyButton', 'exportImage'];
const MAX_SELECTOR_LENGTH = 2_000;
const LANGUAGE_CLASS = /(?:^|\s)lang(?:uage)?-(\S+)/i;
/**
 * A language label is an id such as `mermaid`, `c++` or `objective-c`. Hosts
 * print a localized phrase on a block without one (ChatGPT: 纯文本, Texte brut),
 * which no list can cover, so anything not shaped like an id is no label.
 */
const LANGUAGE_ID = /^[a-z0-9_+#.-]{1,32}$/;
/** Ids that name no language either, so the block's content still decides. */
const PLAIN_TEXT_IDS: ReadonlySet<string> = new Set(['text', 'plaintext', 'plain', 'txt']);

export function querySafe(root: ParentNode, selector: string): Element[] {
  try {
    return Array.from(root.querySelectorAll(selector));
  } catch {
    return [];
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function classLanguage(element: Element): string | undefined {
  return LANGUAGE_CLASS.exec(element.getAttribute('class') ?? '')?.[1];
}

/** `label` as a lowercase language id, or null when it names no language. */
function languageId(label: string | null | undefined): string | null {
  const id = label?.trim().toLowerCase();
  return id && LANGUAGE_ID.test(id) && !PLAIN_TEXT_IDS.has(id) ? id : null;
}

export function validateCodeBlockDiagramParams(
  raw: unknown,
): Result<CodeBlockDiagramParams, ManifestIssue[]> {
  if (raw !== undefined && !isRecord(raw)) {
    return { success: false, error: [{ path: 'params', message: 'must be an object' }] };
  }
  const issues: ManifestIssue[] = [];
  const params: Record<string, string | boolean> = {};
  for (const [key, value] of Object.entries(raw ?? {})) {
    if (BOOLEAN_PARAMS.includes(key)) {
      if (typeof value === 'boolean') params[key] = value;
      else issues.push({ path: `params.${key}`, message: 'must be true or false' });
    } else if (!SELECTOR_PARAMS.includes(key)) {
      issues.push({ path: `params.${key}`, message: 'unknown parameter' });
    } else if (typeof value !== 'string' || !value.trim() || value.length > MAX_SELECTOR_LENGTH) {
      issues.push({ path: `params.${key}`, message: 'must be a non-empty selector' });
    } else {
      params[key] = value;
    }
  }
  return issues.length > 0 ? { success: false, error: issues } : { success: true, data: params };
}

/** A code block's language id (lowercase; null when untagged or plain text) and source text. */
export function readCodeBlock(
  block: Element,
  params: CodeBlockDiagramParams,
): { language: string | null; source: string } {
  const code = querySafe(block, params.code ?? 'code')[0] ?? block;
  const lines = params.codeLine ? querySafe(code, params.codeLine) : [];
  const source =
    lines.length > 0
      ? lines.map((line) => line.textContent ?? '').join('\n')
      : (code.textContent ?? '');
  const label = params.language ? querySafe(block, params.language)[0]?.textContent : null;
  // A localized "plain text" label is no language: the block's content decides, as on Gemini.
  const language =
    languageId(label) ?? languageId(classLanguage(code)) ?? languageId(classLanguage(block));
  return { language, source };
}
