# Folders

Keep your chats in folders in the sidebar: drag one in and it's filed, nest folders three levels deep, and get the same folders back on another device. Folders work on computers and Android phones.

<SiteSupport feature="folders" :labels="{ folders: 'Sidebar folders', 'hide-filed': 'Hide filed chats', activity: 'Activity view', 'account-isolation': 'Account isolation', projects: 'Folders as projects', 'ai-organize': 'AI Organize', 'move-menu': '**Move to folder** in the chat menu', 'library-drag': 'Drag from the Library table', 'gem-icons': 'Chat icons by Gem type' }" :only="[{ id: 'move-menu', sites: ['gemini', 'chatgpt', 'claude'] }, { id: 'library-drag', sites: ['aistudio'] }, { id: 'gem-icons', sites: ['gemini'] }]" />

<GuideHero src="/assets/gemini-folders.png" alt="The folder section in the sidebar">

The folder section sits above the chat list in the sidebar. When the sidebar is closed, the same folders are available in a floating panel.

</GuideHero>

## File a chat

<GuideOp>

Any chat in the sidebar can go into a folder, and one chat can sit in several folders.

- **Drag**: drag a chat from the sidebar onto a folder.
- **Chat menu**: on sites that support it, open the chat's own menu and choose **Move to folder**.
- **Multi-select**: long-press a chat inside a folder to start selecting, then move them all at once.
- **AI Studio**: the sidebar doesn't support multi-select yet; you can drag chats from the Library table into a folder.

</GuideOp>

## Nest and rename

<GuideOp side="end">

<GuideShot src="/assets/folders-nested-en.png" alt="Folders nested three levels deep" :width="240" />

Folders go three levels deep: a top-level folder can hold two more levels of subfolders.

- **Subfolder**: right-click a folder and create a subfolder from the menu.
- **Rename**: double-click a folder's name, or choose **Rename** in its right-click menu.
- **Collapse**: click the arrow before a folder to fold or unfold what's inside.

</GuideOp>

### Menu and colors

<GuideOp side="end">

<GuideShot src="/assets/folders-menu-en.png" alt="A folder's right-click menu with its colors" :width="254" />

Right-click a folder and everything you can do to it is in the menu.

- **Pin**: keep the folder at the top.
- **Color**: pick one of 7 colors.
- **Delete**: remove the folder and everything in it, after you confirm.

</GuideOp>

<GuideNote>

**Display settings**: the gear in the folder header switches the chat order (manual or recently opened) and sets the text size, folder spacing and subfolder indent; the popup's **Folder spacing** sets it too. On Mac Safari, you may need to refresh the page to see a change.

</GuideNote>

## Hide filed chats

<GuideOp>

Once a chat is in a folder, you can take it out of the main list so only active chats stay there.

- **Gemini and AI Studio**: open the popup → **Folder Options** → **Hide archived conversations**. Each site keeps its own setting; on AI Studio it hides the rows of the Library table.
- **First filing**: on these two sites, the first time you file a chat, a card in the folder section offers to turn it on in one click. Choose **Not now** and it won't ask again.
- **Other sites**: the switch is in the folders plugin's settings in the popup's **Plugins** area, off by default.
- **Nothing is deleted**: filed chats are always in their folders, and you can turn this off at any time.

</GuideOp>

## Sync and move

<GuideFacts>
<GuideFact title="Import and export">

The folder icon in the folder header has **Import folders** and **Export folders**. Export saves a JSON file; import merges it with your existing folders, so what you've already sorted stays put.

<GuideShot src="/assets/folders-transfer-en.png" alt="Import and export folders" :width="160" />

</GuideFact>
<GuideFact title="Account isolation">

The person button in Gemini's sidebar temporarily shows only the current Google account's chats; it's off by default. **Enable Hard Isolation** in the popup's **Folder Options** splits folders and cloud sync data by account, and the person button then hides itself.

</GuideFact>
<GuideFact title="Cloud sync">

Every site with folders can use cloud sync to get the same folders on another computer. Each site's folders are stored and synced separately.

[Set up Cloud Sync](/en/guide/cloud-sync)

</GuideFact>
<GuideFact title="Activity view">

The bell in the folder header swaps the tree for a read-only Activity view that lists the last few days' chats by their last real activity; press it again to get the tree back. It never moves, copies or re-files a chat.

[Read the full Activity view guide](/en/guide/activity-view)

</GuideFact>
</GuideFacts>

## AI Organize

Too many chats to sort by hand? Let Gemini suggest a folder plan.

<GuideSteps>
<GuideStep>

Open the popup on Gemini and click **AI Organize** at the bottom of **Folder Options**. It writes your unfiled chats and current folder structure into a prompt and copies it; the prompt and the folder names use your language.

<GuideShot kind="panel" src="/assets/ai-auto-folder.png" alt="The AI Organize button in the popup" :width="326" />

</GuideStep>
<GuideStep>

Paste the prompt into Gemini. It replies with a folder plan in JSON.

</GuideStep>
<GuideStep>

Click **Import folders** in the folder header, choose **Or paste JSON directly**, paste, and click **Import**. **Merge with existing folders** is the default: it only adds new folders and new filings, and leaves your existing ones alone.

</GuideStep>
</GuideSteps>

## Folders as projects

Give a folder first-turn instructions, and a new chat files itself there after its first message. The idea comes from Claude Projects, but Voyager only adds first-turn instructions and auto-filing; it isn't a shared-context workspace.

<GuideSteps>
<GuideStep>

Turn on **Enable Folder as Project** in the popup.

</GuideStep>
<GuideStep>

Right-click a folder and choose **Set Instructions** or **Edit Instructions**.

</GuideStep>
<GuideStep>

Start a new Gemini chat and pick the folder in the folder picker next to the input box.

</GuideStep>
<GuideStep>

Send your first message.

</GuideStep>
</GuideSteps>

<GuideNote>

**What happens next**

- After the first send, the chat is filed into that folder.
- If the folder has instructions, Voyager adds them only to that first send. Without instructions, the folder is a quick way to file new chats.
- Chats in the same folder do **not** share memory or read each other.
- Draft autosave keeps only what you typed, never the hidden instructions.

</GuideNote>

For the sidebar's width, see [Sidebar Width](/en/guide/sidebar).
