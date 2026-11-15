// drive-viewer のトークン中継。client_secret を持つのはここだけ。
// POST /exchange {code, code_verifier, redirect_uri} -> {access_token, expires_in, refresh_token}
// POST /refresh  {refresh_token}                     -> {access_token, expires_in}

const ALLOWED_ORIGINS = ["https://tynswk.github.io", "http://localhost:5173"];
const ALLOWED_REDIRECTS = ["https://tynswk.github.io/drive-viewer/", "http://localhost:5173/"];

function cors(origin) {
  const h = {
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
  if (ALLOWED_ORIGINS.includes(origin)) h["Access-Control-Allow-Origin"] = origin;
  return h;
}

function json(body, status, origin) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...cors(origin) },
  });
}

async function google(params, env) {
  const body = new URLSearchParams({
    client_id: env.GOOGLE_CLIENT_ID,
    client_secret: env.GOOGLE_CLIENT_SECRET,
    ...params,
  });
  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  const data = await r.json();
  // id_token などは返さない
  const out = {};
  for (const k of ["access_token", "expires_in", "refresh_token", "scope", "error", "error_description"]) {
    if (data[k] !== undefined) out[k] = data[k];
  }
  return [out, r.status];
}

export default {
  async fetch(req, env) {
    const origin = req.headers.get("Origin") || "";
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors(origin) });
    if (!ALLOWED_ORIGINS.includes(origin)) return json({ error: "origin" }, 403, origin);
    if (req.method !== "POST") return json({ error: "method" }, 405, origin);

    const url = new URL(req.url);
    let body;
    try { body = await req.json(); } catch { return json({ error: "body" }, 400, origin); }

    if (url.pathname === "/exchange") {
      if (!ALLOWED_REDIRECTS.includes(body.redirect_uri)) return json({ error: "redirect_uri" }, 400, origin);
      const [out, st] = await google({
        grant_type: "authorization_code",
        code: body.code,
        code_verifier: body.code_verifier,
        redirect_uri: body.redirect_uri,
      }, env);
      return json(out, st, origin);
    }
    if (url.pathname === "/refresh") {
      const [out, st] = await google({ grant_type: "refresh_token", refresh_token: body.refresh_token }, env);
      return json(out, st, origin);
    }
    return json({ error: "not found" }, 404, origin);
  },
};
