import "@supabase/functions-js/edge-runtime.d.ts";

// Service-only LLM proxy for the kb/ experiment pipeline (runs on the Pi).
// Reuses the server-side OPENROUTER_KEY so no provider key lives on the Pi.
// Only callers presenting KB_LLM_TOKEN (a Supabase secret, also in kb/.env)
// are served — the app can't reach it. Deliberately separate from ai-chat (the experiment's control).

const OPENROUTER = "https://openrouter.ai/api/v1/chat/completions";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  const token = Deno.env.get("KB_LLM_TOKEN") ?? "";
  if (!token || req.headers.get("Authorization") !== `Bearer ${token}`) return json({ error: "forbidden" }, 403);

  const orKey = Deno.env.get("OPENROUTER_KEY") ?? "";
  if (!orKey) return json({ error: "OPENROUTER_KEY not configured" }, 503);

  const { model = "qwen/qwen3-14b", messages, max_tokens = 2000, temperature } = await req.json().catch(() => ({}));
  if (!Array.isArray(messages) || !messages.length) return json({ error: "messages required" }, 400);

  const res = await fetch(OPENROUTER, {
    method: "POST",
    headers: { Authorization: `Bearer ${orKey}`, "Content-Type": "application/json", "HTTP-Referer": "https://nextup.app", "X-Title": "NextUp KB experiment" },
    // Same routing/thinking settings as ai-chat, so model behaviour is comparable.
    body: JSON.stringify({
      model, messages, max_tokens, ...(temperature != null ? { temperature } : {}),
      provider: { order: ["Fireworks", "Together", "Nebius"], allow_fallbacks: true },
      chat_template_kwargs: { enable_thinking: false },
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) return json({ error: `openrouter ${res.status}`, detail: JSON.stringify(data).slice(0, 300) }, 502);
  const content: string = (data.choices?.[0]?.message?.content ?? "").replace(/<think>[\s\S]*?<\/think>/g, "").trim();
  return json({ content, usage: data.usage ?? null, model: data.model ?? model });
});
