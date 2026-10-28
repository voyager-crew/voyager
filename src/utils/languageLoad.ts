import { type Machine, startMachine } from '@/features/plugins/runtime/stateMachine';

import type { AppLanguage } from './language';
import { getLoadedTranslations, loadTranslations } from './translations';

type LoadState = { status: 'loading' } | { status: 'done' };
type LoadEvent = { type: 'done' };

/** A later selection retires an earlier chunk request before it can change the interface. */
export function createLanguageLoader() {
  let active: Machine<LoadState, LoadEvent> | undefined;

  return {
    stop(): void {
      void active?.stop();
      active = undefined;
    },
    load(
      language: AppLanguage | (() => Promise<AppLanguage>),
      apply: (language: AppLanguage) => void,
    ): Promise<boolean> {
      void active?.stop();
      return new Promise<boolean>((resolve, reject) => {
        active = startMachine<LoadState, LoadEvent>(
          {
            id: 'language-load',
            transition: () => ({ status: 'done' }),
            effects: {
              loading(stay) {
                stay.scope.effect(() => () => resolve(false), 'pending language selection');
                const fail = (error: unknown) => {
                  if (stay.signal.aborted) return;
                  reject(error);
                  stay.send({ type: 'done' });
                };
                const complete = (selected: AppLanguage) => {
                  if (stay.signal.aborted) return;
                  apply(selected);
                  resolve(true);
                  stay.send({ type: 'done' });
                };
                const load = (selected: AppLanguage) => {
                  if (stay.signal.aborted) return;
                  if (getLoadedTranslations(selected)) complete(selected);
                  else void loadTranslations(selected).then(() => complete(selected), fail);
                };
                if (typeof language === 'function') {
                  void language().then(load, fail);
                } else {
                  load(language);
                }
              },
            },
          },
          { status: 'loading' },
        );
      });
    },
  };
}
