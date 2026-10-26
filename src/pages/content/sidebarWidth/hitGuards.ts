import type { PluginScope } from '@/features/plugins/runtime/pluginScope';

import { getSidebarWidthButtons } from './buttonTargets';

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
    const toggleButton = getSidebarWidthButtons().find((button) =>
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
