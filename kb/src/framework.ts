import { createHash } from 'node:crypto';
import { FRAMEWORK_V1, type Dimension, type Framework } from '../framework/v1.ts';
import { FRAMEWORK_V1_1, NAME_ONLY_KEYS as NAME_ONLY_V1_1 } from '../framework/v1_1.ts';

// All known framework versions. Add new versions here; never edit old ones.
// nameOnly: the subset asked with title/year/type only, for the familiarity score.
const FRAMEWORKS: Record<string, { fw: Framework; nameOnly: string[] }> = {
  '1.0': { fw: FRAMEWORK_V1, nameOnly: [] },
  '1.1': { fw: FRAMEWORK_V1_1, nameOnly: NAME_ONLY_V1_1 },
};
export const LATEST_FRAMEWORK = '1.1';

export interface CompiledDimension extends Dimension {
  ordinal: number;   // 1-based position in conf[]
  slotStart: number; // 1-based position in vals[]
  slotCount: number;
  options: string[]; // choice option keys (in slot order); [] otherwise
}

export interface CompiledFramework {
  version: string;
  notes: string;
  hash: string;
  dimensions: CompiledDimension[];
  slotCount: number;
  /** Dimensions used for the name-only familiarity probe (empty for v1.0). */
  nameOnly: CompiledDimension[];
}

export function getFramework(version = LATEST_FRAMEWORK): CompiledFramework {
  const entry = FRAMEWORKS[version];
  if (!entry) throw new Error(`Unknown framework version ${version}. Known: ${Object.keys(FRAMEWORKS).join(', ')}`);

  const fw = entry.fw;
  const keys = new Set<string>();
  let slot = 1;
  const dimensions = fw.dimensions.map((d, i): CompiledDimension => {
    if (keys.has(d.key)) throw new Error(`Duplicate dimension key ${d.key}`);
    keys.add(d.key);
    const options = d.type === 'choice' ? Object.keys(d.criteria as Record<string, string>) : [];
    if (d.type === 'score' && (!Array.isArray(d.criteria) || d.criteria.length < 2 || d.criteria.length > 10)) {
      throw new Error(`${d.key}: score needs 2–10 levels`);
    }
    const slotCount = d.type === 'choice' ? options.length : 1;
    const compiled = { ...d, ordinal: i + 1, slotStart: slot, slotCount, options };
    slot += slotCount;
    return compiled;
  });

  // v1.0's hash covers only its dimensions (as synced); later versions also hash the probe subset.
  const hash = createHash('sha256').update(JSON.stringify(entry.nameOnly.length ? { fw, nameOnly: entry.nameOnly } : fw)).digest('hex');
  const nameOnly = entry.nameOnly.map((k) => {
    const d = dimensions.find((x) => x.key === k);
    if (!d || d.type !== 'score') throw new Error(`name-only key ${k} must be a score dimension`);
    return d;
  });
  return { version: fw.version, notes: fw.notes, hash, dimensions, slotCount: slot - 1, nameOnly };
}

export const appliesTo = (d: Dimension, isTv: boolean) =>
  d.appliesTo === 'all' || (d.appliesTo === 'tv') === isTv;
