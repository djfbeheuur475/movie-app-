import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { requireEnv } from './env.ts';

let client: SupabaseClient | null = null;

export function db(): SupabaseClient {
  client ??= createClient(requireEnv('SUPABASE_URL'), requireEnv('SUPABASE_SERVICE_ROLE_KEY'), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return client;
}

/** Throws on error. Callers only read `data` when the query returns rows. */
export function must<T>(res: { data: T; error: { message: string } | null }, what: string): NonNullable<T> {
  if (res.error) throw new Error(`${what}: ${res.error.message}`);
  return res.data as NonNullable<T>;
}

/** PostgREST caps responses at 1000 rows; page through. */
export async function selectAll<T>(build: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>, what: string): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += 1000) {
    const page = must(await build(from, from + 999), what) ?? [];
    out.push(...page);
    if (page.length < 1000) return out;
  }
}
