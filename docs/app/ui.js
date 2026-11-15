// 小物・アニメーション・トースト（モックから移植）
export const $ = (s, el = document) => el.querySelector(s);
export const h = (html) => { const t = document.createElement("template"); t.innerHTML = html.trim(); return t.content.firstElementChild; };
export const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
export const icon = (id, cls = "i") => `<svg class="${cls}" aria-hidden="true"><use href="#${id}"/></svg>`;
const css = (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
export const T = () => parseFloat(css("--t")) || 0;
export const EASE = () => css("--out");
export const mmss = (s) => (isFinite(s) ? `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}` : "--:--");

// 画面の共有状態（開いているドキュメントのシート）
export const state = { doc: null };

const day = 86400e3;
export function ago(t) {
  const s = (Date.now() - t) / 1000;
  if (s < 60) return "今";
  if (s < 3600) return Math.floor(s / 60) + "分前";
  const d = new Date(t), d0 = new Date(); d0.setHours(0, 0, 0, 0);
  if (t >= d0) return Math.floor(s / 3600) + "時間前";
  if (t >= d0 - day) return `${d.getHours()}:${String(d.getMinutes()).padStart(2, "0")}`;
  return `${d.getMonth() + 1}/${d.getDate()}`;
}
export const freshness = (t) => { const s = (Date.now() - t) / 1000; return s < 600 ? "fresh" : s < 3600 ? "warm" : ""; };
export function groupOf(t) {
  const d0 = new Date(); d0.setHours(0, 0, 0, 0);
  if (t >= d0) return "今日";
  if (t >= d0 - day) return "昨日";
  if (t >= d0 - 6 * day) return "今週";
  return "それより前";
}
export function fmtSize(n) {
  if (n == null || isNaN(n)) return "";
  if (n < 1024) return n + " B";
  if (n < 1048576) return (n / 1024).toFixed(1) + " KB";
  if (n < 1073741824) return (n / 1048576).toFixed(1) + " MB";
  return (n / 1073741824).toFixed(1) + " GB";
}

/* ===== シートの開閉アニメーション ===== */
export const insetOf = (r) => `inset(${Math.max(0, r.top)}px ${Math.max(0, innerWidth - r.right)}px ${Math.max(0, innerHeight - r.bottom)}px ${Math.max(0, r.left)}px round 12px)`;
export const FULL = "inset(0px 0px 0px 0px round 0px)";

export function growFrom(s, originEl) {
  const r = originEl && originEl.isConnected ? originEl.getBoundingClientRect() : null;
  const from = r ? insetOf(r) : "inset(40% 10% 40% 10% round 12px)";
  s.animate([{ clipPath: from }, { clipPath: FULL }], { duration: T(), easing: EASE() });
  s.querySelectorAll(":scope > *").forEach((c) => c.animate([{ opacity: 0 }, { opacity: 1 }], { duration: T(), easing: EASE() }));
}
export function shrinkTo(s, originEl, fromTransform) {
  const r = originEl && originEl.isConnected ? originEl.getBoundingClientRect() : null;
  const visible = r && r.bottom > 0 && r.top < innerHeight;
  const to = visible ? insetOf(r) : "inset(45% 20% 45% 20% round 12px)";
  s.querySelectorAll(":scope > *").forEach((c) => c.animate([{ opacity: 1 }, { opacity: 0 }], { duration: T() * 0.7, easing: EASE(), fill: "forwards" }));
  s.style.transform = "";
  return s.animate([{ clipPath: FULL, transform: fromTransform || "none" }, { clipPath: to, transform: "none" }], { duration: T(), easing: EASE(), fill: "forwards" }).finished;
}

/* ===== トースト（1つだけ） ===== */
let toastTimer;
export function toast(text, act, fn) {
  $("#toastText").textContent = text;
  const b = $("#toastAct"); b.textContent = act || ""; b.hidden = !act; b.onclick = () => { hideToast(); fn && fn(); };
  $("#toast").classList.add("show");
  clearTimeout(toastTimer); toastTimer = setTimeout(hideToast, act ? 8000 : 2200);
}
export const hideToast = () => $("#toast").classList.remove("show");
// 失敗：短いトーストと console の詳細
export function fail(msg, err) { console.error(msg, err); toast(msg); }
