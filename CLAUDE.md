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

## 資料模型：**一個帳號一份文件**

```
tenants/{uid}  →  { data: "<整份狀態的 JSON 字串>", updated: <ms> }
```

狀態本身長這樣：

```js
{ entries: { "2026-09-06_a": {date, person:"a"|"b", kg} , ... },
  goals:   { a: {startDate, startWeight, targetDate, targetWeight}, b: {...} },
  names:   { a: "…", b: "…" } }
```

- **整份 `JSON.stringify` 進 `data` 欄位是刻意的**：Firestore 禁止巢狀陣列、對 map key 有限制，
  序列化成字串後全部免疫，同步也只要比一個字串（`lastSynced`）就能判斷「這是不是我自己剛寫的」。
  不要為了「可以在 console 讀」把它攤平成原生欄位，那會把上述限制全部請回來。
- entry 的 doc key 用 `日期_人`：同一人同一天必定覆蓋，不會有重複列。改成流水號會破壞這個性質。
- 人只有 `a` / `b` 兩個固定 id，顯示名稱另存 `names`。**不要把名字當 id**（改名會孤兒化所有紀錄）。
- 單文件上限 1MB。兩人每天各量一次約可撐 20 年，現在不需要分片或外掛 blob。

## 同步的四條防線（每一條都對應過真實事故，不要拆）

1. **換帳號清空**：localStorage 連 `uid` 一起存。`onAuthStateChanged` 發現本次 uid 與快取不同 →
   先 `resetState()` 再訂閱。否則 A 帳號的殘留資料會在 B 首次登入時被推上 B 的雲端。
2. **`lastSynced` 比對**：`onSnapshot` 收到的字串等於自己剛推的就 return，避免寫入→重繪→再寫入的迴圈。
3. **`flushPending()` 掛在 `visibilitychange` + `pagehide`**：推送有 800ms debounce，
   iOS PWA 切背景是突然的，緩衝空窗期被凍結那次寫入就永遠沒送出。使用者會看到「已同步」卻掉資料。
4. **錯誤訊息一律吐 `e.code || e.message`**：`permission-denied` = 規則問題、
   `auth/unauthorized-domain` = 網域沒加。猜測式的「同步失敗（離線？）」會害遠端除錯繞遠路。

規則路徑 `tenants/{uid}/{document=**}` 必須與程式碼的 `fs.collection("tenants").doc(uid)` 對得上——
**新增任何子集合時回頭檢查 `firestore.rules`**，路徑不合會被靜默拒絕，只看到「同步失敗」。

## 核心計算：`planAt(goal, day)`

整個 app 的價值都在這個函式——它算「目標線上今天應該是幾公斤」，
`實際 − planAt(今天)` 就是使用者要的「與目標差距」（負數＝超前）。
起算日與目標日之間線性內插，區間外夾在端點，`targetDate <= startDate` 時不除以零。
檔案底部的 `selfCheck()` 守著這幾個 case 加上 `applyBlob(stateBlob())` 的恆等性，
**改到日期、內插或序列化就要同步更新它**。

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

圖示是用 `node + zlib` 手寫 PNG 產生的（本機沒有 ImageMagick，`convert` 是 Windows 的檔案系統工具不是它）。
產生器留在 scratchpad，要改圖示直接重寫一份即可，不要手動編輯 PNG。

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
