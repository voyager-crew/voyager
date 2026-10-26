/**
 * DOM extraction module for Deep Research thinking content
 */
import { readGeminiActiveSidebarTitle } from '@/core/gemini/sidebarTitles';

import type { BrowseChip, ThinkingContent, ThinkingItem, ThinkingSection } from './types';

/**
 * Extract a single thought item (header + content)
 * Returns simplified object without type field (will be added by caller)
 */
function extractThoughtItem(thoughtElement: Element): { header: string; content: string } | null {
  try {
    const headerEl = thoughtElement.querySelector('.thought-header');
    // Select the content div that has gds-body-m and gds-italic but is NOT the header
    const contentEl = thoughtElement.querySelector('.gds-body-m.gds-italic:not(.thought-header)');

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
    console.error('[Gemini Voyager] Error extracting thought item:', error);
    return null;
  }
}

/**
 * Extract browse chips (website links) from a browse-chip-list
 */
function extractBrowseChips(browseListElement: Element): BrowseChip[] {
  try {
    const chips: BrowseChip[] = [];
    const chipElements = browseListElement.querySelectorAll(
      'browse-web-chip a[data-test-id="browse-chip-link"]',
    );

    chipElements.forEach((chipEl) => {
      try {
        const url = chipEl.getAttribute('href') || '';
        const domainEl = chipEl.querySelector('[data-test-id="domain-name"]');
        const titleEl = chipEl.querySelector('[data-test-id="title"]');

        const domain = domainEl?.textContent?.trim() || '';
        const title = titleEl?.textContent?.trim() || '';

        if (url && domain) {
          chips.push({ url, domain, title });
        }
      } catch (error) {
        console.error('[Gemini Voyager] Error extracting browse chip:', error);
      }
    });

    return chips;
  } catch (error) {
    console.error('[Gemini Voyager] Error extracting browse chips:', error);
    return [];
  }
}

/**
 * Extract a single thinking section (thoughts + browse chips in order)
 */
function extractThinkingSection(panelElement: Element): ThinkingSection | null {
  try {
    const items: ThinkingItem[] = [];

    // Get all item-container elements in order
    const itemContainers = panelElement.querySelectorAll('.item-container');

    itemContainers.forEach((container) => {
      // Check if this container has a thought-item
      const thoughtEl = container.querySelector('thought-item');
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
      const browseListEl = container.querySelector('browse-chip-list');
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
    console.error('[Gemini Voyager] Error extracting thinking section:', error);
    return null;
  }
}

/**
 * Extract all thinking panels from the Deep Research conversation
 */
export function extractThinkingPanels(): ThinkingContent | null {
  try {
    // Check if we're in a Deep Research conversation
    const deepResearchPanel = document.querySelector('deep-research-immersive-panel');
    if (!deepResearchPanel) {
      console.log('[Gemini Voyager] Not a Deep Research conversation');
      return null;
    }

    const sections: ThinkingSection[] = [];

    // Find all thinking-panel elements
    const thinkingPanels = deepResearchPanel.querySelectorAll('thinking-panel');

    thinkingPanels.forEach((panel) => {
      const section = extractThinkingSection(panel);
      if (section) {
        sections.push(section);
      }
    });

    if (sections.length === 0) {
      console.log('[Gemini Voyager] No thinking content found');
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
    console.error('[Gemini Voyager] Error extracting thinking panels:', error);
    return null;
  }
}

/**
 * Get conversation title from the page
 */
function getConversationTitle(): string {
  try {
    // Strategy 1: Get from page title
    const titleElement = document.querySelector('title');
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
    console.error('[Gemini Voyager] Error getting conversation title:', error);
  }

  return 'Deep Research Conversation';
}
