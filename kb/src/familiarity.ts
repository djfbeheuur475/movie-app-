import type { CompiledDimension } from './framework.ts';

// Familiarity = does Jev's prior (name-only) view of a title agree with its
// evidence-based profile? An operational trust signal, not ground truth.
//
// Deliberately NOT Jev's confidence: the v1.0 probe showed Jev is confidently
// wrong when a title's words suggest a genre ("Sunny Days at Pemberton Bay"
// → cosy, conf 71). Agreement catches that; confidence doesn't.

// Mean absolute gap (0–100 scale, probe dims) at which agreement reaches 0.
// Calibrated on v1.0 profiles: unrelated title pairs median 30, closest 5% ≈ 14;
// a title's own name-only vs full profile 3.5–7.5; re-running identical input 0.6.
export const AGREEMENT_ZERO_AT = 25;

export interface Familiarity {
  familiarity: number;
  agreement: number;
  name_conf: number;
  full_conf: number;
}

const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

export function scoreFamiliarity(
  probeDims: CompiledDimension[],
  fullVals: (number | null)[],
  fullConf: (number | null)[],
  nameVals: (number | null)[],
  nameConf: (number | null)[],
): Familiarity {
  const gaps = probeDims
    .map((d) => [fullVals[d.slotStart - 1], nameVals[d.slotStart - 1]])
    .filter((p): p is [number, number] => p[0] != null && p[1] != null)
    .map(([a, b]) => Math.abs(a - b));
  const agreement = Math.max(0, 1 - avg(gaps) / AGREEMENT_ZERO_AT) * 100;
  const name_conf = avg(probeDims.map((d) => nameConf[d.ordinal - 1]).filter((x): x is number => x != null));
  const full_conf = avg(fullConf.filter((x): x is number => x != null));
  // Primarily agreement; damped (never boosted) when Jev admits it doesn't know.
  const familiarity = agreement * (0.7 + 0.3 * (name_conf / 100));
  return { familiarity: Math.round(familiarity), agreement: Math.round(agreement), name_conf: Math.round(name_conf), full_conf: Math.round(full_conf) };
}
