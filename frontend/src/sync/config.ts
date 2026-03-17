export const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL?.trim() ?? "";
export const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY?.trim() ?? "";

export const isSupabaseSyncEnabled =
  SUPABASE_URL.length > 0 && SUPABASE_ANON_KEY.length > 0;

export const syncDebugEnabled =
  import.meta.env.DEV || import.meta.env.VITE_DEBUG_SYNC === "true";

export const isBrowserOnline = () =>
  typeof navigator === "undefined" ? true : navigator.onLine;
