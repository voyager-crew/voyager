/** Native content serialization shared by the packaged and generic export dialects. */
import type { ExtractedContent } from '@/features/export/services/DOMContentExtractor';
import { extractExportCodeBlock } from '@/features/export/services/exportCodeBlocks';
import { normalizeText } from '@/features/export/services/exportDomPolicy';

export function extractUserText(textLines: NodeListOf<HTMLElement>, textParts: string[]): void {
  textLines.forEach((line) => {
    const raw = line.dataset?.userLatexOriginal ?? line.textContent ?? '';
    const text = normalizeText(raw);
    if (text) textParts.push(text);
  });
}

export function extractFormula(
  child: Element,
  flags: Pick<ExtractedContent, 'hasImages' | 'hasFormulas' | 'hasTables' | 'hasCode'>,
  htmlParts: string[],
  textParts: string[],
  _DEBUG: boolean,
): boolean | undefined {
  if (!child.classList.contains('math-block') && !child.hasAttribute('data-math')) return;
  const latex = child.getAttribute('data-math') || '';
  if (!latex) return;

  flags.hasFormulas = true;
  const clonedFormula = (child as HTMLElement).cloneNode(true) as HTMLElement;
  if (!clonedFormula.hasAttribute('data-math')) clonedFormula.setAttribute('data-math', latex);
  htmlParts.push(clonedFormula.outerHTML);
  textParts.push(`\n$$\n${latex}\n$$\n`);
  return true;
}

export function extractCodeBlock(
  child: Element,
  htmlParts: string[],
  textParts: string[],
  flags: Pick<ExtractedContent, 'hasImages' | 'hasFormulas' | 'hasTables' | 'hasCode'>,
  tagName?: string,
  _DEBUG?: boolean,
): boolean | undefined {
  if (child.querySelector('.gv-mermaid-wrapper')) return;

  // Descendant code blocks belong to the shared DOM-order traversal. Claiming
  // their parent here drops prose and sibling blocks around the first match.
  if (tagName !== 'code-block' && !child.classList.contains('code-block')) return;

  // A diagram plugin's block exports its drawing while it can be read; otherwise its source.
  const codeContent = extractExportCodeBlock(child as HTMLElement);
  if (codeContent?.text) {
    flags.hasCode = true;
    htmlParts.push(codeContent.html);
    textParts.push(`\n${codeContent.text}\n`);
  }
  return true;
}

export function extractInlineFormula(
  element: Element,
  htmlParts: string[],
  textParts: string[],
): boolean | undefined {
  if (!element.classList.contains('math-inline') && !element.hasAttribute('data-math')) return;
  const latex = element.getAttribute('data-math') || '';
  if (!latex) return;

  const clonedFormula = (element as HTMLElement).cloneNode(true) as HTMLElement;
  if (!clonedFormula.hasAttribute('data-math')) clonedFormula.setAttribute('data-math', latex);
  htmlParts.push(clonedFormula.outerHTML);
  textParts.push(`$${latex}$`);
  return true;
}
