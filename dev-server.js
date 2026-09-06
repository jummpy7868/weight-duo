// 本機預覽用的最小靜態伺服器：node dev-server.js → http://localhost:8765/
// 直接用 file:// 開 index.html 會少掉 Service Worker 與 fetch，測不到真實行為。
const http = require("http"), fs = require("fs"), path = require("path");
const MIME = { ".html":"text/html; charset=utf-8", ".js":"application/javascript", ".webmanifest":"application/manifest+json", ".png":"image/png" };
http.createServer((req, res) => {
  let u = decodeURIComponent(req.url.split("?")[0]);
  if(u.endsWith("/")) u += "index.html";
  const fp = path.join(__dirname, u);
  fs.readFile(fp, (err, data) => {
    if(err){ res.writeHead(404); res.end("not found"); return; }
    res.writeHead(200, { "Content-Type": MIME[path.extname(fp)] || "application/octet-stream", "Cache-Control": "no-store" });
    res.end(data);
  });
}).listen(8765, () => console.log("http://localhost:8765/"));
