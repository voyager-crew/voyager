import { queryOutsideThoughts } from '@/features/export/services/exportDomPolicy';

import { readConfiguredExportUserSelector } from '../../configuredUserSelector';
import profile from './generic-profile.json';

export function genericUserTurnSelectors(): string[] {
  const configured = readConfiguredExportUserSelector();
  return configured
    ? [configured, ...profile.userTurns.filter((selector) => selector !== configured)]
    : [...profile.userTurns];
}

export function genericAssistantTurnSelectors(): string[] {
  return [...profile.assistantTurns];
}

export function resolveGenericConversationRoot(
  userSelectors: string[],
  doc: Document = document,
): HTMLElement {
  let first: HTMLElement | null = null;
  for (const selector of profile.roots) {
    const candidate = doc.querySelector<HTMLElement>(selector);
    if (!candidate) continue;
    first ??= candidate;
    if (
      userSelectors.length &&
      Array.from(candidate.querySelectorAll(userSelectors.join(','))).some(
        (node) => !node.closest('deep-research-immersive-panel'),
      )
    )
      return candidate;
  }
  return first ?? doc.body;
}

/** Preserve the original collector's preference before shared rich-content serialization. */
export function pickGenericAssistantExportElement(host: HTMLElement): HTMLElement {
  return (
    queryOutsideThoughts<HTMLElement>(host, profile.assistantElements[0]) ||
    queryOutsideThoughts<HTMLElement>(host, profile.assistantElements[1]) ||
    host.closest<HTMLElement>('.presented-response-container') ||
    queryOutsideThoughts<HTMLElement>(host, profile.assistantElements[2]) ||
    queryOutsideThoughts<HTMLElement>(host, profile.assistantElements[3]) ||
    host
  );
}
