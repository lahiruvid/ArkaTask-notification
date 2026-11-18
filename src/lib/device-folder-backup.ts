/**
 * Device folder backups — folder name: DCleanArkaTasks
 *
 * Laptops (Chrome/Edge): user picks Desktop/DCleanArkaTasks once; we store the
 * folder handle and write a full JSON every day when the app opens.
 * Browsers cannot create a Desktop folder silently without that one-time pick.
 *
 * Phones: no persistent Desktop folder API — daily full JSON goes to Downloads
 * (or the browser’s download folder) via a save/download.
 */
import type { AppData } from "@/types/database";
import { leanAppData, readStoreSnapshot } from "@/lib/store";
import { hasContentData } from "@/lib/cloud-sync";
import { downloadDataJson, summarizeData } from "@/lib/backup";

export const DEVICE_BACKUP_FOLDER_NAME = "DCleanArkaTasks";

const DAY_KEY = "dclean_device_folder_backup_day_v1";
const STATUS_KEY = "dclean_device_folder_backup_status_v1";
const IDB_NAME = "dclean_device_folder_v1";
const IDB_STORE = "handles";
const HANDLE_KEY = "backup_dir";

export type DeviceBackupStatus = {
  at: number;
  ok: boolean;
  message: string;
  mode: "folder" | "download" | "none";
  folderLinked: boolean;
  day?: string;
};

type DirHandle = FileSystemDirectoryHandle;

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

function setStatus(row: DeviceBackupStatus) {
  try {
    localStorage.setItem(STATUS_KEY, JSON.stringify(row));
  } catch {
    /* ignore */
  }
}

export function getDeviceBackupStatus(): DeviceBackupStatus | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(STATUS_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as DeviceBackupStatus;
  } catch {
    return null;
  }
}

export function canUseFolderPicker(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof (window as unknown as { showDirectoryPicker?: unknown })
      .showDirectoryPicker === "function"
  );
}

function openHandleDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(IDB_STORE)) {
        db.createObjectStore(IDB_STORE);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("IDB open failed"));
  });
}

async function saveDirectoryHandle(handle: DirHandle): Promise<void> {
  const db = await openHandleDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, "readwrite");
    tx.objectStore(IDB_STORE).put(handle, HANDLE_KEY);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("IDB put failed"));
  });
  db.close();
}

async function loadDirectoryHandle(): Promise<DirHandle | null> {
  try {
    const db = await openHandleDb();
    const handle = await new Promise<DirHandle | null>((resolve, reject) => {
      const tx = db.transaction(IDB_STORE, "readonly");
      const req = tx.objectStore(IDB_STORE).get(HANDLE_KEY);
      req.onsuccess = () => resolve((req.result as DirHandle) ?? null);
      req.onerror = () => reject(req.error ?? new Error("IDB get failed"));
    });
    db.close();
    return handle;
  } catch {
    return null;
  }
}

type PermissionCapableHandle = DirHandle & {
  queryPermission?: (opts: { mode: "readwrite" }) => Promise<PermissionState>;
  requestPermission?: (opts: {
    mode: "readwrite";
  }) => Promise<PermissionState>;
};

async function ensureWritePermission(handle: DirHandle): Promise<boolean> {
  const opts = { mode: "readwrite" as const };
  const h = handle as PermissionCapableHandle;
  if (typeof h.queryPermission === "function") {
    const q = await h.queryPermission(opts);
    if (q === "granted") return true;
  }
  if (typeof h.requestPermission === "function") {
    const r = await h.requestPermission(opts);
    return r === "granted";
  }
  return true;
}

function backupFileName(day = todayKeyLocal()): string {
  return `dclean-full-backup-${day}.json`;
}

async function writeJsonToFolder(
  handle: DirHandle,
  data: AppData
): Promise<void> {
  const name = backupFileName();
  const fileHandle = await handle.getFileHandle(name, { create: true });
  const writable = await fileHandle.createWritable();
  await writable.write(JSON.stringify(leanAppData(data), null, 2));
  await writable.close();
}

/**
 * One-time setup (user gesture required): pick Desktop/DCleanArkaTasks.
 * Create that folder on the Desktop first if it does not exist, then select it.
 */
export async function linkBackupFolder(): Promise<{
  ok: boolean;
  message: string;
}> {
  if (!canUseFolderPicker()) {
    return {
      ok: false,
      message:
        "This browser cannot link a Desktop folder (use Chrome/Edge on a laptop). On phones, daily backups download to Files/Downloads instead.",
    };
  }
  try {
    // startIn: 'desktop' helps land near Desktop when supported
    type ShowDirectoryPicker = (opts?: {
      id?: string;
      mode?: "read" | "readwrite";
      startIn?: string;
    }) => Promise<DirHandle>;
    const picker = (
      window as Window & { showDirectoryPicker?: ShowDirectoryPicker }
    ).showDirectoryPicker;
    if (!picker) {
      return {
        ok: false,
        message:
          "This browser cannot link a Desktop folder (use Chrome/Edge on a laptop).",
      };
    }
    const handle = await picker({
      id: "dclean-backup-folder",
      mode: "readwrite",
      startIn: "desktop",
    });
    const ok = await ensureWritePermission(handle);
    if (!ok) {
      return { ok: false, message: "Write permission was not granted." };
    }
    await saveDirectoryHandle(handle);
    const snap = leanAppData(readStoreSnapshot());
    if (hasContentData(snap)) {
      await writeJsonToFolder(handle, snap);
      markSavedToday();
    }
    const msg = `Linked folder “${handle.name}”. Prefer name ${DEVICE_BACKUP_FOLDER_NAME} on the Desktop. Daily full backups will save here.`;
    setStatus({
      at: Date.now(),
      ok: true,
      message: msg,
      mode: "folder",
      folderLinked: true,
      day: todayKeyLocal(),
    });
    return { ok: true, message: msg };
  } catch (e) {
    const name = e instanceof DOMException ? e.name : "";
    if (name === "AbortError") {
      return { ok: false, message: "Folder pick cancelled." };
    }
    return {
      ok: false,
      message: e instanceof Error ? e.message : "Could not link folder.",
    };
  }
}

export async function unlinkBackupFolder(): Promise<void> {
  try {
    const db = await openHandleDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(IDB_STORE, "readwrite");
      tx.objectStore(IDB_STORE).delete(HANDLE_KEY);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error("IDB delete failed"));
    });
    db.close();
  } catch {
    /* ignore */
  }
  setStatus({
    at: Date.now(),
    ok: true,
    message: "Folder unlinked. Daily device backups will use Downloads instead.",
    mode: "none",
    folderLinked: false,
  });
}

export async function isBackupFolderLinked(): Promise<boolean> {
  const h = await loadDirectoryHandle();
  return !!h;
}

/**
 * Save today’s full DB copy to the linked folder, or download on mobile / unsupported browsers.
 */
export async function saveDeviceFolderBackup(opts?: {
  force?: boolean;
  data?: AppData;
}): Promise<{ ok: boolean; message: string }> {
  const force = opts?.force === true;
  const day = todayKeyLocal();
  if (!force && alreadySavedToday()) {
    return { ok: true, message: "Device folder backup already saved today." };
  }

  const data = leanAppData(opts?.data ?? readStoreSnapshot());
  if (!hasContentData(data)) {
    return {
      ok: false,
      message: "Nothing to back up — no places/employees/jobs yet.",
    };
  }

  const handle = await loadDirectoryHandle();
  if (handle) {
    try {
      const permitted = await ensureWritePermission(handle);
      if (!permitted) {
        if (!force) {
          const msg =
            "Folder permission needed — tap “Link Desktop folder” or “Save to device now” in Settings.";
          setStatus({
            at: Date.now(),
            ok: false,
            message: msg,
            mode: "none",
            folderLinked: true,
            day,
          });
          return { ok: false, message: msg };
        }
        downloadDataJson(data, backupFileName(day));
        markSavedToday();
        const msg =
          "Folder permission needed again — downloaded a copy instead. Re-link the Desktop folder when you can.";
        setStatus({
          at: Date.now(),
          ok: true,
          message: msg,
          mode: "download",
          folderLinked: true,
          day,
        });
        return { ok: true, message: msg };
      }
      await writeJsonToFolder(handle, data);
      markSavedToday();
      const msg = `Full backup saved to folder “${handle.name}” (${summarizeData(data)}).`;
      setStatus({
        at: Date.now(),
        ok: true,
        message: msg,
        mode: "folder",
        folderLinked: true,
        day,
      });
      return { ok: true, message: msg };
    } catch (e) {
      const err = e instanceof Error ? e.message : "Folder write failed.";
      if (!force) {
        const msg = `${err} Tap “Save to device now” in Settings to retry.`;
        setStatus({
          at: Date.now(),
          ok: false,
          message: msg,
          mode: "none",
          folderLinked: true,
          day,
        });
        return { ok: false, message: msg };
      }
      downloadDataJson(data, backupFileName(day));
      markSavedToday();
      const msg = `${err} Downloaded a copy instead.`;
      setStatus({
        at: Date.now(),
        ok: true,
        message: msg,
        mode: "download",
        folderLinked: true,
        day,
      });
      return { ok: true, message: msg };
    }
  }

  // Mobile / Safari / Firefox: only download on user gesture (force)
  if (!force) {
    const msg = canUseFolderPicker()
      ? `Link folder “${DEVICE_BACKUP_FOLDER_NAME}” or tap “Save to device now”.`
      : `Tap “Save to device now” in Settings to download today’s backup to phone storage.`;
    setStatus({
      at: Date.now(),
      ok: false,
      message: msg,
      mode: "none",
      folderLinked: false,
      day,
    });
    return { ok: false, message: msg };
  }

  downloadDataJson(data, backupFileName(day));
  markSavedToday();
  const msg = canUseFolderPicker()
    ? `Downloaded ${backupFileName(day)}. Link folder “${DEVICE_BACKUP_FOLDER_NAME}” on the Desktop for automatic saves.`
    : `Downloaded ${backupFileName(day)} to phone storage (Downloads / Files). Full copy also stays in Supabase app_full_backups.`;
  setStatus({
    at: Date.now(),
    ok: true,
    message: msg,
    mode: "download",
    folderLinked: false,
    day,
  });
  return { ok: true, message: msg };
}

/** Once per day when the app opens. */
export async function maybeSaveDailyDeviceBackup(): Promise<void> {
  try {
    await saveDeviceFolderBackup({ force: false });
  } catch {
    /* non-blocking */
  }
}
