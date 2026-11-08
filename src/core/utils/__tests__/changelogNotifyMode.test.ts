import { describe, expect, it } from 'vitest';

import { releaseAnnouncement } from '../changelogNotifyMode';

const current = '2.3.1';

describe('releaseAnnouncement', () => {
  it.each([
    ['popup', '2.3.0', false, 'popup'],
    [undefined, '2.3.0', false, 'popup'],
    ['bogus', '2.3.0', false, 'popup'],
    ['badge', '2.3.0', false, 'badge'],
    ['off', '2.3.0', false, 'none'],
    // Older popups wrote an empty read version on choosing badge mode.
    ['badge', '', false, 'badge'],
    ['popup', '', false, 'popup'],
    // A first install and an already read release announce nothing.
    ['popup', undefined, false, 'none'],
    ['badge', undefined, false, 'none'],
    ['popup', current, false, 'none'],
    ['badge', current, true, 'none'],
    // A forced release pops up whatever was chosen.
    ['off', '2.3.0', true, 'popup'],
    ['badge', '2.3.0', true, 'popup'],
    ['off', undefined, true, 'none'],
  ])(
    'mode %j with %j read (forced: %s) announces %s',
    (mode, readVersion, forcePopup, expected) => {
      expect(releaseAnnouncement({ mode, readVersion, currentVersion: current, forcePopup })).toBe(
        expected,
      );
    },
  );
});
