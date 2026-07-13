import { OPENROUTER_BASE, OR_SITE_HEADERS } from "./constants.ts";

const OR_PROVIDER = { order: ["Fireworks", "Together", "Nebius"], allow_fallbacks: true };
const THINKING_OFF = { enable_thinking: false };

// ─── Non-streaming call (used by homepage, summaries) ─────────────────────────

export interface CallOptions {
  key: string;
  model: string;
  messages: { role: string; content: string }[];
  maxTokens?: number;
  jsonMode?: boolean;
}

export async function callOpenRouter(opts: CallOptions): Promise<string> {
  const body: Record<string, unknown> = {
    model: opts.model,
    messages: opts.messages,
    provider: OR_PROVIDER,
    chat_template_kwargs: THINKING_OFF,
  };
  if (opts.maxTokens) body.max_tokens = opts.maxTokens;
  if (opts.jsonMode) body.response_format = { type: "json_object" };

  const res = await fetch(`${OPENROUTER_BASE}/chat/completions`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${opts.key}`,
      "Content-Type": "application/json",
      ...OR_SITE_HEADERS,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    try {
      const j = await res.json();
      msg = (j.error?.message) ?? j.message ?? msg;
    } catch { /* ignore */ }
    throw new Error(msg);
  }

  const data = await res.json();
  return ((data.choices?.[0]?.message?.content as string) ?? "")
    .replace(/<think>[\s\S]*?<\/think>/g, "")
    .trim();
}

// ─── Streaming call (used by chat action) ─────────────────────────────────────

export interface StreamOptions {
  key: string;
  model: string;
  messages: { role: string; content: string }[];
}

export interface StreamResult {
  fullText: string;
  promptTokens: number;
  completionTokens: number;
}

export async function streamFromOpenRouter(
  opts: StreamOptions,
  writer: WritableStreamDefaultWriter<Uint8Array>,
  encoder: TextEncoder,
): Promise<StreamResult> {
  const res = await fetch(`${OPENROUTER_BASE}/chat/completions`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${opts.key}`,
      "Content-Type": "application/json",
      ...OR_SITE_HEADERS,
    },
    body: JSON.stringify({
      model: opts.model,
      messages: opts.messages,
      stream: true,
      provider: OR_PROVIDER,
      chat_template_kwargs: THINKING_OFF,
    }),
  });

  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    try {
      const j = await res.json();
      msg = (j.error?.message) ?? j.message ?? msg;
    } catch { /* ignore */ }
    throw new Error(msg);
  }

  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let sseBuffer = "";
  let fullText = "";
  let promptTokens = 0;
  let completionTokens = 0;

  // 3-state filter that strips <think>...</think> before streaming to client.
  // fullText only accumulates post-thinking content so callers get clean JSON.
  type Phase = "waiting" | "thinking" | "streaming";
  let phase: Phase = "waiting";
  let pendingBuf = "";
  const THINK_START = "<think>";
  const THINK_END = "</think>";

  const sendChunk = async (text: string) => {
    if (!text) return;
    await writer.write(encoder.encode(`data: ${JSON.stringify({ t: "c", v: text })}\n\n`));
  };

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    sseBuffer += decoder.decode(value, { stream: true });
    const lines = sseBuffer.split("\n");
    sseBuffer = lines.pop() ?? "";

    for (const line of lines) {
      if (!line.startsWith("data: ")) continue;
      const raw = line.slice(6).trim();
      if (raw === "[DONE]") continue;

      try {
        const chunk = JSON.parse(raw);
        if (chunk.usage) {
          promptTokens = chunk.usage.prompt_tokens ?? promptTokens;
          completionTokens = chunk.usage.completion_tokens ?? completionTokens;
        }
        const token: string = chunk.choices?.[0]?.delta?.content ?? "";
        if (!token) continue;

        if (phase === "waiting") {
          pendingBuf += token;
          if (pendingBuf.startsWith(THINK_START)) {
            phase = "thinking";
            pendingBuf = pendingBuf.slice(THINK_START.length);
          } else if (!THINK_START.startsWith(pendingBuf)) {
            phase = "streaming";
            fullText += pendingBuf;
            await sendChunk(pendingBuf);
            pendingBuf = "";
          }
        } else if (phase === "thinking") {
          pendingBuf += token;
          const endIdx = pendingBuf.indexOf(THINK_END);
          if (endIdx !== -1) {
            phase = "streaming";
            const after = pendingBuf.slice(endIdx + THINK_END.length).trimStart();
            pendingBuf = "";
            if (after) { fullText += after; await sendChunk(after); }
          }
        } else {
          fullText += token;
          await sendChunk(token);
        }
      } catch { /* skip malformed SSE line */ }
    }
  }

  if (pendingBuf && phase === "waiting") {
    fullText += pendingBuf;
    await sendChunk(pendingBuf);
  }

  return { fullText, promptTokens, completionTokens };
}
