import { requireEnv, optionalNumber } from './env.ts';
import { appliesTo, type CompiledDimension, type CompiledFramework } from './framework.ts';

// Jev-1.13 via defapi.org — POST /api/v1/decisions (verified against
// https://defapi.org/api/model/en/typesafe/jev-1.13 on 2026-09-23).
// One request = one `state` + many typed questions keyed by dimension key.

const ENDPOINT = 'https://api.defapi.org/api/v1/decisions';

type Question =
  | { type: 'score'; instructions: string; criteria: string[] }
  | { type: 'noul'; instructions: string; criteria: Record<string, string> }
  | { type: 'choice'; instructions: string; criteria: Record<string, string> };

export type Answer =
  | { type: 'noul'; noul: number }
  | { type: 'choice'; choice: string; probabilities: Record<string, number>; confidence?: number }
  | { type: 'score'; score: number; probabilities: Record<string, number>; confidence?: number; legend?: Record<string, string> };

export interface JevResponse {
  model: string;                 // concrete version, e.g. typesafe/jev-1.13-20260917
  answers: Record<string, Answer>;
  usage: { input_tokens: number; output_tokens: number; cost?: number };
  task_id: string;
  consumed: string;              // billed USD
}

export class JevError extends Error {
  readonly status: number;
  readonly retryable: boolean;
  constructor(message: string, status: number, retryable: boolean) {
    super(message);
    this.status = status;
    this.retryable = retryable;
  }
}

export function buildQuestions(dims: CompiledDimension[]): Record<string, Question> {
  const q: Record<string, Question> = {};
  for (const d of dims) q[d.key] = { type: d.type, instructions: d.instructions, criteria: d.criteria } as Question;
  return q;
}

export function questionsFor(fw: CompiledFramework, isTv: boolean): CompiledDimension[] {
  return fw.dimensions.filter((d) => appliesTo(d, isTv));
}

export async function askJev(state: string, questions: Record<string, Question>, sessionId?: string): Promise<JevResponse> {
  let res: Response;
  try {
    res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${requireEnv('DEFAPI_API_KEY')}` },
      body: JSON.stringify({
        model: process.env.JEV_MODEL?.trim() || 'typesafe/jev-1.13',
        state,
        questions,
        ...(sessionId ? { session_id: sessionId } : {}),
      }),
      signal: AbortSignal.timeout(optionalNumber('JEV_TIMEOUT_MS', 120_000)),
    });
  } catch (e) {
    throw new JevError(`network: ${(e as Error).message}`, 0, true);
  }
  if (!res.ok) {
    const body = (await res.text().catch(() => '')).slice(0, 300);
    // 400/401 are our fault (schema/key) — retrying won't help.
    throw new JevError(`HTTP ${res.status}: ${body}`, res.status, res.status === 429 || res.status >= 500);
  }
  return (await res.json()) as JevResponse;
}

const pct = (x: number) => Math.max(0, Math.min(100, Math.round(x * 100)));

/**
 * Map answers onto the framework's slot layout.
 * vals: score → expected level scaled 0–100 (from the probability
 * distribution, so it doesn't depend on Jev's own score scale); noul → P(true);
 * choice → P(option) per option slot. conf: Jev confidence for score/choice,
 * |2p−1| for noul; null for dimensions that don't apply (e.g. TV-only on films).
 */
export function toProfile(fw: CompiledFramework, answers: Record<string, Answer>, isTv: boolean) {
  const vals: (number | null)[] = new Array(fw.slotCount).fill(null);
  const conf: (number | null)[] = new Array(fw.dimensions.length).fill(null);
  const missing: string[] = [];

  for (const d of fw.dimensions) {
    if (!appliesTo(d, isTv)) continue;
    const a = answers[d.key];
    if (!a) { missing.push(d.key); continue; }
    const at = d.slotStart - 1;
    if (d.type === 'score' && a.type === 'score') {
      const levels = (d.criteria as string[]).length;
      const probs = levelProbabilities(a.probabilities, d.criteria as string[], a.legend);
      const expected = probs.reduce((s, p, i) => s + p * i, 0) / (levels - 1);
      vals[at] = pct(expected);
      conf[d.ordinal - 1] = a.confidence != null ? pct(a.confidence) : null;
    } else if (d.type === 'noul' && a.type === 'noul') {
      vals[at] = pct(a.noul);
      conf[d.ordinal - 1] = pct(Math.abs(2 * a.noul - 1));
    } else if (d.type === 'choice' && a.type === 'choice') {
      d.options.forEach((opt, i) => { vals[at + i] = pct(a.probabilities?.[opt] ?? (a.choice === opt ? 1 : 0)); });
      conf[d.ordinal - 1] = a.confidence != null ? pct(a.confidence) : null;
    } else {
      missing.push(`${d.key}(type ${a.type})`);
    }
  }
  return { vals, conf, missing };
}

/**
 * The docs don't pin down how score `probabilities` are keyed, so accept level
 * indices (0- or 1-based), level descriptions, or legend keys. Throws if none
 * match rather than silently storing zeros.
 */
function levelProbabilities(p: Record<string, number>, criteria: string[], legend?: Record<string, string>): number[] {
  const levels = criteria.length;
  const out = new Array(levels).fill(0);
  const keys = Object.keys(p ?? {});
  const oneBased = !keys.includes('0') && keys.includes(String(levels));
  for (const [k, prob] of Object.entries(p ?? {})) {
    let i = /^\d+$/.test(k) ? Number(k) - (oneBased ? 1 : 0) : criteria.indexOf(k);
    if (i < 0 && legend) {
      const viaLegend = Object.entries(legend).find(([lk, desc]) => lk === k || desc === k)?.[0];
      if (viaLegend != null && /^\d+$/.test(viaLegend)) i = Number(viaLegend) - (oneBased ? 1 : 0);
    }
    if (i >= 0 && i < levels) out[i] += prob;
  }
  const total = out.reduce((a, b) => a + b, 0);
  if (!total) throw new Error(`unrecognised score probability keys: ${keys.slice(0, 5).join(', ')}`);
  return out.map((x) => x / total);
}
