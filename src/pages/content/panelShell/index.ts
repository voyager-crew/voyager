/**
 * The Voyager panel's shell on the host page, an always-on native feature:
 * the floating entry's satellites, the panel window and its open, close,
 * drag and position, Esc and outside presses, focus return, the live-preview
 * relay and the panel shortcut. The panel page itself runs in an iframe.
 */
import { keyboardShortcutService } from '@/core/services/KeyboardShortcutService';
import { isUserEvent } from '@/core/utils/userEvent';
import { resolvePluginPlatformId } from '@/features/plugins/sites/registry';
import { initI18n, onCachedLanguageChange } from '@/utils/i18n';

import type { StopNativeFeature } from '../featureLifecycle';
import { promptBall } from '../prompt/promptBall';
import { holdBall } from './ballHold';
import { createPanelController } from './controller';
import { type Entry, decorateBall } from './entry';
import { createHideSetting } from './hideSetting';
import { createBallMotion } from './motion';
import { voyagerPanelOpener } from './opener';
import { panelShortcutLabel, shellText, withShortcutCap } from './text';
import { createShellToast } from './toast';

export function startPanelShell(): StopNativeFeature {
  // The panel belongs to the page, never to a frame inside it.
  if (window.top !== window) return () => {};
  void initI18n();

  let entry: Entry | null = null;
  const toast = createShellToast();
  const hideSetting = createHideSetting();
  const controller = createPanelController({
    entry: () => entry,
    ballTogglesPanel: () => promptBall.view()?.answers === 'panel-shell',
    toast,
    onOpenChange: (open) => entry?.setPanelOpen(open),
  });

  const hideBall = (): void => {
    controller.close();
    const undo = hideSetting.hide();
    toast.show({
      render: () => withShortcutCap(shellText('panelShellHiddenToast'), panelShortcutLabel()),
      undo,
    });
  };

  const refreshEntry = (): void => {
    const view = promptBall.view();
    if (entry && entry.ball !== view?.element) {
      entry.destroy();
      entry = null;
    }
    if (!view) return;
    entry ??= decorateBall(view.element, {
      onPanel: () => controller.toggle('satellite'),
      onHide: hideBall,
      onPress: () => controller.notePress(),
    });
    const shellAnswers = view.answers === 'panel-shell';
    entry.setHideOnly(shellAnswers);
    entry.setPanelOpen(controller.isOpen());
    if (shellAnswers) view.element.setAttribute('aria-label', shellText('panelShellPanel'));
  };

  const shortcuts = keyboardShortcutService.acquire();
  const stopShortcut = keyboardShortcutService.on(
    (_action, event) => {
      // A page script's synthetic ⌥V must neither open the panel nor write the hide setting.
      if (!isUserEvent(event)) return;
      const opening = !controller.isOpen();
      controller.toggle(null, { keyboard: true });
      // The shortcut brings a hidden ball back: hiding it is never a dead end.
      if (opening) hideSetting.show();
    },
    ['panel:toggle'],
  );

  const stopBall = resolvePluginPlatformId(location.href)
    ? holdBall({
        label: () => shellText('panelShellPanel'),
        activate: () => controller.toggle('ball'),
        open: () => controller.open('ball'),
      })
    : () => {};
  const stopWatchingBall = promptBall.subscribe(refreshEntry);
  const stopMotion = promptBall.provideMotion(
    createBallMotion(() => (entry ? [entry.element] : [])),
  );
  const stopOpener = voyagerPanelOpener.provide(() => controller.open(null));
  const stopLanguage = onCachedLanguageChange(() => {
    entry?.relabel();
    toast.relabel();
    refreshEntry();
  });
  refreshEntry();

  let stopped = false;
  return () => {
    if (stopped) return;
    stopped = true;
    stopLanguage();
    stopOpener();
    stopShortcut();
    shortcuts.release();
    stopWatchingBall();
    stopMotion();
    void controller.stop();
    entry?.destroy();
    entry = null;
    stopBall();
    toast.destroy();
  };
}
