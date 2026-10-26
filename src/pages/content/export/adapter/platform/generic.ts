import type { SiteAdapter } from '@/features/plugins/types';

import { createCanvasContent } from '../../canvasContent';
import type { ExportPlatformAdapter } from './contract';
import profile from './generic-profile.json';
import {
  genericAssistantTurnSelectors,
  genericUserTurnSelectors,
  resolveGenericConversationRoot,
  pickGenericAssistantExportElement,
} from './genericDom';
import { extractGenericConversationId, extractGenericConversationTitle } from './genericTitle';
import { createImageContent } from './imageContent';
import {
  extractUserText,
  extractFormula,
  extractCodeBlock,
  extractInlineFormula,
} from './sharedContent';

// This is a compatibility reader, never a registered site or an online catalog target.
const site: SiteAdapter = {
  id: 'generic',
  // Preserve the historical platform printed by unknown-host exports.
  label: 'Gemini',
  matches: [],
  selectors: {},
  theme: {
    hostSelector: ':root',
    lightSelector: '[data-gv-scheme="light"]',
    darkSelector: '[data-gv-scheme="dark"]',
  },
  capabilities: new Set(['chat']),
};
const images = createImageContent(profile.images);
const canvas = createCanvasContent(profile.canvas, (doc) =>
  doc.querySelector<HTMLElement>(profile.canvas['canvas.codePanels'].join(', ')),
);

export function buildGenericExportAdapter(): ExportPlatformAdapter {
  return {
    site,
    siteId: site.id,
    getUserSelectors: genericUserTurnSelectors,
    getAssistantSelectors: genericAssistantTurnSelectors,
    extractConversationTitle: extractGenericConversationTitle,
    extractConversationIdFromUrl: extractGenericConversationId,
    resolveConversationRoot: resolveGenericConversationRoot,
    selectAssistantExportElement: pickGenericAssistantExportElement,
    canvas,
    extractUserImage: (element) => element.querySelectorAll(profile.userImages),
    getUserAttachmentCandidates: (element) => {
      const uploaded = Array.from(element.querySelectorAll<HTMLElement>(profile.uploadedFiles));
      if (uploaded.length) return uploaded;
      const previews = Array.from(element.querySelectorAll<HTMLElement>(profile.filePreviews));
      return previews.length ? previews : undefined;
    },
    extractUserText,
    extractAssistantImage: images.extractAssistantImage,
    collectAssistantImages: images.collectAssistantImages,
    extractFormula,
    extractCodeBlock,
    extractInlineFormula,
  };
}
