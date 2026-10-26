import shared from './shared-content.json';

/** The live operation chooses these once, before walking or cloning message content. */
export interface ExportCodeProfile {
  readonly blocks: string;
  readonly owner: string;
  readonly acceptedHosts?: ReadonlySet<Element>;
}

/** Historical serialization compatibility for hosts without their own code reader. */
export const DEFAULT_EXPORT_CODE_PROFILE: ExportCodeProfile = {
  blocks: shared['export.codeBlocks'],
  owner: shared['export.codeOwner'],
};

/** A broad alias may also match prose that the host proof deliberately left out. */
export function matchesExportCodeHost(
  element: Element,
  profile: ExportCodeProfile,
  ownerOnly = false,
): boolean {
  const selected = profile.acceptedHosts ? DEFAULT_EXPORT_CODE_PROFILE : profile;
  return (
    Boolean(profile.acceptedHosts?.has(element)) ||
    element.matches(ownerOnly ? selected.owner : selected.blocks)
  );
}

export function closestExportCodeHost(
  element: Element,
  profile: ExportCodeProfile,
  ownerOnly = false,
): HTMLElement | null {
  const selector = ownerOnly ? profile.owner : profile.blocks;
  if (!profile.acceptedHosts) return element.closest<HTMLElement>(selector);
  let candidate: Element | null = element;
  while (candidate && !matchesExportCodeHost(candidate, profile, ownerOnly)) {
    candidate = candidate.parentElement;
  }
  return candidate as HTMLElement | null;
}

export function firstExportCodeHost(root: Element, profile: ExportCodeProfile): HTMLElement | null {
  if (!profile.acceptedHosts) return root.querySelector<HTMLElement>(profile.blocks);
  return exportCodeHosts(root, profile)[0] ?? null;
}

/** Structural aliases may stop matching after clone stripping; original identity still wins. */
export function exportCodeHosts(root: Element, profile: ExportCodeProfile): HTMLElement[] {
  if (!profile.acceptedHosts) return Array.from(root.querySelectorAll<HTMLElement>(profile.blocks));
  const hosts = new Set([
    ...root.querySelectorAll<HTMLElement>(DEFAULT_EXPORT_CODE_PROFILE.blocks),
    ...Array.from(profile.acceptedHosts).filter(
      (host): host is HTMLElement =>
        host instanceof HTMLElement && host !== root && root.contains(host),
    ),
  ]);
  return Array.from(hosts).sort((left, right) =>
    left.compareDocumentPosition(right) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1,
  );
}

/** Carry live proof to the corresponding clone before export stripping changes its descendants. */
export function cloneExportCodeProfile(
  live: Element,
  clone: Element,
  profile: ExportCodeProfile,
): ExportCodeProfile {
  const acceptedHosts = profile.acceptedHosts;
  if (!acceptedHosts) return profile;
  const liveElements = Array.from(live.querySelectorAll('*'));
  const clones = Array.from(clone.querySelectorAll('*'));
  return {
    ...profile,
    acceptedHosts: new Set(
      clones.filter((_element, index) => acceptedHosts.has(liveElements[index])),
    ),
  };
}
