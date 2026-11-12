# 撰寫自己的外掛

只想用一句話做外掛，請看 [創造模式](./create-mode.md)：網站上的 AI 來寫，Voyager 檢查後裝上。這一頁介紹另外兩條路：交給你電腦上的程式設計 Agent，或是自己動手寫，以及外掛格式的規則。

本機外掛是你為自己做的外掛：它能改變 Gemini、AI Studio、ChatGPT、Claude、DeepSeek 或 Kimi 的外觀與版面，只存在你的瀏覽器裡，不需要發 PR，也不需要 Voyager 的原始碼。

大多數外掛是宣告式的：一份 `plugin.json` 清單加上 CSS，本身不執行任何程式碼。Voyager 會在匯入時檢查它、套用它的修改，關閉時再把所有修改全部還原。匯入的外掛預設是關閉的，你可以先看過一遍再開啟。需求非得用程式碼時，可以寫一個[會執行程式碼的創造](./create-mode.md#會執行程式碼的創造)。

兩條路最後都在 **我的創造** 裡匯入：展開 **更多新增方式**，選擇 **匯入檔案**，選取 `plugin.json` 和 `style.css`。

## 複製給本機 Agent

如果你在用程式設計 Agent（Claude Code、Codex、Cursor 等），在面板的 **創造** 分頁或彈出視窗的 **我的創造** 裡寫一句話，選擇 **複製給本機 Agent**，把這段文字交給它。文字會請 Agent 按照 Voyager 的外掛 skill 來寫：

```text
https://voyager.nagi.fun/skills/write-voyager-plugin/SKILL.md
```

這個 skill 收錄了完整的規範：清單欄位、每個網站宣告了哪些東西、可用的原語，以及外掛做不到的事。Agent 會寫好 `plugin.json` 和 `style.css`，執行 `npx create-voyager-plugin@latest check` 直到通過，再把兩個檔案交回給你，由你用 **匯入檔案** 匯入。

想讓 Agent 一直帶著這個 skill，可以把檔案存成 Agent skills 資料夾下的 `write-voyager-plugin/SKILL.md`（Claude Code 是 `~/.claude/skills/`）。

## 自己動手寫

需要 Node.js 18 或更新版本：

```sh
npx create-voyager-plugin@latest init my-plugin --site claude
# 編輯 my-plugin/plugin.json 和 my-plugin/style.css
npx create-voyager-plugin@latest check my-plugin
```

`init` 會產生一份已經能通過檢查的 `plugin.json` 和 `style.css`，另外附上一份寫有該網站規則的 `AGENTS.md`。`--site` 可以填 `gemini`、`aistudio`、`chatgpt`、`claude`、`deepseek` 或 `kimi`。

`check` 會離線執行和彈出視窗匯入時完全相同的檢查。外掛能順利匯入時以結束代碼 0 結束，否則每個問題輸出一行 `path: message`。加上 `--json` 可以取得機器可讀的輸出。

檢查通過後，同樣在 **更多新增方式** 裡用 **匯入檔案** 匯入這兩個檔案。

## 外掛能做什麼

- 加入 CSS，作用範圍限定在外掛替頁面加上的 `gv-` class 之下。
- 加入 class、設定安全的屬性或行內樣式、隱藏元素。目標可以是網站宣告的語義鍵（`userTurn`、`assistantTurn`、`composer` 等），也可以是 CSS 選擇器。
- 在彈出視窗裡提供設定：開關、滑桿和下拉選單，設定值會透過 `{{key}}` 帶進 CSS。
- 在 ChatGPT、Claude、DeepSeek 和 Kimi 上，啟用 Voyager 的原語（公式複製、時間軸、Mermaid 圖表等），並替 Voyager 自己的介面換色。在任何網站上，都可以用 `:root` 上的 `--gv-theme-*` 變數替 Voyager 換配色，請見[下文](#替-voyager-換配色)。

## 外掛做不到什麼

宣告式外掛不能執行 JavaScript，不能回應點擊或按鍵，不能從網路載入任何東西（字型、圖片、樣式表），不能讀取或改寫訊息內容，也不能在其他網站上執行。只有程式碼才能做到時，可以寫一個會執行程式碼的創造。任何創造都不能在其他網站上執行，也不能改 Voyager 自己的設定；遇到這類需求，撰寫材料會讓 AI 直接說明，並做出最接近、又真的能實現的版本。

## 替 Voyager 換配色

Voyager 在網頁上的介面顏色來自一組公開變數。外掛在一條不加作用範圍的 `:root` 規則裡設定它們，淺色和深色主題同時生效；沒設定的變數會保留 Voyager 原本的顏色。

- `--gv-theme-surface`（背景）、`--gv-theme-hover`（懸停列）、`--gv-theme-text`（文字）、`--gv-theme-text-muted`（次要文字、圖示）、`--gv-theme-border`（邊框）：只作用於 Voyager 自己的面板、選單、對話框、提示和通知。Voyager 直接畫在網站頁面上的文字、邊框和懸停色會繼續跟著網站走。
- `--gv-theme-accent`（按鈕、選取、焦點）、`--gv-theme-accent-fg`（強調色上的文字）、`--gv-theme-accent-hue`（強調色的 OKLCH 色相，一個數字）、`--gv-theme-danger`（刪除）：在 Voyager 的介面和網站頁面上都生效。
- `--gv-theme-timeline`：時間軸的軌道、未選取的圓點和刻度，以及左側滑桿的軌道。

Nord 配色範例：

```css
:root {
  --gv-theme-surface: #2e3440;
  --gv-theme-hover: #3b4252;
  --gv-theme-text: #eceff4;
  --gv-theme-text-muted: #d8dee9;
  --gv-theme-border: #4c566a;
  --gv-theme-accent: #88c0d0;
  --gv-theme-accent-fg: #2e3440;
  --gv-theme-danger: #bf616a;
  --gv-theme-timeline: #81a1c1;
}
```

## 匯入時檢查的規則

除了共通的清單檢查（見[外掛貢獻說明](./plugin-contribution.md)），本機外掛還必須：

- 只匹配 Voyager 支援的網站範圍內的 URL；
- 只使用每個匹配網站都有宣告的語義鍵；
- 每個 `addClass` 只加一個 class，而且以 `gv-` 開頭；
- 只使用 boolean、number 或 select 設定（string 和 color 目前在彈出視窗裡還沒有對應的控制項）；
- 在 Gemini 和 AI Studio 上不使用 `theme`；原語只能用該網站開放的：Gemini 上是 `formulaCopy`、`vimInput`、`userLatex`、`codeCollapse`、`mermaid`、`wavedrom` 和 `echarts`, `sendShortcut`, `draftSave`、`turnNavigator`，AI Studio 上是 `formulaCopy`、`sendShortcut`。它們與 Voyager 內建的對應設定是同一套程式碼。`formulaCopy` 和 `vimInput`（「公式複製」「輸入框 Vim 模式」）在同一頁面上，內建設定和外掛只會執行其中一個：頁面剛載入、或兩者都沒在執行時，內建開關優先；之後誰已經在執行就繼續執行，另一方顯示為暫停。關掉其中一個，功能就交給另一個。`userLatex`、`codeCollapse`、`mermaid`、`wavedrom` 和 `echarts` 按元素逐一認領，可以和內建設定同時執行：對方已經處理的行或程式碼區塊留給對方。

翻譯（`i18n`）是選填的。

### 時間軸與傳送、草稿原語

Gemini 個人版現已支援本機 `turnNavigator`：設定 `params.dataBackend: "shared"` 和 `engine: ">=1.9.0"`，即可讀寫官方時間軸的同一份星標與層級資料；不能覆寫對話、帳號或回合的識別參數。官方「顯示時間軸」開啟時會發生衝突：先關閉官方開關，再啟用本機外掛；切回官方時，先停用本機外掛，再開啟官方開關。Business、Enterprise 和自訂網站範圍暫不開放。

所有網站每頁只能執行一個傳送快捷鍵外掛；已有外掛占用傳送模式時，另一個顯示衝突並暫停。可選 `mode`（需要 `"engine": ">=1.9.0"`）為 `ctrlEnterSends`（預設）或 `enterSends`。輸入法確認鍵不會觸發傳送。Gemini 和 AI Studio 現已開放，支援模式見下文。

Gemini 現在允許 `sendShortcut` 替代官方 Ctrl+Enter 傳送；關閉官方開關後啟用本地外掛。只支援 `ctrlEnterSends`，Enterprise 不執行。`composerRoot` 涵蓋主框和編輯框，`sendButton` 不含停止按鈕。

AI Studio 上的 `sendShortcut` 必須設定 `params.mode: "enterSends"`。關閉官方 Enter 傳送開關後，本地外掛可以接管；Ctrl/Cmd+Enter 換行，Shift/Alt+Enter 交由宿主處理。

Gemini 的 `draftSave` 與官方草稿共用 `gvDraft_<完整 pathname>`，保留 `/u/N` 和 Gem 路徑。停用會保留已存草稿，同頁多個外掛可以共用記錄。卸載前會盡力儲存最後輸入，瀏覽器關閉時無法保證非同步儲存完成。 寫入與修剪僅在同頁協調；同一個 `/u/N` 槽位更換電子郵件仍共用已存草稿。
