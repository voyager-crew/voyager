import type { ExtractedContent } from './DOMContentExtractor';

export type ExtractedContentFlags = Pick<
  ExtractedContent,
  'hasImages' | 'hasFormulas' | 'hasTables' | 'hasCode'
>;

/**
 * Host-specific rules the shared content extractor applies while it walks a
 * message. A hook that returns true has consumed the element.
 */
export interface ExportContentDialect {
  readonly siteId?: string;
  resolveAssistantContent?: (element: HTMLElement) => HTMLElement;
  getUserTextLines?: (element: HTMLElement) => NodeListOf<HTMLElement>;
  extractUserImage: (element: HTMLElement) => NodeListOf<HTMLImageElement>;
  extractUserText: (
    textLines: NodeListOf<HTMLElement>,
    textParts: string[],
    element: HTMLElement,
  ) => void;
  getUserAttachmentCandidates: (element: HTMLElement) => HTMLElement[] | undefined;
  extractAssistantImage: (
    child: Element,
    htmlParts: string[],
    textParts: string[],
    flags: ExtractedContentFlags,
    tagName?: string,
    DEBUG?: boolean,
    processedImageSrcs?: Set<string>,
  ) => boolean | undefined;
  /**
   * Images rendered beside the markdown walk (search / generated attachments).
   * Deduped via `processedImageSrcs`. Hosts inside `skipInside` were already
   * visited in DOM order and must not be appended again.
   */
  collectAssistantImages?: (
    root: Element,
    htmlParts: string[],
    textParts: string[],
    flags: ExtractedContentFlags,
    processedImageSrcs?: Set<string>,
    skipInside?: Element | null,
  ) => void;
  extractFormula: (
    child: Element,
    flags: ExtractedContentFlags,
    htmlParts: string[],
    textParts: string[],
    DEBUG: boolean,
  ) => boolean | undefined;
  extractCodeBlock: (
    child: Element,
    htmlParts: string[],
    textParts: string[],
    flags: ExtractedContentFlags,
    tagName?: string,
    DEBUG?: boolean,
  ) => boolean | undefined;
  extractInlineFormula: (
    el: Element,
    htmlParts: string[],
    textParts: string[],
  ) => boolean | undefined;
}
