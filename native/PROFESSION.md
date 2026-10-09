# 職業欄位驗證（0.3.1）

2026-10-09 在目前開啟的 JP 客戶端唯讀驗證。主程式 SHA-256 及 class.ini SHA-256 記錄於 profile.json。

## 指標來源

```text
manager = read32(mainModuleBase + 0x35B914)
actor = read32(manager + 0x78)
actorName = null-terminated bytes at actor + 0x124
classCode = signed read16(actor + 0x14E)
```

每次取樣重新解析兩層指標。角色名稱只讀取 32 位元組，需有 NUL 結尾且可解碼，並與應用程式名稱成員一致。讀取職業後再確認根指標、角色指標及名稱，避免同次取樣混合兩個角色。

## 程式碼證據

下列位址是檔案以預設基址 0x400000 反組譯的位址，只用於驗證；正式模組使用主模組相對偏移。

```text
0x55F66B: mov eax, [eax + 0x78]       ; eax from global 0x75B914
0x55F686: movsx edx, word [eax+0x14E]
0x55F68E: push edx                   ; class argument
0x55F6B8: add edx, 0x124             ; name argument
0x55F6E7: call 0x5CF140              ; update character window
0x5CF251: mov edx, [esp+0xEC]        ; class argument after two strings
0x5CF25D: mov ecx, [eax+0xC]         ; class database from global 0x761B1C
0x5CF26A: call 0x5ED730              ; lookup by class code
0x5CF295: mov ecx, [esi+0x18C]       ; profession text control
0x5CF2F0: call [ebp+0x44]            ; set profession text
```

角色視窗建立程式於 0x5CEB79 尋找控制項 5101（0x13ED），於 0x5CEB9B 存入視窗 +0x18C；遊戲 UI/Char.xml 同時確認 5101 是職業欄位。這是欄位用途與資料流證據，不以數值碰巧相同推斷。

## 資料表與實測

`data/db/class.ini` 是二進位資料：32 位元筆數、16 位元長度加版本字串 `050425`，之後每筆包含 32 位元代碼、16 位元長度加 UTF-8 名稱，以及另一個帶長度字串。20 筆完整解析，正好消耗檔案的 379 位元組。

profile.json 保存這 20 個明確代碼的對照，移除名稱中的種族前綴；不依百位數推估。包含戰士、盜賊、射手、仙法師、治療師、幻術師與初心者。ItemClassLimit.ini 的額外職業限制標籤不是目前角色 class.ini 的記錄，不擅自加進對照。

目前實測角色名稱與應用程式名稱均為 moooo，職業代碼 110，查表後介面顯示「戰士」。其他職業的對照來自資料表，尚未逐一切換角色實測。尚未重開遊戲驗證跨程序穩定性；登入狀態仍未定位，保留的角色資料不表示仍登入。

原生測試涵蓋模組基址與角色位址重定位、已知與未知代碼、名稱不一致、角色指標未就緒，以及取樣途中指標／名稱改變。編譯及合成測試不代表完成跨角色或跨程序實測。
