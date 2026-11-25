/**
 * When a navigation or interaction must re-discover the conversation
 * container and viewport before acting: the host may have replaced either, or
 * added turns the marker list has not read yet.
 */
export interface TimelineRefreshInputs {
  readonly container: HTMLElement | null;
  readonly viewport: HTMLElement | null;
  /** The host's turn count now, read only when needed. */
  readonly documentCount: () => number;
  readonly markerCount: number;
  /** The scroll container the adapter finds for an element. */
  readonly viewportOf: (element: HTMLElement) => HTMLElement;
}

export function shouldRefreshForNavigation(inputs: TimelineRefreshInputs): boolean {
  const containersDisconnected =
    (inputs.container ? !inputs.container.isConnected : true) ||
    (inputs.viewport ? !inputs.viewport.isConnected : true);

  return containersDisconnected || inputs.documentCount() > inputs.markerCount;
}

export function shouldRefreshForInteraction(
  inputs: TimelineRefreshInputs,
  targetElement: HTMLElement | null,
): boolean {
  const { container, viewport } = inputs;
  // Avoid the document-wide marker count scan on the common path, but still
  // validate the nearest scroll container. Gemini can insert a new viewport
  // inside the old one while both the marker and old viewport remain
  // connected; treating connectivity as freshness writes scrollTop to the
  // wrong element and makes clicks and shortcuts appear inert.
  if (
    targetElement?.isConnected &&
    container?.isConnected &&
    viewport?.isConnected &&
    container.contains(targetElement) &&
    viewport.contains(targetElement)
  ) {
    return inputs.viewportOf(targetElement) !== viewport;
  }

  if (shouldRefreshForNavigation(inputs)) return true;

  if (targetElement && !targetElement.isConnected) return true;

  if (targetElement && container && !container.contains(targetElement)) {
    return true;
  }

  if (!targetElement || !viewport) return false;

  return inputs.viewportOf(targetElement) !== viewport;
}
