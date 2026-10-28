import { baselinedRule, isProductionFile, isTestCode } from './baseline.mjs';
import { collectDoubleCasts } from './double-cast.mjs';
import { collectSleeps } from './sleeps.mjs';
import { collectTimeouts, collectUnlinkedSkips } from './test-api.mjs';
import { collectUnforgeableStubs } from './unforgeable-stub.mjs';

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
    'no-double-cast': baselinedRule(
      'voyager/no-double-cast',
      'Parse the value into the type with a type guard or narrowing instead of forcing it through unknown.',
      collectDoubleCasts,
      { targetsFile: isProductionFile, nodeTypes: ['TSAsExpression', 'TSTypeAssertion'] },
    ),
    'no-unforgeable-global-stub': baselinedRule(
      'voyager/no-unforgeable-global-stub',
      'Move the test page with setPageUrl() or count reloads with watchFullPageLoads() from @/tests/pageUrl: the VM pools run tests in a browser realm, which cannot redefine location, window, document or top.',
      collectUnforgeableStubs,
      { targetsFile: isTestCode },
    ),
  },
};
