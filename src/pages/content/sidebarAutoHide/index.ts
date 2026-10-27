import type { Dispose } from '@/features/plugins/runtime/pluginScope';

import { createSidebarHideController } from './controller';
import { getSidebarToggleState } from './sidebarDom';

type SidebarHideFeature = 'autoHide' | 'fullHide';
let controller: ReturnType<typeof createSidebarHideController> | null = null;
const owners = { autoHide: 0, fullHide: 0 };
// Coachmark leases outlive plugin activations and are released only by their callers.
let keepExpandedLocks = 0;

export function acquireSidebarHide(feature: SidebarHideFeature): Dispose {
  controller ??= createSidebarHideController(() => keepExpandedLocks > 0);
  const current = controller;
  owners[feature] += 1;
  if (feature === 'autoHide') current.setAutoHide(true);
  else current.setFullHide(true);
  if (keepExpandedLocks > 0) current.keepExpanded();

  let released = false;
  return () => {
    if (released) return;
    released = true;
    owners[feature] -= 1;
    if (owners[feature] === 0) {
      if (feature === 'autoHide') current.setAutoHide(false);
      else current.setFullHide(false);
    }
    if (owners.autoHide === 0 && owners.fullHide === 0) {
      controller = null;
      return current.destroy();
    }
  };
}

export function keepSidebarExpanded(): () => void {
  keepExpandedLocks += 1;
  if (controller) controller.keepExpanded();
  else {
    const { button, collapsed } = getSidebarToggleState();
    if (collapsed) button?.click();
  }

  let released = false;
  return () => {
    if (released) return;
    released = true;
    keepExpandedLocks = Math.max(0, keepExpandedLocks - 1);
    if (keepExpandedLocks === 0) controller?.reconcile();
  };
}
