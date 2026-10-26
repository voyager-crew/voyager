import { describe, expect, it } from 'vitest';

import { getBundledGeminiSelectorView, type GeminiSelectorView } from '@/core/gemini/selectors';
import { createContentExtractor } from '@/features/export/services/DOMContentExtractor';
import { geminiAdapter } from '@/features/plugins/sites/adapters/gemini';

import { buildGeminiAdapter } from '../platform/gemini';

function remoteSearch(selector: string): GeminiSelectorView {
  const bundled = getBundledGeminiSelectorView();
  return {
    ...bundled,
    profiles: { ...bundled.profiles, 'imageExport.searchHosts': [selector] },
    remoteKeys: new Set(['imageExport.searchHosts']),
  };
}

function host(markup: string): HTMLElement {
  const response = document.createElement('model-response');
  response.innerHTML = `<message-content>${markup}</message-content>`;
  return response;
}

function extract(root: HTMLElement, view: GeminiSelectorView = getBundledGeminiSelectorView()) {
  return createContentExtractor(buildGeminiAdapter(geminiAdapter, view)).extractAssistantContent(
    root,
  );
}

function sourceCard(className: string, index = 1, extra = ''): string {
  return `<response-element _nghost-ng-c123="" dir="ltr" jslog="123;track:click">
    <image-result _ngcontent-ng-c123="" aria-label="Search image" style="display:block">
      <div class="${className}" data-full-size-image-uri="https://source.example/full-${index}.jpg">
        <button class="image-button" aria-label="Open image">
          <img class="hero-image" src="about:blank" srcset="https://images.example/${index}.jpg 1x, https://images.example/${index}@2x.jpg 2x" alt="Search ${index}">
        </button>
        <caption-row _nghost-ng-c456=""><div class="caption">Caption ${index}</div></caption-row>
        <a class="source" href="https://source.example/page-${index}"><span class="label">Source ${index}</span></a>
        ${extra}
      </div>
    </image-result>
  </response-element>`;
}

describe('Gemini image export online reads', () => {
  it('exports the same ordered search, generated and YouTube images, captions and sources', () => {
    const markup = `<p>Before</p>${sourceCard('image-container search-alias')}
      <generated-image><img class="image" src="https://images.example/generated.png" alt="Generated">
        <download-generated-image-button><button><img src="https://images.example/toolbar.svg"></button></download-generated-image-button>
      </generated-image>
      <div class="attachment-container youtube"><youtube-block><single-video>
        <img class="thumbnail" src="https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg" alt="Video">
        <iframe src="https://www.youtube.com/embed/dQw4w9WgXcQ"></iframe>
      </single-video></youtube-block></div><p>After</p>`;
    const root = host(markup);
    const bundled = extract(root);
    // YouTube marks a cover during export; reset only that marker to reread the same DOM nodes.
    for (const image of root.querySelectorAll('img')) {
      delete (image as HTMLImageElement & { processedByGV?: boolean }).processedByGV;
    }
    const online = extract(root, remoteSearch('.search-alias'));
    expect(online).toEqual(bundled);
    expect(online.html.match(/<img\s/g)).toHaveLength(3);
    expect(online.text).toBe(
      'Before\n\n![Search 1](https://images.example/1.jpg)\n*Caption 1*\n\n![Generated](https://images.example/generated.png)\n\n[![Video](https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg)](https://www.youtube.com/watch?v=dQw4w9WgXcQ)\nAfter',
    );
  });

  it('repairs an Angular search card name and restores its figure caption', () => {
    const markup = `<p>Before</p>${sourceCard('repaired-card')}<p>After</p>`;
    const bundled = extract(host(markup));
    const online = extract(host(markup), remoteSearch('.repaired-card'));
    expect(online.html).toContain(
      '<figure class="gv-export-figure"><img src="https://images.example/1.jpg" alt="Search 1" /><figcaption>Caption 1</figcaption></figure>',
    );
    expect(online.text).toBe(
      'Before\n\n![Search 1](https://images.example/1.jpg)\n*Caption 1*\nAfter',
    );
    expect(online).not.toEqual(bundled);
  });

  it('keeps source links and full-size fallback attached to the repaired image', () => {
    const markup = `<image-result _nghost-ng-c123="" dir="ltr"><div class="repaired-card" data-full-size-image-uri="https://images.example/full.jpg">
      <img alt="Source image"><a class="source" href="https://source.example/article"><span class="label">Publisher</span></a>
    </div></image-result>`;
    const online = extract(host(markup), remoteSearch('.repaired-card'));
    expect(online.text).toBe(
      '![Source image](https://images.example/full.jpg)\n*Source: [Publisher](https://source.example/article)*',
    );
    expect(online.html).toContain(
      '<figcaption>Source: [Publisher](https://source.example/article)</figcaption>',
    );
  });

  it('falls back for the whole export when a remote list omits the second bundled image card', () => {
    const markup = `${sourceCard('image-container first', 1)}${sourceCard('image-container', 2)}`;
    const online = extract(host(markup), remoteSearch('.first'));
    expect(online).toEqual(extract(host(markup)));
    expect(online.html.match(/gv-export-figure/g)).toHaveLength(2);
    expect(online.text).toContain('*Caption 2*');
  });

  it('does not consume surrounding prose when a remote locator matches a card wrapper', () => {
    const markup = `<div class="wrong-owner"><p>Keep this prose</p>${sourceCard('image-container')}</div>`;
    const online = extract(host(markup), remoteSearch('.wrong-owner'));
    expect(online).toEqual(extract(host(markup)));
    expect(online.text).toContain('Keep this prose');
    expect(online.html).toContain('<p>Keep this prose</p>');
  });

  it('does not adopt a partial repaired list when another native source owner exists', () => {
    const markup = `${sourceCard('repaired-card first', 1)}${sourceCard('repaired-card', 2)}`;
    const online = extract(host(markup), remoteSearch('.first'));
    expect(online).toEqual(extract(host(markup)));
    expect(online.text).toContain('Caption 1');
    expect(online.text).toContain('Caption 2');
  });

  it('keeps prose inside an ambiguous source wrapper instead of exporting it as one image', () => {
    const markup = sourceCard('repaired-card', 1, '<p class="caption">Important instruction</p>');
    const online = extract(host(markup), remoteSearch('.repaired-card'));
    expect(online).toEqual(extract(host(markup)));
    expect(online.html).toContain('<p>Important instruction</p>');
  });

  it('keeps unlabelled text inside a source wrapper instead of discarding it as image chrome', () => {
    const markup = sourceCard('repaired-card', 1, '<result-note>Keep this detail</result-note>');
    const online = extract(host(markup), remoteSearch('.repaired-card'));
    expect(online).toEqual(extract(host(markup)));
    expect(online.text).toContain('Keep this detail');
  });

  it('keeps an image with an empty source-owner attribute on the bundled export path', () => {
    const markup = sourceCard('repaired-card').replace(
      'data-full-size-image-uri="https://source.example/full-1.jpg"',
      'data-full-size-image-uri=""',
    );
    const online = extract(host(markup), remoteSearch('.repaired-card'));
    expect(online).toEqual(extract(host(markup)));
    expect(online.text).toContain('![Search 1](https://images.example/1.jpg)');
  });

  it('keeps a source caption visible while its image has not been mounted', () => {
    const markup =
      '<image-result class="repaired-card" data-full-size-image-uri="https://source.example/full.jpg"><div class="caption">Pending image caption</div></image-result>';
    const online = extract(host(markup), remoteSearch('.repaired-card'));
    expect(online).toEqual(extract(host(markup)));
    expect(online.html).toContain('Pending image caption');
  });

  it('keeps search thumbnails separate from a toolbar icon in an ambiguous repaired card', () => {
    const markup = sourceCard(
      'repaired-card',
      1,
      '<div class="generated-image-controls"><button><img src="https://images.example/toolbar.png" alt="Download"></button></div>',
    );
    const online = extract(host(markup), remoteSearch('.repaired-card'));
    expect(online).toEqual(extract(host(markup)));
    expect(online.html.match(/<img\s/g)).toHaveLength(1);
    expect(online.text).toContain('![Search 1](https://images.example/1.jpg)');
  });

  it('does not adopt a source card from a nested response owner', () => {
    const markup = `<model-response>${sourceCard('repaired-card')}</model-response>`;
    const online = extract(host(markup), remoteSearch('.repaired-card'));
    expect(online).toEqual(extract(host(markup)));
    expect(online.text).toContain('Caption 1');
  });

  it('exports bundled figures when a supplied locator cannot be parsed', () => {
    const markup = sourceCard('image-container');
    const online = extract(host(markup), remoteSearch('['));
    expect(online).toEqual(extract(host(markup)));
    expect(online.html).toContain('gv-export-figure');
  });

  it('does not reclassify an uploaded image as a repaired search result', () => {
    const markup = `<user-query-file-preview>${sourceCard('repaired-card')}</user-query-file-preview>`;
    const online = extract(host(markup), remoteSearch('.repaired-card'));
    expect(online).toEqual(extract(host(markup)));
    const user = document.createElement('user-query');
    user.innerHTML =
      '<p class="query-text-line">Uploaded</p><user-query-file-preview><img src="https://images.example/uploaded.png" alt="My upload"></user-query-file-preview>';
    const adapter = buildGeminiAdapter(geminiAdapter, remoteSearch('img'));
    const uploaded = createContentExtractor(adapter).extractUserContent(user);
    expect(uploaded.html).toContain('https://images.example/uploaded.png');
    expect(uploaded.text).toContain('Uploaded');
  });

  it('keeps the same image order when an Angular shadow wrapper is repaired', () => {
    const create = () => {
      const root = host('<div class="markdown"><p>Before</p></div><shadow-images></shadow-images>');
      root.querySelector('shadow-images')!.attachShadow({ mode: 'open' }).innerHTML =
        sourceCard('repaired-card');
      return root;
    };
    const online = extract(create(), remoteSearch('.repaired-card'));
    expect(online.text).toBe('Before\n\n![Search 1](https://images.example/1.jpg)\n*Caption 1*');
    expect(online.html.match(/gv-export-figure/g)).toHaveLength(1);
  });
});
