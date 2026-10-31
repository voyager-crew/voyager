# Kimi · Folders

Folders for Kimi conversations: a folder section above the history in Kimi's
sidebar (a floating panel while the page lists no history), rows dragged from
the history onto a folder, import and export, and folder sync. This plugin
contains no code: it invokes Voyager's first-party `folders` primitive through a
`native` op, and everything about Kimi's page comes from the `folders` section
of `sites/kimi/site.json`.

- Requires the plugin engine that ships `folders` (`"engine": ">=1.10.0"`).
- Ships disabled; enable it from the popup on Kimi.
- Folders, their keys (`gvFolderData:kimi`), the Drive file
  (`gemini-voyager-kimi-folders.json`) and the backup namespace (`kimi-folders`)
  are Voyager's per-site folder policy, not this manifest: a catalog update can
  move the section or its rows, never the data. Turning the plugin off keeps
  every folder.
- Kimi's history rows are their `/chat/<id>` links, so a chat is filed by
  dragging the row onto a folder; there is no configured "Move to folder" row
  menu entry.
- **Hide chats already in folders from the sidebar list** (off by default)
  hides each filed chat's whole history row: `folders.hideFiled.rows` names the
  `.next-sidebar-history-item` wrapper around its `/chat/<id>` link, so the
  row's action button goes with it. Kimi's derived folder site has no first-run
  guide.
