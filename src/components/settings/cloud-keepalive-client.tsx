"use client";

import { useCallback, useEffect, useState } from "react";
import { Activity, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  getKeepAliveStatus,
  KEEP_ALIVE_EVERY_MS,
  msUntilNextKeepAlive,
  PAUSE_AFTER_MS,
  pingCloudKeepAlive,
  type KeepAliveStatus,
} from "@/lib/cloud-keepalive";

function fmtWhen(ts: number | null) {
  if (!ts) return "Never";
  try {
    return new Date(ts).toLocaleString();
  } catch {
    return "—";
  }
}

function fmtDuration(ms: number) {
  const days = Math.floor(ms / (24 * 60 * 60 * 1000));
  const hours = Math.floor((ms % (24 * 60 * 60 * 1000)) / (60 * 60 * 1000));
  if (days <= 0) return `${hours} hour(s)`;
  if (hours <= 0) return `${days} day(s)`;
  return `${days} day(s) ${hours} hour(s)`;
}

export function CloudKeepAliveClient() {
  const [status, setStatus] = useState<KeepAliveStatus>(getKeepAliveStatus);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  const refresh = useCallback(() => {
    setStatus(getKeepAliveStatus());
    setNow(Date.now());
  }, []);

  useEffect(() => {
    refresh();
    const t = window.setInterval(refresh, 30_000);
    return () => window.clearInterval(t);
  }, [refresh]);

  const ping = async (force: boolean) => {
    setBusy(true);
    setMessage(null);
    const result = await pingCloudKeepAlive({ force });
    setStatus(result.status);
    setMessage(result.message);
    setNow(Date.now());
    setBusy(false);
  };

  const untilNext = msUntilNextKeepAlive(now);
  const due = untilNext <= 0;
  const pauseIn = status.lastOkAt
    ? Math.max(0, status.lastOkAt + PAUSE_AFTER_MS - now)
    : null;

  return (
    <div className="rounded-xl border bg-white p-5 shadow-sm space-y-4">
      <div className="flex items-start gap-3">
        <Activity className="h-5 w-5 text-teal-700 mt-0.5 shrink-0" />
        <div>
          <h2 className="text-xl font-bold text-slate-800">
            Cloud stay-awake
          </h2>
          <p className="text-sm text-slate-500 mt-1">
            Free Supabase can pause after about{" "}
            {fmtDuration(PAUSE_AFTER_MS)} with no database use. This app sends
            a small automatic DB request every{" "}
            {fmtDuration(KEEP_ALIVE_EVERY_MS)} when you open it (~2 days before
            that pause), so the project stays awake.
          </p>
        </div>
      </div>

      <div className="rounded-lg border border-slate-200 bg-slate-50/80 p-3 space-y-2 text-sm">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-medium text-slate-800">Status:</span>
          {status.lastOkAt && status.lastOk ? (
            <span className="rounded bg-emerald-100 px-2 py-0.5 text-emerald-800 text-xs font-semibold">
              Working
            </span>
          ) : status.lastAttemptAt && !status.lastOk ? (
            <span className="rounded bg-amber-100 px-2 py-0.5 text-amber-900 text-xs font-semibold">
              Last ping failed
            </span>
          ) : (
            <span className="rounded bg-slate-200 px-2 py-0.5 text-slate-700 text-xs font-semibold">
              Not pinged yet
            </span>
          )}
          {due ? (
            <span className="rounded bg-teal-100 px-2 py-0.5 text-teal-900 text-xs font-semibold">
              Auto-ping due on next open
            </span>
          ) : null}
        </div>
        <p className="text-slate-600">
          Last successful ping:{" "}
          <span className="font-medium text-slate-800">
            {fmtWhen(status.lastOkAt)}
          </span>
        </p>
        <p className="text-slate-600">
          Last attempt:{" "}
          <span className="font-medium text-slate-800">
            {fmtWhen(status.lastAttemptAt)}
          </span>
          {status.lastError ? (
            <span className="text-amber-800"> — {status.lastError}</span>
          ) : null}
        </p>
        <p className="text-slate-600">
          Successful pings:{" "}
          <span className="font-medium text-slate-800">{status.pingCount}</span>
        </p>
        <p className="text-slate-600">
          Next auto-ping:{" "}
          <span className="font-medium text-slate-800">
            {status.lastOkAt
              ? due
                ? "Now (when app opens)"
                : `in ${fmtDuration(untilNext)}`
              : "On next app open"}
          </span>
        </p>
        {pauseIn != null ? (
          <p className="text-slate-600">
            Approx. free-tier pause if no more activity:{" "}
            <span className="font-medium text-slate-800">
              {pauseIn === 0 ? "May pause soon — tap Ping now" : `in ${fmtDuration(pauseIn)}`}
            </span>
          </p>
        ) : null}
      </div>

      {message ? (
        <p
          className={
            /fail|error|not connected|unavailable/i.test(message)
              ? "text-sm text-amber-800 font-medium"
              : "text-sm text-teal-700 font-medium"
          }
        >
          {message}
        </p>
      ) : null}

      <Button
        type="button"
        variant="outline"
        className="gap-2"
        disabled={busy}
        onClick={() => void ping(true)}
      >
        <RefreshCw className={`h-4 w-4 ${busy ? "animate-spin" : ""}`} />
        {busy ? "Pinging…" : "Ping cloud now"}
      </Button>
      <p className="text-xs text-slate-500">
        Open the app at least every few days (or tap Ping cloud now) so the
        free database does not sleep. Data is not deleted when paused — waking
        the project in Supabase brings it back.
      </p>
    </div>
  );
}
