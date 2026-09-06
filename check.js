/* 交付前檢查：node check.js
   單檔 HTML app 沒有編譯器，錯誤大多是安靜的——
   CSS 少一個括號會讓緊接的下一條規則被解析器靜默吞掉，不會報錯。 */
const fs = require("fs"), vm = require("vm"), path = require("path");
process.chdir(__dirname);

const src = fs.readFileSync("index.html", "utf8");
const sw  = fs.readFileSync("sw.js", "utf8");
let bad = 0;
const ok   = m => console.log("  ok   " + m);
const fail = m => { bad++; console.log("  FAIL " + m); };

// 1) CSS 大括號平衡
const css = (src.match(/<style>[\s\S]*?<\/style>/g) || []).join("\n").replace(/<\/?style>/g, "");
let d = 0, min = 0, line = 1, at = 0;
for (const ch of css) {
  if (ch === "\n") line++;
  if (ch === "{") d++;
  if (ch === "}") { d--; if (d < min) { min = d; at = line; } }
}
d === 0 && min === 0 ? ok("CSS 大括號平衡")
                     : fail("CSS 大括號 depth_end=" + d + " min=" + min + (at ? " 第 " + at + " 行" : ""));

// 2) 每個 inline <script> 的語法
let n = 0;
for (const m of src.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)) {
  n++;
  try { new vm.Script(m[1]); ok("inline script #" + n); }
  catch (e) { fail("inline script #" + n + "：" + e.message); }
}
if (!n) fail("找不到任何 inline script");
try { new vm.Script(sw); ok("sw.js 語法"); } catch (e) { fail("sw.js：" + e.message); }

// 3) manifest
let mf;
try { mf = JSON.parse(fs.readFileSync("manifest.webmanifest", "utf8")); ok("manifest 可解析（" + mf.icons.length + " 個圖示）"); }
catch (e) { fail("manifest：" + e.message); mf = { icons: [] }; }

// 4) 版本號的兩份副本必須一致（忘了 bump → 使用者拿到舊版且無錯誤訊息）
const a = (src.match(/id="ver">([^<]+)</) || [])[1];
const b = (sw.match(/VERSION\s*=\s*"([^"]+)"/) || [])[1];
a && a === b ? ok("版本一致：" + a) : fail("版本不一致：index.html=" + a + " sw.js=" + b);

// 5) 被引用的檔案要真的存在
const refs = new Set([...mf.icons.map(i => i.src), "manifest.webmanifest", "sw.js", "index.html"]);
for (const m of src.matchAll(/(?:href|src)="(?!https?:|data:|#)([^"]+)"/g)) refs.add(m[1]);
const missing = [...refs].filter(f => !fs.existsSync(f));
missing.length ? fail("缺檔：" + missing.join(", ")) : ok("引用的 " + refs.size + " 個檔案都存在");

// 6) Service Worker 不可以攔 Firebase 的 API 主機
["firestore.googleapis.com", "identitytoolkit", "securetoken"].some(h => sw.includes('"' + h + '"'))
  ? fail("sw.js 的 CDN 白名單含 Firebase API 主機，會靜默擋掉同步與登入")
  : ok("sw.js 沒有攔截 Firebase API");

console.log(bad ? "\n" + bad + " 項未通過。" : "\n全部通過。");
process.exit(bad ? 1 : 0);
