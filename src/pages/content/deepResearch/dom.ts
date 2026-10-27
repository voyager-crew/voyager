import { hasVoyagerOwner } from '@/core/gemini/composer/ownedInput';
import { preservesGeminiContentFrames } from '@/core/gemini/content/reads';
import {
  getBundledGeminiSelectorView,
  getGeminiSelectorView,
  type GeminiSelectorView,
} from '@/core/gemini/selectors';
import { acceptsGeminiTurnView, readGeminiTurnCollection } from '@/core/gemini/turnIntegrity';
import { isOriginalGeminiTranscriptElement } from '@/core/gemini/turnOwnership';
import { preservesCompleteContent } from '@/core/selectors/contentIntegrity';
import { shouldSkipElement } from '@/features/export/services/exportDomPolicy';
import packaged from '@/features/plugins/catalog/sites/gemini/selector-data/deep-research-packaged.json';

const KEYS = [
  'deepResearch.panel',
  'deepResearch.items',
  'deepResearch.thinkingPanels',
  'deepResearch.reportCandidates',
] as const;

function selector(view: GeminiSelectorView, key: (typeof KEYS)[number]): string {
  return view.profiles[key].join(',');
}

function currentReplyOwns(panel: HTMLElement, view: GeminiSelectorView): boolean {
  if (!acceptsGeminiTurnView(view, panel.ownerDocument)) return false;
  const replies = readGeminiTurnCollection(view, panel.ownerDocument, false).assistants;
  const reply = replies.filter(isOriginalGeminiTranscriptElement).at(-1);
  if (!reply || !isOriginalGeminiTranscriptElement(panel) || panel.closest('user-query'))
    return false;
  if (reply.contains(panel)) return true;
  const labelledBy = panel.getAttribute('aria-labelledby')?.split(/\s+/) ?? [];
  if (
    labelledBy.some((id) => {
      const node = panel.ownerDocument.getElementById(id);
      return node && reply.contains(node);
    })
  )
    return true;
  return (
    !!panel.id &&
    Array.from(reply.querySelectorAll('[aria-controls]')).some((node) =>
      node.getAttribute('aria-controls')?.split(/\s+/).includes(panel.id),
    )
  );
}

function protocolLinks(panel: HTMLElement): HTMLAnchorElement[] {
  return Array.from(
    panel.querySelectorAll<HTMLAnchorElement>(packaged['deepResearch.browseLinks']),
  ).filter((link) => {
    try {
      const url = new URL(link.href);
      return (
        /^(http|https):$/.test(url.protocol) &&
        !!link.querySelector(packaged['deepResearch.browseDomain'])?.textContent?.trim()
      );
    } catch {
      return false;
    }
  });
}

/** Resolve the entire research read before serializing any report or thinking item. */
export function deepResearchView(): GeminiSelectorView {
  const view = getGeminiSelectorView();
  if (!KEYS.some((key) => view.remoteKeys.has(key))) return getBundledGeminiSelectorView();
  const fallback = getBundledGeminiSelectorView();
  const panels = Array.from(
    document.querySelectorAll<HTMLElement>(selector(view, 'deepResearch.panel')),
  );
  if (panels.length !== 1) return fallback;
  const panel = panels[0];
  const originalPanel = document.querySelector(packaged['deepResearch.panel']);
  if (originalPanel && originalPanel !== panel) return fallback;
  const links = protocolLinks(panel);
  // A heading or a long answer is not research: native browse provenance must belong to the current reply.
  if (!currentReplyOwns(panel, view) || !links.length) return fallback;
  const witnessSelector = `${packaged['deepResearch.thought']}, ${packaged['deepResearch.browseList']}`;
  const allWitnesses = Array.from(panel.querySelectorAll(witnessSelector));
  const nativeThinking = Array.from(
    panel.querySelectorAll(packaged['deepResearch.thinkingPanels']),
  );
  const thinking = Array.from(
    panel.querySelectorAll<HTMLElement>(selector(view, 'deepResearch.thinkingPanels')),
  );
  if (
    !thinking.length ||
    thinking.some(
      (node) => hasVoyagerOwner(node) || !allWitnesses.some((witness) => node.contains(witness)),
    ) ||
    !allWitnesses.every(
      (witness) => thinking.filter((node) => node.contains(witness)).length === 1,
    ) ||
    thinking.some(
      (section) => nativeThinking.filter((native) => section.contains(native)).length > 1,
    )
  )
    return fallback;
  for (const section of thinking) {
    const items = Array.from(
      section.querySelectorAll<HTMLElement>(selector(view, 'deepResearch.items')),
    );
    const witnesses = Array.from(section.querySelectorAll(witnessSelector));
    if (
      !items.length ||
      items.some(
        (item) =>
          hasVoyagerOwner(item) ||
          !witnesses.some((node) => item.contains(node)) ||
          item.querySelectorAll(packaged['deepResearch.thought']).length > 1 ||
          item.querySelectorAll(packaged['deepResearch.browseList']).length > 1,
      ) ||
      !witnesses.every((node) => items.filter((item) => item.contains(node)).length === 1)
    )
      return fallback;
  }
  if (view.remoteKeys.has('deepResearch.reportCandidates')) {
    const candidates = Array.from(
      panel.querySelectorAll<HTMLElement>(selector(view, 'deepResearch.reportCandidates')),
    ).filter((node) => !thinking.some((section) => section.contains(node)));
    const original = Array.from(
      panel.querySelectorAll<HTMLElement>(packaged['deepResearch.reportCandidates'].join(',')),
    ).filter((node) => !thinking.some((section) => section.contains(node)));
    if (
      !candidates.length ||
      candidates.some(
        (node) => hasVoyagerOwner(node) || thinking.some((section) => node.contains(section)),
      )
    )
      return fallback;
    if (
      original.length
        ? original.length !== candidates.length ||
          original.some((node) => !candidates.includes(node))
        : !candidates.every(
            (node) =>
              !!node.querySelector('h1, h2, [role="heading"]') &&
              preservesGeminiContentFrames(node, panel) &&
              preservesCompleteContent(
                node,
                panel,
                (element) =>
                  thinking.includes(element as HTMLElement) || shouldSkipElement(element),
              ),
          )
    )
      return fallback;
  }
  return view;
}

export function findDeepResearchPanel(view = deepResearchView()): HTMLElement | null {
  return document.querySelector<HTMLElement>(selector(view, 'deepResearch.panel'));
}

export function researchSelector(view: GeminiSelectorView, key: (typeof KEYS)[number]): string {
  return selector(view, key);
}
