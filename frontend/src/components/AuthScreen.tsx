import { useState, type ReactNode } from "react";
import { Cloud, LockKeyhole, Mail, Smartphone } from "lucide-react";
import toast from "react-hot-toast";
import { useApp } from "../context/useApp";

type AuthMode = "signin" | "signup";

export default function AuthScreen() {
  const { signInWithEmail, signUpWithEmail, syncOnline } = useApp();
  const [mode, setMode] = useState<AuthMode>("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const submit = async () => {
    const normalizedEmail = email.trim();
    if (!normalizedEmail || !password) return;
    if (mode === "signup") {
      if (password.length < 8) {
        toast.error("Password must be at least 8 characters.");
        return;
      }
      if (password !== confirmPassword) {
        toast.error("Passwords do not match.");
        return;
      }
    }

    setSubmitting(true);
    try {
      if (mode === "signin") {
        await signInWithEmail(normalizedEmail, password);
        toast.success("Signed in successfully.");
      } else {
        const result = await signUpWithEmail(normalizedEmail, password);
        if (result.needsEmailConfirmation) {
          toast.success("Account created. Confirm your email once, then sign in with password.");
        } else {
          toast.success("Account created and signed in.");
        }
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Authentication failed");
    } finally {
      setSubmitting(false);
    }
  };

  const authDescription =
    mode === "signin"
      ? "Sign in with your email and password. After that, your session stays on this device."
      : "Create your personal sync account once, then sign in on each device and use passcode or biometric unlock daily.";

  return (
    <div
      className="fixed inset-0 overflow-y-scroll overscroll-contain bg-slate-950 text-slate-100"
      style={{ WebkitOverflowScrolling: "touch", touchAction: "pan-y" }}
    >
      <div className="mx-auto flex min-h-full max-w-6xl flex-col justify-start px-4 py-6 pb-16 sm:px-6 sm:py-10 lg:justify-center lg:px-10 lg:py-12">
        <div className="grid gap-8 lg:grid-cols-[1.1fr_0.9fr]">
          <section className="rounded-[2rem] border border-slate-800 bg-slate-900/80 p-5 shadow-2xl sm:p-8">
            <div className="inline-flex items-center gap-2 rounded-full border border-indigo-500/30 bg-indigo-500/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.2em] text-indigo-300">
              <Cloud size={14} />
              Live Sync Workspace
            </div>
            <h1 className="mt-5 max-w-xl text-3xl font-semibold tracking-tight sm:text-4xl lg:text-5xl">
              One workspace. Desktop and phone stay in sync.
            </h1>
            <p className="mt-4 max-w-2xl text-sm leading-7 text-slate-400 sm:text-base">
              Use one account across all your devices. After signing in once per device, your local passcode or biometric unlock can protect daily access.
            </p>

            <div className="mt-8 grid gap-4 sm:grid-cols-2">
              <InfoCard
                icon={<Smartphone size={16} className="text-cyan-300" />}
                title="Separate device lock"
                body="Email/password handles sync identity. Passcode and biometric unlock stay local to each device."
              />
              <InfoCard
                icon={<Cloud size={16} className="text-emerald-300" />}
                title="Realtime sync"
                body="Changes from another device appear without manual refresh whenever you are online."
              />
            </div>
          </section>

          <section className="rounded-[2rem] border border-slate-800 bg-slate-900/80 p-5 shadow-2xl sm:p-8">
            <div className="flex items-center gap-3">
              <div className="rounded-2xl bg-indigo-500/15 p-3 text-indigo-300">
                <LockKeyhole size={18} />
              </div>
              <div>
                <h2 className="text-xl font-semibold">
                  {mode === "signin" ? "Sign in" : "Create account"}
                </h2>
                <p className="text-sm text-slate-400">{authDescription}</p>
              </div>
            </div>

            <div className="mt-6 inline-flex rounded-2xl border border-slate-800 bg-slate-950/70 p-1">
              <button
                type="button"
                onClick={() => setMode("signin")}
                className={`rounded-xl px-4 py-2 text-sm font-medium transition ${
                  mode === "signin"
                    ? "bg-indigo-500 text-white"
                    : "text-slate-300 hover:bg-slate-900"
                }`}
              >
                Sign in
              </button>
              <button
                type="button"
                onClick={() => setMode("signup")}
                className={`rounded-xl px-4 py-2 text-sm font-medium transition ${
                  mode === "signup"
                    ? "bg-indigo-500 text-white"
                    : "text-slate-300 hover:bg-slate-900"
                }`}
              >
                Create account
              </button>
            </div>

            <div className="mt-6 space-y-4">
              <label className="block">
                <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
                  Email
                </span>
                <div className="relative">
                  <Mail
                    size={16}
                    className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-slate-500"
                  />
                  <input
                    type="email"
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                    placeholder="you@example.com"
                    className="w-full rounded-2xl border border-slate-700 bg-slate-950 py-4 pl-11 pr-4 text-sm text-slate-100 outline-none transition focus:border-indigo-400"
                  />
                </div>
              </label>

              <label className="block">
                <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
                  Password
                </span>
                <input
                  type="password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && mode === "signin") {
                      event.preventDefault();
                      void submit();
                    }
                  }}
                  placeholder={mode === "signin" ? "Enter your password" : "Choose a password"}
                  className="w-full rounded-2xl border border-slate-700 bg-slate-950 px-4 py-4 text-sm text-slate-100 outline-none transition focus:border-indigo-400"
                />
              </label>

              {mode === "signup" && (
                <label className="block">
                  <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
                    Confirm password
                  </span>
                  <input
                    type="password"
                    value={confirmPassword}
                    onChange={(event) => setConfirmPassword(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        event.preventDefault();
                        void submit();
                      }
                    }}
                    placeholder="Re-enter the password"
                    className="w-full rounded-2xl border border-slate-700 bg-slate-950 px-4 py-4 text-sm text-slate-100 outline-none transition focus:border-indigo-400"
                  />
                </label>
              )}

              <button
                type="button"
                onClick={() => void submit()}
                disabled={
                  submitting ||
                  !syncOnline ||
                  !email.trim() ||
                  !password ||
                  (mode === "signup" && !confirmPassword)
                }
                className="w-full rounded-2xl bg-indigo-500 px-4 py-4 text-sm font-semibold text-white transition hover:bg-indigo-400 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {submitting
                  ? mode === "signin"
                    ? "Signing in..."
                    : "Creating account..."
                  : mode === "signin"
                  ? "Sign in with password"
                  : "Create account"}
              </button>

              <div className="rounded-2xl border border-slate-800 bg-slate-950/70 px-4 py-3 text-sm text-slate-400">
                {syncOnline
                  ? mode === "signin"
                    ? "Once this device is signed in, you can rely on local passcode or biometric unlock for daily access."
                    : "If Supabase email confirmation is enabled, you may need to confirm once after creating the account."
                  : "You are offline. Go online once to sign in, then cached data stays available offline."}
              </div>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}

function InfoCard({
  icon,
  title,
  body,
}: {
  icon: ReactNode;
  title: string;
  body: string;
}) {
  return (
    <div className="rounded-3xl border border-slate-800 bg-slate-950/70 p-4">
      <div className="flex items-center gap-2 text-sm font-medium text-slate-200">
        {icon}
        {title}
      </div>
      <p className="mt-2 text-sm leading-6 text-slate-400">{body}</p>
    </div>
  );
}
