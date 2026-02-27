import { useEffect, useRef } from "react";
import { AlertTriangle, Bell, Flag } from "lucide-react";

interface ReminderAlarmModalProps {
  open: boolean;
  title: string;
  groupName: string;
  reminderAt: string;
  highPriority: boolean;
  onStop: () => void | Promise<void>;
}

function playAlarmTick(ctx: AudioContext) {
  const oscillator = ctx.createOscillator();
  const gain = ctx.createGain();
  oscillator.type = "square";
  oscillator.frequency.value = 880;
  gain.gain.value = 0.001;
  oscillator.connect(gain);
  gain.connect(ctx.destination);
  oscillator.start();
  gain.gain.exponentialRampToValueAtTime(0.22, ctx.currentTime + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.35);
  oscillator.stop(ctx.currentTime + 0.35);
}

export default function ReminderAlarmModal({
  open,
  title,
  groupName,
  reminderAt,
  highPriority,
  onStop,
}: ReminderAlarmModalProps) {
  const audioCtxRef = useRef<AudioContext | null>(null);
  const loopRef = useRef<number | null>(null);

  useEffect(() => {
    if (!open) return;

    const AudioCtx =
      window.AudioContext ||
      (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    audioCtxRef.current = ctx;

    const ring = () => {
      if (ctx.state === "suspended") {
        void ctx.resume().catch(() => undefined);
      }
      playAlarmTick(ctx);
      setTimeout(() => playAlarmTick(ctx), 220);
    };

    ring();
    loopRef.current = window.setInterval(ring, 1400);

    return () => {
      if (loopRef.current) {
        window.clearInterval(loopRef.current);
        loopRef.current = null;
      }
      if (audioCtxRef.current) {
        void audioCtxRef.current.close().catch(() => undefined);
        audioCtxRef.current = null;
      }
    };
  }, [open]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/50 px-4">
      <div className="w-full max-w-md rounded-2xl border border-amber-400/60 bg-amber-50 dark:bg-slate-900 shadow-2xl overflow-hidden">
        <div className="px-5 py-4 bg-gradient-to-r from-amber-200 to-yellow-200 dark:from-amber-500/20 dark:to-yellow-500/20 border-b border-amber-300/70 dark:border-amber-400/30">
          <div className="flex items-center gap-2 text-amber-900 dark:text-amber-300">
            <AlertTriangle size={18} />
            <p className="text-sm font-semibold">
              {highPriority ? "High Priority Reminder" : "Reminder Alarm"}
            </p>
          </div>
        </div>
        <div className="px-5 py-4 space-y-2">
          <p className="text-base font-semibold text-slate-900 dark:text-slate-100">{title}</p>
          <p className="text-xs text-slate-600 dark:text-slate-400">Group: {groupName}</p>
          <p className="text-xs text-slate-600 dark:text-slate-400">
            Due: {new Date(reminderAt).toLocaleString()}
          </p>
          <div className="flex items-center gap-2 pt-1">
            {highPriority ? (
              <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-[11px] font-semibold bg-amber-500/20 text-amber-800 dark:text-amber-300">
                <Flag size={12} />
                Urgent
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-[11px] font-semibold bg-indigo-500/10 text-indigo-700 dark:text-indigo-300">
                <Bell size={12} />
                Reminder Active
              </span>
            )}
          </div>
        </div>
        <div className="px-5 py-4 border-t border-slate-200 dark:border-slate-800 flex justify-end">
          <button onClick={onStop} className="btn-danger !py-2 !px-4">
            Stop
          </button>
        </div>
      </div>
    </div>
  );
}
