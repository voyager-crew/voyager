/**
 * Where the timeline preview's toggle, panel and hover bridge sit beside the
 * timeline bar. Pure: callers pass the bar's rect and the viewport size.
 */
const PREVIEW_PANEL_WIDTH_PX = 320;
const PREVIEW_PANEL_GAP_PX = 12;
const PREVIEW_HOVER_BRIDGE_PADDING_PX = 8;
const VIEWPORT_MARGIN_PX = 8;
const TOGGLE_SIZE_PX = 24;
const TOGGLE_GAP_PX = 4;

interface Viewport {
  width: number;
  height: number;
}

/** The toggle sits left of the bar, vertically centered, clamped inside the viewport. */
export function previewToggleSpot(
  barRect: DOMRect,
  viewportWidth: number,
): { left: number; top: number } {
  const minLeft = VIEWPORT_MARGIN_PX;
  const maxLeft = Math.max(minLeft, viewportWidth - TOGGLE_SIZE_PX - VIEWPORT_MARGIN_PX);
  const left = Math.max(
    minLeft,
    Math.min(Math.round(barRect.left - TOGGLE_SIZE_PX - TOGGLE_GAP_PX), maxLeft),
  );
  return { left, top: Math.round(barRect.top + barRect.height / 2 - TOGGLE_SIZE_PX / 2) };
}

export function previewPanelMaxHeight(viewportHeight: number, compact: boolean): number {
  return compact ? Math.min(700, viewportHeight * 0.82) : Math.min(500, viewportHeight * 0.7);
}

/** The panel's left edge: beside the bar on the side away from the viewport edge it hugs. */
export function previewPanelLeft(barRect: DOMRect, viewportWidth: number, rtl: boolean): number {
  if (rtl) {
    // In RTL, bar is on the left — place panel to its right
    const left = barRect.right + PREVIEW_PANEL_GAP_PX;
    return left + PREVIEW_PANEL_WIDTH_PX > viewportWidth - VIEWPORT_MARGIN_PX
      ? viewportWidth - PREVIEW_PANEL_WIDTH_PX - VIEWPORT_MARGIN_PX
      : left;
  }
  // In LTR, bar is on the right — place panel to its left
  const left = barRect.left - PREVIEW_PANEL_WIDTH_PX - PREVIEW_PANEL_GAP_PX;
  return left < VIEWPORT_MARGIN_PX ? VIEWPORT_MARGIN_PX : left;
}

/** The panel's top: centered on the bar, clamped inside the viewport. */
export function previewPanelTop(
  barRect: DOMRect,
  panelHeight: number,
  viewportHeight: number,
): number {
  const top = barRect.top + barRect.height / 2 - panelHeight / 2;
  return Math.max(
    VIEWPORT_MARGIN_PX,
    Math.min(top, viewportHeight - panelHeight - VIEWPORT_MARGIN_PX),
  );
}

/** The strip between bar and panel, padded vertically to cover both. */
export function previewHoverBridgeBox(
  barRect: DOMRect,
  panel: { left: number; top: number; height: number },
  viewport: Viewport,
  rtl: boolean,
): { left: number; top: number; width: number; height: number } {
  const panelRight = panel.left + PREVIEW_PANEL_WIDTH_PX;
  const left = rtl ? barRect.right : panelRight;
  const width = rtl
    ? Math.max(0, panel.left - barRect.right)
    : Math.max(0, barRect.left - panelRight);
  const top = Math.max(0, Math.min(barRect.top, panel.top) - PREVIEW_HOVER_BRIDGE_PADDING_PX);
  const bottom = Math.min(
    viewport.height,
    Math.max(barRect.bottom, panel.top + panel.height) + PREVIEW_HOVER_BRIDGE_PADDING_PX,
  );
  return { left, top, width, height: Math.max(0, bottom - top) };
}
