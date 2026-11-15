// 1) stream/{fileId} を Drive の alt=media に中継する（Content-Range を組み立て直す。ADR-0004）
// 2) 画面と app/ はネットワーク優先（つながらなければキャッシュ）、vendor は stale-while-revalidate（ADR-0015）
// VERSION を上げると、新しい SW が全ファイルを取り直して古いキャッシュを捨てる
const VERSION = "p1-3";
const CACHE = "app-" + VERSION;
const PRECACHE = [
  "./", "manifest.webmanifest", "icon-180.png", "icon-192.png", "icon-512.png",
  "app/app.css", "app/main.js", "app/ui.js", "app/auth.js", "app/drive.js", "app/pages.js",
  "app/viewer.js", "app/media.js", "app/diff.js", "app/kind.js",
  "vendor/marked.esm.js", "vendor/purify.es.mjs", "vendor/pdf.min.mjs", "vendor/pdf.worker.min.mjs",
];
const ROOT = new URL("./", self.registration.scope).href;

self.addEventListener("install", (e) => {
  e.waitUntil((async () => {
    const c = await caches.open(CACHE);
    await Promise.all(PRECACHE.map(async (u) => {
      const r = await fetch(new Request(u, { cache: "reload" }));
      if (!r.ok) throw new Error("precache " + u + " " + r.status);
      await c.put(new URL(u, self.registration.scope).href, r);
    }));
    await self.skipWaiting();
  })());
});
self.addEventListener("activate", (e) => e.waitUntil((async () => {
  for (const k of await caches.keys()) if (k.startsWith("app-") && k !== CACHE) await caches.delete(k);
  await self.clients.claim();
})()));

// キャッシュを返しつつ裏で取り直す。無ければネットワーク
async function swr(key, req) {
  const c = await caches.open(CACHE);
  const hit = await c.match(key);
  const net = fetch(req).then((r) => { if (r.ok) c.put(key, r.clone()); return r; });
  if (hit) { net.catch(() => {}); return hit; }
  return net;
}

// ネットワークを先に見る。失敗・オフラインのときだけキャッシュ（push がすぐ反映されるように）
async function netFirst(key, req) {
  const c = await caches.open(CACHE);
  try {
    const r = await fetch(req, { cache: "no-cache" });
    if (r.ok) c.put(key, r.clone());
    return r;
  } catch {
    const hit = await c.match(key);
    if (hit) return hit;
    throw new Error("offline");
  }
}

const sizes = new Map(); // fileId -> {size, mimeType}

async function token() {
  const c = await caches.open("auth");
  const r = await c.match("__token");
  return r ? r.text() : null;
}

async function meta(id, auth) {
  if (sizes.has(id)) return sizes.get(id);
  const r = await fetch(`https://www.googleapis.com/drive/v3/files/${id}?fields=size,mimeType`, { headers: auth });
  const m = await r.json();
  const v = { size: Number(m.size), mimeType: m.mimeType || "application/octet-stream" };
  sizes.set(id, v);
  return v;
}

async function stream(req, id) {
  const auth = { Authorization: "Bearer " + (await token()) };
  const { size, mimeType } = await meta(id, auth);

  // Range を解釈（無ければ全体）
  let start = 0, end = size - 1, partial = false;
  const m = (req.headers.get("Range") || "").match(/bytes=(\d*)-(\d*)/);
  if (m) {
    partial = true;
    if (m[1] === "") { start = Math.max(0, size - Number(m[2])); }
    else { start = Number(m[1]); if (m[2] !== "") end = Math.min(Number(m[2]), size - 1); }
  }
  if (start >= size) {
    return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${size}` } });
  }

  const r = await fetch(`https://www.googleapis.com/drive/v3/files/${id}?alt=media`, {
    headers: { ...auth, Range: `bytes=${start}-${end}` },
  });
  if (!r.ok) return new Response(null, { status: r.status });

  const h = new Headers({
    "Content-Type": mimeType,
    "Accept-Ranges": "bytes",
    "Content-Length": String(end - start + 1),
  });
  if (partial) h.set("Content-Range", `bytes ${start}-${end}/${size}`);
  return new Response(r.body, { status: partial ? 206 : 200, headers: h });
}

self.addEventListener("fetch", (e) => {
  const req = e.request;
  const url = new URL(req.url);
  const m = url.pathname.match(/\/stream\/([\w-]+)$/);
  if (m) return e.respondWith(stream(req, m[1]));
  if (req.method !== "GET" || url.origin !== location.origin) return;
  // 画面の遷移は、クエリ（?id= や ?code=）が付いていても index.html を返す
  if (req.mode === "navigate" && url.href.startsWith(ROOT) && !url.pathname.includes("/mock/")) {
    return e.respondWith(netFirst(ROOT, ROOT));
  }
  // vendor（pdf.js の cmap・フォント・wasm を含む）と本体
  if (url.href.startsWith(ROOT + "vendor/")) return e.respondWith(swr(url.href, req));
  if (PRECACHE.some((u) => new URL(u, ROOT).href === url.href)) e.respondWith(netFirst(url.href, req));
});
