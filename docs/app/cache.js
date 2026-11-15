// 端末に置くキャッシュ（IndexedDB）。本文・PDF・フォルダの中身・最近の一覧（ADR-0020）
// 失敗しても動作は止めない（読めなければ「無かった」扱い、書けなければ捨てる）
const DB = "dv-cache", ST = "kv";
const BODY_MAX = 30 * 1048576;   // 1ファイルの上限
const BODY_TOTAL = 150 * 1048576; // 本文の合計の上限。超えたら古く開いたものから捨てる

let dbp = null;
function db() {
  return (dbp ||= new Promise((ok, ng) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(ST);
    r.onsuccess = () => ok(r.result);
    r.onerror = () => ng(r.error);
  }));
}
function run(mode, fn) {
  return db().then((d) => new Promise((ok, ng) => {
    const t = d.transaction(ST, mode);
    const req = fn(t.objectStore(ST));
    t.oncomplete = () => ok(req && req.result);
    t.onerror = () => ng(t.error);
  }));
}
export const cget = (k) => run("readonly", (s) => s.get(k)).catch(() => undefined);
export const cset = (k, v) => run("readwrite", (s) => s.put(v, k)).catch((e) => console.warn("cache", e));
const cdel = (k) => run("readwrite", (s) => s.delete(k)).catch(() => {});

/* ===== 本文（id -> {version, buf}） ===== */
// 何をどれだけ持っているかは localStorage に置き、合計が上限を超えたら古いものから消す
const IDX = "dv_bodies";
const idx = () => { try { return JSON.parse(localStorage.getItem(IDX)) || []; } catch { return []; } }; // [[id, bytes, at]]
export const getBody = (id) => cget("b:" + id);
export async function putBody(id, version, buf) {
  if (!buf || buf.byteLength > BODY_MAX) return;
  await cset("b:" + id, { version, buf });
  const list = idx().filter(([i]) => i !== id);
  list.push([id, buf.byteLength, Date.now()]);
  let total = list.reduce((a, [, n]) => a + n, 0);
  while (total > BODY_TOTAL && list.length > 1) { const [old, n] = list.shift(); total -= n; cdel("b:" + old); }
  try { localStorage.setItem(IDX, JSON.stringify(list)); } catch {}
}

export async function clearCache() {
  if (dbp) { try { (await dbp).close(); } catch {} dbp = null; }
  return new Promise((ok) => { const r = indexedDB.deleteDatabase(DB); r.onsuccess = r.onerror = r.onblocked = () => ok(); });
}
