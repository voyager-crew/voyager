# 傳送行為

::: info
**注意**：該功能在 1.3.7 及後續版本中支援。
:::

將傳送快捷鍵改為 `Ctrl+Enter`（macOS 下為 `⌘+Enter`），`Enter` 鍵變為換行，讓你在撰寫多行提示詞時更加從容。

## 為什麼需要這個功能

預設按下 `Enter` 即傳送訊息。在編寫較長的 prompt、貼上多行程式碼、或需要精心排版時，經常導致誤發——你只想換個行，訊息卻已經飛出去了。

開啟後：

- **Enter** → 插入換行
- **Ctrl+Enter**（macOS: **⌘+Enter**） → 傳送訊息

Shift+Enter 與輸入法組字仍維持網站原本的行為；附件還在上傳時，Ctrl/⌘+Enter 會等上傳完成再傳送。

## 如何開啟

1. 打開 Voyager 的彈窗。
2. 在 **輸入** → **Ctrl/Cmd+Enter 傳送** 中打開它。

## 其他網站

- **AI Studio** 剛好相反：打開 **AI Studio Enter 傳送**，就是用 `Enter` 傳送、`Ctrl/⌘+Enter` 換行。
- **Claude、ChatGPT、DeepSeek、Kimi 與 Grok**：在該網站開啟 Voyager 彈窗，於 **外掛** 卡片中開啟 **Ctrl/⌘+Enter 傳送**。各網站的外掛請見[外掛一覽](/zh_TW/guide/plugins)。
- **Safari**：如果在 Gemini 中要按兩次 Enter 才能傳送，請打開 **修復 Safari Enter 鍵**。

## 功能特點

- **零效能開銷**：關閉時不監聽任何鍵盤事件，不影響頁面效能。
- **即時切換**：在設定中開關後立即生效，無需重新整理頁面。
