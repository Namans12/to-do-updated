import { useState, type ReactNode } from "react";
import { Cloud, Mail, Smartphone } from "lucide-react";
import toast from "react-hot-toast";
import { useApp } from "../context/AppContext";

export default function AuthScreen() {
  const { sendMagicLinkEmail, syncOnline } = useApp();
  const [email, setEmail] = useState("");
  const [sending, setSending] = useState(false);

  const submit = async () => {
    const value = email.trim();
    if (!value) return;
    setSending(true);
    try {
      await sendMagicLinkEmail(value);
      toast.success("Magic link sent. Open it on this device to sign in.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to send magic link");
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <div className="mx-auto flex min-h-screen max-w-6xl flex-col justify-center px-6 py-12 lg:px-10">
        <div className="grid gap-8 lg:grid-cols-[1.1fr_0.9fr]">
          <section className="rounded-[2rem] border border-slate-800 bg-slate-900/80 p-8 shadow-2xl">
            <div className="inline-flex items-center gap-2 rounded-full border border-indigo-500/30 bg-indigo-500/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.2em] text-indigo-300">
              <Cloud size={14} />
              Live Sync PWA
            </div>
            <h1 className="mt-5 max-w-xl text-4xl font-semibold tracking-tight sm:text-5xl">
              One workspace. Desktop and phone stay in sync.
            </h1>
            <p className="mt-4 max-w-2xl text-sm leading-7 text-slate-400 sm:text-base">
              Sign in with your email magic link. This cloud workspace starts fresh and syncs
              automatically across devices, with offline reads and queued writes.
            </p>

            <div className="mt-8 grid gap-4 sm:grid-cols-2">
              <InfoCard
                icon={<Smartphone size={16} className="text-cyan-300" />}
                title="Installable PWA"
                body="Use the same app on PC and phone. Install it from the browser when prompted."
              />
              <InfoCard
                icon={<Cloud size={16} className="text-emerald-300" />}
                title="Realtime sync"
                body="Changes from another device appear without manual refresh whenever you are online."
              />
            </div>
          </section>

          <section className="rounded-[2rem] border border-slate-800 bg-slate-900/80 p-8 shadow-2xl">
            <div className="flex items-center gap-3">
              <div className="rounded-2xl bg-indigo-500/15 p-3 text-indigo-300">
                <Mail size={18} />
              </div>
              <div>
                <h2 className="text-xl font-semibold">Sign in</h2>
                <p className="text-sm text-slate-400">Magic link only. No password flow in v1.</p>
              </div>
            </div>

            <div className="mt-6 space-y-4">
              <label className="block">
                <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
                  Email
                </span>
                <input
                  type="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      void submit();
                    }
                  }}
                  placeholder="you@example.com"
                  className="w-full rounded-2xl border border-slate-700 bg-slate-950 px-4 py-4 text-sm text-slate-100 outline-none transition focus:border-indigo-400"
                />
              </label>

              <button
                type="button"
                onClick={() => void submit()}
                disabled={sending || !syncOnline}
                className="w-full rounded-2xl bg-indigo-500 px-4 py-4 text-sm font-semibold text-white transition hover:bg-indigo-400 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {sending ? "Sending link..." : "Send magic link"}
              </button>

              <div className="rounded-2xl border border-slate-800 bg-slate-950/70 px-4 py-3 text-sm text-slate-400">
                {syncOnline
                  ? "After opening the link, the session restores automatically on future visits."
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
