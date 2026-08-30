// オフライン対応の Service Worker。pocket-rogue と同じ方式を踏襲する。
// Vite はビルドごとに assets/ のファイル名 (ハッシュ) を変えるので、一覧は持たない。
// - index.html などの入口: ネットワーク優先。失敗したらキャッシュ
// - assets/ (ハッシュ付きで内容が変わらない): キャッシュ優先。無ければ取得して保存
//
// 入口をキャッシュ優先にしてしまうと、新しいビルドを出しても古い index.html が
// 返り続け、そこから読む assets/ のハッシュも古いままになる (更新が届かなくなる)。
// なので入口だけは「新しい版があれば取りに行き、無ければキャッシュを使う」形にする
const CACHE = 'pocket-legion-v1';
const PRECACHE = ['./', './index.html', './manifest.webmanifest', './icon-192.png', './icon-512.png'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(PRECACHE))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  const isImmutableAsset = url.pathname.includes('/assets/');
  event.respondWith(isImmutableAsset ? cacheFirst(req) : networkFirst(req));
});

async function cacheFirst(req) {
  const cache = await caches.open(CACHE);
  const hit = await cache.match(req);
  if (hit) return hit;
  const res = await fetch(req);
  if (res.ok) cache.put(req, res.clone());
  return res;
}

// 入口 (index.html など) は HTTP キャッシュを迂回して取りに行く。
// GitHub Pages は index.html にも max-age を付けるので、素朴に fetch すると
// ブラウザのキャッシュが応えてしまい、新しいビルドを出したあと数分は古い入口が返り続ける。
// 入口が古いと、そこから読む assets/ のハッシュも古いままになり、更新が反映されない。
async function networkFirst(req) {
  const cache = await caches.open(CACHE);
  try {
    const res = await fetch(req.url, { cache: 'no-store', credentials: 'same-origin' });
    if (res.ok) cache.put(req, res.clone());
    return res;
  } catch {
    const hit = (await cache.match(req)) || (req.mode === 'navigate' ? await cache.match('./index.html') : undefined);
    return hit || Response.error();
  }
}
