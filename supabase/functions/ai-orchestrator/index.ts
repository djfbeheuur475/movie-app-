import "@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "@supabase/supabase-js";
import { CORS_HEADERS, RATE_LIMITS } from "./lib/constants.ts";
import { validateAuth, AuthError } from "./lib/auth.ts";
import { assembleContext } from "./lib/context.ts";
import { handlePing } from "./actions/ping.ts";
import { handleHomepage } from "./actions/homepage.ts";
import { handleIndexTrakt } from "./actions/index_trakt.ts";

// Phase 8: import handleChat from actions/chat.ts

function jsonError(message: string, status: number): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS_HEADERS });
  if (req.method !== "POST") return jsonError("Method not allowed", 405);

  const bodyPromise = req.json().catch(() => ({}));

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    const openRouterKey = Deno.env.get("OPENROUTER_KEY") ?? "";

    // 1. Auth
    const authHeader = req.headers.get("Authorization");
    let user: { id: string };
    try {
      user = await validateAuth(authHeader, supabaseUrl, supabaseAnonKey);
    } catch (e) {
      if (e instanceof AuthError) return jsonError(e.message, 401);
      throw e;
    }

    const admin = createClient(supabaseUrl, serviceRoleKey);

    // 2. Resolve action from body (body parse started in parallel with auth)
    const body = await bodyPromise;
    const action = (typeof body.action === "string" ? body.action : "ping");
    const limit = RATE_LIMITS[action] ?? 50;

    // 3. Rate limit + context assembly.
    // "homepage" is cache-first — most calls just re-serve an unchanged feed
    // and cost nothing, so it checks/consumes its own quota internally, only
    // on an actual cache-miss regeneration. Gating it here unconditionally
    // meant routine repeat opens (or a burst of testing) could exhaust the
    // daily quota before a single real AI generation ever ran.
    let ctx;
    if (action === "homepage") {
      ctx = await assembleContext(admin, user.id, body, openRouterKey);
    } else {
      const [{ data: allowed, error: rlErr }, assembledCtx] = await Promise.all([
        admin.rpc("check_ai_rate_limit", { p_user_id: user.id, p_action: action, p_limit: limit }),
        assembleContext(admin, user.id, body, openRouterKey),
      ]);
      if (rlErr) console.error(`[orchestrator] rate limit error:`, rlErr.message);
      if (allowed === false) return jsonError(`Daily limit reached for action '${action}'`, 429);
      ctx = assembledCtx;
    }

    console.log(`[orchestrator] action=${action} user=${user.id.slice(0, 8)}`);

    // 4. Route to action handler
    switch (action) {
      case "ping":
        return handlePing(ctx);

      case "homepage":
        return handleHomepage(ctx);

      case "index_trakt":
        return handleIndexTrakt(ctx);

      // Phase 8: case "chat": return handleChat(ctx);

      default:
        return jsonError(`Unknown action: ${action}`, 400);
    }
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`[orchestrator] unhandled error:`, msg);
    return jsonError("Internal server error", 500);
  }
});
