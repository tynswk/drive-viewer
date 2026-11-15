// ファイルを開くシート：表示・編集・衝突のマージ・更新の追従
import { $, h, esc, icon, ago, freshness, fmtSize, growFrom, shrinkTo, toast, fail, state } from "./ui.js";
import { swToken } from "./auth.js";
import { getVersion, getMeta, fetchText, fetchBuffer, saveText, fullPath, findByPath } from "./drive.js";
import { kindOf, EDITABLE } from "./kind.js";
import { diff3 } from "./diff.js";
import { openMedia } from "./media.js";
import { marked } from "../vendor/marked.esm.js";
import DOMPurify from "../vendor/purify.es.mjs";

// md 内のリンク：外部URLは別タブ、相対パスはアプリ内でそのファイルを開く（ADR-0019）
const isRel = (href) => !/^([a-z][a-z0-9+.-]*:|\/\/|#|\/)/i.test(href);
DOMPurify.addHook("afterSanitizeAttributes", (n) => {
  const href = n.tagName === "A" && n.getAttribute("href");
  if (!href || href.startsWith("#")) return;
  if (isRel(href)) n.setAttribute("data-rel", href);
  else { n.setAttribute("target", "_blank"); n.setAttribute("rel", "noopener noreferrer"); }
});
// 開いているファイルのフォルダ（マイドライブからの相対）を基準に、href を解いたパスを返す
async function relTarget(f, href) {
  const dir = (await fullPath(f)).split("/").slice(1, -1);
  let rel = href.split(/[?#]/)[0];
  try { rel = decodeURIComponent(rel); } catch {}
  for (const seg of rel.split("/")) {
    if (seg === "..") dir.pop();
    else if (seg && seg !== ".") dir.push(seg);
  }
  return dir.join("/");
}
async function followLink(s, a) {
  try {
    const path = await relTarget(s._file, a.dataset.rel);
    const f = path && await findByPath(path);
    if (!f) { toast("リンク先が見つかりません"); return; }
    if (state.doc !== s) return;
    const back = [...(s._back || []), s._file];
    openFile(f, a);
    if (state.doc) state.doc._back = back;
  } catch (e) { fail("リンク先を開けませんでした", e); }
}

const VENDOR = new URL("../vendor/", import.meta.url).href;

/* ===================== 開く・閉じる ===================== */
export function openFile(f, originEl) {
  const k = kindOf(f);
  if (k === "video" || k === "audio") return openMedia(f, originEl);
  if (state.doc) { teardownDoc(state.doc); state.doc.remove(); state.doc = null; }
  const s = viewerSheet(f, k);
  s._origin = originEl;
  document.body.append(s);
  document.body.classList.add("sheet-open");
  growFrom(s, originEl);
  state.doc = s;
  // ディープリンクの ?id は、開いたら履歴から消す
  if (new URLSearchParams(location.search).has("id")) history.replaceState(null, "", location.pathname);
  history.pushState({ sheet: "doc" }, "");
  load(s);
}
export async function openById(id) {
  try { openFile(await getMeta(id), null); } catch (e) { fail("読み込めませんでした", e); }
}
// リンクで来たシートを閉じたら、来た元のファイルを開き直す
export function backDoc(fromTransform) {
  const back = state.doc?._back;
  if (!back?.length) return closeDoc(fromTransform);
  const prev = back[back.length - 1];
  closeDoc(fromTransform);
  openFile(prev, null);
  if (state.doc) state.doc._back = back.slice(0, -1);
}
export function closeDoc(fromTransform) {
  const s = state.doc; if (!s) return;
  state.doc = null;
  document.body.classList.remove("sheet-open");
  teardownDoc(s);
  shrinkTo(s, s._origin, fromTransform).then(() => s.remove());
}
function teardownDoc(s) { s._rt = null; if (s._pdf) { s._pdf.destroy().catch(() => {}); s._pdf = null; } }

function viewerSheet(f, kind) {
  const modes = kind === "md" ? ["表示", "生"] : kind === "html" ? ["描画", "生"] : null;
  const s = h(`<section class="sheet" role="dialog" aria-modal="true" aria-label="${esc(f.name)}">
    <header class="top" data-grab>
      <button class="icon-btn" data-act="close" aria-label="閉じる">${icon("i-chev-d")}</button>
      <span class="title">${esc(f.name)}</span>
      ${EDITABLE.has(kind) ? `<button class="icon-btn" data-act="cancel-edit" aria-label="編集をやめる" hidden>${icon("i-x")}</button><button class="icon-btn" data-act="edit" aria-label="編集" hidden>${icon("i-pencil")}</button>` : ""}
      <button class="icon-btn" data-act="more" aria-label="その他">${icon("i-more")}</button>
    </header>
    <div class="scroll">
      <div class="subbar">
        <span class="meta"></span>
        ${modes ? `<div class="seg" role="group" aria-label="表示モード">${modes.map((m, i) => `<button aria-pressed="${i === 0}" data-mode="${i}">${m}</button>`).join("")}</div>` : ""}
      </div>
      <div class="body"></div>
    </div>
  </section>`);
  s._file = f; s._kind = kind; s._mode = 0; s._text = ""; s._version = null;
  $(".body", s).addEventListener("click", (e) => {
    const a = e.target.closest("a[data-rel]"); if (!a) return;
    e.preventDefault(); followLink(s, a);
  });
  updateMeta(s);
  return s;
}
function updateMeta(s) {
  const f = s._file, m = $(".meta", s);
  m.textContent = `${ago(f.t)}に更新${f.size != null ? " ・ " + fmtSize(f.size) : ""}`;
  m.classList.toggle("fresh", freshness(f.t) === "fresh");
}

/* ===================== 読み込み ===================== */
// version を先に取ってから本文を取る（間に更新が入っても、保存時に衝突として検知できる側へ倒す）
async function load(s) {
  const f = s._file, k = s._kind;
  s._loading = true;
  try {
    if (k !== "other") {
      const m = await getVersion(f.id);
      if (!s.isConnected) return;
      s._version = m.version;
      Object.assign(f, { version: m.version, modifiedTime: m.modifiedTime, t: Date.parse(m.modifiedTime), ...(m.size != null && { size: Number(m.size) }) });
      if (k === "md" || k === "code" || k === "html") s._text = await fetchText(f.id);
      if (!s.isConnected) return;
      updateMeta(s);
    }
    s._notifiedV = null;
    renderBody(s, 0); setSeg(s, 0);
    const eb = $('[data-act="edit"]', s); if (eb) eb.hidden = false;
  } catch (e) {
    fail("読み込めませんでした", e);
  } finally { s._loading = false; }
}
const reload = (s) => { if (state.doc === s && !s._editing) load(s); };

/* ===================== 本文の描画 ===================== */
const rawPre = (t) => `<pre class="raw">${esc(t)}</pre>`;
function renderBody(s, mode) {
  const f = s._file, k = s._kind, body = $(".body", s);
  s._mode = mode; s._rt = null;
  if (s._pdf) { s._pdf.destroy().catch(() => {}); s._pdf = null; }
  if (k === "md") {
    body.innerHTML = mode === 0 ? `<article class="doc">${DOMPurify.sanitize(marked.parse(s._text, { async: false, gfm: true }))}</article>` : rawPre(s._text);
  } else if (k === "code") {
    body.innerHTML = rawPre(s._text);
  } else if (k === "html") {
    body.innerHTML = mode === 0 ? `<iframe class="frame" sandbox="allow-scripts" title="${esc(f.name)}"></iframe>` : rawPre(s._text);
    if (mode === 0) $("iframe", body).srcdoc = s._text;
  } else if (k === "pdf") {
    renderPdf(s, body).catch((e) => { if (s._rt) fail("読み込めませんでした", e); });
  } else if (k === "image") {
    body.innerHTML = `<div class="imgwrap"><img alt="${esc(f.name)}"></div>`;
    const img = $("img", body);
    img.onerror = () => fail("読み込めませんでした", img.src);
    swToken().then(() => { img.src = `stream/${f.id}?v=${encodeURIComponent(s._version || "")}`; }).catch((e) => fail("読み込めませんでした", e));
  } else {
    body.innerHTML = `<a class="btn open-drive" href="https://drive.google.com/file/d/${encodeURIComponent(f.id)}/view" target="_blank" rel="noopener">${icon("i-external")}Driveで開く</a>`;
  }
}
export function setMode(s, m) { setSeg(s, m); renderBody(s, Number(m)); }
const setSeg = (s, m) => s.querySelectorAll(".seg button").forEach((b) => b.setAttribute("aria-pressed", b.dataset.mode == m));

// PDF：全ページ分の枠を作り、画面に近づいたものから canvas に描く
async function renderPdf(s, body) {
  const tok = (s._rt = {});
  const pdfjs = await import("../vendor/pdf.min.mjs");
  pdfjs.GlobalWorkerOptions.workerSrc = VENDOR + "pdf.worker.min.mjs";
  const data = await fetchBuffer(s._file.id);
  if (s._rt !== tok) return;
  const task = pdfjs.getDocument({
    data, cMapUrl: VENDOR + "pdfjs/cmaps/", cMapPacked: true, standardFontDataUrl: VENDOR + "pdfjs/standard_fonts/",
    wasmUrl: VENDOR + "pdfjs/wasm/", iccUrl: VENDOR + "pdfjs/iccs/",
  });
  s._pdf = task; // 閉じる・描き直すときに task.destroy() で worker ごと解放する
  const doc = await task.promise;
  if (s._rt !== tok) return;
  const n = doc.numPages, root = $(".scroll", s);
  const p1 = (await doc.getPage(1)).getViewport({ scale: 1 });
  body.innerHTML = `<div class="pdf">${Array.from({ length: n }, (_, i) => `<div class="pg" data-p="${i + 1}" style="aspect-ratio:${p1.width} / ${p1.height}"></div>`).join("")}</div><div class="pageno">1 / ${n}</div>`;
  const pages = [...body.querySelectorAll(".pg")], no = $(".pageno", body);

  const draw = async (pg) => {
    const page = await doc.getPage(Number(pg.dataset.p));
    if (s._rt !== tok) return;
    const base = page.getViewport({ scale: 1 });
    pg.style.aspectRatio = `${base.width} / ${base.height}`;
    // 解像度は devicePixelRatio に合わせる（iOS の canvas 上限を超えないよう抑える）
    let scale = (pg.clientWidth / base.width) * Math.min(devicePixelRatio || 1, 3);
    scale = Math.min(scale, Math.sqrt(16e6 / (base.width * base.height)));
    const vp = page.getViewport({ scale });
    const c = document.createElement("canvas");
    c.width = Math.floor(vp.width); c.height = Math.floor(vp.height);
    await page.render({ canvasContext: c.getContext("2d"), viewport: vp }).promise;
    if (s._rt === tok) pg.append(c);
  };
  const io = new IntersectionObserver((es) => es.forEach((e) => {
    if (!e.isIntersecting || e.target._drawn) return;
    e.target._drawn = true; io.unobserve(e.target);
    draw(e.target).catch((err) => console.error("pdf page", err));
  }), { root, rootMargin: "120% 0px" });
  pages.forEach((p) => io.observe(p));

  // 現在のページ：上から 40% の位置にかかっている最後のページ
  let raf = 0;
  const upd = () => {
    raf = 0;
    const line = root.getBoundingClientRect().top + root.clientHeight * 0.4;
    let cur = 1;
    for (const p of pages) { if (p.getBoundingClientRect().top <= line) cur = Number(p.dataset.p); else break; }
    no.textContent = `${cur} / ${n}`;
  };
  root.addEventListener("scroll", () => { if (!raf) raf = requestAnimationFrame(upd); }, { passive: true });
}

/* ===================== 編集（ADR-0013） ===================== */
// 編集中は ✎ が ✓（保存）に変わり、その左に ×（やめる）が出る。どちらも常に押せる
function setEditButtons(s, editing) {
  const main = $('[data-act="edit"],[data-act="save"]', s);
  main.dataset.act = editing ? "save" : "edit";
  main.setAttribute("aria-label", editing ? "保存" : "編集");
  main.innerHTML = icon(editing ? "i-check" : "i-pencil");
  $('[data-act="cancel-edit"]', s).hidden = !editing;
}
export function enterEdit(s) {
  if (s._editing || s._loading) return;
  s._editing = true; s._editBase = s._text; s._editV = s._version;
  $(".subbar", s).hidden = true; setEditButtons(s, true);
  $(".body", s).innerHTML = `<textarea class="edit" spellcheck="false" aria-label="${esc(s._file.name)} を編集"></textarea>`;
  const ta = $("textarea", s); ta.value = s._text; ta.focus({ preventScroll: true });
}
function leaveEdit(s) {
  s._editing = false; s._notifiedV = null;
  $(".subbar", s).hidden = false; setEditButtons(s, false);
  renderBody(s, 0); setSeg(s, 0);
}
const editText = (s) => $("textarea.edit", s)?.value ?? "";
export const isDirty = (s) => !!s._editing && editText(s) !== s._editBase;

// 保存して返ってきた version を記録し直す
async function persist(s, text) {
  const f = s._file;
  const r = await saveText(f.id, text, f.mimeType);
  Object.assign(f, { version: r.version, modifiedTime: r.modifiedTime, t: Date.parse(r.modifiedTime), ...(r.size != null && { size: Number(r.size) }) });
  s._text = text; s._version = r.version;
  updateMeta(s);
}

// ✓：変更が無ければそのまま抜ける。版が変わっていれば衝突、そうでなければ保存
export async function saveEdit(s) {
  if (s._saving) return;
  if (!isDirty(s)) { leaveEdit(s); return; }
  s._saving = true;
  try {
    const cur = await getVersion(s._file.id);
    if (cur.version !== s._editV) {
      const theirs = await fetchText(s._file.id);
      openMerge(s, theirs, cur.version);
      return;
    }
    await persist(s, editText(s));
    leaveEdit(s);
    toast("保存しました");
  } catch (e) {
    fail("保存できませんでした", e);
  } finally { s._saving = false; }
}

// ×：変更が無ければそのまま抜ける。変更があるときだけ確認する
let afterDiscard = null;
export function cancelEdit(s, then) {
  if (!isDirty(s)) { leaveEdit(s); then && then(); return; }
  afterDiscard = then || null;
  $("#discard").showModal();
}
export function resolveDiscard(choice) {
  $("#discard").close();
  const s = state.doc, fn = afterDiscard; afterDiscard = null;
  if (choice === "discard" && s) { leaveEdit(s); fn && fn(); }
}

/* ===================== 衝突：3方向マージ（ADR-0014） ===================== */
let mergeState = null;
function openMerge(s, theirs, theirsV) {
  const chunks = diff3(s._editBase.split("\n"), editText(s).split("\n"), theirs.split("\n"));
  mergeState = { s, chunks, onlyChanges: true, theirsV };
  renderMerge();
  const d = $("#conflict");
  if (!d.open) d.showModal();
}
function mergedText(ms) {
  return ms.chunks.flatMap((c) =>
    c.t === "same" ? c.lines : c.t !== "conflict" ? c.lines :
    c.pick === "mine" ? c.mine : c.pick === "theirs" ? c.theirs : [...c.theirs, ...c.mine]).join("\n");
}
function renderMerge() {
  const { chunks, onlyChanges } = mergeState, d = $("#conflict");
  const n = (t) => chunks.filter((c) => c.t === t).length;
  $("#mergeTitle").textContent = n("conflict") ? `衝突 ${n("conflict")}か所` : "別の場所で更新あり";
  $(".seg.mv", d).innerHTML = `<button data-mv="1" aria-pressed="${onlyChanges}">変更箇所</button><button data-mv="0" aria-pressed="${!onlyChanges}">全文</button>`;
  $(".stats", d).innerHTML = `<span>相手の変更 <b>${n("theirs") + n("both")}</b></span><span>自分の変更 <b>${n("mine")}</b></span><span>衝突 <b>${n("conflict")}</b></span>`;
  const L = (cls, text) => `<div class="ln ${cls}">${esc(text) || " "}</div>`;
  let html = "", gap = false;
  chunks.forEach((c, idx) => {
    if (c.t === "same") {
      const near = chunks.slice(Math.max(0, idx - 2), idx + 3).some((x) => x.t !== "same");
      if (!onlyChanges || near) { html += L("ctx", c.lines[0]); gap = false; }
      else if (!gap) { html += `<div class="gap">…</div>`; gap = true; }
      return;
    }
    gap = false;
    if (c.t === "conflict") {
      const on = (k) => (c.pick === k || c.pick === "both" ? "on" : "");
      html += `<div class="hunk"><div class="head"><span>この箇所を両方が変えました</span>
        <div class="seg" role="group" aria-label="どちらを残すか">${[["theirs", "相手"], ["mine", "自分"], ["both", "両方"]].map(([k, l]) => `<button data-pick="${idx}:${k}" aria-pressed="${c.pick === k}">${l}</button>`).join("")}</div></div>
        <div class="side ${on("theirs")}"><span class="tag theirs">相手</span>${c.theirs.map((t) => L("theirs", t)).join("") || L("del", "（削除）")}</div>
        <div class="side ${on("mine")}"><span class="tag mine">自分</span>${c.mine.map((t) => L("mine", t)).join("") || L("del", "（削除）")}</div></div>`;
      return;
    }
    const who = c.t === "mine" ? "mine" : "theirs";
    html += c.base.map((t) => L("del", t)).join("") + c.lines.map((t) => L(who, t)).join("");
  });
  $(".lines", d).innerHTML = html;
}
export function mergeView(onlyChanges) { mergeState.onlyChanges = onlyChanges; renderMerge(); }
export function mergePick(idx, k) { mergeState.chunks[idx].pick = k; renderMerge(); }

// 「最新を読み込む」「自分の版で上書き」「マージして保存」「編集に戻る」
export async function mergeAction(a) {
  const ms = mergeState;
  $("#conflict").close();
  if (!ms || a === "cancel") return;
  const s = ms.s, f = s._file;
  mergeState = null;
  if (a === "reload") { leaveEdit(s); await load(s); toast("最新を読み込みました"); return; }
  try {
    // 差分を見ている間にさらに更新されていたら、取り直して差分を出し直す
    const cur = await getVersion(f.id);
    if (cur.version !== ms.theirsV) {
      openMerge(s, await fetchText(f.id), cur.version);
      toast("さらに更新されていました");
      return;
    }
    await persist(s, a === "merge" ? mergedText(ms) : editText(s));
    leaveEdit(s);
    toast(a === "merge" ? "マージして保存しました" : "上書きして保存しました");
  } catch (e) {
    fail("保存できませんでした", e);
  }
}

/* ===================== 更新の追従（15秒ごと・画面が見えている間） ===================== */
export async function checkDocUpdate() {
  const s = state.doc;
  if (!s || s._checking || s._loading || s._kind === "other" || s._saving) return;
  s._checking = true;
  try {
    const m = await getVersion(s._file.id);
    if (state.doc !== s || s._saving) return;
    if (m.version !== s._version && m.version !== s._notifiedV) {
      s._notifiedV = m.version;
      const name = s._file.name;
      if (s._editing) toast(`${name} が別の場所で更新されました`);
      else toast(`${name} が更新されました`, "再読込", () => reload(s));
    }
  } catch (e) {
    console.warn("更新の確認に失敗", e);
  } finally { s._checking = false; }
}

/* ===================== 「…」メニュー ===================== */
let moreFile = null;
export function showMore(f) {
  moreFile = f;
  const m = $("#moreMenu");
  m.innerHTML = `<div class="path">マイドライブ/…</div><hr>
    <button data-act="copy">${icon("i-link")}リンクをコピー</button>
    <button data-act="drive">${icon("i-external")}Driveで開く</button>`;
  m.showPopover();
  fullPath(f).then((p) => { if (moreFile === f) { const el = $(".path", m); if (el) el.textContent = p; } }).catch(() => {});
}
export function moreAction(act) {
  const f = moreFile; $("#moreMenu").hidePopover();
  if (!f) return;
  if (act === "copy") {
    navigator.clipboard.writeText(location.origin + location.pathname + "?id=" + f.id)
      .then(() => toast("リンクをコピーしました"), (e) => fail("コピーできませんでした", e));
  } else window.open(`https://drive.google.com/file/d/${encodeURIComponent(f.id)}/view`, "_blank", "noopener");
}
