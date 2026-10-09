# HBO Helper 開發規則

本文件適用於整個儲存庫。使用者的明確指示優先於本文件；子目錄若有更具體的指引，也應一併閱讀。

## 專案目的與架構

HBO Helper 是 Windows 桌面工具，監測 Holy Beast Online 的真實經驗與升級進度。
使用 React、TypeScript、Electron 與獨立 C# 讀取模組。
介面與說明使用繁體中文，優先提供解壓縮即可執行的版本。

- `src/renderer/`：React 介面，不直接存取遊戲程序。
- `src/preload/`：透過 contextBridge 公開限定功能的 IPC。
- `src/main/`：桌面視窗、IPC、讀取程序生命週期與取樣。
- `src/main/monitor/statistics.ts`：滾動統計及效率計算。
- `src/shared/types.ts`：前後端共用資料型別。
- `native/HboReader.cs`：Windows 唯讀記憶體存取、指標解析、驗證與跨等級累計。
- `native/profile.json`：客戶端 SHA-256、主模組相對偏移與經驗表。
- `scripts/`：原生模組建置與免安裝封裝。

## 真實數據與監測行為

- 開始監測時重新尋找程序、取得最新資料，建立新的統計起點。
- 停止後重新開始，必須重新同步並重設本次統計。
- 每秒重新解析指標及讀取數據，不沿用固定 PID 或暫時的 heap 位址。
- 10／30 分鐘採滾動視窗；資料不足時應說明使用本次已有資料。
- 跨等級累計使用同版本的真實經驗表，不使用推估公式。
- 等級由經驗門檻推定；對應多個等級時不猜測。
- 未確認的欄位使用 null，介面顯示「未取得」；不得以示範數字冒充即時數據。
- 目前角色名稱、金幣與登入狀態尚未定位；登出、角色切換辨識尚未完成。
- 保留統計起點及最近視窗資料，避免長時間執行無限累積。
- 讀取失敗、遊戲關閉、驗證失敗或經驗下降時，停止統計並提示原因。
- 連線中、監測中、停止與錯誤需清楚區分；保留的舊資料應標示已停止更新。

## 指標與讀取模組

- 使用當下主模組基址加相對偏移解參照指標，每次取樣重新解析。
- 保留遊戲執行檔 SHA-256 驗證；不符的客戶端不得套用舊偏移。
- 更新 profile 時記錄版本與驗證依據；數值碰巧相同不足以確認欄位。
- 驗證經驗與門檻範圍，處理升級期間的短暫不一致。
- 目前兩個根指標解析到同一份資料，只是指標一致性檢查，不是兩份獨立數據。
- 已在目前程序驗證，但尚未實際重開遊戲確認跨程序穩定性；完成實測後再更新 README 與本文件。
- 目前模組維持唯讀。使用者要求道具或按鍵功能時，另設操作模組，區分監測與操作。
- C# 使用 Windows .NET Framework 編譯，避免需新語言版本或 .NET SDK 的語法與 API。

## Electron 與生命週期

- 保留 contextIsolation、sandbox，以及停用 nodeIntegration 的設定。
- 不向 renderer 公開任意系統指令、任意記憶體位址或完整 ipcRenderer。
- IPC 驗證來源視窗與主框架，只接受明確定義的功能。
- 避免重複啟動讀取程序與重疊取樣。
- 停止監測或關閉助手時，清理計時器、事件及讀取子程序。

## 開發與驗證

沿用現有 Node.js、npm 與 Windows C# 編譯器，不為此專案另裝 .NET SDK。
Windows PowerShell 使用 npm.cmd 可避免 npm.ps1 執行原則問題。
腳本相容 Windows PowerShell 5.1；目前建置腳本採 ASCII，C# 來源以 UTF-8 編譯。

- `npm.cmd run dev`：建置讀取模組並啟動開發介面。
- `npm.cmd run typecheck`：檢查 TypeScript。
- `npm.cmd test`：統計測試。
- `npm.cmd run test:native`：指標重定位、跨等級與異常資料測試。
- `npm.cmd run test:smoke`：實際桌面監測測試，需遊戲已開啟並登入角色。
- `npm.cmd run build`：建置原生模組與 Electron。
- `npm.cmd run pack:portable`：產生 Windows 成品與免安裝 ZIP。

依改動範圍執行必要檢查；純文件修改不需要重新打包。
統計與指標修改需驗證實際行為；介面與 IPC 修改需確認開始、停止及重新開始同步。
無法實測時記錄未驗證項目，不把編譯通過當成遊戲驗證通過。
不要自行關閉或重開使用者的遊戲。

## 版本控制與交付

- 開始工作先查看 git status，保留使用者未提交的修改。
- 新工作分支預設使用 `codex/` 前綴，除非使用者另有指定。
- GitHub 遠端使用 SSH：`git@github.com:alexlocode/hbo-helper.git`。
- 沿用本機 Git 的 SSH 設定，不將私鑰、憑證或金鑰路徑寫入程式碼。
- 不提交 node_modules、out、dist、artifacts、native/bin 或環境機密檔。
- 提交與推送依使用者要求執行，不強制推送或覆寫遠端歷史。
- 更新版本時同步 package.json、package-lock.json 與必要說明。
- 成品放在 `dist/<版本>/`，避免覆蓋使用者正在執行的舊版本。
- 免安裝 ZIP 包含完整 win-unpacked 資料夾、讀取 EXE 與 profile.json。
- 發布前確認封裝資源齊全，不只驗證開發模式。
- 交付時說明完成項目、測試結果與未支援欄位，提供實際成品路徑。
