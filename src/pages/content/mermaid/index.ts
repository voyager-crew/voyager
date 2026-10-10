import { logger } from '@/core/services/LoggerService';

import { createStyles, renderMermaid } from './codeBlock';
import { MermaidRenderer } from './renderer';
import { shouldRenderMermaid } from './source';

const renderer = new MermaidRenderer();

/**
 * Get the language label from a code block's header decoration
 * Returns the language name (lowercase) or null if not found
 */
const getCodeBlockLanguage = (codeEl: Element): string | null => {
  // Navigate up to find the code-block container
  const codeBlock = codeEl.closest('.code-block, code-block');
  if (!codeBlock) return null;

  // Look for the language label in the header decoration
  // Gemini uses: <div class="code-block-decoration"><span>Language</span>...</div>
  const decoration = codeBlock.querySelector('.code-block-decoration');
  if (!decoration) return null;

  // The first span child typically contains the language name
  const langSpan = decoration.querySelector(':scope > span');
  if (!langSpan) return null;

  const language = langSpan.textContent?.trim().toLowerCase();
  return language || null;
};

/**
 * Find and process code blocks
 */
const processCodeBlocks = () => {
  const codeElements = document.querySelectorAll('code[data-test-id="code-content"]');

  codeElements.forEach((codeEl) => {
    const codeText = codeEl.textContent || '';

    // Check the language label from Gemini's code block header
    const language = getCodeBlockLanguage(codeEl);

    if (shouldRenderMermaid(language, codeText)) {
      renderMermaid(codeEl as HTMLElement, codeText, renderer);
    }
  });
};

/**
 * Track whether Mermaid is enabled
 */
let mermaidEnabled = true;
let observer: MutationObserver | null = null;

/**
 * Start Mermaid feature
 */
export const startMermaid = () => {
  // Check if Mermaid rendering is enabled in settings
  chrome.storage?.sync?.get({ gvMermaidEnabled: true }, (result) => {
    mermaidEnabled = result?.gvMermaidEnabled !== false;

    if (mermaidEnabled) {
      initializeMermaid();
    } else {
      logger.info('[Gemini Voyager] Mermaid rendering is disabled');
    }
  });

  // Listen for setting changes
  chrome.storage?.onChanged?.addListener((changes, areaName) => {
    if (areaName === 'sync' && changes.gvMermaidEnabled) {
      mermaidEnabled = changes.gvMermaidEnabled.newValue !== false;
      if (mermaidEnabled) {
        initializeMermaid();
        logger.info('[Gemini Voyager] Mermaid rendering enabled');
      } else {
        // Stop observing when disabled
        if (observer) {
          observer.disconnect();
          observer = null;
        }
        logger.info('[Gemini Voyager] Mermaid rendering disabled');
      }
    }
  });
};

/**
 * Initialize Mermaid rendering
 */
const initializeMermaid = async () => {
  createStyles();

  const loaded = await renderer.initialize();
  if (!loaded) {
    console.warn('[Gemini Voyager] Mermaid library failed to load, diagrams will show as code');
    return;
  }

  processCodeBlocks();

  // Only create observer if not already exists
  if (!observer) {
    let timeout: ReturnType<typeof setTimeout>;
    const debouncedProcess = () => {
      if (!mermaidEnabled) return;
      clearTimeout(timeout);
      timeout = setTimeout(processCodeBlocks, 1000);
    };

    observer = new MutationObserver(() => {
      debouncedProcess();
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true,
      characterData: true,
    });
  }

  logger.info('[Gemini Voyager] Mermaid integration started');
};
