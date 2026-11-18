/**
 * Multi-layer backup: every change is snapshotted in IndexedDB.
 * Empty states never overwrite a "last good" full backup.
 */
import type { AppData } from "@/types/database";

const DB_NAME = "dclean_backups_v1";
const DB_VERSION = 1;
const STORE = "snapshots";
const MAX_SNAPSHOTS = 200;
const LAST_GOOD_ID = "last_good";

export type BackupMeta = {
  id: string;
  createdAt: number;
  reason: string;
  summary: string;
  places: number;
  employees: number;
  jobs: number;
  contentScore: number;
};

export type BackupRecord = BackupMeta & {
  payload: AppData;
};

function contentScore(data: AppData): number {
  return (
    (data.properties?.length ?? 0) +
    (data.employees?.length ?? 0) +
    (data.jobs?.length ?? 0)
  );
}

export function summarizeData(data: AppData): string {
  const p = data.properties?.length ?? 0;
  const e = data.employees?.length ?? 0;
  const j = data.jobs?.length ?? 0;
  return `${p} places · ${e} employees · ${j} jobs`;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("IndexedDB not available"));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const os = db.createObjectStore(STORE, { keyPath: "id" });
        os.createIndex("createdAt", "createdAt", { unique: false });
        os.createIndex("contentScore", "contentScore", { unique: false });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("IDB open failed"));
  });
}

function idbReq<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("IDB request failed"));
  });
}

function idbTxDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("IDB tx failed"));
    tx.onabort = () => reject(tx.error ?? new Error("IDB tx aborted"));
  });
}

export async function saveLocalBackup(
  data: AppData,
  reason: string
): Promise<BackupMeta | null> {
  if (typeof window === "undefined") return null;
  try {
    const score = contentScore(data);
    const db = await openDb();

    // Read current last_good in a separate tx (avoid await mid-write tx)
    let existingGood: BackupRecord | undefined;
    try {
      const rtx = db.transaction(STORE, "readonly");
      existingGood = (await idbReq(
        rtx.objectStore(STORE).get(LAST_GOOD_ID)
      )) as BackupRecord | undefined;
    } catch {
      existingGood = undefined;
    }

    const now = Date.now();
    const record: BackupRecord = {
      id: `snap_${now}_${Math.random().toString(36).slice(2, 8)}`,
      createdAt: now,
      reason,
      summary: summarizeData(data),
      places: data.properties?.length ?? 0,
      employees: data.employees?.length ?? 0,
      jobs: data.jobs?.length ?? 0,
      contentScore: score,
      payload: data,
    };

    const tx = db.transaction(STORE, "readwrite");
    const store = tx.objectStore(STORE);
    store.put(record);

    // Refresh last_good only when this snapshot is at least as rich
    if (score > 0) {
      const existingScore = existingGood?.contentScore ?? 0;
      const existingJobs = existingGood?.jobs ?? 0;
      const shouldReplaceLastGood =
        !existingGood ||
        record.jobs > existingJobs ||
        (record.jobs === existingJobs && score >= existingScore);
      if (shouldReplaceLastGood) {
        store.put({
          ...record,
          id: LAST_GOOD_ID,
          reason: `last_good:${reason}`,
        });
      }
    }

    await idbTxDone(tx);

    // Prune old snapshots (never delete last_good)
    await pruneSnapshots(db);
    db.close();
    return {
      id: record.id,
      createdAt: record.createdAt,
      reason: record.reason,
      summary: record.summary,
      places: record.places,
      employees: record.employees,
      jobs: record.jobs,
      contentScore: record.contentScore,
    };
  } catch {
    return null;
  }
}

async function pruneSnapshots(db: IDBDatabase) {
  const tx = db.transaction(STORE, "readwrite");
  const store = tx.objectStore(STORE);
  const all = (await idbReq(store.getAll())) as BackupRecord[];
  const snaps = all
    .filter((r) => r.id !== LAST_GOOD_ID)
    .sort((a, b) => b.createdAt - a.createdAt);
  if (snaps.length <= MAX_SNAPSHOTS) {
    await idbTxDone(tx);
    return;
  }
  const keep = new Set<string>();
  // Newest MAX
  snaps.slice(0, MAX_SNAPSHOTS).forEach((s) => keep.add(s.id));
  // Top 20 by content score (years of data)
  [...snaps]
    .sort((a, b) => b.contentScore - a.contentScore)
    .slice(0, 20)
    .forEach((s) => keep.add(s.id));
  // One snapshot per calendar day for the last 90 days
  const seenDay = new Set<string>();
  for (const s of snaps) {
    const day = new Date(s.createdAt).toISOString().slice(0, 10);
    if (!seenDay.has(day) && seenDay.size < 90) {
      seenDay.add(day);
      keep.add(s.id);
    }
  }
  for (const s of snaps) {
    // Keep last_good + newest/top-score/daily set; prune the rest (incl. old full snaps)
    if (!keep.has(s.id)) store.delete(s.id);
  }
  await idbTxDone(tx);
}

export async function listLocalBackups(): Promise<BackupMeta[]> {
  if (typeof window === "undefined") return [];
  try {
    const db = await openDb();
    const tx = db.transaction(STORE, "readonly");
    const all = (await idbReq(tx.objectStore(STORE).getAll())) as BackupRecord[];
    db.close();
    return all
      .map(({ payload: _p, ...meta }) => meta)
      .sort((a, b) => {
        if (a.id === LAST_GOOD_ID) return -1;
        if (b.id === LAST_GOOD_ID) return 1;
        return b.createdAt - a.createdAt;
      });
  } catch {
    return [];
  }
}

export async function getLocalBackup(id: string): Promise<BackupRecord | null> {
  if (typeof window === "undefined") return null;
  try {
    const db = await openDb();
    const tx = db.transaction(STORE, "readonly");
    const row = (await idbReq(
      tx.objectStore(STORE).get(id)
    )) as BackupRecord | undefined;
    db.close();
    return row ?? null;
  } catch {
    return null;
  }
}

export async function getLastGoodBackup(): Promise<BackupRecord | null> {
  return getLocalBackup(LAST_GOOD_ID);
}

export async function clearAllLocalBackups(
  seed?: AppData
): Promise<void> {
  if (typeof window === "undefined") return;
  try {
    const db = await openDb();
    const tx = db.transaction(STORE, "readwrite");
    const store = tx.objectStore(STORE);
    store.clear();
    if (seed && contentScore(seed) > 0) {
      const now = Date.now();
      const record: BackupRecord = {
        id: LAST_GOOD_ID,
        createdAt: now,
        reason: "last_good:post-test-purge",
        summary: summarizeData(seed),
        places: seed.properties?.length ?? 0,
        employees: seed.employees?.length ?? 0,
        jobs: seed.jobs?.length ?? 0,
        contentScore: contentScore(seed),
        payload: seed,
      };
      store.put(record);
    }
    await idbTxDone(tx);
    db.close();
  } catch {
    /* ignore */
  }
}

export function downloadDataJson(data: AppData, filename?: string) {
  if (typeof window === "undefined") return;
  const blob = new Blob([JSON.stringify(data, null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download =
    filename ||
    `dclean-backup-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

export async function readBackupFile(file: File): Promise<AppData> {
  const text = await file.text();
  // Prefer email-wrapper parser (ARKATASK_BACKUP_V1) when present
  try {
    const { parseEmailBackupJson } = await import("@/lib/email-backup");
    return parseEmailBackupJson(text);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "";
    if (
      msg.includes("summary only") ||
      msg.includes("Invalid backup") ||
      text.includes("ARKATASK_BACKUP_V1")
    ) {
      throw e instanceof Error ? e : new Error(String(e));
    }
    /* fall through for plain AppData JSON */
  }
  const parsed = JSON.parse(text) as Partial<AppData>;
  if (!parsed || typeof parsed !== "object") {
    throw new Error("Invalid backup file");
  }
  return {
    properties: Array.isArray(parsed.properties) ? parsed.properties : [],
    employees: Array.isArray(parsed.employees) ? parsed.employees : [],
    jobs: Array.isArray(parsed.jobs) ? parsed.jobs : [],
    owners: Array.isArray(parsed.owners) ? parsed.owners : [],
    default_schedule:
      parsed.default_schedule && typeof parsed.default_schedule === "object"
        ? parsed.default_schedule
        : {},
    settings:
      parsed.settings && typeof parsed.settings === "object"
        ? (parsed.settings as AppData["settings"])
        : { company_name: "DClean", whatsapp: null },
  };
}
