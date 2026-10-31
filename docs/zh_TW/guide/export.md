# 徹底自由

Voyager 匯出功能可以把任何 Gemini、ChatGPT、Claude、DeepSeek 或 Kimi 對話下載成 Markdown、PDF、JSON 或圖片檔案。它會完整擷取聊天內容，包括程式碼區塊、圖片與格式，讓你為每一段 AI 對話保留一份永久、可攜的副本。

數據被鎖死，是最壞的體驗。
我們的信條很簡單：你創造的，就是你的。

## 格式比較

| 功能       | Markdown                         | PDF                 | JSON             | 圖片           |
| ---------- | -------------------------------- | ------------------- | ---------------- | -------------- |
| 適合對象   | 筆記應用程式（Obsidian、Notion） | 分享與列印          | 開發者、資料分析 | 在手機上分享   |
| 圖片       | 嵌入                             | 完整納入            | Base64 編碼      | 就地轉譯顯示   |
| 程式碼區塊 | 保留語法                         | 以視覺方式呈現      | 保留原始文字     | 以視覺方式呈現 |
| 檔案大小   | 最小                             | 最大                | 中等             | 大             |
| 可搜尋性   | 純文字                           | 透過 PDF 閱讀器搜尋 | 可程式化存取     | 不可           |

## 帶走一切

Voyager 幫你把數據從雲端拽回手心。

### 格式隨你選

- **Markdown**：給 Obsidian 或 Notion 用。乾淨清爽，並可嵌入圖片。
- **PDF**：發給別人或列印。排版精美，圖文並茂。
- **JSON**：給開發者。原始數據，怎麼玩隨你。
- **圖片**：一張長 PNG，手機上分享最方便。版面可選窄、中、寬。

### 怎麼導

1. 點擊 **匯出** 按鈕（ChatGPT、Claude、DeepSeek、Kimi 與目前的 Gemini 版面）。它預設在頁面右上角，可以拖到任意位置，每個網站分別記住；拖回預設位置附近會自動歸位。在 Gemini 上，也可以從對話或回覆的 ⋮ 選單選擇 **匯出對話記錄**；舊版 Gemini 版面則把滑鼠懸停在 Gemini Logo 上，即可看到出現的 **匯出圖示**。
2. 選格式。
3. 拿走。

在 Claude、DeepSeek 與 Kimi 上，匯出是預設關閉的外掛：請先在彈出視窗的 **外掛** 中開啟。長對話由 Voyager 捲動一遍讀完，讀完後所有訊息預設都已勾選，取消不要的即可；若無法確認讀到開頭與結尾，會提示匯出內容可能不完整。在 ChatGPT 上無法讀到完整紀錄時，會提示向上捲動載入較早的訊息後重試。切換到其他對話會中止匯出，在 Claude 上開始產生新回覆也會。

ChatGPT 對話裡上傳的檔案，會在匯出內容裡以 `📎 檔名` 一行列出。

你的數據，聽你的。

<div style="display: flex; gap: 20px; margin-top: 20px;">
  <div style="flex: 1; text-align: center;">
    <p><b>1. 找到匯出</b></p>
    <img src="/assets/gemini-export-guide-1.png" alt="導出指南步驟 1" style="border-radius: 8px; box-shadow: 0 4px 12px rgba(0,0,0,0.1);"/>
  </div>
  <div style="flex: 1; text-align: center;">
    <p><b>2. 選格式</b></p>
    <img src="/assets/gemini-export-guide-2.png" alt="導出指南步驟 2" style="border-radius: 8px; box-shadow: 0 4px 12px rgba(0,0,0,0.1);"/>
  </div>
</div>

### Safari PDF 匯出特別說明

在 Safari 上匯出 PDF 步驟略有不同（需手動列印）：

1. 點擊 **匯出** 按鈕，選擇 PDF 格式。
2. **等待一秒左右**（讓頁面準備好列印樣式）。
3. 按 `Command + P` 呼叫列印介面。
4. 在列印介面中選擇 **"Save to PDF"**（或 "儲存為 PDF"）。

<img src="/assets/safari-export-pdf.png" alt="Safari Export PDF" style="max-width: 100%; border-radius: 8px; box-shadow: 0 4px 12px rgba(0,0,0,0.1); margin-top: 20px;"/>

## Deep Research 匯出

Gemini 的 Deep Research 模式會產生包含來源、思考步驟與引用的結構化報告。Voyager 可以在保留所有中繼資料的情況下匯出這些對話：

1. 開啟一則已完成的 Deep Research 對話。
2. 開啟報告的 **Share & Export** 選單，並選擇 **儲存報告**。
3. 選擇格式。
4. 匯出內容會包含最終報告及其來源連結。若也要儲存思考過程，請參閱 [Deep Research 匯出](/zh_TW/guide/deep-research)。

這對學術研究、競品分析與技術文件特別有用，因為你需要保留推理鏈與來源出處。

## 何時匯出

- **知識存檔**：在重要對話被淹沒在聊天紀錄之前先保存下來。
- **團隊分享**：把一段除錯對話匯出成 PDF，分享給不使用 Gemini 的同事。
- **建立知識庫**：將對話匯出成 Markdown，並在 Obsidian 或 Notion 中整理。
- **資料分析**：使用 JSON 匯出，以程式方式分析對話模式或擷取結構化資料。
- **合規與稽核**：保存 AI 協助決策的紀錄，以供稽核追蹤。

## 支援平台

匯出功能可用於 Gemini 與 ChatGPT，支援 Chrome、Edge、Firefox、Safari、Opera 與 Brave。Claude、DeepSeek 與 Kimi 的匯出是外掛，預設關閉，需在 **外掛** 中開啟。在 Safari 上，PDF 匯出需要點擊匯出後手動列印（按 Command+P）；Markdown 與 JSON 匯出仍會包含圖片。
