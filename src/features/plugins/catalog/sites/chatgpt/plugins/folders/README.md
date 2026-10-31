# ChatGPT · Folders

Folders for ChatGPT conversations: a folder section just above Recents in
ChatGPT's sidebar (a floating panel while the page shows no sidebar), "Move to
folder" in a chat row's own menu, rows dragged from the sidebar onto a folder,
renaming a filed chat with ChatGPT's own rename, an Activity view of the chats
you last sent to, import and export, and cloud sync. This plugin contains no
code: it invokes Voyager's first-party `folders` primitive through a `native`
op, and everything about ChatGPT's page comes from the `folders` section of
`sites/chatgpt/site.json`.

- Requires the plugin engine that ships `folders` (`"engine": ">=1.10.0"`).
- On by default, the only site whose folders are: it runs once you grant
  Voyager access to chatgpt.com, until you turn it off in the popup.
- Folders, their keys (`gvFolderDataChatGPT`), the Drive file
  (`gemini-voyager-chatgpt-folders.json`) and the backup namespace are
  Voyager's per-site folder policy, not this manifest: a catalog update can
  move the section, its rows or the menu entry, never the data. Turning the
  plugin off keeps every folder.
- A row is dragged with the same press ChatGPT uses to drag it into a
  Project; Voyager only listens, so ChatGPT's own drag keeps working.
- "Move to folder" sits after ChatGPT's own "Move to project", and works with
  the arrow keys and Enter.
- **Hide chats already in folders** hides filed chats from Recents only and
  applies at once. Chats inside a Project and the open chat stay shown.
- Temporary chats are never filed. Chats filed on chat.openai.com still open,
  but a folder file must name chatgpt.com links.
