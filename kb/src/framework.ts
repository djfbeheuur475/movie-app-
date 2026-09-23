import { createHash } from 'node:crypto';
import { FRAMEWORK_V1, type Dimension, type Framework } from '../framework/v1.ts';

// All known framework versions. Add new versions here; never edit old ones.
const FRAMEWORKS: Record<string, Framework> = { '1.0': FRAMEWORK_V1 };
export const LATEST_FRAMEWORK = '1.0';

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
}

export function getFramework(version = LATEST_FRAMEWORK): CompiledFramework {
  const fw = FRAMEWORKS[version];
  if (!fw) throw new Error(`Unknown framework version ${version}. Known: ${Object.keys(FRAMEWORKS).join(', ')}`);

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

  const hash = createHash('sha256').update(JSON.stringify(fw)).digest('hex');
  return { version: fw.version, notes: fw.notes, hash, dimensions, slotCount: slot - 1 };
}

export const appliesTo = (d: Dimension, isTv: boolean) =>
  d.appliesTo === 'all' || (d.appliesTo === 'tv') === isTv;
