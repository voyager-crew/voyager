# AI Studio · Folders

Folders for saved prompts in AI Studio's left nav (`aistudio.google.com` and
`aistudio.google.cn`). This is Voyager's built-in AI Studio folders, packaged
as an official plugin: the manifest contains no code of its own and invokes
the first-party `folders` primitive through a `native` op, which on AI Studio
shows the folder panel, the Library drop zone and the Drive menu over AI
Studio's folder session in core.

## Delivery and control

- Ships inside the extension and updates only with a Voyager release. It is
  never published to or replaced by the online plugin catalog. AI Studio pages
  can receive page-locator fixes through the shared Online updates setting. A local plugin cannot call `folders`
  on AI Studio.
- Controlled by the existing folders switch in Voyager's settings
  (`geminiFolderEnabled`, on unless turned off), shared with Gemini's folders.
  Its `hideFiledChats` setting is AI Studio's own "hide archived" switch
  (`aistudioFolderHideArchivedConversations`), which hides the Library rows of
  prompts already in a folder.
- The folder data (`gvFolderDataAIStudio`, per account when account isolation
  is on), its sync → local migration and the popup's cloud-sync answers belong
  to the page, not the plugin: they keep working while the plugin is off.
- Needs no extra site access: Voyager's content script already runs on AI
  Studio.

## Status

This plugin is the feature's only runtime: `src/features/plugins/sites/featureOwners.ts`
assigns the feature to it, and the plugin host admits it where the retired
native manager used to start.
