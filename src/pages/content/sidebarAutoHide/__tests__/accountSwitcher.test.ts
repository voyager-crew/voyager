import { afterEach, expect, it, vi } from 'vitest';

import { createHoverIntent } from '../hoverIntent';

afterEach(() => {
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

it('keeps the sidebar open while the account switcher opened from the avatar is open', () => {
  // Google's account panel is a body-level iframe wider than the sidebar.
  const account = document.createElement('iframe');
  account.name = 'account';
  vi.spyOn(account, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 46, 424, 600));
  document.body.appendChild(account);
  const hover = createHoverIntent({
    isEnabled: () => true,
    isEdgeHovered: () => false,
    expand: () => {},
    collapse: () => {},
  });

  expect(hover.canCollapse()).toBe(false);
  // Closed, the panel stays in the DOM as a hidden box.
  account.style.visibility = 'hidden';
  expect(hover.canCollapse()).toBe(true);
  hover.stop();
});
