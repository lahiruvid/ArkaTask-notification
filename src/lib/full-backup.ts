/**
 * Full disaster-recovery backups in Supabase (`app_full_backups`).
 * Stores the entire AppData JSON (no FormSubmit size limit).
 * Live data stays in `app_state`; these rows are safe copies to restore later.
 */
import type { AppData } from "@/types/database";
import { getSupabaseClient } from "@/lib/supabase";
import {
  leanAppData,
  readStoreSnapshot,
  restoreAppData,
} from "@/lib/store";
import { contentSummary, hasContentData, pushToCloud } from "@/lib/cloud-sync";
import { downloadDataJson, summarizeData } from "@/lib/backup";

const DAY_KEY = "dclean_full_backup_day_v1";
const STATUS_KEY = "dclean_full_backup_status_v1";
/** Keep about 2 months of daily full copies on free DB. */
const KEEP_MAX = 60;

export type FullBackupMeta = {
  id: number;
  summary: string;
  reason: string;
  createdAt: number;
};

export type FullBackupStatus = {
  at: number;
  ok: boolean;
  message: string;
  day?: string;
};

function todayKeyLocal(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function alreadySavedToday(): boolean {
  if (typeof window === "undefined") return true;
  try {
    return localStorage.getItem(DAY_KEY) === todayKeyLocal();
  } catch {
    return false;
  }
}

function markSavedToday() {
  try {
    localStorage.setItem(DAY_KEY, todayKeyLocal());
  } catch {
    /* ignore */
  }
}

function setStatus(ok: boolean, message: string, day?: string) {
  try {
    const row: FullBackupStatus = { at: Date.now(), ok, message, day };
    localStorage.setItem(STATUS_KEY, JSON.stringify(row));
  } catch {
    /* ignore */
  }
}

export function getFullBackupStatus(): FullBackupStatus | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(STATUS_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as FullBackupStatus;
  } catch {
    return null;
  }
}

async function pruneOldBackups(supabase: NonNullable<
  Awaited<ReturnType<typeof getSupabaseClient>>
>) {
  const { data } = await supabase
    .from("app_full_backups")
    .select("id")
    .order("created_at", { ascending: false })
    .range(KEEP_MAX, KEEP_MAX + 200);
  if (!data?.length) return;
  const ids = data.map((r) => Number(r.id)).filter((n) => n > 0);
  if (ids.length === 0) return;
  await supabase.from("app_full_backups").delete().in("id", ids);
}

/** Save a full AppData snapshot into Supabase app_full_backups. */
export async function saveFullBackupToCloud(opts?: {
  force?: boolean;
  reason?: string;
  data?: AppData;
}): Promise<{ ok: boolean; message: string }> {
  const force = opts?.force === true;
  const day = todayKeyLocal();
  if (!force && alreadySavedToday()) {
    return {
      ok: true,
      message: "Full cloud backup already saved today.",
    };
  }

  const data = leanAppData(opts?.data ?? readStoreSnapshot());
  if (!hasContentData(data)) {
    return {
      ok: false,
      message: "Nothing to back up — no places/employees/jobs on this device.",
    };
  }

  const supabase = await getSupabaseClient();
  if (!supabase) {
    const msg = "Cloud not connected — connect Project URL in Settings first.";
    setStatus(false, msg);
    return { ok: false, message: msg };
  }

  const summary = summarizeData(data);
  const reason = opts?.reason ?? "daily";
  const { error } = await supabase.from("app_full_backups").insert({
    payload: data,
    summary,
    reason,
  });

  if (error) {
    const msg =
      error.message.includes("app_full_backups") || error.code === "42P01"
        ? "Table app_full_backups missing — run the latest schema.sql in Supabase SQL Editor."
        : error.message;
    setStatus(false, msg, day);
    return { ok: false, message: msg };
  }

  markSavedToday();
  void pruneOldBackups(supabase);
  const msg = `Full backup saved to Supabase (app_full_backups): ${summary}.`;
  setStatus(true, msg, day);
  return { ok: true, message: msg };
}

/** Once per calendar day when the app opens. */
export async function maybeSaveDailyFullBackup(): Promise<void> {
  try {
    await saveFullBackupToCloud({ force: false, reason: "daily" });
  } catch {
    /* non-blocking */
  }
}

export async function listFullBackups(
  limit = 30
): Promise<FullBackupMeta[]> {
  const supabase = await getSupabaseClient();
  if (!supabase) return [];
  const { data, error } = await supabase
    .from("app_full_backups")
    .select("id, summary, reason, created_at")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error || !data) return [];
  return data.map((row) => ({
    id: Number(row.id),
    summary: String(row.summary ?? ""),
    reason: String(row.reason ?? ""),
    createdAt: row.created_at ? Date.parse(String(row.created_at)) : 0,
  }));
}

export async function getFullBackupPayload(
  id: number
): Promise<AppData | null> {
  const supabase = await getSupabaseClient();
  if (!supabase) return null;
  const { data, error } = await supabase
    .from("app_full_backups")
    .select("payload")
    .eq("id", id)
    .maybeSingle();
  if (error || !data?.payload) return null;
  return leanAppData(data.payload as AppData);
}

export async function downloadFullBackup(id: number): Promise<{
  ok: boolean;
  message: string;
}> {
  const payload = await getFullBackupPayload(id);
  if (!payload) {
    return { ok: false, message: "Backup not found." };
  }
  downloadDataJson(
    payload,
    `dclean-full-backup-${id}-${new Date().toISOString().slice(0, 10)}.json`
  );
  return {
    ok: true,
    message: `Downloaded ${contentSummary(payload)}. You can paste this JSON into Supabase Table Editor → app_state → payload if needed.`,
  };
}

/**
 * Restore a full backup onto this device and write it to live app_state.
 */
export async function restoreFullBackup(id: number): Promise<{
  ok: boolean;
  message: string;
}> {
  const payload = await getFullBackupPayload(id);
  if (!payload || !hasContentData(payload)) {
    return { ok: false, message: "Backup empty or not found." };
  }
  const ok = restoreAppData(payload, `full-backup-${id}`, {
    allowShrink: true,
  });
  if (!ok) {
    return { ok: false, message: "Could not apply backup on this device." };
  }
  const pushed = await pushToCloud(true, {
    allowShrink: true,
    replace: true,
  });
  if (!pushed) {
    return {
      ok: false,
      message: `Restored ${contentSummary(payload)} on this device, but live cloud upload failed — tap Upload to cloud.`,
    };
  }
  return {
    ok: true,
    message: `Restored ${contentSummary(payload)} to this device and live cloud (app_state).`,
  };
}
