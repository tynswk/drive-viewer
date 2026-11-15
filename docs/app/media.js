// メディア：全画面 ⇄ 下部のミニバー。要素は DOM の中で動かさず、.mini の付け外しだけで形を変える
import { $, h, esc, icon, ago, mmss, fmtSize, growFrom, insetOf, FULL, T, EASE, state, fail } from "./ui.js";
import { swToken } from "./auth.js";
import { fullPath } from "./drive.js";

export const media = { sheet: null, file: null, el: null, playing: false, timer: 0 };

export function openMedia(f, originEl) {
  if (media.file && media.file.id === f.id) return expandMedia();
  if (media.sheet) teardown();
  const isV = f.mimeType.startsWith("video/");
  const s = h(`<section class="sheet media" role="dialog" aria-label="${esc(f.name)}">
    <header class="top" data-grab>
      <button class="icon-btn" data-act="minimize" aria-label="下に収める">${icon("i-chev-d")}</button>
      <span class="title">${esc(f.name)}</span>
      <button class="icon-btn" data-act="more" aria-label="その他">${icon("i-more")}</button>
    </header>
    <div class="scroll">
      <div class="subbar"><span class="meta">${ago(f.t)}に更新 ・ ${esc(fmtSize(f.size))}</span></div>
      <div class="player">
        <div class="stage ${isV ? "" : "audio"}">
          ${isV ? `<video controls playsinline preload="metadata"></video>` : `<div class="art">${icon("i-music")}</div><audio controls preload="metadata"></audio>`}
        </div>
        <div class="chips" role="group" aria-label="再生速度">${[0.75, 1, 1.25, 1.5, 1.8, 2].map((r) => `<button aria-pressed="${r === 1}" data-rate="${r}">${r}×</button>`).join("")}</div>
        <dl class="kv"><dt>長さ</dt><dd class="dur">--:--</dd><dt>サイズ</dt><dd>${esc(fmtSize(f.size))}</dd><dt>場所</dt><dd class="loc"></dd></dl>
      </div>
    </div>
    <div class="mini-ui">
      <button class="mt" data-act="expand"><b>${esc(f.name)}</b><span class="mtime">0:00 / --:--</span></button>
      <button class="icon-btn" data-act="playpause" aria-label="再生">${icon("i-play")}</button>
      <button class="icon-btn" data-act="stop" aria-label="閉じる">${icon("i-x")}</button>
      <span class="prog"></span>
    </div>
  </section>`);
  s._file = f; s._origin = originEl;
  const el = $("video,audio", s);
  Object.assign(media, { sheet: s, file: f, el, playing: false });
  document.body.append(s);
  growFrom(s, originEl);
  history.pushState({ sheet: "media" }, "");
  markPlaying();

  const sync = () => {
    media.playing = !el.paused;
    const b = $('[data-act="playpause"]', s);
    b.innerHTML = icon(media.playing ? "i-pause" : "i-play");
    b.setAttribute("aria-label", media.playing ? "一時停止" : "再生");
  };
  const tick = () => {
    $(".mtime", s).textContent = `${mmss(el.currentTime)} / ${mmss(el.duration)}`;
    $(".prog", s).style.width = (el.duration ? (el.currentTime / el.duration) * 100 : 0) + "%";
  };
  el.addEventListener("play", sync);
  el.addEventListener("pause", sync);
  el.addEventListener("timeupdate", tick);
  el.addEventListener("loadedmetadata", () => { $(".dur", s).textContent = mmss(el.duration); tick(); });
  el.addEventListener("error", () => { if (media.el === el) fail("再生できませんでした", el.error); });

  // SW が読むトークンを新しくしてから src を与える。再生中も切れないよう定期的に更新
  swToken().then(() => { if (media.el === el) el.src = "stream/" + f.id; }).catch((e) => fail("読み込めませんでした", e));
  media.timer = setInterval(() => swToken().catch(() => {}), 4 * 60e3);

  fullPath(f).then((p) => { $(".loc", s).textContent = p; }).catch(() => {});
  if ("mediaSession" in navigator) {
    navigator.mediaSession.metadata = new MediaMetadata({ title: f.name });
    navigator.mediaSession.setActionHandler("play", () => el.play());
    navigator.mediaSession.setActionHandler("pause", () => el.pause());
  }
}

function miniRect() {
  const bar = state.doc ? 0 : 52;
  const top = innerHeight - bar - 8 - 64;
  return { top, left: 8, right: innerWidth - 8, bottom: top + 64 };
}
export function minimizeMedia(fromTransform) {
  const s = media.sheet; if (!s || s.classList.contains("mini")) return;
  s.style.transform = "";
  s.animate([{ clipPath: FULL, transform: fromTransform || "none" }, { clipPath: insetOf(miniRect()), transform: "none" }], { duration: T(), easing: EASE() })
    .finished.then(() => { s.classList.add("mini"); document.body.classList.add("has-mini"); });
}
export function expandMedia() {
  const s = media.sheet; if (!s || !s.classList.contains("mini")) return;
  const r = s.getBoundingClientRect();
  s.classList.remove("mini"); document.body.classList.remove("has-mini");
  s.animate([{ clipPath: insetOf(r) }, { clipPath: FULL }], { duration: T(), easing: EASE() });
  history.pushState({ sheet: "media" }, "");
}
function teardown() {
  const el = media.el;
  clearInterval(media.timer);
  if (el) { el.pause(); el.removeAttribute("src"); el.load(); }
  media.sheet.remove();
  Object.assign(media, { sheet: null, file: null, el: null, playing: false });
  document.body.classList.remove("has-mini");
  if ("mediaSession" in navigator) navigator.mediaSession.metadata = null;
}
export function stopMedia() {
  const s = media.sheet; if (!s) return;
  const el = media.el;
  clearInterval(media.timer);
  el.pause(); el.removeAttribute("src"); el.load();
  s.animate([{ opacity: 1, transform: "none" }, { opacity: 0, transform: "translateY(24px)" }], { duration: T(), easing: EASE(), fill: "forwards" }).finished.then(() => s.remove());
  Object.assign(media, { sheet: null, file: null, el: null, playing: false });
  document.body.classList.remove("has-mini");
  if ("mediaSession" in navigator) navigator.mediaSession.metadata = null;
  markPlaying();
}
export function togglePlay() {
  const el = media.el; if (!el) return;
  if (el.paused) el.play().catch((e) => fail("再生できませんでした", e)); else el.pause();
}
export function setRate(r) { if (media.el) media.el.playbackRate = r; }
// 再生中のファイルの行のアイコンを琥珀色にする
export function markPlaying() {
  document.querySelectorAll(".row[data-id]").forEach((r) => r.classList.toggle("playing", !!media.file && r.dataset.id === media.file.id));
}
