/**
 * Free Supabase projects pause after ~7 days with no DB activity.
 * We ping ~2 days before that (every 5 days) when the app is opened,
 * so normal use keeps the project awake. Settings shows last result.
 */

import { getSupabaseClient, isCloudConfigured } from "@/lib/supabase";

const STATUS_KEY = "dclean_cloud_keepalive_v1";

/** Free tier pause window (approx). */
export const PAUSE_AFTER_MS = 7 * 24 * 60 * 60 * 1000;
/** Ping this long before pause (~day 5). */
export const KEEP_ALIVE_EVERY_MS = 5 * 24 * 60 * 60 * 1000;

export type KeepAliveStatus = {
  lastOkAt: number | null;
  lastAttemptAt: number | null;
  lastError: string | null;
  lastOk: boolean;
  pingCount: number;
};

function emptyStatus(): KeepAliveStatus {
  return {
    lastOkAt: null,
    lastAttemptAt: null,
    lastError: null,
    lastOk: false,
    pingCount: 0,
  };
}

export function getKeepAliveStatus(): KeepAliveStatus {
  if (typeof window === "undefined") return emptyStatus();
  try {
    const raw = localStorage.getItem(STATUS_KEY);
    if (!raw) return emptyStatus();
    const parsed = JSON.parse(raw) as Partial<KeepAliveStatus>;
    return {
      lastOkAt: typeof parsed.lastOkAt === "number" ? parsed.lastOkAt : null,
      lastAttemptAt:
        typeof parsed.lastAttemptAt === "number" ? parsed.lastAttemptAt : null,
      lastError: parsed.lastError ? String(parsed.lastError) : null,
      lastOk: !!parsed.lastOk,
      pingCount: Number(parsed.pingCount) || 0,
    };
  } catch {
    return emptyStatus();
  }
}

function saveKeepAliveStatus(row: KeepAliveStatus) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(STATUS_KEY, JSON.stringify(row));
  } catch {
    /* ignore */
  }
}

export function msUntilNextKeepAlive(now = Date.now()): number {
  const s = getKeepAliveStatus();
  if (!s.lastOkAt) return 0;
  const due = s.lastOkAt + KEEP_ALIVE_EVERY_MS;
  return Math.max(0, due - now);
}

export function isKeepAliveDue(now = Date.now()): boolean {
  return msUntilNextKeepAlive(now) <= 0;
}

/**
 * Lightweight SELECT against app_state — counts as DB activity for Supabase.
 */
export async function pingCloudKeepAlive(opts?: {
  force?: boolean;
}): Promise<{
  ok: boolean;
  skipped: boolean;
  message: string;
  status: KeepAliveStatus;
}> {
  const force = opts?.force === true;
  const prev = getKeepAliveStatus();

  if (!(await isCloudConfigured())) {
    return {
      ok: false,
      skipped: true,
      message: "Cloud not connected — connect Project URL in Settings first.",
      status: prev,
    };
  }

  if (!force && !isKeepAliveDue()) {
    const hours = Math.ceil(msUntilNextKeepAlive() / (60 * 60 * 1000));
    return {
      ok: true,
      skipped: true,
      message: `Next auto-ping in about ${hours} hour(s). Cloud is already kept awake.`,
      status: prev,
    };
  }

  const supabase = await getSupabaseClient();
  if (!supabase) {
    const next = {
      ...prev,
      lastAttemptAt: Date.now(),
      lastOk: false,
      lastError: "Cloud client unavailable",
    };
    saveKeepAliveStatus(next);
    return {
      ok: false,
      skipped: false,
      message: "Cloud client unavailable.",
      status: next,
    };
  }

  const attemptedAt = Date.now();
  try {
    const { error } = await supabase
      .from("app_state")
      .select("id")
      .eq("id", "main")
      .maybeSingle();

    if (error) {
      const next: KeepAliveStatus = {
        ...prev,
        lastAttemptAt: attemptedAt,
        lastOk: false,
        lastError: error.message,
        pingCount: prev.pingCount,
      };
      saveKeepAliveStatus(next);
      return {
        ok: false,
        skipped: false,
        message: error.message,
        status: next,
      };
    }

    const next: KeepAliveStatus = {
      lastOkAt: attemptedAt,
      lastAttemptAt: attemptedAt,
      lastError: null,
      lastOk: true,
      pingCount: prev.pingCount + 1,
    };
    saveKeepAliveStatus(next);
    return {
      ok: true,
      skipped: false,
      message: "Cloud ping OK — free project stay-awake signal sent.",
      status: next,
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Ping failed.";
    const next: KeepAliveStatus = {
      ...prev,
      lastAttemptAt: attemptedAt,
      lastOk: false,
      lastError: msg,
    };
    saveKeepAliveStatus(next);
    return { ok: false, skipped: false, message: msg, status: next };
  }
}

/** Call on app open — pings only if the 5-day window is due. */
export async function maybeRunCloudKeepAlive(): Promise<void> {
  try {
    await pingCloudKeepAlive({ force: false });
  } catch {
    /* non-blocking */
  }
}
