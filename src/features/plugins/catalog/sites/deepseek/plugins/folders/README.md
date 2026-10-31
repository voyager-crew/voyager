# DeepSeek · Folders

Folders for DeepSeek conversations: a folder section above the history in
DeepSeek's sidebar (a floating panel while the page lists no history), rows
dragged from the history onto a folder, import and export, and cloud sync. This
plugin contains no code: it invokes Voyager's first-party `folders` primitive
through a `native` op, and everything about DeepSeek's page comes from the
`folders` section of `sites/deepseek/site.json`.

- Requires the plugin engine that ships `folders` (`"engine": ">=1.10.0"`).
- Ships disabled; enable it from the popup on DeepSeek.
- Folders, their keys (`gvFolderDataDeepSeek`), the Drive file
  (`gemini-voyager-deepseek-folders.json`) and the backup namespace are
  Voyager's per-site folder policy, not this manifest: a catalog update can
  move the section or its rows, never the data. Turning the plugin off keeps
  every folder.
- DeepSeek's row menu has no link to its row, so a chat is filed by dragging
  it onto a folder; there is no "Move to folder" menu entry.
- **Hide chats already in folders** hides filed chats from the history and
  applies at once.
