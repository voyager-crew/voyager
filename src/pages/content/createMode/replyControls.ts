/**
 * Create mode's reading of replies. Only in a Create chat (a user message
 * links a create page, `isCreationChatText`) does it read the AI's code
 * blocks, classify each with the local import gate (`classifyReplyBlock`) and
 * put a control under every plugin-shaped one. Elsewhere nothing is read and
 * no control appears; the popup's paste path covers any other chat.
 *
 * Blocks are the site's `codeBlock` anchor inside an assistant turn, or a
 * `pre` inside one where the site declares no anchor. Both the marker and the
 * blocks are read only from the conversation on screen: ChatGPT keeps earlier
 * conversations mounted under hidden ancestors, as the export reader knows.
 */
import { pageSemanticSelector } from '@/core/selectors/semanticSnapshot';
import { isCreationChatText } from '@/features/plugins/local/creation/creationMarker';
import { markLatestCandidates } from '@/features/plugins/local/creation/latestCandidates';
import { classifyReplyBlock } from '@/features/plugins/local/creation/replyBlock';
import type {
  CreationBlock,
  CreationCandidate,
  CreationVerdict,
} from '@/features/plugins/local/creation/types';
import type { LocalPluginRecordMap } from '@/features/plugins/local/localPluginStore';
import { resolveSemanticElements } from '@/features/plugins/runtime/semanticElements';
import type { SiteAdapter } from '@/features/plugins/types';
import { onCachedLanguageChange } from '@/utils/i18n';

import { isRendered } from '../export/adapter/chatgptThread';
import { type ReplyControl, type ReplyControlAction, createReplyControl } from './replyControl';

export const RESCAN_DELAY_MS = 300;
const MAX_CACHED_VERDICTS = 200;

export interface ReplyControlsDeps {
  readonly doc: Document;
  readonly adapter: SiteAdapter;
  readonly loadRecords: () => Promise<LocalPluginRecordMap>;
  /** Calls back on every import, update or removal of a local plugin. */
  readonly subscribeRecords: (callback: () => void) => () => void;
  readonly onAction: (action: ReplyControlAction, candidate: CreationCandidate) => void;
}

function queryAll(root: ParentNode, selector: string | undefined): Element[] {
  if (!selector) return [];
  try {
    return Array.from(root.querySelectorAll(selector));
  } catch {
    return [];
  }
}

const selector = (adapter: SiteAdapter, key: string, doc: Document): string | undefined =>
  pageSemanticSelector(adapter, key, doc) ?? adapter.selectors[key];

function replyBlocks(doc: Document, adapter: SiteAdapter): Element[] {
  const replies = queryAll(doc, selector(adapter, 'assistantTurn', doc));
  const inReply = (block: Element) => replies.some((reply) => reply.contains(block));
  const anchor = selector(adapter, 'codeBlock', doc);
  if (!anchor) return replies.flatMap((reply) => queryAll(reply, 'pre')).filter(isRendered);
  const blocks = resolveSemanticElements(doc, adapter, 'codeBlock') ?? queryAll(doc, anchor);
  return blocks.filter((block) => inReply(block) && isRendered(block));
}

function blockText(block: Element): string {
  return (block.querySelector('code') ?? block.querySelector('pre') ?? block).textContent ?? '';
}

export function startReplyControls(deps: ReplyControlsDeps): () => void {
  const { doc, adapter } = deps;
  const controls = new Map<Element, ReplyControl>();
  const hosts = new Set<Node>();
  const ids = new WeakMap<Element, string>();
  const verdicts = new Map<string, CreationVerdict>();
  let records: LocalPluginRecordMap | null = null;
  let rescan: ReturnType<typeof setTimeout> | undefined;
  let stopped = false;

  const remove = (block: Element): void => {
    const control = controls.get(block);
    if (control) {
      control.host.remove();
      hosts.delete(control.host);
    }
    controls.delete(block);
  };

  const classify = (text: string, installed: LocalPluginRecordMap): CreationVerdict => {
    const known = verdicts.get(text);
    if (known) return known;
    const verdict = classifyReplyBlock(text, installed);
    // A streaming reply passes through many partial texts; keep the cache small.
    if (verdicts.size >= MAX_CACHED_VERDICTS) verdicts.clear();
    verdicts.set(text, verdict);
    return verdict;
  };

  const candidates = (installed: LocalPluginRecordMap): Map<Element, CreationCandidate> => {
    const userTurns = queryAll(doc, selector(adapter, 'userTurn', doc));
    const isCreationChat = userTurns.some(
      (turn) => isCreationChatText(turn.textContent ?? '') && isRendered(turn),
    );
    if (!isCreationChat) return new Map();
    const found: { element: Element; block: CreationBlock }[] = [];
    for (const element of replyBlocks(doc, adapter)) {
      const text = blockText(element);
      const verdict = classify(text, installed);
      if (verdict.kind === 'none') continue;
      let id = ids.get(element);
      if (!id) {
        id = crypto.randomUUID();
        ids.set(element, id);
      }
      found.push({ element, block: { id, text, siteId: adapter.id, verdict } });
    }
    const marked = markLatestCandidates(found.map(({ block }) => block));
    return new Map(found.map(({ element }, index) => [element, marked[index]]));
  };

  const scan = (): void => {
    if (stopped || !records) return;
    const current = candidates(records);
    for (const [block, control] of Array.from(controls)) {
      if (!current.has(block) || !block.isConnected || control.host.previousSibling !== block)
        remove(block);
    }
    for (const [block, candidate] of current) {
      let control = controls.get(block);
      if (!control) {
        control = createReplyControl(doc, deps.onAction);
        hosts.add(control.host);
        block.after(control.host);
        controls.set(block, control);
      }
      control.show(candidate);
    }
  };

  const schedule = (): void => {
    clearTimeout(rescan);
    rescan = setTimeout(scan, RESCAN_DELAY_MS);
  };

  const ownNodes = (nodes: NodeList): boolean => Array.from(nodes).every((node) => hosts.has(node));
  const observer = new MutationObserver((mutations) => {
    // Adding or removing a control is a mutation too; only the host's own changes need a scan.
    if (
      mutations.every(
        (mutation) =>
          mutation.type === 'childList' &&
          ownNodes(mutation.addedNodes) &&
          ownNodes(mutation.removedNodes),
      )
    )
      return;
    schedule();
  });
  observer.observe(doc.body, { childList: true, subtree: true, characterData: true });

  const refresh = (): void => {
    void deps
      .loadRecords()
      .then((loaded) => {
        if (stopped) return;
        records = loaded;
        verdicts.clear();
        scan();
      })
      .catch(() => {});
  };
  const stopRecords = deps.subscribeRecords(refresh);
  const stopLanguage = onCachedLanguageChange(() =>
    controls.forEach((control) => control.relabel()),
  );
  refresh();

  return () => {
    if (stopped) return;
    stopped = true;
    // Observer and timer go before the controls, so no scan can bring one back.
    clearTimeout(rescan);
    observer.disconnect();
    stopRecords();
    stopLanguage();
    Array.from(controls.keys()).forEach(remove);
  };
}
