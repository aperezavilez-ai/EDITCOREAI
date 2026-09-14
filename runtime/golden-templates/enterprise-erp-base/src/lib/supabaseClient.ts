import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL || import.meta.env.VITE_GAFCORE_URL || "";
const key = import.meta.env.VITE_SUPABASE_ANON_KEY || import.meta.env.VITE_GAFCORE_ANON_KEY || "";

export type ApiResult<T> = { data: T | null; error: string | null };

class ApiErrorBoundary {
  static wrap<T>(error: unknown): ApiResult<T> {
    const message = error instanceof Error ? error.message : String(error || "Unknown API error");
    return { data: null, error: message };
  }
}

let client: SupabaseClient | null = null;

export function getSupabase(): SupabaseClient {
  if (!url || !key) {
    throw new Error("Missing VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY (or Gafcore equivalents).");
  }
  if (!client) client = createClient(url, key, { auth: { persistSession: true } });
  return client;
}

export async function apiQuery<T>(runner: (db: SupabaseClient) => PromiseLike<{ data: T; error: { message: string } | null }>): Promise<ApiResult<T>> {
  try {
    const db = getSupabase();
    const { data, error } = await runner(db);
    if (error) return { data: null, error: error.message };
    return { data, error: null };
  } catch (error) {
    return ApiErrorBoundary.wrap<T>(error);
  }
}
