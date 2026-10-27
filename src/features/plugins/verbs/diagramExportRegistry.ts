/**
 * The bridge between the code-block diagram primitives and export. A primitive
 * whose plugin sets `exportImage` registers, for each block it has drawn, a
 * provider that reads the drawing synchronously; export asks it for the block
 * it is walking (or, for a list, for the live block its clone came from) and
 * falls back to the block's own source when there is none or it answers null.
 *
 * Synchronous on purpose: the export walk is, and an image it awaited could
 * belong to a source the reply has already moved past.
 */

/** Set on a code block by the diagram activation that draws it, `<kind>:<id>`. */
export const DIAGRAM_OWNER_ATTR = 'data-gv-diagram-owner';

/** `html` for PNG and PDF (the drawn image), `text` for Markdown (the fenced source). */
export interface DiagramExport {
  readonly html: string;
  readonly text: string;
}

export type DiagramExportProvider = () => DiagramExport | null;

const providers = new WeakMap<Element, DiagramExportProvider>();
const hiddenSources = new WeakSet<Element>();

/** Only the renderer that hides a native block can preserve its visibility proof. */
export function ownDiagramSource(block: Element): () => void {
  hiddenSources.add(block);
  return () => hiddenSources.delete(block);
}

export function isOwnedDiagramSource(block: Element): boolean {
  return hiddenSources.has(block) && block.hasAttribute('data-gv-diagram-hidden');
}

/** Registers `read` for `block`; the returned withdraw only removes this registration. */
export function provideDiagramExport(block: Element, read: DiagramExportProvider): () => void {
  providers.set(block, read);
  return () => {
    if (providers.get(block) === read) providers.delete(block);
  };
}

/** The drawn diagram of a live `block`, or null when export should use the block's source. */
export function readDiagramExport(block: Element): DiagramExport | null {
  const read = providers.get(block);
  if (!read) return null;
  try {
    return read();
  } catch {
    return null;
  }
}
