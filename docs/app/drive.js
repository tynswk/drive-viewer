// Drive API。401 は一度だけ更新して再試行する。祖先フォルダのキャッシュ（ADR-0016）もここ
import { accessToken, forceRefresh, store } from "./auth.js";

const API = "https://www.googleapis.com/drive/v3/";
const UPLOAD = "https://www.googleapis.com/upload/drive/v3/";
export const FOLDER = "application/vnd.google-apps.folder";
const FIELDS = "id,name,mimeType,modifiedTime,size,version,parents";
export const EXCLUDE = new Set([".git", "node_modules", "__pycache__"]);
const TTL = 12 * 3600e3; // フォルダ情報の有効期間（移動・改名に追従するため）

/* ===== 低レベル ===== */
export async function call(url, init = {}) {
  const go = (t) => fetch(url, { ...init, headers: { ...init.headers, Authorization: "Bearer " + t } });
  let r = await go(await accessToken());
  if (r.status === 401) r = await go(await forceRefresh());
  return r;
}
async function check(r, what) {
  if (r.ok) return r;
  const e = new Error(`Drive ${r.status} ${what}`);
  e.status = r.status;
  throw e;
}
export async function api(path, init) {
  return (await check(await call(API + path, init), path.split("?")[0])).json();
}

export function norm(raw) {
  return {
    id: raw.id, name: raw.name, mimeType: raw.mimeType || "",
    modifiedTime: raw.modifiedTime, t: Date.parse(raw.modifiedTime),
    size: raw.size != null ? Number(raw.size) : undefined,
    version: raw.version, parents: raw.parents || [],
  };
}

// 一覧の行から id で引けるように
export const reg = new Map();

/* ===== フォルダのキャッシュ（id -> {name, parents, at}） ===== */
const dirs = new Map();
try { for (const [k, v] of JSON.parse(store.get("dv_dirs") || "[]")) dirs.set(k, v); } catch {}
let saveTimer;
function saveDirs() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => store.set("dv_dirs", JSON.stringify([...dirs])), 500);
}
const fresh = (e) => e && Date.now() - e.at < TTL;
function setDir(id, name, parents) { dirs.set(id, { name, parents, at: Date.now() }); saveDirs(); }

let rootId = store.get("dv_root");
export async function getRootId() {
  if (!rootId) { rootId = (await api("files/root?fields=id")).id; store.set("dv_root", rootId); }
  return rootId;
}

async function ensureDirs(ids) {
  const need = [...new Set(ids)].filter((id) => id && !fresh(dirs.get(id)));
  await Promise.all(need.map(async (id) => {
    try {
      const d = await api(`files/${id}?fields=id,name,parents`);
      setDir(id, d.name, d.parents || []);
    } catch (e) {
      if (e.status === 403 || e.status === 404) setDir(id, "?", []); else throw e;
    }
  }));
}
// 取得した行の祖先をすべてキャッシュに載せる
async function resolveAncestors(files) {
  let frontier = files.flatMap((f) => f.parents);
  for (let i = 0; i < 40 && frontier.length; i++) {
    await ensureDirs(frontier);
    frontier = frontier.flatMap((id) => (dirs.get(id)?.parents || []).slice(0, 1));
  }
}
function chainOf(f) {
  const out = [];
  let id = f.parents[0];
  while (id && out.length < 40) { out.push(id); id = dirs.get(id)?.parents[0]; }
  return out;
}
// 祖先IDの列（親→上）から、範囲からの相対パスを作る
function relPath(chain, scopeId) {
  const names = [];
  for (const id of chain) {
    if (id === scopeId || id === rootId) break;
    names.push(dirs.get(id)?.name || "?");
  }
  return names.reverse().join("/");
}
export async function fullPath(f) {
  await getRootId();
  await resolveAncestors([f]);
  const p = relPath(chainOf(f), null);
  return "マイドライブ/" + (p ? p + "/" : "") + f.name;
}

/* ===== パス → フォルダID（ピン留め用） ===== */
const pathIds = (() => { try { return JSON.parse(store.get("dv_paths") || "{}"); } catch { return {}; } })();
export async function resolvePath(path) {
  const hit = pathIds[path];
  if (hit && Date.now() - hit.at < TTL) return hit.id;
  let parent = await getRootId();
  for (const name of path.split("/")) {
    const q = `'${parent}' in parents and name='${name.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}' and mimeType='${FOLDER}' and trashed=false`;
    const d = await api("files?" + new URLSearchParams({ q, pageSize: "1", fields: "files(id,name)" }));
    if (!d.files.length) return null;
    parent = d.files[0].id;
  }
  pathIds[path] = { id: parent, at: Date.now() };
  store.set("dv_paths", JSON.stringify(pathIds));
  return parent;
}

/* ===== 最近（ADR-0016） ===== */
// scopeId が null ならマイドライブ全体。範囲に絞り、除外を捨てた結果を返す
export async function listRecent(scopeId, { want = 40, maxPages = 5 } = {}) {
  await getRootId();
  const out = [];
  let tok;
  for (let p = 0; p < maxPages; p++) {
    const params = {
      q: `trashed=false and mimeType!='${FOLDER}'`, orderBy: "modifiedTime desc", pageSize: "100",
      fields: `nextPageToken,files(${FIELDS})`,
    };
    if (tok) params.pageToken = tok;
    const d = await api("files?" + new URLSearchParams(params));
    const fs = d.files.map(norm);
    await resolveAncestors(fs);
    for (const f of fs) {
      const c = chainOf(f);
      if (scopeId && !c.includes(scopeId)) continue;
      if (c.some((id) => EXCLUDE.has(dirs.get(id)?.name))) continue;
      f.path = relPath(c, scopeId);
      out.push(f);
    }
    tok = d.nextPageToken;
    if (out.length >= want || !tok) break;
  }
  return out;
}

/* ===== ツリー ===== */
const byName = (a, b) => a.name.localeCompare(b.name, "ja");
// フォルダ直下。フォルダが先（名前順）、ファイルは更新の新しい順。除外名のフォルダは出さない
export async function listChildren(folderId) {
  const all = [];
  let tok;
  do {
    const params = { q: `'${folderId}' in parents and trashed=false`, pageSize: "1000", fields: `nextPageToken,files(${FIELDS})` };
    if (tok) params.pageToken = tok;
    const d = await api("files?" + new URLSearchParams(params));
    all.push(...d.files.map(norm));
    tok = d.nextPageToken;
  } while (tok);
  const folders = all.filter((f) => f.mimeType === FOLDER && !EXCLUDE.has(f.name)).sort(byName);
  folders.forEach((f) => setDir(f.id, f.name, [folderId]));
  const files = all.filter((f) => f.mimeType !== FOLDER).sort((a, b) => b.t - a.t);
  files.forEach((f) => { f.parents = [folderId]; });
  return { folders, files };
}

/* ===== ファイル ===== */
export async function getMeta(id) { return norm(await api(`files/${id}?fields=${FIELDS}`)); }
export async function getVersion(id) { return api(`files/${id}?fields=version,modifiedTime,size`); }
export async function fetchText(id) { return (await check(await call(`${API}files/${id}?alt=media`), "media")).text(); }
export async function fetchBuffer(id) { return (await check(await call(`${API}files/${id}?alt=media`), "media")).arrayBuffer(); }
// 本文を上書きする。返り値は新しい version など
export async function saveText(id, text, mimeType) {
  const r = await call(`${UPLOAD}files/${id}?uploadType=media&fields=version,modifiedTime,size`, {
    method: "PATCH", headers: { "Content-Type": mimeType || "text/plain;charset=utf-8" }, body: text,
  });
  return (await check(r, "upload")).json();
}
