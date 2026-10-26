import { hasGeminiCodeFixes, resolveGeminiCodeHosts } from '@/core/gemini/code/hosts';

import type { CodeBlockDiagramParams } from './codeBlockDiagram';
import { querySafe, readCodeBlock } from './codeBlockDiagramRead';
import type { PrimitiveContext } from './types';

export function usesGeminiCodeFixes(context: PrimitiveContext, blockSelector: string): boolean {
  return (
    context.adapter?.id === 'gemini' &&
    blockSelector === 'code-block' &&
    hasGeminiCodeFixes(context.doc)
  );
}

/** Each scan, copy and export recheck sees one complete accepted code-host collection. */
export function createDiagramRead(
  context: PrimitiveContext,
  params: CodeBlockDiagramParams,
  turn: string,
  blockSelector: string,
): {
  blocks: Element[];
  checked: boolean;
  owner: (block: Element) => Element | null;
  sourceElement: (block: Element) => Element;
  read: (block: Element) => { language: string | null; source: string };
} {
  const { doc } = context;
  const replies = querySafe(doc, turn);
  const checked = usesGeminiCodeFixes(context, blockSelector);
  const blocks = checked
    ? resolveGeminiCodeHosts(doc).value.filter((block) =>
        replies.some((reply) => reply.contains(block)),
      )
    : replies.flatMap((reply) => querySafe(reply, blockSelector));
  return {
    blocks,
    checked,
    owner: (block) => replies.find((reply) => reply.contains(block)) ?? null,
    sourceElement: (block) => querySafe(block, params.code ?? 'code')[0] ?? block,
    read: (block) => readCodeBlock(block, params),
  };
}
