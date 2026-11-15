// 起動・操作の振り分け・戻る／払う操作
import { $, h, T, EASE, state, fail, ago, freshness } from "./ui.js";
import { store, isAuthed, login, logout, handleRedirect } from "./auth.js";
import { reg } from "./drive.js";
import { media, minimizeMedia, expandMedia, stopMedia, togglePlay, setRate } from "./media.js";
import { showTab, showNewer, searchBox, initScopeMenu, appMenu, toggleNode, checkRecent, nodeMenu, pinAction } from "./pages.js";
import {
  openFile, openById, closeDoc, backDoc, isDirty, cancelEdit, resolveDiscard, enterEdit, saveEdit, setMode,
  mergeAction, mergeView, mergePick, showMore, moreAction, checkDocUpdate,
} from "./viewer.js";

/* ===================== 起動 ===================== */
async function boot() {
  if ("serviceWorker" in navigator) await navigator.serviceWorker.register("sw.js", { updateViaCache: "none" }).catch((e) => console.warn("SW", e));
  try { await handleRedirect(); } catch (e) { console.error(e); }
  if (!isAuthed()) return showLogin();
  $("#tabs").hidden = false;
  initScopeMenu();
  showTab("recent");
  // ディープリンク（ログイン前に来ていたものも拾う）
  const id = new URLSearchParams(location.search).get("id") || store.get("post_login_id");
  store.del("post_login_id");
  if (id) openById(id);
  // 画面が見えている間だけ15秒ごとに、新着と開いているファイルの更新を見る
  const tick = () => { if (document.visibilityState === "visible") { checkRecent(); checkDocUpdate(); } };
  setInterval(tick, 15e3);
  document.addEventListener("visibilitychange", tick);
}
function showLogin() {
  $("#tabs").hidden = true;
  $("#main").replaceChildren(h(`<section class="login"><button class="btn solid" data-act="login">Googleでログイン</button></section>`));
}

addEventListener("scroll", () => document.querySelectorAll(".page > .top").forEach((t) => t.classList.toggle("scrolled", scrollY > 4)), { passive: true });
// 相対時刻を 30 秒ごとに更新
setInterval(() => document.querySelectorAll(".row time").forEach((t) => {
  const ts = Date.parse(t.dateTime);
  t.textContent = ago(ts);
  const r = t.closest(".row"); r.classList.remove("fresh", "warm");
  const fr = freshness(ts); if (fr) r.classList.add(fr);
}), 30e3);

/* ===================== ヘッダを掴んで下へ払う／ミニバーを上へ払う ===================== */
let drag = null;
document.addEventListener("pointerdown", (e) => {
  const mini = e.target.closest(".sheet.media.mini");
  if (mini) { if (!e.target.closest("[data-act=playpause],[data-act=stop]")) drag = { s: mini, y0: e.clientY, t0: e.timeStamp, dy: 0, mini: true }; return; }
  const grab = e.target.closest("[data-grab]");
  if (!grab || e.target.closest("button")) return;
  drag = { s: grab.closest(".sheet"), y0: e.clientY, t0: e.timeStamp, dy: 0 };
  grab.setPointerCapture(e.pointerId);
});
document.addEventListener("pointermove", (e) => {
  if (!drag) return;
  drag.dy = e.clientY - drag.y0;
  if (!drag.mini) drag.s.style.transform = `translateY(${Math.max(0, drag.dy)}px)`;
});
document.addEventListener("pointerup", (e) => {
  if (!drag) return;
  const d = drag; drag = null;
  const v = d.dy / Math.max(1, e.timeStamp - d.t0); // px/ms
  if (d.mini) { if (d.dy < -30 || v < -0.3) expandMedia(); return; }
  const tr = d.s.style.transform;
  if ((d.dy > 90 || v > 0.5) && isDirty(d.s)) {
    d.s.style.transform = ""; d.s.animate([{ transform: tr }, { transform: "none" }], { duration: T(), easing: EASE() });
    cancelEdit(d.s, () => history.back());
    return;
  }
  if (d.dy > 90 || v > 0.5) {
    d.s._dragTr = tr;
    history.back(); // popstate で閉じる／収める
  } else {
    d.s.style.transform = "";
    d.s.animate([{ transform: tr }, { transform: "none" }], { duration: T(), easing: EASE() });
  }
});

/* ===================== フォルダ行の長押し（右クリックも）でメニュー ===================== */
let press = null, swallowClick = false;
document.addEventListener("pointerdown", (e) => {
  const row = e.target.closest(".node.dir > .row[data-toggle]"); if (!row) return;
  press = { x: e.clientX, y: e.clientY, tm: setTimeout(() => { press = null; swallowClick = true; nodeMenu(row.closest(".node")); }, 450) };
});
const endPress = () => { if (press) { clearTimeout(press.tm); press = null; } };
document.addEventListener("pointermove", (e) => { if (press && Math.hypot(e.clientX - press.x, e.clientY - press.y) > 8) endPress(); });
["pointerup", "pointercancel"].forEach((n) => document.addEventListener(n, () => {
  endPress();
  if (swallowClick) setTimeout(() => (swallowClick = false), 350); // クリックが来なかったときに次のタップを食べない
}));
addEventListener("scroll", endPress, { passive: true });
document.addEventListener("contextmenu", (e) => {
  const row = e.target.closest(".node.dir > .row[data-toggle]"); if (!row) return;
  e.preventDefault(); endPress(); swallowClick = false; nodeMenu(row.closest(".node"));
});
// 長押しで開いたあとの指離しのクリックで、フォルダが開閉しないように
document.addEventListener("click", (e) => { if (swallowClick) { swallowClick = false; e.stopImmediatePropagation(); e.preventDefault(); } }, true);
$("#nodeMenu").addEventListener("click", (e) => { const b = e.target.closest("[data-pin]"); if (b) pinAction(b.dataset.pin === "on"); });

/* ===================== 戻る（ボタン・OS・ブラウザ共通） ===================== */
addEventListener("popstate", () => {
  if (media.sheet && !media.sheet.classList.contains("mini")) { minimizeMedia(media.sheet._dragTr); media.sheet._dragTr = null; return; }
  const d = state.doc;
  if (!d) return;
  // 変更があるまま OS の戻るで抜けようとしたときも、破棄の確認を挟む
  if (isDirty(d)) { history.pushState({ sheet: "doc" }, ""); cancelEdit(d, () => history.back()); return; }
  backDoc(d._dragTr);
});

/* ===================== 操作 ===================== */
document.addEventListener("click", (e) => {
  const t = e.target.closest("button"); if (!t) return;
  const s = t.closest(".sheet"), p = t.closest(".page");
  if (t.dataset.tab) { showTab(t.dataset.tab); return; }
  if (t.dataset.id && !s) { const f = reg.get(t.dataset.id); if (f) openFile(f, t); return; }
  if ("toggle" in t.dataset) { toggleNode(t.closest(".node")); return; }
  if (t.dataset.mode) { setMode(s, t.dataset.mode); return; }
  if (t.dataset.rate) {
    t.parentElement.querySelectorAll("button").forEach((b) => b.setAttribute("aria-pressed", b === t));
    setRate(Number(t.dataset.rate)); return;
  }
  if (t.dataset.mv) { mergeView(t.dataset.mv === "1"); return; }
  if (t.dataset.pick) { const [ix, k] = t.dataset.pick.split(":"); mergePick(Number(ix), k); return; }
  if (t.dataset.c) { mergeAction(t.dataset.c); return; }
  if (t.dataset.d) { resolveDiscard(t.dataset.d); return; }
  switch (t.dataset.act) {
    case "login": login().catch((err) => fail("ログインできませんでした", err)); break;
    case "logout": logout(); break;
    case "close": if (s._editing) cancelEdit(s, () => history.back()); else history.back(); break;
    case "minimize": history.back(); break;
    case "expand": expandMedia(); break;
    case "playpause": togglePlay(); break;
    case "stop": stopMedia(); break;
    case "edit": enterEdit(s); break;
    case "cancel-edit": cancelEdit(s); break;
    case "save": saveEdit(s); break;
    case "newer": showNewer(); break;
    case "search": searchBox(p); break;
    case "appmenu": appMenu(); break;
    case "more": showMore(s._file); break;
    case "copy": case "drive": moreAction(t.dataset.act); break;
  }
});
// ポップオーバー内のログアウトは、閉じてから実行
$("#moreMenu").addEventListener("click", (e) => { if (e.target.closest('[data-act="logout"]')) $("#moreMenu").hidePopover(); });
$("#scopeMenu").addEventListener("click", (e) => { if (e.target.closest('[data-act="logout"]')) $("#scopeMenu").hidePopover(); });

boot().catch((e) => fail("起動できませんでした", e));
