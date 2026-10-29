/**
 * On a catalog site (Claude, ChatGPT, …) Prompt Manager runs only where its
 * coverage list includes the site, so the shell holds the floating ball too:
 * turning Prompt Manager off there must not take away the way into the panel.
 * While Prompt Manager is off the ball opens the panel; while it is on the
 * click waits for Prompt Manager (inert until its panel is built), as today.
 * Gemini and AI Studio always run Prompt Manager, which brings the ball.
 */
import { StorageKeys } from '@/core/types/common';
import { promptCoverageBindingForUrl } from '@/features/plugins/storage/promptCoverageBinding';

import { type BallLease, promptBall } from '../prompt/promptBall';
import { readPromptStartupSettings } from '../prompt/promptStartup';
import { resolvePromptSiteAdapter } from '../prompt/resolvePromptSiteAdapter';

type StorageChanges = Record<string, chrome.storage.StorageChange>;

export interface BallHoldOptions {
  /** The ball's accessible name while the shell is the one answering it. */
  label(): string;
  /** A click on the ball while Prompt Manager is off here. */
  activate(): void;
  /** Opens the panel without toggling it. */
  open(): void;
}

/** Holds the ball until the returned stop runs. */
export function holdBall(options: BallHoldOptions): () => void {
  const binding = promptCoverageBindingForUrl(location.href);
  let lease: BallLease | null = null;
  let stopped = false;
  /** Whether Prompt Manager is meant to run here; a live change outranks the first read. */
  let covered: boolean | null = null;

  const apply = (): void => {
    lease?.setActivate(covered ? null : options.activate, options.open);
  };

  const onChanged = (changes: StorageChanges, area: string): void => {
    const change = changes[StorageKeys.PROMPT_CUSTOM_WEBSITES];
    if (area !== 'sync' || !change || !binding) return;
    covered = binding.read(change.newValue);
    apply();
  };
  chrome.storage.onChanged.addListener(onChanged);

  void (async () => {
    if (binding) {
      try {
        const stored = await chrome.storage.sync.get(StorageKeys.PROMPT_CUSTOM_WEBSITES);
        covered ??= binding.read(stored?.[StorageKeys.PROMPT_CUSTOM_WEBSITES]);
      } catch {
        covered ??= false;
      }
    }
    if (stopped) return;
    const acquired = await promptBall.acquire({ id: 'panel-shell' }, async () => {
      const startup = await readPromptStartupSettings();
      const site = resolvePromptSiteAdapter(location.href);
      return {
        label: options.label(),
        mascotLogo: startup.mascotLogo,
        hiddenByUser: startup.hiddenByUser,
        attention: startup.changelogBadgeActive,
        defaultSpot: (ballHeight) => site.defaultTriggerSpot(ballHeight),
      };
    });
    if (stopped) {
      acquired?.release();
      return;
    }
    lease = acquired;
    apply();
  })();

  return () => {
    stopped = true;
    chrome.storage.onChanged.removeListener(onChanged);
    lease?.release();
    lease = null;
  };
}
