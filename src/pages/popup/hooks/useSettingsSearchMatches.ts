import { useEffect, useMemo, useState } from 'react';

import { logger } from '@/core/services/LoggerService';
import { startMachine } from '@/features/plugins/runtime/stateMachine';

import {
  type SettingsSearchItem,
  getLoadedSettingsSearchMatches,
  getSettingsSearchMatches,
} from '../utils/settingsSearch';

type SearchState<Id extends string> =
  | { status: 'loading' }
  | { status: 'ready'; matches: ReadonlySet<Id> }
  | { status: 'failed'; error: unknown };

type SearchEvent<Id extends string> =
  | { type: 'resolved'; matches: ReadonlySet<Id> }
  | { type: 'rejected'; error: unknown };

function transitionSearch<Id extends string>(
  state: SearchState<Id>,
  event: SearchEvent<Id>,
): SearchState<Id> {
  if (state.status !== 'loading') return state;
  return event.type === 'resolved'
    ? { status: 'ready', matches: event.matches }
    : { status: 'failed', error: event.error };
}

/** A completed search belongs to the query and popup inventory that requested it. */
export function useSettingsSearchMatches<Id extends string>(
  items: readonly SettingsSearchItem<Id>[],
  query: string,
): { matches: ReadonlySet<Id>; loading: boolean } {
  const loadedMatches = useMemo(() => getLoadedSettingsSearchMatches(items, query), [items, query]);
  const [result, setResult] = useState<{
    status: 'loading' | 'ready';
    items: readonly SettingsSearchItem<Id>[];
    query: string;
    matches: ReadonlySet<Id>;
  }>(() => ({ status: 'loading', items, query, matches: loadedMatches }));

  useEffect(() => {
    const machine = startMachine<SearchState<Id>, SearchEvent<Id>>(
      {
        id: 'popup-settings-search',
        transition: transitionSearch,
        effects: {
          loading(stay) {
            setResult((previous) => {
              if (
                previous.items === items &&
                (previous.query === query ||
                  (previous.query.trim() && query.trim() && previous.matches.size > 0))
              ) {
                return previous;
              }
              return { status: 'loading', items, query, matches: loadedMatches };
            });
            void getSettingsSearchMatches(items, query).then(
              (matches) => stay.send({ type: 'resolved', matches }),
              (error: unknown) => stay.send({ type: 'rejected', error }),
            );
          },
          ready(stay) {
            setResult({ status: 'ready', items, query, matches: stay.state().matches });
          },
          failed(stay) {
            logger.warn('Could not load settings search translations', {
              error: String(stay.state().error),
            });
            setResult({
              status: 'ready',
              items,
              query,
              matches: getLoadedSettingsSearchMatches(items, query),
            });
          },
        },
      },
      { status: 'loading' },
    );
    return () => {
      void machine.stop();
    };
  }, [items, query, loadedMatches]);

  // Keep the last matches while chunks load instead of unmounting every setting on each key.
  const matches =
    result.items === items &&
    result.query.trim() &&
    query.trim() &&
    (result.query === query || result.matches.size > 0)
      ? result.matches
      : loadedMatches;
  const loading =
    query.trim().length > 0 &&
    (result.items !== items || result.query !== query || result.status === 'loading');
  return { matches, loading };
}
