# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 這是什麼

`index.html`：一個**單檔零建置** HTML app，兩個人共用的體重追蹤面板。
沒有 build / lint / test 指令，唯一的產物就是這個檔。要看畫面直接在瀏覽器開它。
部署：push 到 `main` → GitHub Pages 自動更新 https://jummpy7868.github.io/weight-duo/

`weight-panel.html`（gitignore，僅留在本機）是最早的 Claude Artifact 版本，已被取代。
Artifact 的 CSP 只允許 cdnjs/jsdelivr 且擋 XHR，**跑不了 Firebase**，不要試圖讓兩者共用一份程式碼。

## 兩種儲存模式（改任何存取邏輯前先讀懂這段）

`FB.apiKey` 還是 `PASTE_` 開頭時 → `CLOUD === false` → 整個 Firebase 區段不啟動，
資料只進 localStorage。**這個 fallback 要一直維持可用**，它讓 UI 能在沒有雲端的情況下開發與測試。

| 狀態 | 資料放哪 | 指示燈 |
|---|---|---|
| config 未填 | localStorage | 本機儲存（未接雲端）|
| 已填、未登入 | localStorage | 未登入 · 只存這台裝置 |
| 已登入 | Firestore `tenants/{uid}` + localStorage 快取 | 雲端同步 |

## 資料模型：**一個帳號一份文件，欄位帶時間戳，雲端進來用合併**

```
tenants/{uid}  →  { data: "<整份狀態的 JSON 字串>", updated: <ms> }
```

狀態本身（v8 起）：

```js
{ entries: { "2026-09-06_a": {date, person:"a"|"b", kg, t}  |  {del:true, t} , ... },
  goals:   { a: { "<起算日>": {startDate, startWeight, targetDate, targetWeight, t} | {del:true, t} }, b: {...} },
  names:   { a: "…", b: "…", t } }
```

- **每一筆都帶 `t`（最後改動的毫秒），刪除是留墓碑 `{del:true,t}` 不是真的刪。**
  這讓 `merge(local, remote)` 可以逐 key 取 `t` 大的那份：兩人同一秒各記一筆不會互吃、
  Safari 把分頁重載時本機還沒送出的改動不會被雲端蓋掉、一台刪了另一台不會把它復活。
  平手（例如兩邊都是遷移來的 t=0）讓雲端贏。墓碑超過 `TOMB_KEEP_DAYS` 天在 `stateBlob()` 時剪掉。
- **`onSnapshot` 收到雲端版本一律 `merge` 進 S，不是 `applyBlob` 整份取代**；合併後 `stateBlob()` 若和雲端字串不同，
  代表本機有雲端沒有的東西，立刻推回去。`applyBlob`（整份取代）只用在開機讀 localStorage。
- **所有讀取都要過 `live(map)` 濾掉墓碑**——`seriesOf` / `periodsOf` / `renderLog` 都是。
  直接 `Object.values(S.entries)` 會把已刪的畫出來。
- **`migrate()` 負責吃 v7 以前的舊格式**（entries 沒 `t`、goals[p] 是單一物件），對新格式必須是恆等。
  雲端第一次被 v8 讀到時會自動改寫成新格式，不需要手動搬。
- **整份 `JSON.stringify` 進 `data` 欄位是刻意的**：Firestore 禁止巢狀陣列、對 map key 有限制，
  序列化成字串後全部免疫。不要為了「可以在 console 讀」把它攤平成原生欄位。
- entry 的 key 用 `日期_人`：同一人同一天必定覆蓋。改成流水號會破壞這個性質。
- 人只有 `a` / `b` 兩個固定 id，顯示名稱另存 `names`。**不要把名字當 id**。
- **目標是多期的**，key = 起算日。`currentGoal(V,p)` = 起算日 ≤ 今天的最後一期（卡片用）；
  `goalAt(V,p,date)` = 起算日 ≤ 那天的最後一期（紀錄列與圖用）。圖上所有期都畫。
  對話框「另訂新一期」= `goalKey=null`；「修改這一期」改了起算日 = 舊 key 留墓碑、新 key 寫入（搬期不是複製）。
- 單文件上限 1MB。兩人每天各量一次約可撐 20 年，現在不需要分片。

## 核心計算：`planAt(goal, day)`

整個 app 的價值都在這個函式——它算「目標線上今天應該是幾公斤」，
`實際 − planAt(今天)` 就是使用者要的「與目標差距」（負數＝超前）。
起算日與目標日之間線性內插，區間外夾在端點，`targetDate <= startDate` 時不除以零。
檔案底部的 `selfCheck()` 守著這幾個 case 加上 `applyBlob(stateBlob())` 的恆等性，
**改到日期、內插或序列化就要同步更新它**。

## 修改既有紀錄：複用同一張表單

按紀錄列的「修改」→ 該筆載入上方的輸入表單，送出鍵變成「儲存修改」。
**不要另外做一個編輯對話框**，那會變成第二份寫入邏輯。

一個必守的細節：doc key 是「日期_人」，所以存回去是覆蓋——
但使用者若把**日期或誰也改了**，key 就變成另一筆，
`if(was && was !== id) delete S.entries[was]` 這行不能拿掉，否則一筆會分裂成兩筆。
同理，刪掉正在編輯的那筆時要 `stopEdit(true)`，否則會殘留編輯狀態指向不存在的 id。
送出後刻意**不重設日期**：接著通常要記另一半同一天的體重。

## 畫圖的規矩（違反了圖就會退化）

- 純手寫 SVG 字串，**不要引圖表庫**。
- **統計窗口＝顯示窗口**：切到「近 30 天」時，Y 軸範圍就只能用那 30 天的點算。
- 橫軸是**真實日期比例**，不是「第 N 次」。體重對照的是有期限的目標線，時間軸必須等比。
- 兩人的區分不能只靠顏色：`a` 實線、`b` 虛線，圖例用 `border-top-style` 對應。
  配色若要改，用相對亮度算對比（色相差 ≥60° 或對比 ≥1.8:1，各色對背景 ≥2.7:1），
  **動一個顏色要重驗全部配對**。
- SVG 的顏色一律走 CSS 變數（`var(--a)` / `var(--ink)` / `var(--line-soft)`），
  寫死色碼在深色主題下會變成看不見的字。

## PWA：**每次改動都要 bump 版本**

`sw.js` 的 `VERSION` 與 `index.html` 裡 `<span class="ver" id="ver">` 的字樣是**同一個版本號的兩份副本**，
必須一起改。忘了 bump → 舊快取不清 → 使用者拿到舊版而且**完全沒有錯誤訊息**。
交付檢查腳本會比對這兩處，不一致會叫。

Service Worker 的攔截範圍是刻意收窄的，**不要放寬**：

| 請求 | 策略 | 為什麼 |
|---|---|---|
| 非 GET | 不攔 | Firestore 寫入是 POST |
| 同源 | 網路優先，離線回快取 | push 的新版要馬上拿得到 |
| fonts.googleapis / fonts.gstatic / www.gstatic | 快取優先 | 版本化網址，不會變 |
| 其他（firestore / identitytoolkit / securetoken …） | **完全不呼叫 `respondWith`** | 攔了會擋掉即時同步與登入，而且是靜默失敗 |

### 圖示

**改圖示 = 換掉 `icon-src.png` 再跑 `make-icons.ps1`**，不要手動編輯輸出的 PNG。
本機沒有 ImageMagick（`convert` 是 Windows 的檔案系統工具，不是它），用 System.Drawing 縮放。

那支腳本有兩個非改不可的寫法，動它之前先讀腳本開頭的註解：

1. **主體包在 here-string 裡再 `Invoke-Expression`**。PowerShell 5.1 會先解析整個檔案才執行，
   檔案裡的 `[System.Drawing.X]` 在 `Add-Type` 跑到之前就要解析 → `Unable to find type`。
   同一段程式碼貼進 shell 逐句跑卻正常，很容易誤判成環境壞掉。
2. **maskable 版單獨產一張**（`icon-maskable-512.png`，內縮 78% + 補底色）。
   Android 會把圖示裁成圓角／圓形遮罩，直接拿滿版圖當 maskable 會把貼邊的元素切掉。
   補邊色取邊框八點平均——只取一個角落像素會被暈影或 JPEG 雜訊帶偏，接縫看得出來。

## 交付前固定跑（不要跳過）

單檔 app 沒有編譯器，很多錯是**安靜地**發生的——CSS 少一個括號會讓下一條規則被靜默吞掉。

```bash
node check.js
```

檢查 CSS 大括號平衡、每個 inline script 與 `sw.js` 的語法、manifest 可解析、
**版本號兩份副本一致**、被引用的檔案都存在、`sw.js` 沒有把 Firebase API 主機列進快取白名單。
改完 CSS 或 script 一定要重跑，非 0 離開碼就是有東西壞了。

## 用語

健康類 app，措辭要降焦慮：用「超前／落後」不用「達標／失敗」，
用「需要留意」不用「異常」。中文介面，繁體。
