/* ArUco Marker Tool — Service Worker */
const CACHE = "aruco-v26";
const CORE = [
  "./", "./index.html", "./style.css", "./app.js", "./i18n.js",
  "./manifest.json", "./icon-192.png", "./icon-512.png",
  // 同梱ライブラリ（初回からオフラインで全機能を使えるように）
  "./lib/opencv.js", "./lib/three.min.js", "./lib/OrbitControls.js", "./lib/GLTFLoader.js",
  "./lib/OBJLoader.js", "./lib/jszip.min.js", "./lib/qrcode.min.js", "./lib/JsBarcode.all.min.js",
];

self.addEventListener("install", (e) => {
  e.waitUntil(
    caches.open(CACHE)
      .then((c) => Promise.allSettled(CORE.map((u) => c.add(u))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// 成功応答のみ保存（403 のチャレンジページ等をキャッシュしない）。
// crossorigin 無しの <script> は中身の見えない opaque 応答になるため、CDN 分のみ許可
function put(req, res, allowOpaque) {
  if (res && (res.ok || (allowOpaque && res.type === "opaque"))) {
    const copy = res.clone();
    caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
  }
  return res;
}

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  // アクセス解析は常にネットワークへ（キャッシュすると計測されない）
  if (/(^|\.)(googletagmanager|google-analytics)\.com$/.test(url.hostname)) return;
  const sameOrigin = url.origin === self.location.origin;
  if (sameOrigin && url.pathname.indexOf("/lib/") >= 0) {
    // 同梱ライブラリ: バージョン固定なのでキャッシュ優先（10MB の OpenCV を毎回取り直さない）
    e.respondWith(
      caches.match(req, { ignoreSearch: true })
        .then((hit) => hit || fetch(req).then((res) => put(req, res)))
        .catch(() => Response.error())
    );
    return;
  }
  if (sameOrigin) {
    // アプリ本体: ネットワーク優先（更新を即反映）、オフライン時はキャッシュ
    e.respondWith(
      fetch(req).then((res) => put(req, res))
        .catch(() => caches.match(req, { ignoreSearch: true })
          .then((hit) => hit || caches.match("./index.html"))
          .then((hit) => hit || Response.error()))
    );
    return;
  }
  // CDN ライブラリ・フォント: キャッシュ優先（バージョン固定 URL のため）
  e.respondWith(
    caches.match(req).then((hit) => hit || fetch(req).then((res) => put(req, res, true)))
      .catch(() => Response.error())
  );
});
