import type { AuthChangeEvent, Session } from "@supabase/supabase-js";
import { supabase } from "./supabase";

export async function getSyncSession() {
  if (!supabase) return null;
  const { data, error } = await supabase.auth.getSession();
  if (error) throw error;
  return data.session;
}

export async function sendMagicLink(email: string) {
  if (!supabase) throw new Error("Supabase sync is not configured.");
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: {
      emailRedirectTo: window.location.origin,
    },
  });
  if (error) throw error;
}

export async function signOutSync() {
  if (!supabase) return;
  const { error } = await supabase.auth.signOut();
  if (error) throw error;
}

export function onSyncAuthStateChange(
  callback: (event: AuthChangeEvent, session: Session | null) => void
) {
  if (!supabase) {
    return {
      unsubscribe() {},
    };
  }
  const {
    data: { subscription },
  } = supabase.auth.onAuthStateChange(callback);
  return subscription;
}
