import { useEffect, useRef, useState } from "react";
import { Fingerprint, LockKeyhole } from "lucide-react";
import toast from "react-hot-toast";
import { useApp } from "../context/useApp";

export default function PasscodeLockScreen() {
  const { unlockWithPasscode, unlockWithDeviceAuth, deviceAuthAvailable, deviceAuthConfigured } =
    useApp();
  const [passcode, setPasscode] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [deviceAuthBusy, setDeviceAuthBusy] = useState(false);
  const attemptedAutoUnlockRef = useRef(false);

  const submit = async () => {
    if (passcode.length < 4) return;
    setSubmitting(true);
    try {
      const ok = await unlockWithPasscode(passcode);
      if (!ok) {
        toast.error("Incorrect passcode");
        setPasscode("");
      }
    } finally {
      setSubmitting(false);
    }
  };

  const submitDeviceAuth = async () => {
    setDeviceAuthBusy(true);
    try {
      const ok = await unlockWithDeviceAuth();
      if (!ok) {
        toast.error("Device authentication failed");
      }
    } finally {
      setDeviceAuthBusy(false);
    }
  };

  useEffect(() => {
    if (!deviceAuthAvailable || !deviceAuthConfigured) return;
    if (attemptedAutoUnlockRef.current) return;
    attemptedAutoUnlockRef.current = true;
    void submitDeviceAuth();
  }, [deviceAuthAvailable, deviceAuthConfigured]);

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <div className="mx-auto flex min-h-screen max-w-xl items-center justify-center px-6">
        <div className="w-full rounded-[2rem] border border-slate-800 bg-slate-900/85 p-8 shadow-2xl">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-indigo-500/15 text-indigo-300">
            <LockKeyhole size={22} />
          </div>
          <h1 className="mt-5 text-center text-3xl font-semibold tracking-tight">Unlock Nodes</h1>
          <p className="mt-2 text-center text-sm text-slate-400">
            {deviceAuthAvailable && deviceAuthConfigured
              ? "Use your device authentication or enter your passcode to open the app."
              : "Enter your device passcode to open the app."}
          </p>

          <div className="mt-8 space-y-4">
            {deviceAuthAvailable && deviceAuthConfigured && (
              <button
                type="button"
                onClick={() => void submitDeviceAuth()}
                disabled={deviceAuthBusy}
                className="w-full rounded-2xl border border-slate-700 bg-slate-950 px-4 py-4 text-sm font-semibold text-slate-100 transition hover:border-indigo-400 hover:bg-slate-900 disabled:cursor-not-allowed disabled:opacity-60"
              >
                <span className="inline-flex items-center gap-2">
                  <Fingerprint size={18} />
                  {deviceAuthBusy ? "Waiting for device unlock..." : "Use device unlock"}
                </span>
              </button>
            )}
            <input
              type="password"
              inputMode="numeric"
              autoFocus
              value={passcode}
              onChange={(event) => setPasscode(event.target.value.replace(/\D/g, "").slice(0, 12))}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  void submit();
                }
              }}
              placeholder="Enter passcode"
              className="w-full rounded-2xl border border-slate-700 bg-slate-950 px-4 py-4 text-center text-lg tracking-[0.35em] text-slate-100 outline-none transition focus:border-indigo-400"
            />
            <button
              type="button"
              onClick={() => void submit()}
              disabled={submitting || passcode.length < 4}
              className="w-full rounded-2xl bg-indigo-500 px-4 py-4 text-sm font-semibold text-white transition hover:bg-indigo-400 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {submitting ? "Unlocking..." : "Unlock"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
