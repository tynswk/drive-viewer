// stream/{fileId} を Drive の alt=media に中継する。
// Google の応答は CORS で Content-Range を公開しないので、ファイルサイズを別に取って組み立て直す。
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));

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
  const m = new URL(e.request.url).pathname.match(/\/stream\/([\w-]+)$/);
  if (m) e.respondWith(stream(e.request, m[1]));
});
