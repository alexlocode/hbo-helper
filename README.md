# HBO Helper 0.3.3

React + TypeScript + Electron，使用獨立 C# 讀取程式監測 Holy Beast Online 的實際經驗。

## 使用

0.3.3 角色卡片依職業顯示 `src/renderer/src/assets/professions/` 中的圖片：02 → warrior.jpg（戰士）、03 → mage.jpg（仙法師）、04 → archer.jpg（射手）、05 → healer.jpg（治療師）、06 → rogue.jpg（盜賊）、07 → illusionist.jpg（幻術師）。使用原始 JPG，等比例顯示；初心者及未取得職業時留空。

0.3.2 介面移除頂部標題列，監測中以角色卡片外圍綠色圈線標示；近期 10／30 分鐘經驗合為一組，本次監測總累計的經驗與金幣另成一組。升級進度區保持原樣；金幣尚未定位，仍顯示「未取得」。

先開啟遊戲並登入角色，再開啟 HBO Helper，按「開始監測」。
開始時重新尋找程序、取得主模組基址、解參照指標，讀取當下最新數據作為統計起點。
之後每 5 秒重讀指標、角色名稱、職業與經驗。停止後再開始會清除上一段統計並重新同步。

- 經驗、升級門檻：實際讀取。
- 等級：依同一遊戲版本的經驗表推定，重複門檻時不顯示等級。
- 角色名稱：實際讀取名稱成員，驗證字串長度、容量、結尾與 UTF-8；無法解碼時顯示「未取得」。
- 職業：實際讀取目前角色的職業代碼，核對角色名稱後查同版本 class.ini 對照表；只顯示職業，不顯示種族。支援資料表中的戰士、盜賊、射手、仙法師、治療師、幻術師與初心者；未知代碼顯示「未取得」。
- 金幣：尚未定位，顯示「未取得」，沒有示範數據。
- 10／30 分鐘經驗：滾動統計，資料不足時使用本次已有資料。
- 跨等級：使用從目前遊戲擷取的等級經驗表累計，不使用示範公式。
- 遊戲關閉、讀取失敗、指標驗證失敗或經驗下降時，停止監測並提示。
- 目前不讀取登入狀態；登出但程序仍保留角色資料時，可能讀到最後保留的數值。需停止監測；登入狀態辨識待後續接入。
- 統計不永久保存。保留本次起點及最近 30 分鐘的資料，避免長時間執行無限累積。

## 指標設定

`native/profile.json` 綁定遊戲執行檔 SHA-256，僅支援目前驗證的 JP 客戶端版本。
不是硬編碼 PID 或暫時的 heap 位址。每次開始都依當下主模組基址重新計算：

```text
required = read32(read32(HBOnlinejp.exe base + 0x361AFC) + 0x1B0)
experience = read32(read32(HBOnlinejp.exe base + 0x361AFC) + 0x1B4)

secondary required = read32(read32(base + 0x3619D8) + 0x738)
secondary experience = read32(read32(base + 0x3619D8) + 0x73C)
```

每次讀取會比對兩個根指標，並驗證門檻存在於經驗表、目前經驗小於門檻。
兩個根指標在本次程序會解析到同一份資料，因此這是指標一致性檢查，不是兩份獨立數據。
目前已在開啟中的遊戲驗證，並測試模組基址與 heap 位址改變時的解析。
**尚未實際重開遊戲驗證跨程序穩定性**；遊戲更新或指標結構改變時需更新 profile，程式會拒絕不符的版本。
已取得的角色名稱改變或無法確認時會停止統計。登入狀態與同名角色切換仍未驗證；切換角色請手動停止後重新開始統計。

0.3.1 名稱及職業驗證（2026-10-09）：

```text
name = MSVC string at read32(base + 0x362B30) + 0x154
actor = read32(read32(base + 0x35B914) + 0x78)
actorName = null-terminated bytes at actor + 0x124
classCode = signed read16(actor + 0x14E)
profession = profile.professionTable[classCode]
```

已從遊戲更新職業欄位的程式碼追蹤職業代碼來源，不再依賴職業 UI 的自訂字碼。角色物件名稱需與應用程式名稱一致，且取樣前後指標與名稱需一致。class.ini 的 20 筆代碼使用明確對照，移除種族前綴，不使用推估公式。開啟中的 moooo 已實測讀到代碼 110，顯示「戰士」；其他職業與重開遊戲後穩定性尚未實測。角色物件可能保留登出前的資料，不能作為登入狀態依據。完整定位證據見 [native/PROFESSION.md](native/PROFESSION.md)。

## 開發與驗證

Windows、Node.js 22.12 以上，以及系統 .NET Framework C# 編譯器。
不需另裝 .NET SDK。成品包含讀取 EXE，但仍需 Windows .NET Framework 執行環境。

```sh
npm install
npm run dev
npm test
npm run test:native
npm run test:smoke
npm run pack:portable
```

`test:smoke` 使用實際遊戲，需要已登入角色。
可設定 `HBO_EXPECT_CHARACTER` 與 `HBO_EXPECT_PROFESSION` 驗證指定角色；此次使用 moooo／戰士，檢查 5 秒前不取樣、5 秒後更新、停止後不更新，以及重新開始同步。
設定 `HBO_PACKAGED_ROOT` 為 win-unpacked 絕對路徑，可直接以 `electron tests/smoke.cjs` 驗證成品 app.asar 及隨附的讀取 EXE。
`npm run build` 會編譯讀取 EXE，再建置 Electron。
Windows 成品位於 `dist/0.3.3/`。整個 `win-unpacked` 資料夾可直接執行，不需安裝。

## 結構

- `native/HboReader.cs`：唯讀 Windows API、指標解析及跨等級累計。
- `native/profile.json`：版本限定指標與經驗表。
- `scripts/build-native.ps1`：使用 Windows C# 編譯器建置。
- `src/main/monitor/`：讀取程式通訊、取樣與統計。
- `src/preload/`：限定功能的 IPC 橋接。
- `src/renderer/`：React 介面。
- `src/shared/`：共用型別。

Electron 啟用 context isolation 與 sandbox，未公開任意執行指令的 API。
只使用讀取權限，不修改遊戲記憶體，不操作道具。
打包依賴 global-agent 固定為 4.1.3；升級時可重新檢查此 override。
