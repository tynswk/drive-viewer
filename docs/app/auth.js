// ログイン（認可コード＋PKCE、交換と更新は Worker）。P0 の処理の移植
const CLIENT_ID = "591925567747-l2hgpfep4qvme7c5tdhh9mnal8nub2h1.apps.googleusercontent.com";
const WORKER = "https://drive-viewer-auth.tynswk.workers.dev";
const REDIRECT = location.origin + location.pathname.replace(/index\.html$/, "");
const SCOPE = "https://www.googleapis.com/auth/drive";

export const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch {} },
  del(k) { try { localStorage.removeItem(k); } catch {} },
};

function b64url(buf) {
  return btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export const isAuthed = () => !!store.get("refresh_token");

export async function login() {
  const verifier = b64url(crypto.getRandomValues(new Uint8Array(32)));
  const challenge = b64url(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)));
  const state = b64url(crypto.getRandomValues(new Uint8Array(16)));
  store.set("pkce_verifier", verifier);
  store.set("pkce_state", state);
  // ディープリンクで来ていたら、ログイン後に開けるよう覚えておく
  const id = new URLSearchParams(location.search).get("id");
  if (id) store.set("post_login_id", id);
  const p = new URLSearchParams({
    client_id: CLIENT_ID, redirect_uri: REDIRECT, response_type: "code", scope: SCOPE,
    access_type: "offline", prompt: "consent", code_challenge: challenge, code_challenge_method: "S256", state,
  });
  location.href = "https://accounts.google.com/o/oauth2/v2/auth?" + p;
}

// リダイレクトで戻ってきたときの code 交換。成功したら true
export async function handleRedirect() {
  const q = new URLSearchParams(location.search);
  if (!q.has("code")) return false;
  history.replaceState(null, "", REDIRECT);
  if (q.get("state") !== store.get("pkce_state")) throw new Error("state 不一致");
  const r = await fetch(WORKER + "/exchange", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code: q.get("code"), code_verifier: store.get("pkce_verifier"), redirect_uri: REDIRECT }),
  });
  const d = await r.json();
  store.del("pkce_verifier"); store.del("pkce_state");
  if (!d.refresh_token) throw new Error("交換失敗: " + JSON.stringify(d));
  store.set("refresh_token", d.refresh_token);
  await saveAccess(d.access_token, d.expires_in);
  return true;
}

async function saveAccess(token, expiresIn) {
  store.set("access_token", token);
  store.set("access_exp", String(Date.now() + (expiresIn - 60) * 1000));
  await putSwToken(token);
}
// Service Worker からも読めるよう Cache API に置く
async function putSwToken(token) {
  try { const c = await caches.open("auth"); await c.put("__token", new Response(token)); } catch {}
}

let refreshing = null;
function refresh() {
  refreshing ||= (async () => {
    const rt = store.get("refresh_token");
    if (!rt) throw new Error("未ログイン");
    const r = await fetch(WORKER + "/refresh", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ refresh_token: rt }),
    });
    const d = await r.json();
    if (!d.access_token) throw new Error("更新失敗: " + JSON.stringify(d));
    await saveAccess(d.access_token, d.expires_in);
    return d.access_token;
  })().finally(() => { refreshing = null; });
  return refreshing;
}

// minLeft：期限までこれだけ（ms）残っていなければ取り直す
export async function accessToken(minLeft = 0) {
  const t = store.get("access_token");
  if (t && Date.now() + minLeft < Number(store.get("access_exp"))) return t;
  return refresh();
}
// 401 を受けたときの強制更新
export const forceRefresh = () => refresh();

// SW のストリーミング用：Cache のトークンを最新にしておく（メディア再生中に切れないよう余裕を持たせる）
export async function swToken(minLeft = 6 * 60e3) {
  const t = await accessToken(minLeft);
  await putSwToken(t);
  return t;
}

export function logout() {
  const pins = store.get("dv_pins");
  try { localStorage.clear(); } catch {}
  if (pins) store.set("dv_pins", pins);
  caches.delete("auth").finally(() => location.reload());
}
