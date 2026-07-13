import { createClient } from "@supabase/supabase-js";

export class AuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AuthError";
  }
}

export async function validateAuth(
  authHeader: string | null,
  supabaseUrl: string,
  supabaseAnonKey: string,
): Promise<{ id: string; email?: string }> {
  if (!authHeader?.startsWith("Bearer ")) {
    throw new AuthError("Missing or invalid Authorization header");
  }
  const client = createClient(supabaseUrl, supabaseAnonKey, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: { user }, error } = await client.auth.getUser();
  if (error || !user) throw new AuthError("Invalid or expired token");
  return user;
}
