/**
 * The parent chain of one Grok conversation, chosen from the endpoint payloads.
 * No network: the endpoint client fetches, and this file decides which messages
 * are on the branch the page is showing.
 */
import { grokMessageMarkdown, record } from './grokMessageMarkdown';

const CONVERSATION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface GrokBranchMessage {
  readonly id: string;
  readonly role: 'user' | 'assistant';
  readonly text: string;
}

export interface GrokBranch {
  readonly messages: readonly GrokBranchMessage[];
  /** A selected message was still marked partial by the endpoint. */
  readonly partial: boolean;
}

export function responseIdOf(value: unknown): string | null {
  const id = record(value)?.responseId;
  if (typeof id !== 'string') return null;
  const trimmed = id.trim();
  return trimmed.length > 0 && trimmed.length <= 200 ? trimmed : null;
}

function isGrokConversationId(value: string): boolean {
  return CONVERSATION_ID.test(value);
}

/** `undefined` means the field is absent or unusable, so a node parent stays. */
function parentFrom(facts: Record<string, unknown> | null): string | null | undefined {
  if (!facts || !Object.hasOwn(facts, 'parentResponseId')) return undefined;
  const parent = facts.parentResponseId;
  if (parent === null || parent === '') return null;
  if (typeof parent !== 'string') return undefined;
  const trimmed = parent.trim();
  if (!trimmed) return null;
  return trimmed.length <= 200 ? trimmed : undefined;
}

function readTime(value: unknown): number | null {
  if (typeof value !== 'string' || !value) return null;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : parsed;
}

function roleOf(facts: Record<string, unknown>): 'user' | 'assistant' | 'other' {
  const sender = typeof facts.sender === 'string' ? facts.sender.toLowerCase() : '';
  if (sender === 'human') return 'user';
  if (sender === 'assistant') return 'assistant';
  return 'other';
}

interface Draft {
  id: string;
  parentId: string | null;
  role: 'user' | 'assistant' | 'other' | 'pending';
  text: string;
  createdAt: number | null;
  partial: boolean;
  control: boolean;
  index: number;
}

/** The `/c/<uuid>` id, and only that. A capture that is not a UUID is not requested. */
export function grokConversationId(url: string, pattern: string): string | null {
  try {
    const captured = new RegExp(pattern).exec(new URL(url).pathname)?.[1];
    return captured !== undefined && isGrokConversationId(captured) ? captured : null;
  } catch {
    return null;
  }
}

/** `rid` is the response the page is showing, when the query is a UUID. */
export function grokDisplayedLeafId(url: string): string | null {
  try {
    const rid = new URL(url).searchParams.get('rid');
    return rid !== null && isGrokConversationId(rid) ? rid : null;
  } catch {
    return null;
  }
}

function chooseLeaf(drafts: ReadonlyMap<string, Draft>, leafId: string | null): string | null {
  if (leafId) {
    const wanted = leafId.toLowerCase();
    for (const id of drafts.keys()) {
      if (id.toLowerCase() === wanted) return id;
    }
  }
  const used = new Set<string>();
  for (const draft of drafts.values()) {
    if (draft.parentId && drafts.has(draft.parentId)) used.add(draft.parentId);
  }
  const leaves = [...drafts.values()].filter((draft) => !used.has(draft.id));
  if (leaves.length === 0) return null;
  leaves.sort((a, b) => {
    const at = a.createdAt ?? Number.NEGATIVE_INFINITY;
    const bt = b.createdAt ?? Number.NEGATIVE_INFINITY;
    if (at !== bt) return bt - at;
    return b.index - a.index;
  });
  return leaves[0]?.id ?? null;
}

function isShown(draft: Draft): draft is Draft & { role: 'user' | 'assistant' } {
  return (
    (draft.role === 'user' || draft.role === 'assistant') && !draft.control && draft.text.length > 0
  );
}

/**
 * The messages on one branch, oldest first. `null` when the payloads are not
 * the node tree and response list this reader understands, or the chain is
 * cyclic, unfinished, or empty.
 */
export function selectGrokBranch(
  nodePayload: unknown,
  responses: readonly unknown[],
  leafId: string | null,
): GrokBranch | null {
  const nodes = record(nodePayload)?.responseNodes;
  if (!Array.isArray(nodes)) return null;
  const drafts = new Map<string, Draft>();
  nodes.forEach((node, index) => {
    const id = responseIdOf(node);
    if (!id || drafts.has(id)) return;
    const facts = record(node);
    drafts.set(id, {
      id,
      parentId: parentFrom(facts) ?? null,
      role: 'pending',
      text: '',
      createdAt: facts ? readTime(facts.createTime) : null,
      partial: false,
      control: false,
      index,
    });
  });
  if (drafts.size === 0) return null;

  responses.forEach((response, index) => {
    const id = responseIdOf(response);
    const facts = record(response);
    const current = id ? drafts.get(id) : undefined;
    if (!id || !facts || !current) return;
    const parent = parentFrom(facts);
    drafts.set(id, {
      ...current,
      parentId: parent === undefined ? current.parentId : parent,
      role: roleOf(facts),
      text: grokMessageMarkdown(facts),
      createdAt: readTime(facts.createTime) ?? current.createdAt,
      partial: facts.partial === true,
      control: facts.isControl === true,
      index,
    });
  });

  const leaf = chooseLeaf(drafts, leafId);
  if (!leaf) return null;
  const chain: Draft[] = [];
  const seen = new Set<string>();
  for (let id: string | null = leaf; id;) {
    if (seen.has(id)) return null;
    seen.add(id);
    const draft = drafts.get(id);
    if (!draft) break;
    if (draft.role === 'pending') return null;
    chain.push(draft);
    id = draft.parentId && drafts.has(draft.parentId) ? draft.parentId : null;
  }
  const shown = chain.reverse().filter(isShown);
  if (shown.length === 0) return null;
  return {
    messages: shown.map(({ id, role, text }) => ({ id, role, text })),
    partial: shown.some((draft) => draft.partial),
  };
}
