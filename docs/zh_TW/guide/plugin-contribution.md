# 外掛貢獻說明

Voyager 的外掛系統優先支援宣告式外掛：用 `plugin.json` 描述外掛資訊與 DOM 操作，再用 CSS 描述樣式。外掛本身不執行遠端 JavaScript，而是由 Voyager 內建的外掛引擎解讀這些資料。

這讓外掛更容易審查與維護。如果你想貢獻外掛，建議先從這條路徑開始。

## 只給自己用：本機外掛

只需要在自己瀏覽器中使用的外掛，不必走這套流程。把它做成本機外掛，再於彈出視窗中匯入即可：不需要 Issue、不需要 PR，也不需要 clone 儲存庫。最快的是 [創造模式](/zh_TW/guide/create-mode)：一句話，網站上的 AI 來寫；想交給程式代理或自己動手，請見 [撰寫你自己的外掛](/zh_TW/guide/write-a-plugin)，包括 `create-voyager-plugin` 檢查工具與給程式代理使用的 skill。

## 建議流程

1. 先確認它適合做成外掛：閱讀寬度、排版修正、主題微調、隱藏或標記頁面元素、簡單的網站適配，通常都適合宣告式外掛。
2. 先在 Voyager 主倉庫提交 Issue，說明它解決的問題、目標網站，以及和現有外掛相比的差異；等待維護者明確同意方案後再開始實作和提交 PR。
3. 使用 `plugin.json` 撰寫外掛中繼資料、匹配網站和貢獻內容。
4. 將樣式放進同目錄的 `style.css`，再由 `plugin.json` 的 `contributes.styles` 引用。
5. 本地測試後提交 PR，並附上測試頁面、截圖或錄影。維護者會依外掛成熟度決定是否進入官方 catalog。

## 目錄結構

官方內建外掛都放在 `src/features/plugins/catalog/` 下面，一個外掛平台一個目錄：

```
src/features/plugins/catalog/
  marketplace.json                        手動維護的網站外掛索引，由測試檢查
  sites/<site>/site.json                  網站適配器（資料形式）
  sites/<site>/plugins/<id>/plugin.json   一個宣告式外掛
  sites/<site>/plugins/<id>/style.css     它的樣式
  sites/<site>/plugins/<id>/README.md     它修了什麼、為什麼這樣修
```

尋找流程是自動的：`catalog/sites/index.ts` 用 `import.meta.glob` 找出每個 `site.json` 和每個 `plugin.json`，所以新增網站或外掛就是新增檔案，沒有對照表需要維護。

`marketplace.json` 不是那張對照表，它只是手動維護的網站外掛索引；有測試確保它和自動尋找的結果一致，所以新外掛也要在裡面加一筆（`bun run plugin:new` 會幫你追加），`source` 寫 catalog 相對路徑，例如 `sites/deepseek/plugins/reading-width/plugin.json`。`sites/gemini/` 和 `sites/aistudio/` 下的外掛是例外：它們隨 Voyager 一起發布，不列入 `marketplace.json`。文件站的[外掛一覽](/zh_TW/guide/plugins)直接從磁碟讀取各外掛的清單，不讀這個檔案。

外掛的 `matches` 必須落在所屬網站的 `matches` 範圍內；越界的外掛會讓建置失敗。

## 語義選擇器鍵

`site.json` 把一組固定的語義鍵對應到網站自己的 CSS 選擇器。這組詞彙定義在 `src/features/plugins/sites/semanticKeys.ts`，`site.json` 只能使用表內的鍵，用了表外的鍵會被拒絕。

- `userTurn`：使用者訊息容器。
- `assistantTurn`：助手訊息容器。
- `thinkingBlock`：助手回覆裡的思考段落。
- `codeBlock`：算繪後的程式碼區塊。
- `composer`：使用者輸入框。
- `sidebar`：對話列表或導覽列。
- `sidePanel`：次要面板，例如 artifacts 或 canvas。
- `headerActions`：對話頁右上角的操作區。
- `scrollContainer`：負責捲動對話的元素。
- `composerRoot`：輸入框及其操作按鈕所在的容器。
- `sendButton`：傳送按鈕；有些網站只在輸入框有內容時才顯示它。

網站只需要宣告它真正能提供的鍵。外掛以 `{ "kind": "semantic", "key": "userTurn" }` 當作 DOM 操作的 `target` 來引用語義鍵，而不是寫死選擇器，這樣網站改版時只要改 `site.json` 一個檔案。

`conversationIdPattern` 是 `site.json` 裡的另一個欄位，不是選擇器：它是比對 URL 路徑的正規表示式，第一個擷取群組就是對話 id，例如 `^/chat/([^/?#]+)`。

[新增平台](./adding-a-platform.md)

## 外掛粒度

外掛應該以「使用者想解決的問題」為邊界，而不是機械地按平台拆分。

catalog 裡的外掛屬於單一網站資料夾，它的每個 `matches` 都必須落在該資料夾 `site.json` 的範圍內（否則 `bun run plugin:check` 會失敗），所以同一個外掛不能同時覆蓋 Claude 和 ChatGPT。如果同一個功能適用多個平台，例如「閱讀寬度」「翻頁體驗」「程式碼區塊排版」，就在每個網站資料夾各做一個外掛（例如 `sites/claude/plugins/reading-width` 和 `sites/chatgpt/plugins/reading-width`），並讓名稱、設定和說明保持一致。

但如果不同平台需要完全不同的設定、DOM 邏輯或使用者文案，拆成多個外掛會更清楚。不要為了「一個外掛管所有事」把無關功能硬塞在一起；一個外掛最好只解決一個明確問題。

簡單判斷：

- 同一個使用者目標、同一組設定、只是網站選擇器不同：每個網站資料夾各做一個外掛，名稱與設定保持一致。
- 同一個主題但每個平台體驗差異很大：可以拆開，但名稱和說明保持關聯。
- 功能目標不同：不要合併。

## 避免重複外掛

提交前請先在[外掛一覽](/zh_TW/guide/plugins)看看已有的官方外掛。如果已經有一個好用的外掛，優先為它提交改進 PR，而不是再做一個類似外掛。

重複外掛只有在有明顯提升時才值得接受，例如：

- 覆蓋了原外掛不支援的重要平台。
- 修復了原外掛長期無法解決的相容性問題。
- 有明顯更好的效能、可存取性或維護性。
- 提供了不同但足夠清楚的使用者體驗，而不只是換名字或微調樣式。

這樣外掛列表會更乾淨，使用者也更容易選擇。

## 最小範例

不用從空目錄開始：`bun run plugin:new <id-segment> --site <site>` 會產生 `catalog/sites/<site>/plugins/<id-segment>/`，裡面有 `plugin.json`、`style.css` 和 `README.md`，並順手往 `marketplace.json` 追加對應條目。它產生的只是起點，不代表已經通過審核；你要填的清單長這樣：

```json
{
  "$schema": "https://voyager.nagi.fun/plugin.schema.json",
  "id": "your-name.example-plugin",
  "name": "Example Plugin",
  "version": "1.0.0",
  "description": "A short description of what this plugin improves.",
  "author": "your-name",
  "category": "readability",
  "license": "MIT",
  "engine": ">=1.0.0",
  "tier": "declarative",
  "matches": ["https://claude.ai/*"],
  "contributes": {
    "styles": [{ "file": "style.css" }],
    "domOps": [
      {
        "op": "addClass",
        "target": "body",
        "className": "gv-plugin-example"
      }
    ]
  }
}
```

`$schema` 這行是可選的，只服務於編輯器：它指向清單的 JSON Schema，讓編輯器邊寫邊驗證和補完。`site.json` 也有自己的一份，位址是 `https://voyager.nagi.fun/site.schema.json`。

`style.css` 可以像普通 CSS 一樣撰寫，但建議所有外掛樣式都掛在自己的 `gv-plugin-*` 類別下面：

```css
.gv-plugin-example .some-target {
  max-width: 880px;
}
```

## Manifest 注意事項

- `id` 使用反向網域或作者前綴，例如 `your-name.reading-width`，避免和其他外掛衝突。
- `matches` 盡量收窄，只匹配外掛真正需要生效的網站。
- `matches` 只有在所屬網站的 `site.json` 全部涵蓋時，才能列出多個主機（例如 chatgpt.com 和 chat.openai.com）；要支援其他網站，請在該網站的資料夾新增外掛。
- `category` 建議使用 `render-fix`、`theme`、`layout`、`readability`、`productivity`、`integration` 或 `other`。
- `engine` 寫外掛需要的最低 Voyager 版本。官方外掛可參考目前目錄中的範例。
- `i18n` 推薦補齊中文、英文和其他常用語言的名稱、描述、設定項文案。

## CSS 與資源限制

宣告式外掛會被當作不可信輸入驗證，所以請保持資源自包含：

- 不要使用 `@import`。
- 不要引用外鏈圖片、外部字體或遠端 CSS。
- 可以使用普通 CSS、自訂屬性和 Voyager 提供的設定值替換。
- 類別名稱請使用 `gv-plugin-` 前綴，避免污染宿主網站或 Voyager 自身樣式。

如果外掛需要使用者設定，建議先使用數字型設定；例如閱讀寬度外掛可以用設定值寫入 CSS 變數，再由樣式消費。

[DOM 操作邊界](./dom-operation-boundaries.md)

## 什麼時候不適合做成普通外掛

如果功能必須執行 JavaScript、攔截請求、讀寫 Voyager 內部資料，或依賴複雜的執行期邏輯，它就不適合作為普通宣告式外掛提交。

這類功能請先開 Issue 說明需求。確實需要內建能力時，我們會考慮把它做成 Voyager 主倉庫裡的 builtin/native 外掛，例如 Formula Copy。

## PR 前檢查

先跑 `bun run plugin:check <外掛目錄>`，並把輸出貼進 PR。它會一次列出所有問題：清單和 CSS、`matches` 是否越出網站範圍、原語、語義鍵、十種語言的翻譯，以及 README；CI 也會對每個內建外掛跑同一套檢查。

- 外掛預設關閉，使用者需要自己啟用。
- 已檢查沒有功能幾乎相同的現有外掛；如果有，優先改進現有外掛。
- 在目標網站的淺色和深色主題都測試過。
- `matches` 沒有覆蓋無關網站。
- 沒有遠端資源引用。
- 外掛目錄包含 `plugin.json`、必要的 CSS 檔案和簡短 README。
- 官方外掛的目錄位於 `catalog/sites/<site>/plugins/<id>/`，`matches` 落在網站 `matches` 範圍內，且 `catalog/marketplace.json` 有對應條目（Gemini 和 AI Studio 的外掛隨 Voyager 發布，不在此限）。
- PR 描述裡寫清楚測試頁面、截圖或錄影，以及可能影響的頁面區域。

保持簡單、克制、可撤銷。一個外掛只解決一個明確問題，通常會更容易合併和維護。
