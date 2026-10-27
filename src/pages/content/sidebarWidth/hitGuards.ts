import { getGeminiSelectorView } from '@/core/gemini/selectors';
import type { PluginScope } from '@/features/plugins/runtime/pluginScope';

import { getSidebarWidthButtons, getSidebarWidthActionButtons } from './buttonTargets';

function rectContainsPoint(rect: DOMRect, x: number, y: number): boolean {
  return (
    rect.width > 0 &&
    rect.height > 0 &&
    x >= rect.left &&
    x <= rect.right &&
    y >= rect.top &&
    y <= rect.bottom
  );
}

function setupSidebarToggleHitGuard(scope: PluginScope): void {
  const onPointerDownCapture = (event: PointerEvent) => {
    if (scope.isDisposed) return;
    if (event.pointerType === 'mouse' && event.button !== 0) return;

    const { clientX: x, clientY: y } = event;
    const view = getGeminiSelectorView();
    const candidates = getSidebarWidthButtons();
    if (!candidates.some((region) => rectContainsPoint(region.getBoundingClientRect(), x, y)))
      return;
    const buttons =
      view.remoteKeys.has('sidebarWidth.buttons') || view.remoteKeys.has('sidebarWidth.candidates')
        ? getSidebarWidthActionButtons()
        : candidates;
    // Catalog geometry alone must never forward a click outside the actual native control.
    const toggleButton = buttons.find((button) =>
      rectContainsPoint(button.getBoundingClientRect(), x, y),
    );
    if (!toggleButton) return;

    const target = event.target instanceof Element ? event.target : null;
    if (target && toggleButton.contains(target)) return;

    event.preventDefault();
    event.stopImmediatePropagation();
    toggleButton.click();
  };

  scope.on(window, 'pointerdown', onPointerDownCapture, { capture: true });
}

export function installSidebarWidthHitGuards(scope: PluginScope): void {
  setupSidebarToggleHitGuard(scope);
}
