# 新增平台

新增一個聊天網站，分為兩個獨立的層次：

1. **網站適配器**，即 `catalog/sites/<site>/site.json`，告訴 Voyager 如何辨識這個網站，並找到它的使用者訊息、助理訊息、輸入框、側邊欄與主題標記。
2. **外掛**，位於 `catalog/sites/<site>/plugins/<id>/`，用來解決該網站上某一個面向使用者的問題，例如閱讀寬度或轉譯修正。

`site.json` 包含 `id`（與其目錄名相同）、`label`、`matches`、`selectors`、`theme`、`brandColor`、`capabilities`，以及選填的 `conversationIdPattern` 與 `turnKeyAttributes`。`turnKeyAttributes` 指定當頁面重新轉譯使用者訊息時，用來保持其身分識別的屬性。送出追蹤（供資料夾活動與時間軸時間戳記使用）只會在有設定它的網站上執行，並同時需要 `composer`、`userTurn` 與 `conversationIdPattern`。`src/features/plugins/sites/siteAdapterData.ts` 中的 `validateSiteAdapterData` 會驗證它，而 `bun run catalog:build` 會在發布前驗證每個網站與外掛。

`site.json` 就是網站適配器本身，只是寫成了資料。目前的外掛平台是 ChatGPT、Claude、DeepSeek、Kimi 和 Grok。Gemini 和 AI Studio 是 Voyager 的原生介面，同樣有各自的 `site.json`（`catalog/sites/gemini/`、`catalog/sites/aistudio/`），但它隨擴充功能打包，不會發布到遠端目錄；`sites/adapters/` 下的 `gemini.ts`、`aistudio.ts`、`claude.ts`、`chatgpt.ts`、`deepseek.ts` 現在都只是 `site.json` 的一行外殼，要改就改 JSON，不要改 TypeScript。發布的分網站目錄也帶上了網站資料，所以 `site.json` 裡的選擇器修正不必發新版本就能送到使用者手上。全新的網站仍然需要發新版本，因為它還需要隨套件發布主機權限與內容腳本註冊。

以 DeepSeek 這類新平台為例，適配器的工作應聚焦於平台契約。請在同一個完整的變更中提交 `site.json`、必要的選擇器測試，以及說明支援範圍所需的最少文件。網站註冊表會直接從檔案中取得新適配器，因此不需要修改任何註冊清單。不要為每個外掛都新增一個網站。

適配器被接受後，後續的外掛可以各自以獨立、聚焦的變更提交。如果多個變更彼此相依，使用堆疊式 PR 鏈會很有用：後一個分支以前一個分支為基礎，每個 PR 只顯示自己增量的功能。整條鏈仍須遵守相同的範圍原則：每個 PR 只解決一個明確的使用者目標，並附上必要的測試與清理。

網站支援不需要模型 API 整合。新平台不要加入靜態內容腳本或必要的主機權限；僅供外掛使用的網站，請使用既有的選用權限與動態註冊流程。

選用權限與動態註冊流程取決於瀏覽器版本。Chrome 與 Edge 支援擴充功能所使用的流程。Firefox 需要 128 或更新版本才能使用選用主機權限，Safari 需要 16.4 或更新版本才能使用動態內容腳本註冊。在較舊的受支援瀏覽器版本上，彈出視窗可能會正確地拒絕為自訂網站啟用外掛，因為所需 API 無法提供持久的授權。請不要為了繞過這個限制而加入範圍過大的靜態主機權限，除非維護者同意。
