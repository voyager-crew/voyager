/**
 * Where Voyager hangs a small tag just above a site's composer (the counter
 * badge, the new-chat folder chip): the composer root, or the nearest ancestor
 * that does not clip what sits above it, made the tag's containing block.
 */
import { nativeDomDecorations } from '@/core/services/NativeDomDecorationService';

/** A root with one of these positions already contains the tag without Voyager's class. */
const POSITIONED = /^(relative|absolute|fixed|sticky)$/;

function clips(style: CSSStyleDeclaration): boolean {
  return [style.overflow, style.overflowX, style.overflowY].some(
    (value) => value !== '' && value !== 'visible',
  );
}

/**
 * The root, or the parent of the outermost ancestor that would clip a tag drawn `clearancePx`
 * above the root: DeepSeek's composer root sits inside a rounded card with `overflow: hidden`.
 */
export function unclippedAnchor(root: HTMLElement, view: Window, clearancePx: number): HTMLElement {
  const tagTop = root.getBoundingClientRect().top - clearancePx;
  let anchor = root;
  for (
    let node: HTMLElement | null = root;
    node && node !== root.ownerDocument.body;
    node = node.parentElement
  ) {
    if (
      node.parentElement &&
      clips(view.getComputedStyle(node)) &&
      node.getBoundingClientRect().top > tagTop
    )
      anchor = node.parentElement;
  }
  return anchor;
}

/** The composer root `field` sits in: `composerRoot` when it matches, else the field's parent. */
export function composerRootOf(
  field: HTMLElement | null,
  composerRoot: string | undefined,
): HTMLElement | null {
  return (
    (field && composerRoot ? field.closest<HTMLElement>(composerRoot) : null) ??
    field?.parentElement ??
    null
  );
}

export interface AnchorPosition {
  /** React rewrites a root's className on its own updates; puts the class back. */
  reapply(): void;
  /** Takes only Voyager's class off: the host may have changed its own classes since. */
  release(): void;
}

/**
 * Makes `anchor` a containing block with `className` (whose page rule sets
 * `position: relative`) while it is statically positioned; a root that already
 * positions itself keeps its own value, so the host's absolutely placed
 * children stay where they were. `owner` records the class as a decoration of
 * a native element, so the page's own content is not taken for Voyager UI.
 */
export function positionAnchor(
  anchor: HTMLElement,
  view: Window,
  className: string,
  owner: object | null,
): AnchorPosition {
  if (POSITIONED.test(view.getComputedStyle(anchor).position)) {
    return { reapply: () => {}, release: () => {} };
  }
  const hadClass = anchor.hasAttribute('class');
  if (owner) nativeDomDecorations.acquire(anchor, className, owner);
  anchor.classList.add(className);
  return {
    reapply: () => anchor.classList.add(className),
    release: () => {
      if (owner) nativeDomDecorations.release(anchor, className, owner);
      anchor.classList.remove(className);
      if (!hadClass && anchor.classList.length === 0) anchor.removeAttribute('class');
    },
  };
}
