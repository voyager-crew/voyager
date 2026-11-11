# 撰寫自己的外掛

創造模式能把一句話變成外掛：你說想改什麼，AI 來寫外掛，Voyager 檢查後再匯入。它在 Voyager popup 的「我的創造」卡片裡，做出來的是本機外掛。

本機外掛是你為自己做的外掛：它能改變 Gemini、AI Studio、ChatGPT、Claude、DeepSeek 或 Kimi 的外觀與版面，只存在你的瀏覽器裡，不需要發 PR，也不需要 Voyager 的原始碼。

和所有 Voyager 外掛一樣，它是宣告式的：一份 `plugin.json` 清單加上 CSS，本身不執行任何程式碼。Voyager 會在匯入時檢查它、套用它的修改，關閉時再把所有修改全部還原。匯入的外掛預設是關閉的，你可以先看過一遍再開啟。

## 三種做法

三種做法最後都回到「我的創造」。在 Gemini 和 AI Studio 上，它是一張設定卡片，預設緊接在「雲端同步」下方，你也可以調整它的位置；popup 頂部的「跳至」目錄能直接跳過去。在 ChatGPT、Claude、DeepSeek 和 Kimi 上，它在外掛清單下方。外掛清單末尾的「自己創造一個」會直接帶你到它的輸入框。

前兩種做法都從一句話開始。在「想改什麼？」下面寫一句話（例如「讓我的訊息窄一點，並隱藏側邊欄」）。下方的「網站」預設是目前分頁的網站；外掛要用在別的網站時，改一下即可。

### 複製到目前對話

1. 選擇「複製到目前對話」，把訊息貼到該網站的 AI 對話裡。
2. AI 會先讀 Voyager 為該網站準備的說明頁（例如 `https://voyager.nagi.fun/create/claude.md`），然後只回覆一個 JSON 程式碼區塊。AI 必須能打開連結。
3. 把完整回覆貼到「貼上 AI 的回覆」，選擇「檢查回覆」。
4. Voyager 會用白話說明這個外掛改了什麼。選擇「匯入」，再到外掛清單裡把它開啟。在 Gemini 和 AI Studio 上，它的開關就在卡片下方。

Voyager 自己不會送出任何東西。訊息由你貼過去，回覆也由你帶回來。

### 複製給本機 Agent

如果你在用程式設計 Agent（Claude Code、Codex、Cursor 等），選擇「複製給本機 Agent」，把這段文字交給它。文字會請 Agent 按照 Voyager 的外掛 skill 來寫：

```text
https://voyager.nagi.fun/skills/write-voyager-plugin/SKILL.md
```

這個 skill 收錄了完整的規範：清單欄位、每個網站宣告了哪些東西、可用的原語，以及外掛做不到的事。Agent 會寫好 `plugin.json` 和 `style.css`，執行 `npx create-voyager-plugin@latest check` 直到通過，再把兩個檔案交回給你。在「我的創造」裡展開「更多新增方式」，選擇「匯入檔案」，選取這兩個檔案就行了。

想讓 Agent 一直帶著這個 skill，可以把檔案存成 Agent skills 資料夾下的 `write-voyager-plugin/SKILL.md`（Claude Code 是 `~/.claude/skills/`）。

### 自己動手寫

需要 Node.js 18 或更新版本：

```sh
npx create-voyager-plugin@latest init my-plugin --site claude
# 編輯 my-plugin/plugin.json 和 my-plugin/style.css
npx create-voyager-plugin@latest check my-plugin
```

`init` 會產生一份已經能通過檢查的 `plugin.json` 和 `style.css`，另外附上一份寫有該網站規則的 `AGENTS.md`。`--site` 可以填 `gemini`、`aistudio`、`chatgpt`、`claude`、`deepseek` 或 `kimi`。

`check` 會離線執行和 popup 匯入時完全相同的檢查。外掛能順利匯入時以結束代碼 0 結束，否則每個問題輸出一行 `path: message`。加上 `--json` 可以取得機器可讀的輸出。

檢查通過後，同樣在「更多新增方式」裡用「匯入檔案」匯入這兩個檔案。

## 外掛能做什麼

- 加入 CSS，作用範圍限定在外掛替頁面加上的 `gv-` class 之下。
- 加入 class、設定安全的屬性或行內樣式、隱藏元素。目標可以是網站宣告的語義鍵（`userTurn`、`assistantTurn`、`composer` 等），也可以是 CSS 選擇器。
- 在 popup 裡提供設定：開關、滑桿和下拉選單，設定值會透過 `{{key}}` 帶進 CSS。
- 在 ChatGPT、Claude、DeepSeek 和 Kimi 上，啟用 Voyager 的原語（公式複製、時間軸、Mermaid 圖表等），並替 Voyager 自己的介面換色。

## 外掛做不到什麼

外掛不能執行 JavaScript，不能回應點擊或按鍵，不能從網路載入任何東西（字型、圖片、樣式表），不能讀取或改寫訊息內容，也不能在其他網站上執行。如果需求牽涉到這些，撰寫材料會讓 AI 直接說明，並做出最接近、又真的能實現的版本。

## 匯入時檢查的規則

除了共通的清單檢查（見[外掛貢獻說明](./plugin-contribution.md)），本機外掛還必須：

- 只匹配 Voyager 支援的網站範圍內的 URL；
- 只使用每個匹配網站都有宣告的語義鍵；
- 每個 `addClass` 只加一個 class，而且以 `gv-` 開頭；
- 只使用 boolean、number 或 select 設定（string 和 color 目前在 popup 裡還沒有對應的控制項）；
- 在 Gemini 和 AI Studio 上不使用 `theme`；原語只能用該網站開放的：Gemini 上是 `formulaCopy`、`vimInput`、`userLatex`、`codeCollapse`、`mermaid`、`wavedrom` 和 `echarts`, `sendShortcut`, `draftSave`、`turnNavigator`，AI Studio 上是 `formulaCopy`、`sendShortcut`。它們與 Voyager 內建的對應設定是同一套程式碼。`formulaCopy` 和 `vimInput`（「公式複製」「輸入框 Vim 模式」）在同一頁面上，內建設定和外掛只會執行其中一個：頁面剛載入、或兩者都沒在執行時，內建開關優先；之後誰已經在執行就繼續執行，另一方顯示為暫停。關掉其中一個，功能就交給另一個。`userLatex`、`codeCollapse`、`mermaid`、`wavedrom` 和 `echarts` 按元素逐一認領，可以和內建設定同時執行：對方已經處理的行或程式碼區塊留給對方。

Gemini 個人版現已支援本機 `turnNavigator`：設定 `params.dataBackend: "shared"` 和 `engine: ">=1.9.0"`，即可讀寫官方時間軸的同一份星標與層級資料；不能覆寫對話、帳號或回合的識別參數。官方「顯示時間軸」開啟時會發生衝突：先關閉官方開關，再啟用本機外掛；切回官方時，先停用本機外掛，再開啟官方開關。Business、Enterprise 和自訂網站範圍暫不開放。

翻譯（`i18n`）是選填的。

## 分享

本機外掛只存在你的瀏覽器裡。想搬到別的地方用，就在「我的創造」清單裡對它選擇「匯出」，再到那邊匯入這個 JSON 檔案。如果它對大家都有幫助，可以提議收進官方外掛目錄，流程請見[外掛貢獻說明](./plugin-contribution.md)。

所有網站每頁只能執行一個傳送快捷鍵外掛；已有外掛占用傳送模式時，另一個顯示衝突並暫停。可選 `mode`（需要 `"engine": ">=1.9.0"`）為 `ctrlEnterSends`（預設）或 `enterSends`。輸入法確認鍵不會觸發傳送。Gemini 和 AI Studio 現已開放，支援模式見下文。

Gemini 現在允許 `sendShortcut` 替代官方 Ctrl+Enter 傳送；關閉官方開關後啟用本地外掛。只支援 `ctrlEnterSends`，Enterprise 不執行。`composerRoot` 涵蓋主框和編輯框，`sendButton` 不含停止按鈕。

AI Studio 上的 `sendShortcut` 必須設定 `params.mode: "enterSends"`。關閉官方 Enter 傳送開關後，本地外掛可以接管；Ctrl/Cmd+Enter 換行，Shift/Alt+Enter 交由宿主處理。

Gemini 的 `draftSave` 與官方草稿共用 `gvDraft_<完整 pathname>`，保留 `/u/N` 和 Gem 路徑。停用會保留已存草稿，同頁多個外掛可以共用記錄。卸載前會盡力儲存最後輸入，瀏覽器關閉時無法保證非同步儲存完成。 寫入與修剪僅在同頁協調；同一個 `/u/N` 槽位更換電子郵件仍共用已存草稿。
