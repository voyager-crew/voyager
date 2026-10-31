# 資料夾

把對話收進側邊欄裡的資料夾：拖進去就歸檔好了，資料夾可以套三層，換一台裝置也能同步回來。電腦和 Android 手機上都能用。

<SiteSupport feature="folders" :labels="{ folders: '側邊欄資料夾', 'hide-filed': '隱藏已歸檔對話', activity: 'Activity 檢視', 'account-isolation': '帳號隔離', projects: '資料夾即專案', 'ai-organize': 'AI 整理', 'move-menu': '對話選單裡的 **移動到資料夾**', 'library-drag': '從 Library 表格拖進資料夾', 'gem-icons': '依 Gem 類型顯示的對話圖示' }" :only="[{ id: 'move-menu', sites: ['gemini', 'chatgpt', 'claude'] }, { id: 'library-drag', sites: ['aistudio'] }, { id: 'gem-icons', sites: ['gemini'] }]" />

<GuideHero src="/assets/gemini-folders.png" alt="側邊欄裡的資料夾區域">

資料夾區域在側邊欄的對話列表上方。側邊欄收起時，同一套資料夾也能在浮動面板裡使用。

</GuideHero>

## 把對話放進資料夾

<GuideOp>

側邊欄裡的對話都能放進資料夾，同一則對話也可以放進好幾個資料夾。

- **拖曳**：把側邊欄裡的對話拖到資料夾上。
- **對話選單**：在支援的網站上，打開對話自己的選單，選 **移動到資料夾**。
- **多選**：長按資料夾裡的一則對話進入多選，再一起移動。
- **AI Studio**：側邊欄暫不支援多選；可以從 Library 表格把對話拖進資料夾。

</GuideOp>

## 巢狀與改名

<GuideOp side="end">

<GuideShot src="/assets/folders-nested-zh.png" alt="三層巢狀的資料夾" :width="240" />

資料夾最多三層：頂層資料夾下面還能再建兩級子資料夾。

- **子資料夾**：在資料夾上按右鍵，從選單新增子資料夾。
- **改名**：雙擊資料夾名稱，或在右鍵選單裡選 **重新命名**。
- **收合**：點資料夾前的箭頭，收起或展開它底下的內容。

</GuideOp>

### 右鍵選單與顏色

<GuideOp side="end">

<GuideShot src="/assets/folders-menu-zh.png" alt="資料夾右鍵選單和顏色" :width="206" />

在資料夾上按右鍵，所有操作都在選單裡。

- **置頂**：讓這個資料夾排在最前面。
- **顏色**：7 種顏色任選一種。
- **刪除**：連同裡面的內容一起刪掉，會先確認。

</GuideOp>

<GuideNote>

**顯示設定**：資料夾標題列的齒輪裡可以切換對話排序（手動排序或最近開啟），並調整字級、資料夾間距和子資料夾縮排；彈出視窗的 **資料夾間距** 也能調。Mac Safari 上調整後可能要重新整理頁面才會生效。

</GuideNote>

## 隱藏已歸檔對話

<GuideOp>

對話放進資料夾後，可以讓它不再出現在主列表裡，主列表只留進行中的對話。

- **Gemini 和 AI Studio**：打開彈出視窗 → **資料夾選項** → **隱藏已歸檔對話**。兩邊的設定互相獨立；AI Studio 上隱藏的是 Library 表格裡的列。
- **第一次歸檔**：在這兩個網站上，你第一次把對話放進資料夾時，資料夾區域會跳出一張卡片，一鍵就能開啟；點 **暫不開啟** 就不會再提示。
- **其他網站**：這個開關在彈出視窗 **外掛** 區域資料夾外掛的設定裡，預設關閉。
- **不會刪除**：對話隨時能在資料夾裡找到；開關也隨時可以關掉。

</GuideOp>

## 同步與遷移

<GuideFacts>
<GuideFact title="匯入與匯出">

資料夾標題列的資料夾圖示裡有 **匯入資料夾** 和 **匯出資料夾**。匯出會得到一個 JSON 檔；匯入時會與現有資料夾合併，不會打亂已有的分類。

<GuideShot src="/assets/folders-transfer-zh.png" alt="匯入和匯出資料夾" :width="160" />

</GuideFact>
<GuideFact title="帳號隔離">

Gemini 側欄的人像按鈕只暫時顯示目前 Google 帳號的對話，預設關閉。彈出視窗 **資料夾選項** 裡的 **啟用硬隔離（Hard Isolation）** 會依帳號拆分資料夾和雲端同步資料；開啟後人像按鈕會自動隱藏。

</GuideFact>
<GuideFact title="雲端同步">

每個有資料夾的網站都能用雲端同步在另一台電腦上拿回同樣的資料夾。各網站的資料夾分開儲存、分開同步。

[設定雲端同步](/zh_TW/guide/cloud-sync)

</GuideFact>
<GuideFact title="Activity 檢視">

點資料夾標題列的鈴鐺，目錄會換成唯讀的 Activity 檢視，依最近一次真實對話的時間列出近幾天的對話；再點一次回到資料夾樹。它不會移動、複製或重新分類任何對話。

[Activity 檢視的完整說明](/zh_TW/guide/activity-view)

</GuideFact>
</GuideFacts>

## AI 整理

對話太多不想手動分，可以讓 Gemini 給出一份資料夾方案。

<GuideSteps>
<GuideStep>

在 Gemini 上打開彈出視窗，點 **資料夾選項** 底部的 **AI 整理**。它會把未分類的對話和現有資料夾結構寫成一段提示詞，複製到剪貼簿；提示詞和資料夾名稱都用你設定的語言。

<GuideShot kind="panel" src="/assets/ai-auto-folder.png" alt="彈出視窗裡的 AI 整理按鈕" :width="326" />

</GuideStep>
<GuideStep>

把提示詞貼給 Gemini，它會回覆一段 JSON 格式的資料夾方案。

</GuideStep>
<GuideStep>

在資料夾標題列點 **匯入資料夾**，選 **或直接貼上 JSON**，貼上後點 **匯入**。預設 **與現有資料夾合併**，只新增資料夾和新的歸檔，不動已有的分類。

</GuideStep>
</GuideSteps>

## 資料夾即專案

讓某個資料夾帶上一套首輪指令，新對話送出第一則訊息後自動歸進去。思路參考了 Claude Projects，但 Voyager 只做首輪指令加自動歸檔，不是共享上下文的工作區。

<GuideSteps>
<GuideStep>

在彈出視窗中開啟 **啟用資料夾作為專案**。

</GuideStep>
<GuideStep>

在資料夾上按右鍵，選 **設定指令** 或 **編輯指令**。

</GuideStep>
<GuideStep>

打開一個新的 Gemini 對話，在輸入框旁的資料夾選擇器裡選中它。

</GuideStep>
<GuideStep>

送出第一則訊息。

</GuideStep>
</GuideSteps>

<GuideNote>

**之後**

- 第一次送出後，對話自動歸入這個資料夾。
- 資料夾有指令時，Voyager 只在第一次送出時暫時附上這些指令；沒有指令時，它就是一個快速歸檔入口。
- 同一資料夾裡的對話 **不** 共享記憶，也不會互相讀取內容。
- 草稿自動儲存只保留你輸入的正文，不會把隱藏的指令放回輸入框。

</GuideNote>

側邊欄寬度見 [側邊欄寬度](/zh_TW/guide/sidebar)。
