/**
 * DOM extraction module for Deep Research thinking content
 */

import { readGeminiActiveSidebarTitle } from '@/core/gemini/sidebarTitles';
import { logger } from '@/core/services/LoggerService';
import packaged from '@/features/plugins/catalog/sites/gemini/selector-data/deep-research-packaged.json';

import type { BrowseChip, ThinkingContent, ThinkingItem, ThinkingSection } from './types';

/**
 * Extract a single thought item (header + content)
 * Returns simplified object without type field (will be added by caller)
 */
function extractThoughtItem(thoughtElement: Element): { header: string; content: string } | null {
  try {
    const headerEl = thoughtElement.querySelector(packaged['deepResearch.thoughtHeader']);
    // Select the content div that has gds-body-m and gds-italic but is NOT the header
    const contentEl = thoughtElement.querySelector(packaged['deepResearch.thoughtContent']);

    if (!headerEl || !contentEl) {
      return null;
    }

    const header = headerEl.textContent?.trim() || '';
    const content = contentEl.textContent?.trim() || '';

    if (!header && !content) {
      return null;
    }

    return { header, content };
  } catch (error) {
    logger.error('Error extracting Deep Research thought item', { error });
    return null;
  }
}

/**
 * Extract browse chips (website links) from a browse-chip-list
 */
function extractBrowseChips(browseListElement: Element): BrowseChip[] {
  try {
    const chips: BrowseChip[] = [];
    const chipElements = browseListElement.querySelectorAll(packaged['deepResearch.browseLinks']);

    chipElements.forEach((chipEl) => {
      try {
        const url = chipEl.getAttribute('href') || '';
        const domainEl = chipEl.querySelector(packaged['deepResearch.browseDomain']);
        const titleEl = chipEl.querySelector(packaged['deepResearch.browseTitle']);

        const domain = domainEl?.textContent?.trim() || '';
        const title = titleEl?.textContent?.trim() || '';

        if (url && domain) {
          chips.push({ url, domain, title });
        }
      } catch (error) {
        logger.error('Error extracting Deep Research browse chip', { error });
      }
    });

    return chips;
  } catch (error) {
    logger.error('Error extracting Deep Research browse chips', { error });
    return [];
  }
}

/**
 * Extract a single thinking section (thoughts + browse chips in order)
 */
function extractThinkingSection(panelElement: Element): ThinkingSection | null {
  try {
    const items: ThinkingItem[] = [];
    const itemContainers = panelElement.querySelectorAll(packaged['deepResearch.items'].join(','));

    itemContainers.forEach((container) => {
      // Check if this container has a thought-item
      const thoughtEl = container.querySelector(packaged['deepResearch.thought']);
      if (thoughtEl) {
        const thought = extractThoughtItem(thoughtEl);
        if (thought) {
          items.push({
            type: 'thought',
            header: thought.header,
            content: thought.content,
          });
        }
      }

      // Check if this container has a browse-chip-list
      const browseListEl = container.querySelector(packaged['deepResearch.browseList']);
      if (browseListEl) {
        const chips = extractBrowseChips(browseListEl);
        if (chips.length > 0) {
          items.push({
            type: 'browse-chips',
            chips,
          });
        }
      }
    });

    // Only return if we have content
    if (items.length === 0) {
      return null;
    }

    return { items };
  } catch (error) {
    logger.error('Error extracting Deep Research thinking section', { error });
    return null;
  }
}

/**
 * Extract all thinking panels from the Deep Research conversation
 */
export function extractThinkingPanels(): ThinkingContent | null {
  try {
    // Check if we're in a Deep Research conversation
    const deepResearchPanel = document.querySelector(packaged['deepResearch.panel']);
    if (!deepResearchPanel) {
      logger.debug('Not a Deep Research conversation');
      return null;
    }

    const sections: ThinkingSection[] = [];

    // Find all thinking-panel elements
    const thinkingPanels = deepResearchPanel.querySelectorAll(
      packaged['deepResearch.thinkingPanels'],
    );

    thinkingPanels.forEach((panel) => {
      const section = extractThinkingSection(panel);
      if (section) {
        sections.push(section);
      }
    });

    if (sections.length === 0) {
      logger.debug('No Deep Research thinking content found');
      return null;
    }

    // Try to get conversation title
    const title = getConversationTitle();

    return {
      sections,
      exportedAt: new Date().toISOString(),
      title,
    };
  } catch (error) {
    logger.error('Error extracting Deep Research thinking panels', { error });
    return null;
  }
}

/**
 * Get conversation title from the page
 */
function getConversationTitle(): string {
  try {
    // Strategy 1: Get from page title
    const titleElement = document.querySelector(packaged['deepResearch.documentTitle']);
    if (titleElement) {
      const title = titleElement.textContent?.trim();
      if (
        title &&
        title !== 'Gemini' &&
        title !== 'Google Gemini' &&
        !title.startsWith('Gemini -') &&
        title.length > 0
      ) {
        return title;
      }
    }

    // Strategy 2: Try to get from sidebar
    const sidebarTitle = readGeminiActiveSidebarTitle(
      'activeResearch',
      (title) => title.length > 0 && title !== 'New chat',
    );
    if (sidebarTitle) return sidebarTitle;
  } catch (error) {
    logger.error('Error getting Deep Research conversation title', { error });
  }

  return 'Deep Research Conversation';
}
