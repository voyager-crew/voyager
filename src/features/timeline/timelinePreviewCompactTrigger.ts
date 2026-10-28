/**
 * In compact mode the timeline bar itself opens the preview: hover or focus
 * opens it, leaving the bar, panel and the bridge between them schedules a
 * close, and Enter/Space or a click toggles it. Outside compact mode every
 * handler here does nothing.
 */
export interface CompactTriggerTargets {
  anchor: HTMLElement;
  panel: HTMLElement | null;
  hoverBridge: HTMLElement | null;
}

export interface CompactTriggerActions {
  isCompact: () => boolean;
  isOpen: () => boolean;
  open: () => void;
  close: () => void;
  toggle: () => void;
  scheduleClose: () => void;
  cancelClose: () => void;
}

/** Binds the compact-mode handlers; returns the stop that removes them all. */
export function bindCompactTrigger(
  { anchor, panel, hoverBridge }: CompactTriggerTargets,
  actions: CompactTriggerActions,
): () => void {
  const controller = new AbortController();
  const { signal } = controller;
  let wasOpenOnPointerDown: boolean | null = null;

  const openNow = () => {
    if (!actions.isCompact()) return;
    actions.cancelClose();
    actions.open();
  };
  const keepOpen = () => {
    if (!actions.isCompact()) return;
    actions.cancelClose();
  };
  const scheduleClose = () => actions.scheduleClose();

  anchor.addEventListener('mouseenter', openNow, { signal });
  anchor.addEventListener('mouseleave', scheduleClose, { signal });
  panel?.addEventListener('mouseenter', keepOpen, { signal });
  panel?.addEventListener('mouseleave', scheduleClose, { signal });
  hoverBridge?.addEventListener('mouseenter', keepOpen, { signal });
  hoverBridge?.addEventListener('mouseleave', scheduleClose, { signal });
  anchor.addEventListener('focusin', openNow, { signal });
  anchor.addEventListener('focusout', scheduleClose, { signal });
  anchor.addEventListener(
    'keydown',
    (event: KeyboardEvent) => {
      if (!actions.isCompact() || (event.key !== 'Enter' && event.key !== ' ')) return;
      event.preventDefault();
      event.stopPropagation();
      actions.toggle();
    },
    { signal },
  );
  anchor.addEventListener(
    'pointerdown',
    () => {
      if (!actions.isCompact()) return;
      // Pointer focus can open the panel before the subsequent click fires.
      // Preserve the pre-click state so a closed rail still opens on touch.
      wasOpenOnPointerDown = actions.isOpen();
    },
    { signal },
  );
  anchor.addEventListener(
    'click',
    (event: MouseEvent) => {
      if (!actions.isCompact()) return;
      event.stopPropagation();
      const wasOpen = wasOpenOnPointerDown ?? actions.isOpen();
      wasOpenOnPointerDown = null;
      if (wasOpen) actions.close();
      else actions.open();
    },
    { signal },
  );

  return () => {
    controller.abort();
    wasOpenOnPointerDown = null;
  };
}
