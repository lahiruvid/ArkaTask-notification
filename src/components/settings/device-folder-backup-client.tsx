"use client";

import { useCallback, useEffect, useState } from "react";
import { FolderOpen, HardDrive, Unlink } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  canUseFolderPicker,
  DEVICE_BACKUP_FOLDER_NAME,
  getDeviceBackupStatus,
  isBackupFolderLinked,
  linkBackupFolder,
  saveDeviceFolderBackup,
  unlinkBackupFolder,
  type DeviceBackupStatus,
} from "@/lib/device-folder-backup";

function fmtWhen(ts: number) {
  try {
    return new Date(ts).toLocaleString();
  } catch {
    return "—";
  }
}

export function DeviceFolderBackupClient() {
  const [status, setStatus] = useState<DeviceBackupStatus | null>(null);
  const [linked, setLinked] = useState(false);
  const [folderOk, setFolderOk] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    setStatus(getDeviceBackupStatus());
    setFolderOk(canUseFolderPicker());
    setLinked(await isBackupFolderLinked());
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const link = async () => {
    setBusy(true);
    setMessage(null);
    const result = await linkBackupFolder();
    setMessage(result.message);
    await refresh();
    setBusy(false);
  };

  const saveNow = async () => {
    setBusy(true);
    setMessage(null);
    const result = await saveDeviceFolderBackup({ force: true });
    setMessage(result.message);
    await refresh();
    setBusy(false);
  };

  const unlink = async () => {
    if (!window.confirm("Stop saving daily backups to the linked folder?")) {
      return;
    }
    setBusy(true);
    await unlinkBackupFolder();
    setMessage("Folder unlinked.");
    await refresh();
    setBusy(false);
  };

  return (
    <div className="rounded-xl border bg-white p-5 shadow-sm space-y-4">
      <div className="flex items-start gap-3">
        <HardDrive className="h-5 w-5 text-teal-700 mt-0.5 shrink-0" />
        <div>
          <h2 className="text-xl font-bold text-slate-800">
            Device folder backup
          </h2>
          <p className="text-sm text-slate-500 mt-1">
            Folder name:{" "}
            <span className="font-semibold text-slate-800">
              {DEVICE_BACKUP_FOLDER_NAME}
            </span>
            . On a laptop, create that folder on the Desktop once, link it here,
            then a full DB JSON is saved there every day when you open the app.
            Browsers cannot create the Desktop folder silently — one tap to link
            is required.
          </p>
        </div>
      </div>

      <div className="rounded-lg border border-slate-200 bg-slate-50/80 p-3 space-y-2 text-sm text-slate-600">
        <p>
          <span className="font-medium text-slate-800">Laptop (Chrome/Edge):</span>{" "}
          Desktop → create folder{" "}
          <code className="text-xs bg-white border px-1 rounded">
            {DEVICE_BACKUP_FOLDER_NAME}
          </code>{" "}
          → tap <strong>Link Desktop folder</strong> → select that folder.
        </p>
        <p>
          <span className="font-medium text-slate-800">Phone:</span> daily full
          backup downloads into Files / Downloads (same file name). Full copies
          also stay in Supabase{" "}
          <code className="text-xs bg-white border px-1 rounded">
            app_full_backups
          </code>
          .
        </p>
        <p>
          Folder API:{" "}
          {folderOk ? (
            <span className="text-emerald-700 font-medium">supported</span>
          ) : (
            <span className="text-amber-800 font-medium">
              not available — downloads only
            </span>
          )}
          {linked ? (
            <span className="text-emerald-700 font-medium">
              {" "}
              · folder linked
            </span>
          ) : (
            <span className="text-slate-500"> · no folder linked</span>
          )}
        </p>
        {status ? (
          <p>
            Last device backup: {status.message}
            {status.at ? ` · ${fmtWhen(status.at)}` : ""}
          </p>
        ) : (
          <p>No device backup logged yet.</p>
        )}
      </div>

      {message ? (
        <p
          className={
            /cancel|fail|could not|not granted|not available/i.test(message)
              ? "text-sm text-amber-800 font-medium"
              : "text-sm text-teal-700 font-medium"
          }
        >
          {message}
        </p>
      ) : null}

      <div className="flex flex-wrap gap-2">
        {folderOk ? (
          <Button
            type="button"
            className="gap-2"
            disabled={busy}
            onClick={() => void link()}
          >
            <FolderOpen className="h-4 w-4" />
            {linked ? "Re-link Desktop folder" : "Link Desktop folder"}
          </Button>
        ) : null}
        <Button
          type="button"
          variant="outline"
          className="gap-2"
          disabled={busy}
          onClick={() => void saveNow()}
        >
          <HardDrive className="h-4 w-4" />
          Save to device now
        </Button>
        {linked ? (
          <Button
            type="button"
            variant="ghost"
            className="gap-2"
            disabled={busy}
            onClick={() => void unlink()}
          >
            <Unlink className="h-4 w-4" />
            Unlink folder
          </Button>
        ) : null}
      </div>
    </div>
  );
}
