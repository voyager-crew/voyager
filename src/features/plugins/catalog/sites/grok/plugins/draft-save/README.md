# Grok draft auto-save

Keeps unsent text in the Grok composer. After a one-second pause in typing the
text is saved to this device; when you refresh the page or open the same
conversation again, it goes back into the composer, but only while the composer
is empty, so anything you already typed is never replaced. The restore does not
move focus. Sending the message drops its draft.

Drafts are keyed by the conversation id in `/c/<uuid>`, from the adapter's
`conversationIdPattern`. A page that does not match (the new-chat page) shares
one new-chat draft. Drafts live in `chrome.storage.local` as `gvDraft:grok:…`,
at most five per site, and are cleared from the popup's storage page together
with Gemini drafts. They are not backed up or synced. Grok routes carry no
account index, so two accounts in one browser share drafts per conversation id.

The plugin uses the `draftSave` primitive with the adapter's `composer` and
`sendButton` semantic selectors and its `conversationIdPattern`. Turning it off
stops saving and restoring and keeps the drafts already saved.

Grok's Private chat mode is not recognized as a temporary chat, so its drafts
are saved like any other new-chat draft, as with Claude's incognito chats.

Live check (2026-11-17, grok.com): a four-block draft with an empty paragraph
came back unchanged after a reload, and a cleared draft stayed cleared. A
new-chat draft restored after a reload, and sending it as the first message of
a chat dropped it: the new-chat page was empty afterwards. A conversation draft
restored after a reload and was gone after it was sent.
