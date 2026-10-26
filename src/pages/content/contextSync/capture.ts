import { acceptsGeminiContextImages, readGeminiContextImages } from '@/core/gemini/content/reads';
import { getBundledGeminiSelectorView, getGeminiSelectorView } from '@/core/gemini/selectors';
import { locatorSiteForHost } from '@/core/selectors/sites';
import { logger } from '@/core/services/LoggerService';
import { getMatchedAdapter } from '@/features/contextSync/adapters';
import { DialogNode } from '@/features/contextSync/types';

import { getBrowserName } from '../../../core/utils/browser';

interface PreparedContextNode {
  readonly element: HTMLElement;
  readonly clone: HTMLElement;
  readonly role: 'user' | 'assistant';
}

export class ContextCaptureService {
  private static instance: ContextCaptureService;

  private constructor() {}

  static getInstance(): ContextCaptureService {
    if (!this.instance) {
      this.instance = new ContextCaptureService();
    }
    return this.instance;
  }

  async captureDialogue(): Promise<DialogNode[]> {
    const host = window.location.hostname;
    const adapter = getMatchedAdapter(host);
    const messages: DialogNode[] = [];

    let queries: HTMLElement[] = [];
    let responses: HTMLElement[] = [];

    if (adapter.user_selector && adapter.ai_selector) {
      queries = adapter.user_selector
        ? (Array.from(document.querySelectorAll(adapter.user_selector.join(','))) as HTMLElement[])
        : [];
      responses = adapter.ai_selector
        ? (Array.from(document.querySelectorAll(adapter.ai_selector.join(','))) as HTMLElement[])
        : [];
    }

    logger.debug(
      `[ContextSync] Found ${queries.length} queries and ${responses.length} responses.`,
    );

    const ordered = Array.from(
      { length: Math.max(queries.length, responses.length) },
      (_, index) => [
        ...(queries[index] ? [{ element: queries[index], role: 'user' as const }] : []),
        ...(responses[index] ? [{ element: responses[index], role: 'assistant' as const }] : []),
      ],
    ).flat();
    const collect = () =>
      ordered.flatMap(({ element, role }) => {
        const prepared = this.prepareNode(element, role);
        return prepared ? [prepared] : [];
      });
    const bundle = getBundledGeminiSelectorView();
    let view = locatorSiteForHost(host) === 'gemini' ? getGeminiSelectorView() : bundle;
    if (!view.remoteKeys.has('context.images')) {
      // OFF retains the original per-message prepare/await ordering.
      for (const { element, role } of ordered) {
        const node = this.prepareNode(element, role);
        if (!node) continue;
        const info = await this.extractNodeInfo({
          ...node,
          images: readGeminiContextImages(node.clone, bundle),
        });
        if (info) messages.push(info);
      }
      return messages;
    }
    let prepared = collect();
    // No image request starts until every message agrees with the same captured profile.
    if (
      view.remoteKeys.has('context.images') &&
      !prepared.every(({ clone }) => acceptsGeminiContextImages(clone, view))
    ) {
      view = bundle;
      prepared = collect();
    }
    const captures = prepared.map((node) => ({
      ...node,
      images: readGeminiContextImages(node.clone, view),
    }));
    for (const node of captures) {
      const info = await this.extractNodeInfo(node);
      if (info) messages.push(info);
    }

    return messages;
  }

  private static async getBase64Safe(url: string): Promise<string | null> {
    if (!url || url === 'about:blank') return null;

    // If it's a blob URL, it's already a high-res/processed image in the page context
    if (url.startsWith('blob:')) {
      try {
        const resp = await fetch(url);
        const blob = await resp.blob();
        return new Promise((resolve) => {
          const reader = new FileReader();
          reader.onloadend = () => resolve(reader.result as string);
          reader.onerror = () => {
            logger.error('[ContextSync] FileReader error for blob');
            resolve(null);
          };
          reader.readAsDataURL(blob);
        });
      } catch (e) {
        logger.error('[ContextSync] Failed to fetch blob URL:', { error: e });
        return null;
      }
    }

    // Determine the "best" URL to fetch.
    // For Google images, try to request the original size (=s0).
    let targetUrl = url;
    const isGoogleImage = url.includes('googleusercontent.com') || url.includes('ggpht.com');

    if (isGoogleImage) {
      // 1. Convert rd-gg to rd-gg-dl for better access to original resolution.
      // NOTE: We only do this for Chrome-based browsers.
      // Firefox handles rd-gg-dl poorly (NetworkError/CORS), so it stays on rd-gg.
      const isFirefox = getBrowserName().includes('Firefox');
      if (!isFirefox && targetUrl.includes('/rd-gg/')) {
        targetUrl = targetUrl.replace('/rd-gg/', '/rd-gg-dl/');
      }

      // 2. Request original size (=s0).
      // This is a known Google image parameter for full resolution.
      if (targetUrl.match(/=[swh]\d+/)) {
        targetUrl = targetUrl.replace(/=[swh]\d+[^?#]*/, '=s0');
      } else if (!targetUrl.includes('=s0')) {
        // If no sizing parameter found, append =s0
        // We use =s0 which is generally safer for these types of URLs
        if (targetUrl.includes('=')) {
          // If there's already some other parameter, append another one?
          // Usually Google params are =sNN-pp-kk. If it doesn't match [swh]\d, we just append.
          targetUrl += '-s0';
        } else {
          targetUrl += '=s0';
        }
      }
    }

    // Helper for fetch with potential credentials fallback
    const fetchToBlob = async (fetchUrl: string): Promise<Blob | null> => {
      try {
        const resp = await fetch(fetchUrl, {
          credentials: 'include',
          mode: 'cors' as RequestMode,
        });
        if (resp.ok) return await resp.blob();
      } catch {
        /* ignore credentials error */
      }

      try {
        const resp = await fetch(fetchUrl, {
          credentials: 'omit',
          mode: 'cors' as RequestMode,
        });
        if (resp.ok) return await resp.blob();
      } catch (e) {
        logger.error('[ContextSync] Image fetch failed (all content-script attempts):', {
          error: e,
        });
      }
      return null;
    };

    // Strategy 1: Attempt direct fetch from content script
    try {
      const blob = await fetchToBlob(targetUrl);
      if (blob) {
        return new Promise((resolve) => {
          const reader = new FileReader();
          reader.onloadend = () => resolve(reader.result as string);
          reader.onerror = () => resolve(null);
          reader.readAsDataURL(blob);
        });
      }
    } catch (e) {
      logger.warn('[ContextSync] Strategy 1 (Direct) exception:', { error: e });
    }

    // Strategy 2: Background fetch
    return new Promise((resolve) => {
      chrome.runtime.sendMessage({ type: 'gv.fetchImage', url: targetUrl }, (response) => {
        if (response && response.ok) {
          resolve(response.data);
        } else {
          // Strategy 3: Fetch via page context
          chrome.runtime.sendMessage(
            { type: 'gv.fetchImageViaPage', url: targetUrl },
            (pageResponse) => {
              if (pageResponse && pageResponse.ok) {
                resolve(pageResponse.data);
              } else {
                logger.error('[ContextSync] Image fetch failed (all methods):', { targetUrl });
                resolve(null);
              }
            },
          );
        }
      });
    });
  }

  private convertTableToMarkdown(table: HTMLTableElement): string {
    try {
      const rows = Array.from(table.rows);
      if (rows.length === 0) return '';

      const data = rows.map((row) => {
        const cells = Array.from(row.cells);
        return cells.map((cell) => {
          return cell.innerText.trim().replace(/\|/g, '\\|').replace(/\n/g, '___BR___');
        });
      });

      const maxCols = data.reduce((max, row) => Math.max(max, row.length), 0);
      if (maxCols === 0) return '';

      let md = '\n\n';

      const headerRow = data[0];
      while (headerRow.length < maxCols) headerRow.push('');
      md += '| ' + headerRow.join(' | ') + ' |\n';

      md += '| ' + Array(maxCols).fill('---').join(' | ') + ' |\n';

      for (let i = 1; i < data.length; i++) {
        const row = data[i];
        while (row.length < maxCols) row.push('');
        md += '| ' + row.join(' | ') + ' |\n';
      }

      return md + '\n';
    } catch (e) {
      logger.error('Table conversion failed', { error: e });
      return table.innerText;
    }
  }

  private prepareNode(el: HTMLElement, role: 'user' | 'assistant'): PreparedContextNode | null {
    if (el.offsetParent === null) return null;
    if (['SCRIPT', 'STYLE', 'NAV', 'HEADER', 'FOOTER', 'SVG', 'PATH'].includes(el.tagName))
      return null;
    const clone = el.cloneNode(true) as HTMLElement;
    const tables = Array.from(clone.querySelectorAll('table')).reverse();
    tables.forEach((table) => {
      const md = this.convertTableToMarkdown(table as HTMLTableElement);
      table.replaceWith(document.createTextNode(md));
    });
    return { element: el, clone, role };
  }

  private async extractNodeInfo({
    element: el,
    clone,
    role: forceRole,
    images: imgElements,
  }: PreparedContextNode & { images: HTMLImageElement[] }): Promise<DialogNode | null> {
    const imgBase64List: string[] = [];
    if (imgElements.length > 0) {
      logger.debug(`[ContextSync] Found ${imgElements.length} image(s)`);
      for (const imgEl of imgElements) {
        // Use attribute if available, otherwise fallback to property
        let src = imgEl.getAttribute('src') || imgEl.src || '';
        if (!src || src === 'about:blank') continue;

        // Resolve relative URLs to absolute
        if (src.startsWith('/')) {
          src = window.location.origin + src;
        }

        const base64 = await ContextCaptureService.getBase64Safe(src);
        if (base64) {
          imgBase64List.push(base64);
          logger.debug('[ContextSync] Converted image to Base64 (length):', {
            length: base64.length,
          });
        }
      }
      logger.debug(
        `[ContextSync] Successfully converted ${imgBase64List.length} image(s) to Base64`,
      );
    }

    let text = clone.innerText.trim();
    if (text.length < 1 && imgBase64List.length === 0) return null;

    text = text.replace(/</g, '&lt;').replace(/>/g, '&gt;');
    text = text.replace(/___BR___/g, '<br>');

    return {
      url: window.location.hostname,
      className: el.className,
      text: text,
      images: imgBase64List,
      is_ai_likely: forceRole === 'assistant',
      is_user_likely: forceRole === 'user',
      rect: {
        top: el.getBoundingClientRect().top,
        left: el.getBoundingClientRect().left,
        width: el.getBoundingClientRect().width,
      },
    };
  }
}
