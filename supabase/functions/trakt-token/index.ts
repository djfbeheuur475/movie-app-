import "@supabase/functions-js/edge-runtime.d.ts";

// Trakt OAuth token refresh, done server-side so the client secret never ships
// in the app bundle. Since 2025-03-20 Trakt access tokens live 24h, and the
// refresh_token grant rejects a blank client_secret — which is what the app
// used to send, so every refresh failed and users were silently logged out
// of Trakt once a day.
//
// No user auth: guests can connect Trakt too, and this only ever exchanges a
// refresh token the caller already holds.

const TRAKT_CLIENT_ID = "f2709b8b2160742dabafd2f96bdbb3af4329d022c1a303d59e132435bf177003";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS_HEADERS });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const secret = Deno.env.get("TRAKT_CLIENT_SECRET");
  if (!secret) return json({ error: "server_misconfigured" }, 500);

  let refreshToken = "";
  try {
    ({ refresh_token: refreshToken = "" } = await req.json());
  } catch { /* fall through */ }
  if (!refreshToken) return json({ error: "missing_refresh_token" }, 400);

  const res = await fetch("https://api.trakt.tv/oauth/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "User-Agent": "NextUp/1.0 (+supabase-edge)",
    },
    body: JSON.stringify({
      refresh_token: refreshToken,
      client_id: TRAKT_CLIENT_ID,
      client_secret: secret,
      redirect_uri: "urn:ietf:wg:oauth:2.0:oob",
      grant_type: "refresh_token",
    }),
  });

  if (res.ok) return json(await res.json(), 200);

  // 400/401 from Trakt = the refresh token itself is dead (revoked, already
  // rotated, or expired) — the client must reconnect. Anything else is
  // transient and the client should keep its tokens and retry later.
  const detail = await res.text().catch(() => "");
  console.warn(`[trakt-token] Trakt ${res.status}: ${detail.slice(0, 200)}`);
  if (res.status === 400 || res.status === 401) return json({ error: "invalid_grant" }, 401);
  return json({ error: "upstream_error", status: res.status }, 502);
});
