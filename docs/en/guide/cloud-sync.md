# Cloud Sync

Voyager Cloud Sync backs up your folders, prompt library, starred messages, and supported settings. Choose Google Drive on any supported browser, or iCloud on Safari. Data moves directly between Voyager and the personal cloud account you select; Voyager does not operate a sync server.

## What Gets Synced

| Data Type               | Synced | Details                                                                                                          |
| ----------------------- | ------ | ---------------------------------------------------------------------------------------------------------------- |
| Folder structure        | Yes    | Folders on Gemini, AI Studio, ChatGPT, Claude, DeepSeek, and Kimi: nesting, colors, and conversation assignments |
| Prompt library          | Yes    | All saved prompts with tags and folder organization                                                              |
| Starred messages        | Yes    | Timeline bookmarks from any conversation                                                                         |
| Timeline on other sites | Yes    | Timeline stars and levels on ChatGPT, Claude, and DeepSeek                                                       |
| Extension settings      | Yes    | `gemini-voyager-settings.json`: cross-device preferences such as sorting, colors, and input behavior             |
| Plugin configuration    | Yes    | `gemini-voyager-plugins.json`: install/enable state and plugin settings; site permissions remain per-device      |
| Model answers           | No     | Star backups contain user prompts, not model answers                                                             |

**Enable Hard Isolation** no longer travels in the cloud settings file. Your browser's own sync (Chrome sync, for example) still carries it between computers signed in to the same browser profile.

## Starred Data and Sync Limits

Cloud uploads include the **full user prompts you star** (up to 16 KiB UTF-8 per prompt) in your own Google Drive or iCloud. Star backups do not store model answers. The legacy v1 backup keeps previews only; the new v2 backup includes prompt text and deletion records.

Deletion records are retained for 180 days. Older Voyager versions ignore them and may display or upload deleted stars again; newer versions suppress stale copies with unchanged timestamps. An explicit newer re-star, or an expired deletion record, can restore a star. Long offline periods and device clock differences also affect deletion propagation.

Sync merges and checks its writes, with at most three attempts, but is not an atomic transaction across devices: concurrent uploads can still overwrite another device's write. A later sync from a device retaining the missing data can repair this; recovery is not guaranteed if it never syncs again. Partial upload failures keep writes already accepted; sync again to finish the repair.

## Features

- **Multi-Device Sync**: Keep your configurations in sync across multiple devices.
- **Data Privacy**: Data is stored in your own Google Drive or private iCloud database, without a Voyager server.
- **Flexible Sync**: Support for manual uploading and downloading/merging of data.

::: info
Device identifiers, access tokens, caches, viewport coordinates, panel position, export button position, and temporary runtime state are intentionally not synced as personalization settings.
:::

## How to Use

1. Open a Gemini, AI Studio, ChatGPT, Claude, DeepSeek, or Kimi tab, then click the Voyager icon in your browser's toolbar to open the popup. The **Cloud Sync** section appears only on these sites, and each site's folders sync separately.
2. Locate the **Cloud Sync** section.
3. On Safari, choose **Google Drive** or **iCloud**. Other browsers use Google Drive.
4. Set **Sync Mode** to **Manual**. It starts as **Disabled**, and the sync buttons appear only in Manual mode.
5. For Google Drive on Safari, click **Connect Google Drive** to sign in through the Voyager app. Other browsers have no separate sign-in button: Google's authorization window opens the first time you click **Upload** or **Download & Merge**. For iCloud, make sure the Mac is signed in to iCloud.
6. Click **Upload** to send local data to the cloud, or **Download & Merge** to merge cloud data into this browser. **Overwrite** asks first, then replaces only the data the cloud has and Voyager can read; anything missing or unreadable in the cloud stays as it is, and the result lists it. You can undo right after.

With iCloud, **Delete iCloud backup** removes every Voyager backup from iCloud; local data on the Mac stays as it is.

## Sync from the Panel

<GuideOp>

The cloud icon in the [Voyager panel](/en/guide/panel)'s top bar opens **Cloud Sync**, so you can sync through Google Drive without leaving the chat. Until Drive is connected, click **Connect Google Drive**; the first sync after connecting merges cloud and local, and nothing is overwritten.

- **Choose sites**: **Shared** (Prompts · Settings · Plugins) and each site have a row. Switch a row off and this device skips it when syncing; a supported site you grant access to joins automatically.
- **Status**: each row shows **Synced**, **Newer here**, **Newer in cloud**, **Not uploaded** or **Couldn't check**. The main button, **Sync** followed by a count, runs every pending row at once.
- **In the cloud**: a site that is off on this device but has cloud data gets its own row; **Enable** takes you to the **Sites** tab to turn it on.
- **More**: the menu holds **Upload all**, **Merge all from cloud**, **Restore previous version** and **Disconnect Google Drive**. **Restore previous version** asks first, then puts each switched-on row back to its previous version in the cloud.

</GuideOp>

### 💡 Quick Sync

The quickest way is the cloud icon in the folder area's header in the left sidebar: click it, then choose **Upload to Cloud** or **Sync from Cloud**.

<GuideShot src="/assets/cloud-sync.png" alt="Cloud Sync Quick Buttons" :width="440" />

::: warning
**Security Recommendation: Double Protection**  
While Cloud Sync offers great convenience, we strongly recommend that you also periodically back up your core data to **local files**.

1. **Folders**: Open the folder area's menu, choose **Import/Export folders**, then **Export folders** to save all your folders and conversation assignments.
2. **Prompts**: In the Prompt Manager, click **Export** to save your prompt library.
   :::

## Sync Safety

<GuideFacts>
<GuideFact title="Upload confirmation">

If an upload would make a cloud file much smaller (this device has none of something the cloud has, or less than half when the cloud has at least 4), or Voyager can't read the cloud file, it asks first: **Merge from cloud instead**, **Upload anyway** or **Cancel**. Merging is offered only when the cloud file is readable.

</GuideFact>
<GuideFact title="Overwrite replaces only what exists">

**Overwrite** keeps any kind of data the cloud lacks or Voyager can't read, and lists it in the result. An empty plugin list in the cloud never clears your plugins.

</GuideFact>
<GuideFact title="Undo right after a download">

After **Download & Merge** or **Overwrite**, the popup's result line offers **Undo** while the popup stays open. The folder area's cloud notice offers it for about 10 seconds and waits while you point at it. Undo restores what that download changed and keeps anything you changed afterwards. Only the latest download can be undone.

</GuideFact>
<GuideFact title="History copies in Google Drive">

Before an upload replaces a file, Voyager keeps the replaced version beside it in its Drive folder as `<file>.backup-<UTC time>.json`, for example `gemini-voyager-folders.backup-2026-10-29-031100.json`. It keeps the latest 3 per file and moves older ones to Drive's trash. **Restore previous version** in the panel's Cloud Sync menu puts the cloud back to the previous version. iCloud also keeps the 3 latest replaced versions of each kind of data.

</GuideFact>
<GuideFact title="Update every device">

With **Enable Hard Isolation** on, current Voyager names each account's Drive files by the account's email. A device still on Voyager 2.2.1 that first saw the account at a numbered address (gemini.google.com/u/1) won't see what newer versions upload until it updates. Chrome Web Store updates arrive within days; Safari takes longer.

</GuideFact>
</GuideFacts>

## Cloud Sync vs. Manual Backup

| Aspect         | Manual Backup (Export/Import)     | Cloud Sync                                      |
| -------------- | --------------------------------- | ----------------------------------------------- |
| Frequency      | Whenever you remember             | On-demand with one click                        |
| Data location  | Local file on your computer       | Your Google Drive or private iCloud database    |
| Cross-device   | Requires transferring files       | Devices signed in to the selected cloud account |
| Merge behavior | Replaces or requires manual merge | Intelligent merge without duplicating           |
| Privacy        | File stays on your machine        | Stored in your personal cloud account           |

## How It Works

1. **Provider**: Google Drive uses the limited `drive.file` permission, so Voyager can only access files it created. On Safari, iCloud uses the app's private CloudKit database and does not expose an Apple ID token to Voyager.
2. **Upload**: When you click **Upload**, Voyager writes separate backup files for folders, prompts, stars, forks, timeline hierarchy, personalization settings, and plugin configuration to the selected provider. Highlight data is included when highlight cloud sync is enabled.
3. **Download & Merge**: When you click **Download & Merge** on another device, Voyager reads those files and merges them by data type. New folders and prompts are added without duplication, cloud preferences are restored, and plugin entries are merged by plugin ID.
4. **No background sync**: Sync is manual and on-demand. Voyager never syncs without your explicit action.

Switching providers does not copy data between them and does not write to both providers. Upload once after switching if you want the current local data in the newly selected provider.

## Supported Platforms

Google Drive sync works on Chrome, Edge, Firefox, and Safari on computers, and on Android browsers with Google sign-in, such as Edge. It isn't available on Firefox for Android, which can't open Google's sign-in window. iCloud sync is available only in the directly distributed Safari app and uses the iCloud account signed in on the Mac.
