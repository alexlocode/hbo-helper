# HBO Helper

個人使用的 Holy Beast Online 小工具，也是學習 **Electron** 的練習專案。

以遊戲角色資訊、經驗與金幣記錄為題材，練習桌面介面、IPC 通訊、程序生命週期管理及 Windows 應用程式封裝。

## 技術棧

- **Electron**：桌面視窗與 IPC 通訊。
- **React + TypeScript**：介面與共用資料型別。
- **Vite / electron-vite**：開發與建置。
- **C# / .NET Framework**：獨立的 Windows 唯讀資料模組。
- **electron-builder**：Windows 封裝與免安裝版本。

## 功能

- 搜尋已開啟的遊戲，顯示角色名稱、職業與等級。
- 在同一視窗切換角色入口與記錄畫面。
- 記錄經驗、升級進度、近期效率與金幣淨變化。

僅供個人使用與學習，依目前使用的遊戲版本開發。登入狀態辨識尚未支援。

## 開發

環境：Windows、Node.js 22.12 以上，以及系統 .NET Framework C# 編譯器。

```powershell
npm.cmd install
npm.cmd run dev
```

```powershell
npm.cmd run typecheck
npm.cmd test
npm.cmd run pack:portable
```

免安裝成品位於 `dist/<版本>/`，解壓縮完整資料夾後執行 `HBO Helper.exe`。

定位筆記：[職業欄位](native/PROFESSION.md)、[金幣欄位](native/GOLD.md)。
