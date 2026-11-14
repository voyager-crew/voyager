import type { PrimitiveContract } from '../contractTypes';

export const contract: PrimitiveContract = {
  name: 'folders',
  sinceEngine: '1.10.0',
  semantic: [],
  sections: { folders: 1 },
  settings: { hideFiledChats: 'boolean' },
  params: {},
  description:
    "Folders for this site's conversations: a folder section in the site's own sidebar (a floating panel while the page shows none), sidebar rows dragged onto a folder, \"Move to folder\" in a row's own menu, \"New chat in this folder\" in a folder's menu (it opens the site's own new chat and files the conversation the first send there creates), and renaming a filed chat with the site's own rename where the site describes them, import and export, and cloud sync. Where the sidebar, its rows and the section's place are comes from the site's `folders` section in site.json; storage, account scope, backups and Drive follow Voyager's per-site folder policy, so only sites in that policy get folders, and one folders runtime runs per page. The boolean setting `hideFiledChats` hides filed chats from the sidebar list and applies without a reload. Turning the plugin off keeps every folder.",
};
