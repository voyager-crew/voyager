# Panel trust boundary

The host page shares the content script's DOM and can create extension-page
iframes of its own. A panel URL therefore carries no authority. The background
issues a one-time secret to the top-frame content script, and returns the plain
panel page URL separately.

**P5-o:** the shell keeps the secret in its isolated world. On each trusted
load of its exact created iframe, it sends `gv.panel.bootstrap` directly to that iframe's
captured `contentWindow`, with the extension origin as `targetOrigin`. The
secret never appears in `src`, a hash, a DOM attribute, or a message to the host
window. An initial `about:blank` load may drop this send; delivery continues on
later trusted loads until redemption is acknowledged or the frame's lifetime
ends. A host-created copy of the URL stays blank.

The panel accepts one browser-delivered bootstrap from its parent window, then
redeems the secret through the existing runtime protocol. It renders only when
the returned session's host origin matches the bootstrap sender's origin.
Background redemption still requires the issuing tab and the extension panel
page as a subframe, consumes the fresh secret once, and binds the session to the
browser's frame/document identity. Context and privileged requests continue
through that registration and runtime Port; window messages supply no context.

Only after successful redemption and the host-origin match, the panel sends
`gv.panel.bootstrap.accepted` to its parent at that confirmed host origin. The
acknowledgment contains no secret or session data. The shell stops delivery only
for a browser-delivered acknowledgment from the captured frame window at the
extension origin; a host-forged message cannot suppress the handoff.

The shell watches the exact iframe through its entire lifetime, including the
close animation. Removal, replacement, or a `src`/`srcdoc` mutation
closes the shell and asks the background to revoke pending secrets and the
registered frame. A change/reset or detach/reinsert in the same task also
revokes it. Both load and acknowledgment handlers drain pending mutations, and
acknowledgment leaves the lifetime observer active.

Mouse confirmation of slash action rows and keyboard confirmation of those
actions require `isUserEvent`. Synthetic input may show the menu, but cannot
open Prompt Manager or the Voyager panel. Existing prompt completion remains
unchanged. The `#keyboard` hash chooses initial focus-ring presentation only.
