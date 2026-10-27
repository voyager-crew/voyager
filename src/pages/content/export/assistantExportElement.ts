import { queryOutsideThoughts } from '@/features/export/services/exportDomPolicy';

interface AssistantExportProfile {
  readonly content: string;
  readonly markdown: string;
  readonly presentedAncestor: string;
  readonly presentedContent: string;
  readonly responseElement: string;
}

/** Preserve the collector's ordered preferences while each dialect owns its locator data. */
export function readAssistantExportElement(
  host: HTMLElement,
  profile: AssistantExportProfile,
): HTMLElement {
  return (
    queryOutsideThoughts<HTMLElement>(host, profile.content) ||
    queryOutsideThoughts<HTMLElement>(host, profile.markdown) ||
    host.closest<HTMLElement>(profile.presentedAncestor) ||
    queryOutsideThoughts<HTMLElement>(host, profile.presentedContent) ||
    queryOutsideThoughts<HTMLElement>(host, profile.responseElement) ||
    host
  );
}
