import type { AppData } from "@/types/database";
import { getSupabaseClient, loadSavedCloudConfig } from "@/lib/supabase";
import {
  applyCloudData,
  getLastUserEditAt,
  getLocalUpdatedAt,
  getSyncGeneration,
  hasPendingLocalWrite,
  leanAppData,
  readStoreSnapshot,
  setLocalUpdatedAt,
} from "@/lib/store";
import { clearAllLocalBackups, saveLocalBackup } from "@/lib/backup";
import {
  contentScore,
  isMateriallyThinner,
  mergeAppData,
} from "@/lib/merge-data";

export type SyncStatus =
  | "idle"
  | "syncing"
  | "synced"
  | "offline"
  | "error"
  | "not_configured";

export type PullResult =
  | "applied"
  | "kept_local"
  | "empty"
  | "skip"
  | "uploaded"
  | "merged";

export type CloudHistoryMeta = {
  id: number;
  summary: string;
  reason: string;
  createdAt: number;
};

let status: SyncStatus = "idle";
let lastError: string | null = null;
let pushTimer: ReturnType<typeof setTimeout> | null = null;
let bootstrapped = false;
let pushInFlight = false;
let pullInFlight = false;
/** Bumped on connect / config change so stale in-flight pulls never apply. */
let syncEpoch = 0;
/** If a local write arrived while sync was busy, push once when free. */
let pendingPush = false;
/** Fingerprint of last payload we successfully wrote to THIS cloud project. */
let lastPushedFingerprint = "";
/** Project URL that lastPushedFingerprint belongs to (switching projects must reset). */
let lastPushedProjectUrl = "";
let lastPullAt = 0;

const listeners = new Set<() => void>();

/** Call whenever Supabase URL/key changes so upload cannot be skipped as “already pushed”. */
export function resetCloudSyncState() {
  syncEpoch += 1;
  lastPushedFingerprint = "";
  lastPushedProjectUrl = "";
  lastPullAt = 0;
  pendingPush = false;
  if (pushTimer) {
    clearTimeout(pushTimer);
    pushTimer = null;
  }
}

/** Disconnect this device from cloud UI state (local data kept). */
export function disconnectCloud() {
  resetCloudSyncState();
  setStatus("not_configured");
}

export function getSyncStatus() {
  return { status, lastError };
}

export function subscribeSyncStatus(fn: () => void) {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

function setStatus(next: SyncStatus, error: string | null = null) {
  if (status === next && lastError === error) return;
  status = next;
  lastError = error;
  listeners.forEach((fn) => fn());
}

function dataFingerprint(data: AppData): string {
  try {
    return JSON.stringify(leanAppData(data));
  } catch {
    return String(contentScore(data));
  }
}

export function hasContentData(data: AppData): boolean {
  return contentScore(data) > 0;
}

export function contentSummary(data: AppData): string {
  const p = data.properties?.length ?? 0;
  const e = data.employees?.length ?? 0;
  const j = data.jobs?.length ?? 0;
  return `${p} places · ${e} employees · ${j} jobs`;
}

function normalizePayload(raw: unknown): {
  data: AppData;
  hadSettings: boolean;
  hadOwners: boolean;
  hadSchedule: boolean;
} {
  let data = raw as Partial<AppData> | null;
  if (typeof raw === "string") {
    try {
      data = JSON.parse(raw) as Partial<AppData>;
    } catch {
      data = null;
    }
  }
  data = data ?? {};
  return {
    hadSettings: data.settings != null && typeof data.settings === "object",
    hadOwners: Array.isArray(data.owners),
    hadSchedule:
      data.default_schedule != null && typeof data.default_schedule === "object",
    data: {
      properties: Array.isArray(data.properties) ? data.properties : [],
      employees: Array.isArray(data.employees) ? data.employees : [],
      jobs: Array.isArray(data.jobs) ? data.jobs : [],
      owners: Array.isArray(data.owners) ? data.owners : [],
      default_schedule:
        data.default_schedule && typeof data.default_schedule === "object"
          ? data.default_schedule
          : {},
      settings:
        data.settings && typeof data.settings === "object"
          ? data.settings
          : { company_name: "DClean", whatsapp: null },
    },
  };
}

async function appendCloudHistory(
  payload: AppData,
  reason: string
): Promise<void> {
  try {
    const supabase = await getSupabaseClient();
    if (!supabase) return;
    await supabase.from("app_state_history").insert({
      payload,
      summary: contentSummary(payload),
      reason,
    });
  } catch {
    /* history optional */
  }
}

async function fetchCloudRow(): Promise<
  | {
      kind: "row";
      payload: AppData;
      updatedAt: number;
      hadSettings: boolean;
      hadOwners: boolean;
      hadSchedule: boolean;
    }
  | { kind: "empty" }
  | { kind: "error"; message: string }
> {
  const supabase = await getSupabaseClient();
  if (!supabase) return { kind: "error", message: "Cloud not configured" };
  const { data, error } = await supabase
    .from("app_state")
    .select("payload, updated_at")
    .eq("id", "main")
    .maybeSingle();
  // Network/RLS errors must NOT be treated as empty (would seed-overwrite cloud)
  if (error) {
    return { kind: "error", message: error.message || "Cloud read failed" };
  }
  if (!data) return { kind: "empty" };
  const norm = normalizePayload(data.payload);
  return {
    kind: "row",
    payload: norm.data,
    updatedAt: data.updated_at ? Date.parse(data.updated_at) : 0,
    hadSettings: norm.hadSettings,
    hadOwners: norm.hadOwners,
    hadSchedule: norm.hadSchedule,
  };
}

function flushPendingPush() {
  if (!pendingPush || pushInFlight || pullInFlight) return;
  pendingPush = false;
  const local = readStoreSnapshot();
  if (!hasContentData(local)) return;
  void pushToCloud(false).then((ok) => {
    if (!ok) pendingPush = true;
  });
}

function currentProjectUrl(): string {
  try {
    return loadSavedCloudConfig()?.supabaseUrl ?? "";
  } catch {
    return "";
  }
}

/**
 * Write payload to cloud. Refuses empty / thinner overwrites unless allowShrink.
 * One history row per successful change (not a flood).
 */
async function upsertCloudPayload(
  payload: AppData,
  opts?: { allowShrink?: boolean; reason?: string }
): Promise<boolean> {
  const supabase = await getSupabaseClient();
  if (!supabase) {
    setStatus("not_configured");
    return false;
  }
  if (!hasContentData(payload)) {
    setStatus("synced");
    return true;
  }

  const projectUrl = currentProjectUrl();
  const nextFp = dataFingerprint(payload);
  // Only skip if we already pushed THIS fingerprint to THIS same project
  if (
    nextFp &&
    nextFp === lastPushedFingerprint &&
    projectUrl &&
    projectUrl === lastPushedProjectUrl
  ) {
    setStatus("synced");
    return true;
  }

  const { data: existing, error: readErr } = await supabase
    .from("app_state")
    .select("payload")
    .eq("id", "main")
    .maybeSingle();

  if (readErr) {
    setStatus(
      "error",
      `Could not read cloud before upload: ${readErr.message}`
    );
    return false;
  }

  if (existing?.payload) {
    const prev = normalizePayload(existing.payload).data;
    const prevFp = dataFingerprint(prev);
    if (prevFp === nextFp) {
      lastPushedFingerprint = nextFp;
      lastPushedProjectUrl = projectUrl;
      setStatus("synced");
      return true;
    }
    if (hasContentData(prev)) {
      if (isMateriallyThinner(payload, prev) && !opts?.allowShrink) {
        setStatus(
          "error",
          `Blocked upload that would shrink cloud (${contentSummary(payload)} vs ${contentSummary(prev)}). Use Backup restore if intentional.`
        );
        void saveLocalBackup(leanAppData(prev), "blocked-thin-upload-cloud");
        return false;
      }
    }
  }

  const now = new Date().toISOString();
  const { error } = await supabase.from("app_state").upsert(
    {
      id: "main",
      payload,
      updated_at: now,
    },
    { onConflict: "id" }
  );
  if (error) {
    setStatus("error", error.message);
    return false;
  }

  // Single history snapshot per successful change (keeps free DB small)
  await appendCloudHistory(payload, opts?.reason ?? "upload");
  void saveLocalBackup(payload, "cloud-upload");
  lastPushedFingerprint = nextFp;
  lastPushedProjectUrl = projectUrl;
  setLocalUpdatedAt(Date.parse(now));
  setStatus("synced");
  return true;
}

export async function pullFromCloud(options?: {
  respectPendingWrite?: boolean;
}): Promise<PullResult> {
  const respectPending = options?.respectPendingWrite !== false;
  const supabase = await getSupabaseClient();
  if (!supabase) {
    setStatus("not_configured");
    return "skip";
  }

  // Never run two pulls at once (even Sync now) — stale apply can undo connect
  if (pullInFlight) {
    setStatus("synced");
    return "kept_local";
  }

  if (respectPending && (hasPendingLocalWrite() || pushInFlight)) {
    setStatus("synced");
    return "kept_local";
  }

  const nowMs = Date.now();
  // After a user edit (e.g. untick), push first — skip pull briefly so an
  // older cloud snapshot cannot fight the local schedule change.
  if (respectPending && nowMs - getLastUserEditAt() < 4000) {
    pendingPush = true;
    flushPendingPush();
    setStatus("synced");
    return "kept_local";
  }

  if (nowMs - lastPullAt < 2000 && respectPending) {
    setStatus("synced");
    return "kept_local";
  }
  lastPullAt = nowMs;
  const epochAtStart = syncEpoch;
  pullInFlight = true;
  setStatus("syncing");

  try {
    const cloudFetch = await fetchCloudRow();
    if (epochAtStart !== syncEpoch) {
      setStatus("synced");
      return "skip";
    }
    if (cloudFetch.kind === "error") {
      setStatus("error", cloudFetch.message);
      return "skip";
    }
    if (cloudFetch.kind === "empty") {
      const local = readStoreSnapshot();
      if (hasContentData(local)) {
        // Direct upsert — do not call pushToCloud while pullInFlight
        const ok = await upsertCloudPayload(leanAppData(local), {
          reason: "seed-upload",
        });
        if (epochAtStart !== syncEpoch) {
          setStatus("synced");
          return "skip";
        }
        setStatus(ok ? "synced" : "error", ok ? null : lastError);
        return ok ? "uploaded" : "skip";
      }
      setStatus("synced");
      return "empty";
    }

    const cloudRow = cloudFetch;

    let local = readStoreSnapshot();
    const cloudContent = hasContentData(cloudRow.payload);
    const localContent = hasContentData(local);

    if (!cloudContent && !localContent) {
      setStatus("synced");
      return "empty";
    }

    if (!cloudContent && localContent) {
      const ok = await upsertCloudPayload(leanAppData(local), {
        reason: "seed-upload",
      });
      if (epochAtStart !== syncEpoch) {
        setStatus("synced");
        return "skip";
      }
      setStatus(ok ? "synced" : "error", ok ? null : lastError);
      return ok ? "uploaded" : "skip";
    }

    // Abort apply if user edited during the fetch
    if (hasPendingLocalWrite()) {
      pendingPush = true;
      setStatus("synced");
      return "kept_local";
    }

    if (epochAtStart !== syncEpoch) {
      setStatus("synced");
      return "skip";
    }

    // Intentional wipe / replace: higher sync_generation wins without union-merge
    {
      const localGen = getSyncGeneration(local);
      const cloudGen = getSyncGeneration(cloudRow.payload);
      if (cloudGen > localGen && cloudContent) {
        if (pushTimer) {
          clearTimeout(pushTimer);
          pushTimer = null;
        }
        const applied = applyCloudData(
          leanAppData(cloudRow.payload),
          Math.max(cloudRow.updatedAt, Date.now()),
          {
            allowShrink: true,
            keepLocalSettings: false,
            keepLocalOwners: false,
            keepLocalSchedule: false,
          }
        );
        if (!applied) {
          setStatus("synced");
          return "kept_local";
        }
        lastPushedFingerprint = dataFingerprint(cloudRow.payload);
        lastPushedProjectUrl = currentProjectUrl();
        setStatus("synced");
        return "applied";
      }
      if (localGen > cloudGen && localContent) {
        const ok = await upsertCloudPayload(leanAppData(local), {
          allowShrink: true,
          reason: "sync-generation-replace",
        });
        if (epochAtStart !== syncEpoch) {
          setStatus("synced");
          return "skip";
        }
        setStatus(ok ? "synced" : "error", ok ? null : lastError);
        return ok ? "uploaded" : "skip";
      }
    }

    // Empty browser must always take cloud; rich local seeds empty cloud (above)
    let prefer: "local" | "cloud" =
      getLocalUpdatedAt() >= cloudRow.updatedAt ? "local" : "cloud";
    if (!localContent && cloudContent) prefer = "cloud";
    if (localContent && !cloudContent) prefer = "local";

    // Re-read local right before merge so mid-fetch edits are included
    local = readStoreSnapshot();
    let merged = leanAppData(
      mergeAppData(local, cloudRow.payload, prefer)
    );

    if (pushTimer) {
      clearTimeout(pushTimer);
      pushTimer = null;
    }

    let localFp = dataFingerprint(local);
    const cloudFp = dataFingerprint(cloudRow.payload);
    let mergedFp = dataFingerprint(merged);

    if (localFp === cloudFp && localFp === mergedFp) {
      lastPushedFingerprint = cloudFp;
      setStatus("synced");
      return "kept_local";
    }

    if (epochAtStart !== syncEpoch) {
      setStatus("synced");
      return "skip";
    }

    if (mergedFp !== localFp) {
      // One more re-merge if memory changed while we prepared apply
      const latest = readStoreSnapshot();
      if (dataFingerprint(latest) !== localFp) {
        merged = leanAppData(
          mergeAppData(latest, cloudRow.payload, prefer)
        );
        mergedFp = dataFingerprint(merged);
        localFp = dataFingerprint(latest);
      }
      if (mergedFp !== localFp) {
        if (epochAtStart !== syncEpoch) {
          setStatus("synced");
          return "skip";
        }
        const applied = applyCloudData(
          merged,
          Math.max(cloudRow.updatedAt, getLocalUpdatedAt(), Date.now()),
          {
            keepLocalSettings: !cloudRow.hadSettings,
            keepLocalOwners: !cloudRow.hadOwners,
            keepLocalSchedule: !cloudRow.hadSchedule,
            allowShrink: false,
          }
        );
        if (!applied) {
          setStatus("synced");
          return "kept_local";
        }
      }
    }

    if (mergedFp !== cloudFp) {
      if (epochAtStart !== syncEpoch) {
        setStatus("synced");
        return "skip";
      }
      const ok = await upsertCloudPayload(merged, { reason: "merge-sync" });
      if (!ok) {
        pendingPush = true;
        setStatus("error", lastError);
        return "skip";
      }
      setStatus("synced");
      return "merged";
    }

    setStatus("synced");
    return mergedFp !== localFp ? "merged" : "kept_local";
  } finally {
    pullInFlight = false;
    flushPendingPush();
  }
}

export async function forcePullFromCloud(): Promise<PullResult> {
  const supabase = await getSupabaseClient();
  if (!supabase) {
    setStatus("not_configured");
    return "skip";
  }
  if (pushInFlight || pullInFlight) {
    setStatus("synced");
    return "kept_local";
  }

  const epochAtStart = syncEpoch;
  pullInFlight = true;
  setStatus("syncing");
  try {
    const cloudFetch = await fetchCloudRow();
    if (epochAtStart !== syncEpoch) {
      setStatus("synced");
      return "skip";
    }
    if (cloudFetch.kind === "error") {
      setStatus("error", cloudFetch.message);
      return "skip";
    }
    if (cloudFetch.kind === "empty" || !hasContentData(cloudFetch.payload)) {
      setStatus("synced");
      return "empty";
    }
    const cloudRow = cloudFetch;

    // Intentional wipe: take cloud as-is when its generation is newer
    {
      const local = readStoreSnapshot();
      const localGen = getSyncGeneration(local);
      const cloudGen = getSyncGeneration(cloudRow.payload);
      if (cloudGen > localGen) {
        if (pushTimer) {
          clearTimeout(pushTimer);
          pushTimer = null;
        }
        if (epochAtStart !== syncEpoch) {
          setStatus("synced");
          return "skip";
        }
        const applied = applyCloudData(
          leanAppData(cloudRow.payload),
          Math.max(cloudRow.updatedAt || 0, Date.now()),
          {
            allowShrink: true,
            keepLocalSettings: false,
            keepLocalOwners: false,
            keepLocalSchedule: false,
          }
        );
        if (!applied) {
          setStatus("synced");
          return "kept_local";
        }
        lastPushedFingerprint = dataFingerprint(cloudRow.payload);
        lastPushedProjectUrl = currentProjectUrl();
        setStatus("synced");
        return "applied";
      }
    }

    // Flush-on-apply keeps unflushed edits; cloud wins field conflicts on Download.
    if (epochAtStart !== syncEpoch) {
      setStatus("synced");
      return "skip";
    }
    const local = readStoreSnapshot();
    const merged = leanAppData(
      mergeAppData(local, cloudRow.payload, "cloud")
    );
    const ok = applyCloudData(
      merged,
      Math.max(cloudRow.updatedAt || 0, getLocalUpdatedAt(), Date.now()),
      {
        keepLocalSettings: !cloudRow.hadSettings,
        keepLocalOwners: !cloudRow.hadOwners,
        keepLocalSchedule: !cloudRow.hadSchedule,
      }
    );
    if (!ok) {
      setStatus("synced");
      return "kept_local";
    }

    if (dataFingerprint(merged) !== dataFingerprint(cloudRow.payload)) {
      const upOk = await upsertCloudPayload(merged, {
        reason: "merge-download",
      });
      if (!upOk) {
        pendingPush = true;
        setStatus("error", lastError || "Downloaded locally but cloud upload failed.");
        return "merged";
      }
    }
    setStatus("synced");
    return "merged";
  } finally {
    pullInFlight = false;
    flushPendingPush();
  }
}

export async function pushToCloud(
  immediate = false,
  opts?: { allowShrink?: boolean; replace?: boolean }
): Promise<boolean> {
  const run = async () => {
    const supabase = await getSupabaseClient();
    if (!supabase) {
      setStatus("not_configured");
      return false;
    }

    if (hasPendingLocalWrite()) {
      pendingPush = true;
      setStatus("synced");
      return false;
    }

    const local = readStoreSnapshot();
    if (!hasContentData(local)) {
      setStatus("synced");
      return true;
    }

    if (pushInFlight || pullInFlight) {
      pendingPush = true;
      setStatus("synced");
      return false;
    }

    const localFp = dataFingerprint(local);
    const projectUrl = currentProjectUrl();
    if (
      localFp &&
      localFp === lastPushedFingerprint &&
      projectUrl &&
      projectUrl === lastPushedProjectUrl
    ) {
      setStatus("synced");
      return true;
    }

    setStatus("syncing");
    pushInFlight = true;
    try {
      const cloudFetch = await fetchCloudRow();
      if (cloudFetch.kind === "error") {
        pendingPush = true;
        setStatus("error", cloudFetch.message);
        return false;
      }
      // Re-read after network — include any edits that landed during fetch
      const latest = readStoreSnapshot();
      if (hasPendingLocalWrite()) {
        pendingPush = true;
        setStatus("synced");
        return false;
      }

      let payload = leanAppData(latest);
      const replace =
        opts?.replace === true ||
        (cloudFetch.kind === "row" &&
          getSyncGeneration(latest) > getSyncGeneration(cloudFetch.payload));

      if (
        !replace &&
        cloudFetch.kind === "row" &&
        hasContentData(cloudFetch.payload)
      ) {
        payload = leanAppData(
          mergeAppData(latest, cloudFetch.payload, "local")
        );
        const payloadFp = dataFingerprint(payload);
        const nowFp = dataFingerprint(readStoreSnapshot());
        if (payloadFp !== nowFp) {
          const applied = applyCloudData(payload, Date.now(), {
            allowShrink: false,
          });
          if (!applied) {
            pendingPush = true;
            return false;
          }
        }
      }

      return await upsertCloudPayload(payload, {
        allowShrink: opts?.allowShrink || replace,
        reason: replace ? "sync-generation-replace" : "upload",
      });
    } finally {
      pushInFlight = false;
      flushPendingPush();
    }
  };

  if (immediate) {
    if (pushTimer) clearTimeout(pushTimer);
    pushTimer = null;
    return run();
  }

  return new Promise((resolve) => {
    if (pushTimer) clearTimeout(pushTimer);
    pushTimer = setTimeout(async () => {
      pushTimer = null;
      resolve(await run());
    }, 400);
  });
}

export async function connectAndSync(): Promise<{
  ok: boolean;
  message: string;
  result: PullResult;
}> {
  // Save & connect: always clear local and adopt this cloud — never upload.
  resetCloudSyncState();

  const test = await testCloudConnection();
  if (!test.ok) {
    return { ok: false, message: test.message, result: "skip" };
  }

  const cloudFetch = await fetchCloudRow();
  if (cloudFetch.kind === "error") {
    return {
      ok: false,
      message: cloudFetch.message || "Could not read cloud after connect.",
      result: "skip",
    };
  }

  const local = readStoreSnapshot();
  const localContent = hasContentData(local);
  const cloudContent =
    cloudFetch.kind === "row" && hasContentData(cloudFetch.payload);
  const preConnect = leanAppData(local);

  // Snapshot BEFORE clear so recovery is not raced/wiped
  if (localContent) {
    await saveLocalBackup(preConnect, "before-connect-replace");
  }

  if (cloudContent) {
    const payload = leanAppData(cloudFetch.payload);
    const applied = applyCloudData(
      payload,
      Math.max(cloudFetch.updatedAt || 0, Date.now()),
      {
        allowShrink: true,
        allowEmptyOverwrite: true,
        keepLocalSettings: false,
        keepLocalOwners: false,
        keepLocalSchedule: false,
      }
    );
    if (!applied) {
      return {
        ok: false,
        message:
          "Connected, but could not replace local data from cloud. Try again.",
        result: "skip",
      };
    }
    // last_good becomes the new cloud dataset (intentional project switch)
    await clearAllLocalBackups(payload);
    await saveLocalBackup(payload, "after-connect-replace");
    lastPushedFingerprint = dataFingerprint(payload);
    lastPushedProjectUrl = currentProjectUrl();
    try {
      const { pullCredentialsFromCloud } = await import("@/lib/auth");
      await pullCredentialsFromCloud();
    } catch {
      /* optional */
    }
    await bootstrapCloudSync();
    const next = readStoreSnapshot();
    setStatus("synced");
    return {
      ok: true,
      message: `Connected. Cleared local and loaded from cloud: ${contentSummary(next)}.`,
      result: "applied",
    };
  }

  // Cloud empty — clear live local work, keep pre-connect snapshot as last_good
  const cleared = applyCloudData(
    {
      properties: [],
      employees: [],
      jobs: [],
      owners: [],
      default_schedule: {},
      settings: local.settings,
    },
    Date.now(),
    {
      allowEmptyOverwrite: true,
      allowShrink: true,
      keepLocalSettings: true,
      keepLocalOwners: false,
      keepLocalSchedule: false,
    }
  );
  if (!cleared && localContent) {
    return {
      ok: false,
      message: "Connected, but could not clear local data. Try again.",
      result: "skip",
    };
  }
  await clearAllLocalBackups(localContent ? preConnect : undefined);
  lastPushedFingerprint = "";
  lastPushedProjectUrl = currentProjectUrl();
  try {
    const { pullCredentialsFromCloud } = await import("@/lib/auth");
    await pullCredentialsFromCloud();
  } catch {
    /* optional */
  }
  await bootstrapCloudSync();
  setStatus("synced");
  return {
    ok: true,
    message:
      "Connected. Local schedules cleared. This cloud has no places yet — add data here, or use Upload to cloud from a device that already has schedules.",
    result: "empty",
  };
}

export async function clearCloudHistory(): Promise<{
  ok: boolean;
  message: string;
}> {
  const supabase = await getSupabaseClient();
  if (!supabase) {
    return { ok: false, message: "Cloud not connected." };
  }
  const { error } = await supabase
    .from("app_state_history")
    .delete()
    .gte("id", 0);
  if (error) {
    return {
      ok: false,
      message:
        "Could not clear cloud history from the app. In Supabase SQL Editor run: TRUNCATE app_state_history;",
    };
  }
  return { ok: true, message: "Cloud history cleared." };
}

export async function listCloudHistory(
  limit = 40
): Promise<CloudHistoryMeta[]> {
  const supabase = await getSupabaseClient();
  if (!supabase) return [];
  const { data, error } = await supabase
    .from("app_state_history")
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

export async function restoreFromCloudHistory(
  historyId: number
): Promise<{ ok: boolean; message: string }> {
  const supabase = await getSupabaseClient();
  if (!supabase) {
    return { ok: false, message: "Cloud not connected." };
  }
  const { data, error } = await supabase
    .from("app_state_history")
    .select("payload, summary")
    .eq("id", historyId)
    .maybeSingle();
  if (error || !data) {
    return { ok: false, message: error?.message || "History entry not found." };
  }
  const { data: payload } = normalizePayload(data.payload);
  if (!hasContentData(payload)) {
    return { ok: false, message: "That history snapshot is empty." };
  }

  // Point-in-time restore: replace local with history (do not union-merge leftovers)
  const snapshot = leanAppData(payload);
  const { restoreAppData } = await import("@/lib/store");
  const restored = restoreAppData(snapshot, `cloud-history-${historyId}`, {
    allowShrink: true,
  });
  if (!restored) {
    return { ok: false, message: "Restore blocked (empty or thinner snapshot)." };
  }
  const pushed = await pushToCloud(true, {
    allowShrink: true,
    replace: true,
  });
  if (!pushed) {
    return {
      ok: false,
      message: `Restored ${contentSummary(snapshot)} on this device, but live cloud upload failed — tap Upload to cloud.`,
    };
  }
  return {
    ok: true,
    message: `Restored ${contentSummary(snapshot)} from cloud history to this device and live cloud.`,
  };
}

export async function bootstrapCloudSync() {
  if (typeof window === "undefined") return;
  if (bootstrapped) {
    await pullFromCloud();
    return;
  }
  bootstrapped = true;

  await pullFromCloud();

  // Prefer cloud login row; only seed app_login if cloud has none (never overwrite)
  try {
    const { pullCredentialsFromCloud } = await import("@/lib/auth");
    await pullCredentialsFromCloud();
  } catch {
    /* optional */
  }

  window.addEventListener("dclean-local-write", () => {
    const local = readStoreSnapshot();
    if (!hasContentData(local)) return;
    if (pushInFlight || pullInFlight) {
      pendingPush = true;
      return;
    }
    void pushToCloud(false);
  });

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") void pullFromCloud();
  });

  window.addEventListener("online", () => {
    void pullFromCloud();
  });
}

export async function testCloudConnection(): Promise<{
  ok: boolean;
  message: string;
}> {
  const supabase = await getSupabaseClient();
  if (!supabase) {
    return { ok: false, message: "Missing Project URL or anon key." };
  }
  const { error } = await supabase
    .from("app_state")
    .select("id")
    .eq("id", "main")
    .maybeSingle();
  if (error) {
    return {
      ok: false,
      message: error.message.includes("relation")
        ? "Table missing — run supabase/schema.sql in the SQL Editor."
        : error.message,
    };
  }
  return { ok: true, message: "Connected to Supabase." };
}
