import { hasGeminiCodeFixes, resolveGeminiCodeHosts } from '@/core/gemini/code/hosts';
import { hasPageSemanticFixes } from '@/core/selectors/semanticSnapshot';

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

export function usesCatalogCodeFixes(
  context: PrimitiveContext,
  params: CodeBlockDiagramParams,
): boolean {
  return hasPageSemanticFixes(
    context.adapter,
    [...(params.turn ? [] : ['assistantTurn']), ...(params.codeBlock ? [] : ['codeBlock'])],
    context.doc,
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
  const catalog = usesCatalogCodeFixes(context, params);
  // Re-read the guarded getters for each scan and after every asynchronous draw boundary.
  const currentTurn = catalog ? (params.turn ?? context.adapter!.selectors.assistantTurn) : turn;
  const currentBlock = catalog
    ? (params.codeBlock ?? context.adapter!.selectors.codeBlock)
    : blockSelector;
  const replies = querySafe(doc, currentTurn);
  const gemini = usesGeminiCodeFixes(context, blockSelector);
  const blocks = gemini
    ? resolveGeminiCodeHosts(doc).value.filter((block) =>
        replies.some((reply) => reply.contains(block)),
      )
    : replies.flatMap((reply) => querySafe(reply, currentBlock));
  return {
    blocks,
    checked: gemini || catalog,
    owner: (block) => replies.find((reply) => reply.contains(block)) ?? null,
    sourceElement: (block) => querySafe(block, params.code ?? 'code')[0] ?? block,
    read: (block) => readCodeBlock(block, params),
  };
}
