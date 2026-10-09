# Folder Import/Export Guide

## Overview

The folder configuration import/export feature allows you to sync folder configurations across devices without setting up a server.

## How to Use

### 📥 Export Folder Configuration (Download ⬇️)

1. Open Gemini chat page
2. Find the **download icon button** (downward arrow ⬇️) in the folder area
3. Click to download the configuration file (format: `gemini-voyager-folders-YYYYMMDD-HHMMSS.json`)

### 📤 Import Folder Configuration (Upload ⬆️)

1. Click the **upload icon button** (upward arrow ⬆️) in the folder area
2. Choose an import strategy:
   - **Merge Mode**: Keep existing folders, only add new ones (recommended)
   - **Overwrite Mode**: Completely replace existing configuration
3. Select a previously exported JSON file
4. Click "Import" to confirm

## Import Strategies

### Merge Mode

- ✅ Keeps all existing folders and conversations
- ✅ Only adds new folders and conversations
- ✅ Automatically skips duplicates (by ID)
- 💡 Best for: Importing partial configurations from other devices

### Overwrite Mode

- ⚠️ Deletes all existing folders
- ✅ Completely uses imported configuration
- 🔒 Keeps a copy of the replaced folders for this tab (see below)
- 💡 Best for: Full sync to a new device

## 🔄 Backup & Recovery

### Backup Information

- **Auto Backup**: Every folder import on Gemini first saves the folders it is about to change
- **Storage Location**: Browser sessionStorage (temporary storage)
- **Validity**: Valid until current tab is closed; the next import in the tab replaces it
- **Size Limit**: Usually 5-10MB

### How to Restore Backup

If you encounter issues after import, you can restore the backup while the tab is still open, on the same Google account (`/u/<index>/`) you imported into:

1. Open the browser console (F12) on that Gemini tab and run:

   ```javascript
   console.log('Backup time:', sessionStorage.getItem('gvFolderBackupTimestamp'));
   copy(
     JSON.stringify({
       format: 'gemini-voyager.folders.v1',
       data: JSON.parse(sessionStorage.getItem('gvFolderBackup')),
     }),
   );
   ```

   An error here means this tab has no backup.

2. Open the folder **Import** dialog, choose **Overwrite**, paste the copied text and confirm.

The restore is itself an import, so it saves the folders it replaces as the new backup.

### Clear Backup

```javascript
sessionStorage.removeItem('gvFolderBackup');
sessionStorage.removeItem('gvFolderBackupTimestamp');
```

## Export File Format

```json
{
  "format": "gemini-voyager.folders.v1",
  "exportedAt": "2025-01-15T10:30:00.000Z",
  "version": "0.7.2",
  "data": {
    "folders": [
      {
        "id": "folder-xxx",
        "name": "My Folder",
        "parentId": null,
        "isExpanded": true,
        "createdAt": 1736935800000,
        "updatedAt": 1736935800000
      }
    ],
    "folderContents": {
      "folder-xxx": [
        {
          "conversationId": "conv-yyy",
          "title": "Conversation Title",
          "url": "https://gemini.google.com/app/...",
          "addedAt": 1736935800000
        }
      ]
    }
  }
}
```

## Data Security

- ✅ **Local Storage**: All data is stored locally only, not uploaded to any server
- ✅ **Format Validation**: Strict data format validation during import to prevent corruption
- ✅ **Auto Backup**: Automatic backup before every import
- ✅ **Version Control**: Files include version numbers for future compatibility

## FAQ

### Q: Where is the backup stored?

A: Stored in the browser's `sessionStorage`, only valid for the current tab, automatically cleared when the tab is closed.

### Q: Why can't I see the backup file?

A: The backup is temporarily stored in memory and does not generate a file. For permanent storage, use the export feature.

### Q: Can it sync automatically?

A: Currently requires manual export/import. Automatic sync would require cloud service support, which is not provided to protect privacy.

### Q: What if the configuration is wrong after import?

A: If the tab is still open, you can paste the backup back through the Import dialog (see instructions above).

### Q: Does it support cross-browser sync?

A: Yes! Simply export from one browser and import to another.

## Best Practices

1. **Regular Exports**: Make it a habit to export configurations regularly
2. **Cloud Backup**: Save exported JSON files to cloud storage
3. **Test Import**: Test with merge mode first on new devices
4. **Keep Backups**: Export a backup before important operations
5. **Version Management**: Save multiple versions for different configuration states

## Technical Details

- **Format Version**: `gemini-voyager.folders.v1`
- **Deduplication Strategy**: Deduplicate by `id` and `conversationId`
- **File Encoding**: UTF-8
- **Max File Size**: Theoretically unlimited (limited by browser memory)
- **Compatibility**: Chrome 88+, Firefox 85+, Safari 15.4+

## Feedback & Support

For issues or suggestions, please visit:
https://github.com/voyager-crew/voyager/issues/36
