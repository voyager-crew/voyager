const BLANK_IMAGE =
  'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
const INSTALLED = Symbol('gv-mermaid-image-fallback');

function imageSource(value: string, extensionBase: string): string {
  let start = 0;
  let end = value.length;
  while (start < end && value.charCodeAt(start) <= 0x20) start++;
  while (end > start && value.charCodeAt(end - 1) <= 0x20) end--;
  const url = value.slice(start, end).replace(/[\t\n\r]/g, '');
  // Only what the renderer CSP admits (img-src 'self' data:) can decode; a
  // blob: URL or a #fragment (which resolves to this HTML page) cannot.
  return url === '' || /^data:/i.test(url) || url.startsWith(extensionBase) ? value : BLANK_IMAGE;
}

/**
 * CSP rejects every other image source, but Mermaid awaits decode() before drawing their
 * labels. Give those image nodes a decodable placeholder in this renderer realm.
 * The protection lasts until the whole one-use document is destroyed.
 */
export function installMermaidImageFallback(doc: Document, extensionBase: string): void {
  // Refuse a host document even if this module is accidentally called from one.
  if (
    !/^(?:chrome|moz|safari-web)-extension:\/\//i.test(extensionBase) ||
    !doc.URL.startsWith(extensionBase) ||
    !doc.defaultView
  ) {
    return;
  }
  const prototype = doc.defaultView.HTMLImageElement.prototype;
  if (Object.prototype.hasOwnProperty.call(prototype, INSTALLED)) return;
  const src = Object.getOwnPropertyDescriptor(prototype, 'src');
  if (!src?.set) throw new Error('The renderer document has no native image source setter');
  const setSource = src.set;
  const setAttribute = prototype.setAttribute;
  const setAttributeNS = prototype.setAttributeNS;
  Object.defineProperties(prototype, {
    src: {
      ...src,
      set(this: HTMLImageElement, value: unknown) {
        setSource.call(this, imageSource(String(value), extensionBase));
      },
    },
    setAttribute: {
      configurable: true,
      writable: true,
      value(this: HTMLImageElement, name: string, value: string) {
        setAttribute.call(
          this,
          name,
          name.toLowerCase() === 'src' ? imageSource(String(value), extensionBase) : value,
        );
      },
    },
    setAttributeNS: {
      configurable: true,
      writable: true,
      value(this: HTMLImageElement, namespace: string | null, name: string, value: string) {
        setAttributeNS.call(
          this,
          namespace,
          name,
          !namespace && name.toLowerCase() === 'src'
            ? imageSource(String(value), extensionBase)
            : value,
        );
      },
    },
    [INSTALLED]: { value: true },
  });
}
