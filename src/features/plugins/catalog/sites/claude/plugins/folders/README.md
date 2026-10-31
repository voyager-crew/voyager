# Claude · Folders

Folders for Claude conversations: a folder section just above Recents in
Claude's sidebar (a floating panel while the page shows no sidebar), "Move to
folder" in a chat row's own menu, rows dragged from the sidebar onto a folder,
import and export, and cloud sync. This plugin contains no code: it invokes
Voyager's first-party `folders` primitive through a `native` op, and everything
about Claude's page comes from the `folders` section of `sites/claude/site.json`.

- Requires the plugin engine that ships `folders` (`"engine": ">=1.10.0"`).
- Ships disabled; enable it from the popup on Claude.
- Folders, their keys (`gvFolderDataClaude`), the Drive file
  (`gemini-voyager-claude-folders.json`) and the backup namespace are
  Voyager's per-site folder policy, not this manifest: a catalog update can
  move the section, its rows or the menu entry, never the data. Turning the
  plugin off keeps every folder.
- "Move to folder" sits after Claude's own "Add to project" and "Move to
  group", and works with the arrow keys and Enter.
- **Hide chats already in folders** hides filed chats from Recents only and
  applies at once. Pinned chats, Projects and the open chat stay shown.
