# Privacy Policy

Last updated: October 25, 2026

## Overview

Voyager is a local-first browser extension for organizing and enhancing supported AI chat workspaces. It processes limited user data only to provide features the user requests. Voyager does not operate a backend that receives conversations, prompts, browsing activity, images, or account identifiers, and it does not use advertising or analytics trackers.

## Data Processed

Depending on which features you use, Voyager may process:

- **Website content and personal communications**: conversation text, prompts, drafts, images, links, and other supported-page content used for folders, navigation, export, prompt management, research, and interface features.
- **Account identifiers**: a supported Google service may expose the signed-in email address. Voyager converts it to a local account identifier so data from different accounts remains separated. Voyager does not send the raw email address to us.
- **Web history and user activity**: supported-site URLs, conversation routes, and limited page, interaction, and network events needed for navigation, shortcuts, usage displays, response-completion notifications, and other requested features. This data is not used for profiling or advertising.
- **Authentication information**: an OAuth2 token with the `drive.file` scope, only when the user explicitly enables Google Drive sync.
- **Extension data and settings**: folders, prompt templates, drafts, starred messages, usage snapshots, plugin state, and interface preferences.

This data is stored locally in `chrome.storage.local` or, for supported settings, in `chrome.storage.sync`. Some features also use the supported site's own `localStorage` on the user's device, for backup copies of folder data and for timeline caches. Short-lived handoff records use session storage: the browser's in-memory extension `storage.session` for the Research Pack handoff, and, for the ChatGPT temporary-chat handoff, a tab token in the page's `sessionStorage` while the transcript waits in `chrome.storage.local` for at most 60 seconds. It remains on the user's device or browser-sync account unless the user explicitly uses a transfer described below.

## User-Requested Transfers

- **Google Drive sync (optional)**: selected backup data is transferred directly between the user's device and their own Google Drive. Chrome, Edge, and Firefox use the browser identity API; the direct Safari app uses native Google Sign-In and stores credentials in the macOS Keychain. Both paths request only the limited `drive.file` scope, and OAuth tokens are not sent to a Voyager server. In Chromium browsers, when the browser cannot issue a token directly (for example in Brave, or when that sign-in fails), Google returns the sign-in result to a static relay page at `https://voyager.nagi.fun/oauth/callback/`, whose script forwards it within the browser to the extension. The token is carried in the URL fragment, which browsers do not send to the server; as with any web page, the static host sees the requesting IP address and browser user agent. Firefox instead uses a loopback redirect (`http://127.0.0.1/mozoauth2/…`) that the browser intercepts before any request leaves it, and exchanges the authorization code directly with Google using PKCE.
- **iCloud sync on Safari (optional)**: selected backup data is transferred by the native Safari extension directly to the user's private CloudKit database in their iCloud account. Voyager does not receive the user's Apple ID or an iCloud authentication token, and the developer cannot access records in that private database.
- **Exports and images**: when the user requests an export, Voyager may fetch images from their existing page-hosted sources and may request temporary access needed to capture generated interface content. The resulting file is created for the user; it is not uploaded to a Voyager server.
- **Context Sync (optional)**: when the user presses sync, Voyager sends the captured conversation context to a local server on the user's own computer at `http://127.0.0.1:<port>/sync` (port 3030 by default, configurable). While the feature is enabled and the popup is open, it also checks that address to show whether the local server is reachable. This data does not leave the device through Voyager.
- **Research Pack "Continue in ChatGPT / Claude"**: when the user chooses a target, Voyager opens a new chat on the selected site (ChatGPT or Claude). If Voyager is active there, the pack is handed over through the browser's in-memory `storage.session`, claimed once by that tab, and placed in the composer without being sent; the record expires after 60 seconds. Otherwise the pack is copied to the clipboard for the user to paste. The pack never travels in a URL.
- **ChatGPT temporary-chat handoff**: when the user continues a ChatGPT temporary chat, Voyager downloads a Markdown backup to the user's device, leaves temporary mode, and places the conversation in the composer of a normal ChatGPT chat without sending it. The transcript stays on ChatGPT and the user's device.
- **Public project resources**: Voyager may request public release, announcement, or documentation resources. These requests do not include conversation or prompt content.
- **Plugin catalog updates**: on a site where the user has enabled at least one plugin, Voyager may fetch an updated catalog file for that site over HTTPS from `https://voyager.nagi.fun/catalog/hosts/<site host>.json`, for example `https://voyager.nagi.fun/catalog/hosts/chat.deepseek.com.json`. The check runs when such a page is opened, or when the extension popup is opened on it, and only if the last check is older than the interval the user chose (6 hours by default; 1 hour, 6 hours, 24 hours, or manual only). Gemini and AI Studio keep their packaged official plugins and never make plugin catalog requests. The request is a plain GET that carries no cookies, no account or extension identifier, and no page or conversation content; as with any web request, the server sees the requesting IP address and browser user agent, plus the site host name in the URL path. On plugin sites the popup provides a "Plugin online updates" switch and the check interval selector, both stored in browser sync storage and included in settings backup. With the switch off, Voyager makes no plugin catalog request to voyager.nagi.fun unless the user presses "Check for plugin updates now". If the request fails or the site has no catalog file, the plugin snapshot bundled with the extension stays in use. A fetched catalog contains only CSS and JSON, which are validated and sanitized before use; no JavaScript is downloaded or executed. This check is separate from the announcement check, which has its own setting. voyager.nagi.fun is static hosting behind a Cloudflare proxy; the Voyager project does not log or retain these requests, and connection metadata (IP address, User-Agent) is handled by the hosting providers under their own privacy policies.
- **Online fixes for Gemini page detection (optional, off by default)**: after you enable this separate switch under General, Voyager may fetch `https://voyager.nagi.fun/catalog/gemini-selectors/v1/hosts/gemini.google.com.json`. The file contains only validated rules for finding conversation turns on the page, with no code, CSS or plugins. Opening Gemini or its popup may trigger an automatic check, at most once every 6 hours from the last attempt. Turning the setting off and on does not reset this interval. A check interrupted by an extension restart may be retried. “Check now” bypasses only the interval and works only while enabled. Turning the switch on needs an open Gemini tab; you can turn it off from the popup on any tab. Off blocks every one of these requests, including manual checks, cancels in-flight checks and deletes the downloaded data; the last-attempt time remains local. Consent and downloaded data are device-local and excluded from browser sync and settings backups. New fixes and switching off take effect on a page after you refresh it yourself; open pages keep their current snapshot, with no automatic reload. GET requests send no cookies, referrer, identifiers, or page or conversation content. The server sees the IP address, User-Agent and requested host; the hosting policies above apply. AI Studio stays packaged-only. Plugin updates and announcements keep their separate settings.

Voyager does not sell user data or transfer it for advertising, creditworthiness, or purposes unrelated to the extension's user-facing features.

## Permissions

- **Storage**: saves extension data and preferences locally and, where supported, through browser sync. Chrome, Edge, and Firefox also grant `unlimitedStorage` so local data isn't cut off by the default browser quota; Voyager still applies its own storage limit. On Safari it is optional.
- **Identity**: authenticates optional Google Drive sync after explicit user action. Safari does not request it: Google Drive and iCloud sync on Safari go through the Voyager macOS app.
- **Scripting**: injects only extension-bundled scripts on supported sites; no remote JavaScript or WebAssembly is executed.
- **Active tab and declarative content**: identifies the supported site opened by the user and displays the appropriate site-specific controls. Declarative content is used on Chrome and Edge only.
- **Alarms**: schedules periodic checks for public announcements, plus background timers that clean up expired handoff records and run delayed tasks.
- **Notifications (optional)**: requested only when the user turns on response-completion notifications or system alerts for remote announcements. Safari does not request it; response-completion notifications there are shown by the Voyager macOS app.
- **Native messaging (Safari only)**: connects the Safari extension to the Voyager macOS app for Google Drive and iCloud sync and for response-completion notifications.
- **Host permissions**: granted at install for Gemini, Gemini Enterprise, and AI Studio, plus the Google domains needed for user-requested Google Drive and image operations.
- **Optional host permissions**: Claude, ChatGPT, DeepSeek, and custom sites are accessed only after the user enables Voyager or a plugin for that site and approves the browser's permission prompt. `<all_urls>` may also be requested temporarily when the user chooses an export that captures generated interface content; if denied, export continues without that capture.

## Retention and User Control

Local and browser-sync data remains until the user deletes it, clears extension storage, or uninstalls the extension. Copies that Voyager keeps in a supported site's own `localStorage` (folder backups and timeline caches) are not removed on uninstall; clear that site's data in the browser to remove them. Cloud backups remain in the user's selected Google Drive or iCloud account until the user removes them from that account. Users can disable optional features and revoke optional site access or Google authorization through Voyager and browser settings.

## Google API Limited Use

Voyager's use and transfer of information received from Google APIs adheres to the Chrome Web Store User Data Policy, including the Limited Use requirements.

## Changes to This Policy

We may update this Privacy Policy as Voyager changes. The latest version and its update date will be published on this page.

## Contact Us

For privacy questions, contact us through the [Voyager GitHub repository](https://github.com/voyager-crew/voyager).
