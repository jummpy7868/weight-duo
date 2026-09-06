/* 兩人體重刻度盤 — Service Worker
   改動這個檔或 index.html 之後，VERSION 必須 bump，
   否則舊快取不會被清掉，使用者會拿到舊版而且完全沒有錯誤訊息。
   畫面右上角的版本字樣就是拿來確認「我現在看到的是哪一版」。 */
const VERSION = "v7";
const SHELL   = VERSION + "-shell";
const RUNTIME = VERSION + "-cdn";

const SHELL_FILES = [
  "./", "./index.html", "./manifest.webmanifest",
  "./icon-192.png", "./icon-512.png", "./icon-maskable-512.png", "./apple-touch-icon.png"
];

// 只有這三個主機的靜態資源可以快取。
// firestore.googleapis.com / identitytoolkit / securetoken 一律不攔——
// 攔了會擋掉即時同步與登入，而且是靜默失敗。
const CDN = ["fonts.googleapis.com", "fonts.gstatic.com", "www.gstatic.com"];

self.addEventListener("install", e => {
  e.waitUntil(
    caches.open(SHELL)
      .then(c => c.addAll(SHELL_FILES))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", e => {
  e.waitUntil(
    caches.keys()
      .then(ks => Promise.all(ks.filter(k => k.indexOf(VERSION) !== 0).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", e => {
  const req = e.request;
  if (req.method !== "GET") return;          // Firestore 寫入是 POST,直通
  const url = new URL(req.url);

  if (url.origin === self.location.origin) {
    // 網路優先:push 上去的新版要馬上拿得到,離線才回快取。
    e.respondWith(
      fetch(req)
        .then(res => {
          const copy = res.clone();
          caches.open(SHELL).then(c => c.put(req, copy)).catch(() => {});
          return res;
        })
        .catch(() => caches.match(req).then(hit => hit || caches.match("./index.html")))
    );
    return;
  }

  if (CDN.indexOf(url.hostname) !== -1) {
    // 版本化網址,快取優先;沒中才連網。
    e.respondWith(
      caches.match(req).then(hit => hit || fetch(req).then(res => {
        const copy = res.clone();
        caches.open(RUNTIME).then(c => c.put(req, copy)).catch(() => {});
        return res;
      }))
    );
    return;
  }

  // 其餘一律不呼叫 respondWith,交還瀏覽器預設行為。
});
