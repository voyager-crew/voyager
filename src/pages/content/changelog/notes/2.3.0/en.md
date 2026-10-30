> _"Yesterday is history, tomorrow is a mystery, but today is a gift." — Master Oogway, 《Kung Fu Panda》 (2008)_

### Highlights

- 🎛️ **Voyager panel**: hover the floating button and click the panel entry that pops out, or press ⌥V / Alt+V, to open the panel right on the page: turn the current site's features on and off without leaving the chat, drag sliders with a live preview, manage site access and run cloud sync; typing `/` in the composer opens it too. The floating button can now be hidden in one click, and ⌥V brings it back.
- ☁️ **Safer cloud sync, with undo for downloads**: when an upload would empty or sharply shrink your cloud data, or the cloud file can't be read, Voyager asks whether to merge, upload anyway or cancel; a download from the cloud can be undone in one click; before each upload, Drive keeps the 3 most recent replaced versions so you can restore the previous one. The panel's cloud sync also lets you choose which sites sync and shows the status of each.
- 🛰️ **Site fixes arrive faster**: the page locators for each site now come through online updates, so when a site redesign breaks a feature, it can be fixed without waiting for store review; a refresh button beside the Online updates switch checks once on demand. With online updates off, Voyager runs only on its built-in version.

### New

- **Site access card**: a new Site access card in the popup shows every site's access and the features turned on there, with undo when you revoke access; on :chatgpt: ChatGPT, :claude: Claude, :deepseek: DeepSeek and :kimi: Kimi, Prompt Manager becomes a switch in that site's feature list.
- **Movable export button**: drag the floating export button anywhere; each site remembers its spot, and dropping it near the default position snaps it back.
- **Safari app in your Voyager language**: the Voyager app's window, menus and notifications on macOS use the language you chose in Voyager, and Arabic mirrors the layout.
- **:chatgpt: ChatGPT exports list uploaded files**: files uploaded in a conversation appear in the export as a "📎 file name" line.

### Fixes

- **Export starts with everything selected**: once the whole conversation is read, every message starts selected instead of "0 selected" with Export greyed out.
- **:chatgpt: ChatGPT PDF export no longer blank**: PDF export works with ChatGPT's new print handling and shows the conversation again.
- **:chatgpt: ChatGPT says when it can't read the history**: when export can't read the full history, it says so and suggests scrolling up to load it before retrying, instead of leaving you waiting.
- **:chatgpt: ChatGPT folder guide stops popping up**: the guide no longer appears every time the collapsed sidebar slides out on hover; it waits until the sidebar is docked open.
- **Export button stays clear of page controls**: the export button moves out of the way of the site's own buttons, such as the share button in :claude: Claude's top bar, and drops behind the site's dialogs.
- **:claude: Claude dark mode**: when Claude switches to dark mode, Voyager's interface follows.
- **Safer Mermaid rendering**: diagrams render in a separate, isolated page that loads no outside images or fonts, and a failed render retries on its own.
- **Failed syncs no longer upload partial data**: if reading cloud or local data fails, the upload stops before writing anything; syncing from two places at once no longer overwrites each other, and failure messages say why.
- **Overwrite download no longer wipes data**: data missing from the cloud or unreadable there stays as it is locally, and an empty plugin list in the cloud no longer clears your plugins.
- **Safari Drive connection and account switching**: after connecting Google Drive in the Voyager app, the popup shows it as connected right away; after switching accounts, sync follows the new account, and switching mid-sync stops it instead of mixing two accounts' data.
- **Backups carry only the settings you changed**: exported and Drive settings files hold only what you actually changed, so restoring no longer overwrites another device's choices with defaults; device-only settings such as panel and button positions no longer sync.
- **Plugins work again on Android**: on Android browsers such as Edge, plugins no longer say they aren't supported on phones, and folder settings and Google Drive sync work again.
- **Hover previews easier to reach**: moving diagonally toward a prompt's hover preview no longer switches it to the rows you pass over.
- **Translation fixes**: the folder panel's sync messages no longer show in English, and Prompt Manager's cloud sync buttons no longer overflow in Russian.
- **Less memory**: Voyager loads only the language you use, so each page takes less memory.

With account isolation on, each account's Drive files are now named by email. Update every device to this version, or older devices won't see new uploads.
