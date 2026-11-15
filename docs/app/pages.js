// タブの中身：最近・フォルダ。ページ遷移はしない
import { $, h, esc, icon, ago, freshness, groupOf, fail, toast } from "./ui.js";
import { store } from "./auth.js";
import { reg, resolvePath, listRecent, listChildren, getRootId } from "./drive.js";
import { kindOf, ICON } from "./kind.js";
import { media } from "./media.js";
import { cget, cset } from "./cache.js";

/* ===================== 設定（ピン留め・範囲） ===================== */
const ALL = "マイドライブ全体";
const pinsGet = () => { try { return JSON.parse(store.get("dv_pins")) || ["Claude", "Claude/dev"]; } catch { return ["Claude", "Claude/dev"]; } };
const pinsSet = (a) => store.set("dv_pins", JSON.stringify(a));
let scope = store.get("dv_scope") || "Claude";

/* ===================== 行 ===================== */
export function fileRow(f, tree) {
  reg.set(f.id, f);
  return `<button class="row ${freshness(f.t)} ${media.file && media.file.id === f.id ? "playing" : ""}" data-id="${esc(f.id)}">
    ${tree ? "<span></span>" : ""}
    <span class="ico">${icon(ICON[kindOf(f)])}</span>
    <span><span class="name">${esc(f.name)}</span>${tree ? "" : `<span class="path">${esc(f.path || "")}</span>`}</span>
    <time datetime="${new Date(f.t).toISOString()}">${ago(f.t)}</time>
  </button>`;
}

/* ===================== タブ ===================== */
const main = $("#main");
let tab = "recent";

export function showTab(name) {
  tab = name;
  document.querySelectorAll(".tabs button").forEach((b) => b.setAttribute("aria-current", b.dataset.tab === name ? "page" : "false"));
  main.replaceChildren(name === "recent" ? recentPage() : folderPage());
  scrollTo(0, 0);
}

/* ===================== 最近 ===================== */
const cache = new Map(); // 範囲 -> 一覧
let pending = 0, seq = 0;

function recentPage() {
  const p = h(`<section class="page" aria-label="最近">
    <header class="top">
      <button class="scope" popovertarget="scopeMenu">${esc(scope)}${icon("i-chev-d")}</button>
      <span class="title"></span>
      <button class="icon-btn" data-act="search" aria-label="検索">${icon("i-search")}</button>
    </header>
    <div class="pill"><button data-act="newer">${icon("i-arrow-up")}<span></span></button></div>
    <div class="list"></div>
  </section>`);
  if (cache.has(scope)) { renderRecent(p); checkRecent(); return p; }
  // 起動直後：端末に保存した前回の一覧を先に出し、裏で取り直して差し替える
  const sc = scope;
  cget("r:" + sc).then((items) => {
    if (items && !cache.has(sc) && sc === scope && p.isConnected) { cache.set(sc, items); renderRecent(p); }
  }).finally(() => loadRecent());
  return p;
}
function renderRecent(p) {
  const list = $(".list", p); list.innerHTML = "";
  let g = null, ul = null;
  for (const f of cache.get(scope) || []) {
    const gg = groupOf(f.t);
    if (gg !== g) { g = gg; list.append(h(`<h2 class="group-h">${g}</h2>`)); ul = h(`<ul class="rows"></ul>`); list.append(ul); }
    ul.append(h(`<li>${fileRow(f)}</li>`));
  }
  renderPill(p);
}
function renderPill(p) {
  $(".pill", p).classList.toggle("show", pending > 0);
  $(".pill span", p).textContent = `新着 ${pending} 件`;
}
const recentEl = () => (tab === "recent" ? $(".page") : null);
async function scopeId() {
  if (scope === ALL) return null;
  const id = await resolvePath(scope);
  if (!id) throw new Error("範囲のフォルダが見つかりません: " + scope);
  return id;
}

// 取得してそのまま一覧に反映する（初回・範囲の切り替え・「新着」を押したとき）
export async function loadRecent() {
  const my = ++seq, sc = scope;
  try {
    const items = await listRecent(await scopeId());
    if (my !== seq || sc !== scope) return;
    cache.set(sc, items); pending = 0;
    cset("r:" + sc, items);
    const p = recentEl(); if (p) renderRecent(p);
  } catch (e) { fail("読み込めませんでした", e); }
}
// 15秒ごと：先頭ページだけ見て、新着があればピルを出す（一覧は動かさない）
export async function checkRecent() {
  const cur = cache.get(scope), sc = scope;
  if (!cur || tab !== "recent") return;
  try {
    const items = await listRecent(await scopeId(), { want: 0, maxPages: 1 });
    if (sc !== scope) return;
    const known = new Map(cur.map((f) => [f.id, f.modifiedTime]));
    pending = items.filter((f) => known.get(f.id) !== f.modifiedTime).length;
    const p = recentEl(); if (p) renderPill(p);
  } catch (e) { console.warn("新着の確認に失敗", e); }
}
export async function showNewer() {
  await loadRecent();
  scrollTo({ top: 0 });
}
export function searchBox(p) {
  if ($(".search", p)) return;
  const sb = h(`<div class="search"><input type="search" placeholder="ファイル名" enterkeyhint="search" aria-label="ファイル名で検索"></div>`);
  $(".top", p).after(sb); $("input", sb).focus();
  $("input", sb).addEventListener("input", (ev) => {
    const q = ev.target.value.toLowerCase();
    p.querySelectorAll(".row").forEach((r) => (r.closest("li").hidden = !!q && !$(".name", r).textContent.toLowerCase().includes(q)));
  });
}

/* ===================== 範囲メニュー ===================== */
export function initScopeMenu() {
  const menu = $("#scopeMenu");
  menu.addEventListener("beforetoggle", (e) => {
    if (e.newState !== "open") return;
    const opts = [...pinsGet().map((o) => [o, "i-pin"]), [ALL, "i-hard-drive"]];
    menu.innerHTML = opts.map(([o, ic]) => `<button data-scope="${esc(o)}">${icon(ic)}${esc(o)}${o === scope ? `<span class="check">${icon("i-check")}</span>` : ""}</button>`).join("")
      + `<hr><button data-act="logout">${icon("i-log-out")}ログアウト</button>`;
  });
  menu.addEventListener("click", (e) => {
    const b = e.target.closest("[data-scope]"); if (!b) return;
    scope = b.dataset.scope; store.set("dv_scope", scope);
    pending = 0;
    menu.hidePopover(); showTab("recent");
  });
}
export function appMenu() {
  const m = $("#moreMenu");
  m.innerHTML = `<button data-act="logout">${icon("i-log-out")}ログアウト</button>`;
  m.showPopover();
}

/* ===================== フォルダ（ツリー） ===================== */
const openDirs = new Set();   // 開いているフォルダのキー（ピン留めは "pin:" 付き）
const kidsCache = new Map();  // フォルダID -> {folders, files}
const sig = (d) => d.folders.map((f) => f.id).join() + "|" + d.files.map((f) => f.id + f.modifiedTime).join();

function folderNode(dir, depth, pin, path) {
  const li = h(`<li class="node dir" style="--depth:${depth}" data-id="${esc(dir.id)}" data-key="${pin ? "pin:" : ""}${esc(dir.id)}">
    <button class="row" data-toggle aria-expanded="false">
      <span class="chev">${icon("i-chev-r")}</span>
      <span class="ico">${icon(pin ? "i-pin" : "i-folder")}</span>
      <span><span class="name">${esc(dir.name)}</span></span>
      <span class="count"></span>
    </button>
    <div class="kids"><ul style="--depth:${depth}"></ul></div>
  </li>`);
  li._pin = pin; li._path = path;
  const c = kidsCache.get(dir.id);
  if (c) $(".count", li).textContent = c.folders.length + c.files.length || "";
  if (openDirs.has(li.dataset.key)) expand(li, true, true);
  return li;
}
// 子の行を作る。cached を先に出し、取り直した結果が違えば差し替える
function renderKids(ul, d, depth, base) {
  const nodes = [
    ...d.folders.map((f) => folderNode(f, depth, false, base ? base + "/" + f.name : f.name)),
    ...d.files.map((f) => h(`<li class="node file" style="--depth:${depth}">${fileRow(f, true)}</li>`)),
  ];
  if (!nodes.length) nodes.push(h(`<li class="empty-node" style="--depth:${depth}">空のフォルダ</li>`));
  ul.replaceChildren(...nodes);
}
// 中身の取得。指が触れた時点（prefetchKids）で始めたものがあれば使う（ADR-0020）
const kidsInflight = new Map(); // id -> {at, p}
function fetchKids(id) {
  const hit = kidsInflight.get(id);
  if (hit && Date.now() - hit.at < 5000) { kidsInflight.delete(id); return hit.p; }
  return listChildren(id);
}
export function prefetchKids(li) {
  const id = li.dataset.id;
  if (li.classList.contains("open") || kidsInflight.has(id)) return;
  const p = listChildren(id); p.catch(() => {});
  kidsInflight.set(id, { at: Date.now(), p });
}
async function cachedKids(id) {
  let c = kidsCache.get(id);
  if (!c) { c = await cget("k:" + id); if (c) kidsCache.set(id, c); }
  return c;
}
async function fillKids(li) {
  const id = li.dataset.id, depth = Number(li.style.getPropertyValue("--depth")) + 1, ul = $(".kids > ul", li);
  const net = fetchKids(id); net.catch(() => {});
  const cached = await cachedKids(id);
  if (cached) renderKids(ul, cached, depth, li._path);
  try {
    const d = await net;
    kidsCache.set(id, d); cset("k:" + id, d);
    $(".count", li).textContent = d.folders.length + d.files.length || "";
    if (!cached || sig(cached) !== sig(d)) renderKids(ul, d, depth, li._path);
  } catch (e) { if (!cached) fail("読み込めませんでした", e); else console.warn(e); }
}
function expand(li, on = !li.classList.contains("open"), silent) {
  if (on) fillKids(li);
  if (silent) { const k = $(":scope > .kids", li); k.style.transition = "none"; requestAnimationFrame(() => (k.style.transition = "")); }
  li.classList.toggle("open", on);
  $(":scope > .row", li).setAttribute("aria-expanded", on);
  if (!li._pin) $(":scope > .row .ico", li).innerHTML = icon(on ? "i-folder-open" : "i-folder");
  on ? openDirs.add(li.dataset.key) : openDirs.delete(li.dataset.key);
}
export const toggleNode = (li) => expand(li);

function folderPage() {
  const p = h(`<section class="page" aria-label="フォルダ">
    <header class="top"><span class="title" style="padding-left:8px">フォルダ</span>
      <button class="icon-btn" data-act="appmenu" aria-label="その他">${icon("i-more")}</button></header>
    <div class="tree-sep">ピン留め</div><ul class="tree pins"></ul>
    <div class="tree-sep">マイドライブ</div><ul class="tree drive"></ul>
  </section>`);
  const drive = $(".drive", p);
  renderPins($(".pins", p));
  getRootId().then(async (rootId) => {
    // root は「開いた状態の1つのフォルダ」と同じ作りで、直下をそのまま出す
    const net = listChildren(rootId); net.catch(() => {});
    const cached = await cachedKids(rootId);
    if (cached) renderKids(drive, cached, 0, "");
    const d = await net;
    kidsCache.set(rootId, d); cset("k:" + rootId, d);
    if (!cached || sig(cached) !== sig(d)) renderKids(drive, d, 0, "");
  }).catch((e) => fail("読み込めませんでした", e));
  return p;
}

/* ===================== ピン留め（フォルダ行の長押し。ADR-0018） ===================== */
function renderPins(ul) {
  const paths = pinsGet();
  if (!paths.length) { ul.replaceChildren(h(`<li class="empty-node" style="--depth:0">フォルダを長押しして追加</li>`)); return; }
  Promise.all(paths.map(async (path) => ({ path, id: await resolvePath(path).catch(() => null) })))
    .then((rs) => ul.replaceChildren(...rs.filter((r) => r.id).map((r) => folderNode({ id: r.id, name: r.path.split("/").pop() }, 0, true, r.path))))
    .catch((e) => fail("読み込めませんでした", e));
}
let menuNode = null;
export function nodeMenu(li) {
  const path = li._path; if (!path) return;
  menuNode = li;
  const pinned = pinsGet().includes(path);
  const m = $("#nodeMenu");
  m.innerHTML = `<div class="path">${esc(path)}</div>`
    + `<button data-pin="${pinned ? "off" : "on"}">${icon("i-pin")}${pinned ? "ピンを外す" : "ピン留め"}</button>`;
  m.showPopover();
  // 押した行のすぐ下に出す。下に入らなければ上に
  const r = $(":scope > .row", li).getBoundingClientRect(), mh = m.offsetHeight, mw = m.offsetWidth;
  m.style.left = Math.min(Math.max(8, r.left + 16), innerWidth - mw - 8) + "px";
  m.style.top = (r.bottom + 4 + mh < innerHeight - 8 ? r.bottom + 4 : Math.max(8, r.top - mh - 4)) + "px";
}
export function pinAction(on) {
  const li = menuNode, path = li && li._path; menuNode = null;
  $("#nodeMenu").hidePopover();
  if (!path) return;
  const a = pinsGet().filter((x) => x !== path);
  if (on) a.push(path);
  pinsSet(a);
  toast(on ? "ピン留めしました" : "ピンを外しました");
  const ul = document.querySelector(".page .tree.pins");
  if (ul) renderPins(ul);
}
