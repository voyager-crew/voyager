import { filterTopLevel, sameItems } from '@/core/utils/array';
import { shouldSkipElement } from '@/features/export/services/exportDomPolicy';

import { preservesGeminiContentFrames } from './content/reads';
import { getBundledGeminiSelectorView } from './selectors/bundle';
import type { GeminiTurnProfileKey, GeminiTurnView } from './selectors/types';

export interface GeminiTurnCollection {
  readonly root: HTMLElement;
  readonly users: readonly HTMLElement[];
  readonly assistants: readonly HTMLElement[];
}

const EXCLUDED =
  'deep-research-immersive-panel, model-thoughts, .thoughts-container, .thoughts-content';

function before(left: Node, right: Node): boolean {
  const position = left.compareDocumentPosition(right);
  return (
    !(position & Node.DOCUMENT_POSITION_DISCONNECTED) &&
    !!(position & Node.DOCUMENT_POSITION_FOLLOWING)
  );
}

function ordered(nodes: readonly HTMLElement[]): boolean {
  return nodes.every((node, index) => index === 0 || before(nodes[index - 1], node));
}

function hasContent(host: Node, excluded: readonly Node[] = []): boolean {
  if (excluded.includes(host)) return false;
  if (host instanceof Element) {
    // Timestamp labels are Voyager UI beside the prompt, not an omitted native content leaf.
    if (
      shouldSkipElement(host) ||
      host.matches(`${EXCLUDED}, message-actions, .message-actions, .gv-timestamp`)
    )
      return false;
    if (host.matches('img, canvas, svg, math')) return true;
  }
  if (host.nodeType === Node.TEXT_NODE && host.textContent?.trim()) return true;
  return Array.from(host.childNodes).some((child) => hasContent(child, excluded));
}

/** One gate for remote turn readers: preserve the complete bundle or prove native ownership. */
export function acceptsGeminiTurnCollection(
  candidate: GeminiTurnCollection,
  bundled: GeminiTurnCollection,
): boolean {
  if (
    candidate.root !== bundled.root ||
    !ordered(candidate.users) ||
    !ordered(candidate.assistants)
  )
    return false;
  if (
    sameItems(candidate.users, bundled.users) &&
    sameItems(candidate.assistants, bundled.assistants)
  )
    return true;
  if (candidate.users.length === 0) return false;
  if (bundled.users.length > 0 && !sameItems(candidate.users, bundled.users)) return false;
  if (bundled.assistants.length > 0 && !sameItems(candidate.assistants, bundled.assistants))
    return false;
  const containers = filterTopLevel(
    Array.from(candidate.root.querySelectorAll<HTMLElement>('.conversation-container')).filter(
      (container) => !container.closest(EXCLUDED),
    ),
  ).filter((container) => hasContent(container));
  const users = filterTopLevel([...candidate.users]);
  const assistants = filterTopLevel([...candidate.assistants]);
  const paired: HTMLElement[] = [];
  const owners: HTMLElement[] = [];
  for (const [index, user] of users.entries()) {
    const owner = user.closest<HTMLElement>('.conversation-container');
    if (!owner || owner === user || !candidate.root.contains(owner) || !hasContent(user))
      return false;
    if (!preservesGeminiContentFrames(user, owner)) return false;
    owners.push(owner);
    const next = users[index + 1];
    const assistant = assistants.find(
      (node) => before(user, node) && (!next || before(node, next)),
    );
    if (assistant) {
      // Gemini mounts an empty native response while pending or cancelled; the bundle already proves that host.
      if (
        assistant.closest('.conversation-container') !== owner ||
        (!hasContent(assistant) && !bundled.assistants.includes(assistant))
      )
        return false;
      if (!preservesGeminiContentFrames(assistant, owner)) return false;
      if (hasContent(owner, [user, assistant])) return false;
      paired.push(assistant);
    } else if (index !== users.length - 1 || hasContent(owner, [user])) return false;
  }
  // A nonempty partial/reordered list must never assign another turn's ID before fallback.
  return sameItems(owners, containers) && sameItems(paired, assistants);
}

function readMatches(
  root: HTMLElement,
  selectors: readonly string[],
  hosts = false,
): HTMLElement[] {
  const nodes = Array.from(
    new Set(
      hosts
        ? Array.from(root.querySelectorAll<HTMLElement>(selectors.join(',')))
        : selectors.flatMap((selector) => Array.from(root.querySelectorAll<HTMLElement>(selector))),
    ),
  ).filter((node) => !node.closest(EXCLUDED));
  return hosts ? nodes : filterTopLevel(nodes);
}

function readCollection(
  view: GeminiTurnView,
  doc: Document,
  hosts: boolean,
  userSelectors?: readonly string[],
): GeminiTurnCollection {
  const users = userSelectors ?? view.profiles[hosts ? 'turn.userWithHosts' : 'turn.user'];
  const root = doc.body;
  const specific = readMatches(
    root,
    view.profiles[hosts ? 'turn.assistantWithHosts' : 'turn.assistant'],
    hosts,
  );
  return {
    root,
    users: readMatches(root, users, hosts),
    assistants:
      specific.length || hosts
        ? specific
        : readMatches(root, view.profiles['turn.assistantFallback']),
  };
}

/** All turn operations share this preflight; the bundled path performs no extra DOM reads. */
export function acceptsGeminiTurnView(
  view: GeminiTurnView,
  doc: Document = document,
  userSelectors?: readonly string[],
): boolean {
  const changed = (key: GeminiTurnProfileKey) => view.remoteKeys.has(key);
  const primary = (['turn.user', 'turn.assistant', 'turn.assistantFallback'] as const).some(
    changed,
  );
  const hosts = (['turn.userWithHosts', 'turn.assistantWithHosts'] as const).some(changed);
  if (!primary && !hosts) return true;
  const bundle = getBundledGeminiSelectorView();
  try {
    if (
      primary &&
      !acceptsGeminiTurnCollection(
        readCollection(view, doc, false, userSelectors),
        readCollection(bundle, doc, false),
      )
    )
      return false;
    return (
      !hosts ||
      acceptsGeminiTurnCollection(
        readCollection(view, doc, true),
        readCollection(bundle, doc, true),
      )
    );
  } catch {
    return false;
  }
}
