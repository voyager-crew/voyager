# 文件夹导出/导入功能使用指南

## 功能概述

文件夹配置导出/导入功能允许您在不同设备间同步文件夹配置，无需搭建服务器。

## 使用方法

### 📥 导出文件夹配置（下载 ⬇️）

1. 打开 Gemini 聊天页面
2. 在文件夹区域找到**下载图标按钮**（向下箭头 ⬇️）
3. 点击即可下载配置文件（格式：`gemini-voyager-folders-YYYYMMDD-HHMMSS.json`）

### 📤 导入文件夹配置（上传 ⬆️）

1. 点击文件夹区域的**上传图标按钮**（向上箭头 ⬆️）
2. 选择导入策略：
   - **合并模式**：保留现有文件夹，只添加新的（推荐）
   - **覆盖模式**：完全替换现有配置
3. 选择之前导出的 JSON 文件
4. 点击"导入"按钮确认

## 导入策略说明

### 合并模式 (Merge)

- ✅ 保留所有现有文件夹和对话
- ✅ 只添加新的文件夹和对话
- ✅ 自动跳过重复项（按 ID 判断）
- 💡 适合：从其他设备导入部分配置

### 覆盖模式 (Overwrite)

- ⚠️ 删除所有现有文件夹
- ✅ 完全使用导入的配置
- 🔒 为当前标签页保留被替换文件夹的副本（见下文）
- 💡 适合：完全同步到新设备

## 🔄 备份与恢复

### 备份说明

- **自动备份**：在 Gemini 上每次导入文件夹前，先保存即将被改动的文件夹
- **存储位置**：浏览器 sessionStorage（临时存储）
- **有效期**：当前标签页关闭前有效；同一标签页的下一次导入会替换它
- **大小限制**：通常为 5-10MB

### 如何恢复备份

如果导入后发现问题，可以在当前标签页未关闭的情况下，在导入时所用的同一 Google 账号（`/u/<index>/`）下恢复备份：

1. 在该 Gemini 标签页打开浏览器控制台 (F12)，运行：

   ```javascript
   console.log('备份时间：', sessionStorage.getItem('gvFolderBackupTimestamp'));
   copy(
     JSON.stringify({
       format: 'gemini-voyager.folders.v1',
       data: JSON.parse(sessionStorage.getItem('gvFolderBackup')),
     }),
   );
   ```

   如果这里报错，说明该标签页没有备份。

2. 打开文件夹的**导入**对话框，选择**覆盖**，粘贴刚复制的文本并确认。

恢复本身也是一次导入，因此它会把被替换的文件夹存为新的备份。

### 清除备份

```javascript
sessionStorage.removeItem('gvFolderBackup');
sessionStorage.removeItem('gvFolderBackupTimestamp');
```

## 导出文件格式

```json
{
  "format": "gemini-voyager.folders.v1",
  "exportedAt": "2025-01-15T10:30:00.000Z",
  "version": "0.7.2",
  "data": {
    "folders": [
      {
        "id": "folder-xxx",
        "name": "我的文件夹",
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
          "title": "对话标题",
          "url": "https://gemini.google.com/app/...",
          "addedAt": 1736935800000
        }
      ]
    }
  }
}
```

## 数据安全

- ✅ **本地存储**：所有数据仅存储在本地，不上传到任何服务器
- ✅ **格式验证**：导入时严格验证数据格式，防止损坏
- ✅ **自动备份**：每次导入前自动备份
- ✅ **版本控制**：文件包含版本号，便于未来兼容

## 常见问题

### Q: 备份存储在哪里？

A: 存储在浏览器的 `sessionStorage` 中，仅在当前标签页有效，关闭标签页后自动清除。

### Q: 为什么看不到备份文件？

A: 备份是临时存储在内存中的，不会生成文件。如需永久保存，请使用导出功能。

### Q: 可以自动同步吗？

A: 目前需要手动导出/导入。自动同步需要云服务支持，暂不提供以保护隐私。

### Q: 导入后发现配置不对怎么办？

A: 如果标签页未关闭，可以通过导入对话框把备份粘贴回去（参见上方说明）。

### Q: 支持跨浏览器同步吗？

A: 支持！只需在一个浏览器导出，在另一个浏览器导入即可。

## 最佳实践

1. **定期导出**：养成定期导出配置的习惯
2. **云盘备份**：将导出的 JSON 文件保存到云盘
3. **测试导入**：在新设备先用合并模式测试
4. **保留备份**：重要操作前先导出一份备份
5. **版本管理**：可以为不同配置状态保存多个版本

## 技术细节

- **格式版本**: `gemini-voyager.folders.v1`
- **去重策略**: 按 `id` 和 `conversationId` 去重
- **文件编码**: UTF-8
- **最大文件大小**: 理论无限制（受浏览器内存限制）
- **兼容性**: Chrome 88+, Firefox 85+, Safari 15.4+

## 反馈与支持

如有问题或建议，请访问：
https://github.com/voyager-crew/voyager/issues/36
