import type { AuthChangeEvent, Session } from "@supabase/supabase-js";
import { Capacitor } from "@capacitor/core";
import { syncDebugEnabled } from "./config";
import { supabase } from "./supabase";

const NATIVE_AUTH_REDIRECT_URL = "com.namans.todo://auth/callback";
const EMAIL_OTP_TYPES = new Set([
  "signup",
  "invite",
  "magiclink",
  "recovery",
  "email_change",
  "email",
] as const);
let sessionPromise: Promise<Session | null> | null = null;
let redirectPromise: Promise<boolean> | null = null;

function debugAuthLog(...args: unknown[]) {
  if (!syncDebugEnabled) return;
  console.info("[nodes-sync][auth]", ...args);
}

function isNativeShell() {
  return Capacitor.isNativePlatform() || isTauriDesktopShell();
}

function isTauriDesktopShell() {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

function getNativeAuthParams(url: string) {
  const parsed = new URL(url);
  const wrappedUrl = parsed.hostname.includes("google.") ? parsed.searchParams.get("q") : null;
  if (wrappedUrl) {
    return getNativeAuthParams(wrappedUrl);
  }
  const hash = parsed.hash.startsWith("#") ? parsed.hash.slice(1) : parsed.hash;
  const hashParams = new URLSearchParams(hash);
  return {
    code: parsed.searchParams.get("code"),
    token: parsed.searchParams.get("token"),
    tokenHash: parsed.searchParams.get("token_hash") ?? hashParams.get("token_hash"),
    type: parsed.searchParams.get("type") ?? hashParams.get("type"),
  };
}

export function normalizeAuthRedirectUrl(url: string): string {
  const parsed = new URL(url);
  const wrappedUrl = parsed.hostname.includes("google.") ? parsed.searchParams.get("q") : null;
  return wrappedUrl ? normalizeAuthRedirectUrl(wrappedUrl) : parsed.toString();
}

export function isSupabaseVerifyLink(url: string) {
  const normalized = normalizeAuthRedirectUrl(url);
  const parsed = new URL(normalized);
  return (
    parsed.hostname.endsWith(".supabase.co") &&
    parsed.pathname.includes("/auth/v1/verify") &&
    parsed.searchParams.has("token")
  );
}

export function getAuthRedirectUrl() {
  return isNativeShell() ? NATIVE_AUTH_REDIRECT_URL : window.location.origin;
}

export async function getSyncSession() {
  if (!supabase) return null;
  if (sessionPromise) return sessionPromise;
  sessionPromise = (async () => {
    debugAuthLog("getSession:start");
    const { data, error } = await supabase.auth.getSession();
    if (error) throw error;
    debugAuthLog("getSession:done", { hasSession: !!data.session });
    return data.session;
  })().finally(() => {
    sessionPromise = null;
  });
  return sessionPromise;
}

export async function sendMagicLink(email: string) {
  if (!supabase) throw new Error("Supabase sync is not configured.");
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: {
      emailRedirectTo: getAuthRedirectUrl(),
    },
  });
  if (error) throw error;
}

export async function signInWithEmailPassword(email: string, password: string) {
  if (!supabase) throw new Error("Supabase sync is not configured.");
  const { error } = await supabase.auth.signInWithPassword({
    email,
    password,
  });
  if (error) throw error;
}

export async function signUpWithEmailPassword(email: string, password: string) {
  if (!supabase) throw new Error("Supabase sync is not configured.");
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      emailRedirectTo: getAuthRedirectUrl(),
    },
  });
  if (error) throw error;
  return data;
}

function mapEmailOtpType(type: string | null) {
  if (!type) return null;
  if (type === "magiclink" || type === "signup") return "email";
  if (EMAIL_OTP_TYPES.has(type as (typeof EMAIL_OTP_TYPES extends Set<infer T> ? T : never))) {
    return type as "invite" | "recovery" | "email_change" | "email";
  }
  return null;
}

export async function handleAuthRedirect(url: string) {
  if (!supabase || !isNativeShell()) return false;
  if (redirectPromise) return redirectPromise;
  redirectPromise = (async () => {
    const { code, token, tokenHash, type } = getNativeAuthParams(url);
    debugAuthLog("handleAuthRedirect:start", { hasCode: !!code, hasTokenHash: !!tokenHash, type });

    if (code) {
      const { error } = await supabase.auth.exchangeCodeForSession(code);
      if (error) throw error;
      return true;
    }

    const mappedType = mapEmailOtpType(type);

    if (tokenHash && mappedType) {
      const { error } = await supabase.auth.verifyOtp({
        token_hash: tokenHash,
        type: mappedType,
      });
      if (error) throw error;
      return true;
    }

    if (token && mappedType) return false;

    return false;
  })().finally(() => {
    redirectPromise = null;
  });
  return redirectPromise;
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
