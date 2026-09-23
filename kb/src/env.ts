// Every secret comes from the environment (kb/.env, gitignored). Fail fast and
// name the variable, never echo its value.
export function requireEnv(name: string): string {
  const v = process.env[name]?.trim();
  if (!v) throw new Error(`Missing environment variable ${name} (see kb/.env.example)`);
  return v;
}

export const optionalNumber = (name: string, fallback: number): number => {
  const n = Number(process.env[name]);
  return Number.isFinite(n) && n > 0 ? n : fallback;
};
