import { baselinedRule } from './baseline.mjs';
import { collectSleeps } from './sleeps.mjs';
import { collectTimeouts, collectUnlinkedSkips } from './test-api.mjs';

export default {
  meta: { name: 'voyager' },
  rules: {
    'no-real-sleep-in-tests': baselinedRule(
      'voyager/no-real-sleep-in-tests',
      'Advance fake timers or await the event the code emits instead of sleeping on real time.',
      collectSleeps,
    ),
    'no-per-test-timeout': baselinedRule(
      'voyager/no-per-test-timeout',
      'Keep the shared test timeout; advance fake timers or await completion instead of extending a test timeout.',
      collectTimeouts,
    ),
    'no-unlinked-skip': baselinedRule(
      'voyager/no-unlinked-skip',
      'Link the quarantine with a // quarantine: #<issue> comment on the same or preceding line, or enable the test.',
      collectUnlinkedSkips,
    ),
  },
};
