# 隱私政策

最後更新：2026年10月25日

## 概覽

Voyager 是一款本機優先的瀏覽器擴充功能，用來整理並強化支援的 AI 聊天工作區。它只會為了提供您要求的功能而處理有限的使用者資料。Voyager 不營運會接收對話、提示詞、瀏覽活動、圖片或帳戶識別碼的後端伺服器，也不使用廣告或分析追蹤器。

## 處理的資料

視您使用的功能而定，Voyager 可能會處理以下資料：

- **網站內容與個人通訊內容**：對話文字、提示詞、草稿、圖片、連結，以及其他受支援頁面的內容，用於資料夾、導覽、匯出、提示詞管理、研究與介面功能。
- **帳戶識別碼**：受支援的 Google 服務可能會提供已登入的電子郵件地址。Voyager 會將其轉換為本機帳戶識別碼，讓不同帳戶的資料保持分離。Voyager 不會把原始電子郵件地址傳送給我們。
- **網頁紀錄與使用者活動**：受支援網站的網址、對話路由，以及有限的頁面、互動與網路事件，用於導覽、快捷鍵、用量顯示、回應完成通知與其他您要求的功能。這些資料不會用於建立使用者輪廓或投放廣告。
- **驗證資訊**：僅在您明確啟用 Google Drive 同步時，才會取得具有 `drive.file` 範圍的 OAuth2 權杖。
- **擴充功能資料與設定**：資料夾、提示詞範本、草稿、星標訊息、用量快照、外掛狀態與介面偏好設定。

這些資料儲存在 `chrome.storage.local` 中；受支援的設定則儲存在 `chrome.storage.sync` 中。部分功能也會使用受支援網站本身在使用者裝置上的 `localStorage`，用於保存資料夾資料的備份副本與時間軸快取。短暫的轉交記錄使用工作階段儲存空間：Research Pack 轉交使用瀏覽器記憶體中的擴充功能 `storage.session`；ChatGPT 臨時對話轉交只在頁面的 `sessionStorage` 中保存一個分頁權杖，對話記錄在 `chrome.storage.local` 中最多保留 60 秒。除非使用者明確使用下文所述的傳輸功能，資料會留在使用者的裝置或瀏覽器同步帳戶中。

## 使用者要求的傳輸

- **Google Drive 同步（選用）**：選定的備份資料會在您的裝置與**您自己的 Google Drive**之間直接傳輸。Chrome、Edge 與 Firefox 會使用瀏覽器身分 API；Safari 直裝版則使用原生 Google Sign-In，並將憑證保存在 macOS 鑰匙圈中。兩種方式都只申請 `drive.file` 範圍；OAuth 權杖不會傳送到 Voyager 伺服器。在 Chromium 瀏覽器中，若瀏覽器無法直接核發權杖（例如 Brave，或該登入方式失敗時），Google 會將登入結果傳回 `https://voyager.nagi.fun/oauth/callback/` 上的靜態中轉頁，由該頁的腳本在瀏覽器內轉交給擴充功能。權杖位於 URL fragment 中，瀏覽器不會將它傳送給伺服器；與造訪任何網頁一樣，該靜態網站可以看到請求的 IP 位址與瀏覽器 User-Agent。Firefox 則使用 loopback 重新導向（`http://127.0.0.1/mozoauth2/…`），由瀏覽器在請求送出前攔截，並透過 PKCE 直接與 Google 交換授權碼。
- **Safari iCloud 同步（選用）**：Safari 直裝版可將選定的備份資料直接寫入您 iCloud 帳戶的私有 CloudKit 資料庫。Voyager 不會取得您的 Apple ID 或 iCloud 驗證權杖，開發者也無法存取該私有資料庫中的記錄。
- **匯出與圖片**：使用者要求匯出時，Voyager 可能會從頁面既有的圖片來源擷取圖片，並可能要求臨時存取權限，以擷取生成的介面內容。產生的檔案是為使用者建立的，不會上傳到 Voyager 伺服器。
- **Context Sync（選用）**：使用者按下同步時，Voyager 會將擷取的對話脈絡傳送到使用者本機上的本地伺服器 `http://127.0.0.1:<連接埠>/sync`（預設連接埠 3030，可修改）。功能開啟且擴充功能視窗開啟時，Voyager 也會檢查該位址，以顯示本地伺服器是否可連線。這些資料不會經由 Voyager 離開使用者的裝置。
- **Research Pack「在 ChatGPT / Claude 中繼續」**：使用者選擇目標後，Voyager 會在所選網站（ChatGPT 或 Claude）開啟新對話。若 Voyager 已在該網站執行，研究包會透過瀏覽器記憶體中的 `storage.session` 轉交，只能由該分頁領取一次，並填入輸入框而不會送出；該記錄 60 秒後失效。否則研究包會複製到剪貼簿，由使用者自行貼上。研究包不會放在 URL 中傳遞。
- **ChatGPT 臨時對話轉交**：使用者選擇繼續 ChatGPT 臨時對話時，Voyager 會將一份 Markdown 備份下載到使用者的裝置，離開臨時模式，並將對話內容放入一般 ChatGPT 對話的輸入框而不送出。對話記錄只會留在 ChatGPT 與使用者的裝置上。
- **公開專案資源**：Voyager 可能會請求公開的發行版本、公告或說明文件資源。這些請求不包含對話或提示詞內容。
- **外掛目錄線上更新（選用）**：在您已啟用至少一個外掛的網站上，Voyager 可能會透過 HTTPS 取得該網站的外掛目錄檔案 `https://voyager.nagi.fun/catalog/hosts/<網站主機名稱>.json`，例如 `https://voyager.nagi.fun/catalog/hosts/chat.deepseek.com.json`。檢查只會在開啟這類頁面、或在這類頁面上開啟擴充功能視窗時進行，而且距離上次檢查必須超過您選擇的間隔（預設 6 小時，可選 1 小時、6 小時、24 小時或僅手動）。Gemini 與 AI Studio 繼續使用隨擴充功能打包的官方外掛，不會發出外掛目錄請求。該請求是一般的 GET：不會帶上 Cookie，不會帶上帳戶或擴充功能識別碼，也不會帶上頁面或對話內容；與任何網路請求一樣，伺服器可以看到發出請求的 IP 位址、瀏覽器 User-Agent，以及網址路徑中的網站主機名稱。在有外掛的網站上，擴充功能視窗提供「外掛線上更新」開關與檢查間隔選項，兩項設定都保存在瀏覽器同步儲存空間中，並包含在設定備份內。關閉該開關後，除非您按下「立即檢查外掛更新」，Voyager 不會向 voyager.nagi.fun 發出外掛目錄請求。若請求失敗或該網站沒有目錄檔案，擴充功能會繼續使用隨附的外掛快照。取得的目錄只包含 CSS 與 JSON，使用前會經過驗證與淨化；不會下載或執行任何 JavaScript。此檢查與公告檢查分開，後者有自己的設定。voyager.nagi.fun 是由 Cloudflare 代理的靜態託管網站，Voyager 專案不記錄、不保存這些請求；連線中繼資料（IP 位址、User-Agent）由託管方依其自身隱私政策處理。
- **Gemini 頁面辨識線上修復（選用，預設關閉）**：只有在「一般選項」中開啟這個獨立開關後，Voyager 才可能取得 `https://voyager.nagi.fun/catalog/gemini-selectors/v2/hosts/gemini.google.com.json`。檔案只含經過驗證、用於識別對話輪次、側邊欄項目和標題、資料夾顯示區域及模型選單控制項的規則，不含程式碼、CSS 或外掛。開啟 Gemini 或其擴充功能視窗時可能自動檢查，從上次嘗試起最多每 6 小時一次，關閉再開啟不會重設間隔。因擴充功能重新啟動而中斷的檢查可能重試。「立即檢查」僅在開啟時可用，只跳過時間間隔。開啟需要在 Gemini 分頁中操作，關閉可以在任何分頁的擴充功能視窗裡完成。關閉後禁止這類請求，包括手動檢查；取消進行中的檢查並刪除已下載的資料，但在本機保留上次嘗試時間。授權選擇與下載的資料僅保存在目前裝置，不參與瀏覽器同步或設定備份。新修復及關閉操作在你自行重新整理頁面後生效；已開啟的頁面繼續使用目前快照，不會自動重新載入。GET 請求不攜帶 Cookie、Referrer、識別碼或頁面、對話內容；伺服器可見 IP 位址、User-Agent 和請求的主機名稱，託管方處理方式同上。AI Studio 仍只使用包內資料。外掛更新與公告保留各自獨立的開關。

Voyager 不會出售使用者資料，也不會為了廣告、信用評估，或與擴充功能面向使用者的功能無關的目的而傳輸資料。

## 權限

- **Storage（儲存空間）**：在本機儲存擴充功能資料與偏好設定，並在支援的情況下透過瀏覽器同步。Chrome、Edge 與 Firefox 也會授予 `unlimitedStorage`，避免本機資料受預設的瀏覽器配額限制；Voyager 仍會套用自己的儲存上限。在 Safari 上此權限為選用。
- **Identity（身分識別）**：在使用者明確操作後，為選用的 Google Drive 同步進行驗證。Safari 版不會請求此權限：Safari 上的 Google Drive 與 iCloud 同步都透過 Voyager macOS 應用程式完成。
- **Scripting（腳本注入）**：只在受支援的網站上注入擴充功能隨附的腳本；不會執行遠端 JavaScript 或 WebAssembly。
- **Active tab 與 declarative content**：辨識使用者開啟的受支援網站，並顯示對應的網站專用控制項。declarative content 僅用於 Chrome 與 Edge。
- **Alarms（定時器）**：定期檢查公開公告，並執行背景定時器，用於清理過期的轉交記錄與執行延遲工作。
- **Notifications（通知，選用）**：只有在使用者開啟回應完成通知或遠端公告的系統提醒時才會請求。Safari 版不會請求此權限，回應完成通知由 Voyager macOS 應用程式發出。
- **Native messaging（原生訊息，僅 Safari）**：將 Safari 擴充功能連接到 Voyager macOS 應用程式，用於 Google Drive 與 iCloud 同步，以及回應完成通知。
- **Host permissions（主機權限）**：安裝時即授予 Gemini、Gemini Enterprise 與 AI Studio，以及使用者要求的 Google Drive 與圖片操作所需的 Google 網域。
- **選用主機權限**：Claude、ChatGPT、DeepSeek 與自訂網站，只有在使用者為該網站啟用 Voyager 或外掛，並核准瀏覽器的權限提示後，才會存取。使用者選擇會擷取生成介面內容的匯出時，可能會臨時請求 `<all_urls>`；若被拒絕，匯出會在沒有該擷取步驟的情況下繼續。

## 保留期限與使用者控制

本機與瀏覽器同步的資料會一直保留，直到使用者將其刪除、清除擴充功能儲存空間，或解除安裝擴充功能為止。Voyager 存放在支援網站自身 `localStorage` 中的副本（資料夾備份與時間軸快取）不會隨解除安裝而刪除，需在瀏覽器中清除該網站的資料。雲端備份會保留在使用者選定的 Google Drive 或 iCloud 帳戶中，直到使用者自該帳戶中移除為止。使用者可以透過 Voyager 與瀏覽器設定停用選用功能，並撤銷選用的網站存取權限或 Google 授權。

## Google API 限制使用

Voyager 對從 Google API 取得的資訊之使用與傳輸，符合 Chrome 線上應用程式商店使用者資料政策，包括其中的限制使用要求。

## 政策變更

我們可能會隨 Voyager 的變動不時更新隱私政策。最新版本及其更新日期將發佈在此頁面。

## 聯絡我們

如果您對本隱私政策有任何疑問，請透過我們的 [GitHub 儲存庫](https://github.com/voyager-crew/voyager) 聯絡我們。
