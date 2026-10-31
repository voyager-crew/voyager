# ✨ 功能特色

<div align="center">
  <img src="../../../docs/public/assets/teaser.png" alt="teaser"/>
</div>

如需完整功能介紹，請造訪我們的[官方文件](https://voyager.nagi.fun/zh_TW)。

## 🌌 核心功能（Gemini 與 AI Studio）

- **📂 [資料夾整理](https://voyager.nagi.fun/zh_TW/guide/folders)**：將對話整理到最多三層的資料夾階層中，支援拖放操作。
  - **Gemini**：支援 **帳號隔離模式** 與 **自訂資料夾顏色**。
- **💡 [提示詞寶庫](https://voyager.nagi.fun/zh_TW/guide/prompts)**：在 Gemini、AI Studio 以及[自訂網站](https://voyager.nagi.fun/zh_TW/guide/prompts#任何網站皆可用)中儲存並重複使用提示詞。
- **☁️ [雲端同步](https://voyager.nagi.fun/zh_TW/guide/cloud-sync)**：透過 Google 雲端硬碟同步資料夾與提示詞，Safari 上則可使用 iCloud。
- **🗑️ [批次刪除](https://voyager.nagi.fun/zh_TW/guide/batch-delete)**：一次批次刪除多則對話。
- **📐 [公式複製](https://voyager.nagi.fun/zh_TW/guide/formula-copy)**：點擊公式即可將它複製為 LaTeX、MathML（Word）或適用於 Notion 的數學格式。

## ✨ Gemini 專屬功能

- **📍 [時間軸導覽](https://voyager.nagi.fun/zh_TW/guide/timeline)**：以視覺化節點在訊息間跳轉、為重要時刻加上星號，並管理對話分叉。
- **💾 [對話匯出](https://voyager.nagi.fun/zh_TW/guide/export)**：將對話匯出為 JSON、Markdown、PDF 或圖片，且包含圖片內容。
- **🧜‍♀️ [Mermaid 圖表渲染](https://voyager.nagi.fun/zh_TW/guide/mermaid)**：自動渲染流程圖、時序圖與其他 Mermaid 圖表。
- **📝 [Markdown 渲染修復](https://voyager.nagi.fun/zh_TW/guide/markdown-fix)**：自動修復因 Gemini 插入的 HTML 元素而損壞的粗體語法。
- **🍌 [Image Refinement](https://voyager.nagi.fun/zh_TW/guide/nanobanana)**：為 Gemini 生成的圖片進行無損去除浮水印。
- **🔬 [Deep Research](https://voyager.nagi.fun/zh_TW/guide/deep-research)**：從 Deep Research 對話中擷取思考過程與研究連結。
- **🛠️ 效率工具**：
  - **[引用回覆](https://voyager.nagi.fun/zh_TW/guide/quote-reply)**：選取文字即可帶著上下文回覆。
  - **[防止自動捲動](https://voyager.nagi.fun/zh_TW/guide/prevent-auto-scroll)**：攔截你送出新提示詞時，頁面強制跳到最底部的行為。
  - **[輸入框摺疊](https://voyager.nagi.fun/zh_TW/guide/input-collapse)**：輸入框可自動展開與摺疊，釋放閱讀空間。
  - **[預設模型](https://voyager.nagi.fun/zh_TW/guide/default-model)**：將你偏好的模型設為預設。

## 🔌 Claude、ChatGPT、DeepSeek 與 Kimi

這些功能由 [Voyager 外掛引擎](https://voyager.nagi.fun/zh_TW/guide/plugins) 驅動，讓你的體驗延伸到 Gemini 之外。請在擴充功能彈出視窗中開啟，並授權存取各網站：

- **📍 時間軸**：在 ChatGPT、Claude 與 DeepSeek 上提供相同的時間軸，支援星號訊息與搜尋；預設關閉，需手動開啟。
- **📂 資料夾**：在 ChatGPT、Claude、DeepSeek 與 Kimi 上將對話整理到資料夾中。ChatGPT 資料夾預設開啟。
- **💾 匯出**：在 ChatGPT、Claude、DeepSeek 與 Kimi 上將對話匯出為 Markdown、JSON、PDF 或圖片。
- **📐 公式複製**：在 Claude、ChatGPT 與 DeepSeek 上點擊公式，即可複製其 LaTeX。
- **⌨️ Vim 輸入**：在 Claude、ChatGPT 與 DeepSeek 的輸入框中使用 Vim 風格的模式編輯與游標移動。
- **📖 舒適閱讀寬度**：在 Claude、ChatGPT、DeepSeek 與 Kimi 上調整對話寬度，獲得更好的閱讀體驗。
- **💬 日常小工具**：在 Claude、ChatGPT、DeepSeek 與 Kimi 上提供引用回覆、Ctrl/⌘+Enter 傳送與草稿字數計算；Claude、DeepSeek 與 Kimi 另支援草稿自動儲存。
- **🈶 CJK 渲染修復**：修復 Claude 上中日韓文字的渲染問題。
- **📜 程式碼不換行**：DeepSeek 上的長程式碼行改為橫向捲動，縮排不會被折斷。

## 🧩 任何網站，包括本機

在擴充功能彈出視窗中新增任意網站，Prompt Manager 就會跟著過去，本機應用也一樣。下圖是它執行在 `localhost:3080` 的 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 裡：

<p align="center">
  <img src="../../../docs/public/assets/prompt-manager-deepseek-harness.png" alt="在 DeepSeek Harness 中執行的 Prompt Manager" width="720">
</p>

## 🎨 個人化設定

- **🌦️ 視覺特效**：以 **飄雪**、**電影感雨幕** 或 **飄落櫻花花瓣**，為 Voyager 執行的每個網站增添季節氛圍。
- 在 Gemini / AI Studio 上，開啟擴充功能彈出視窗，打開 **頁面版面** → **視覺特效**，再在該列下選擇 `飄雪`、`櫻花` 或 `雨滴`；關閉該開關即可關閉特效。在 Claude、ChatGPT、DeepSeek 與自訂網站上，同一列位於該網站的 **外掛** 卡片中。
- 特效會以輕量的全螢幕覆蓋層呈現，不會阻擋頁面互動。
- 切換或關閉特效時，既有的粒子會自然淡出，而不會突然消失。
