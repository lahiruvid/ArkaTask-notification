"use client";

import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import {
  Download,
  History,
  Lock,
  Mail,
  RotateCcw,
  Upload,
  ShieldCheck,
  Database,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { verifyPassword } from "@/lib/auth";
import {
  downloadDataJson,
  getLocalBackup,
  listLocalBackups,
  readBackupFile,
  type BackupMeta,
} from "@/lib/backup";
import {
  contentSummary,
  hasContentData,
  listCloudHistory,
  restoreFromCloudHistory,
  type CloudHistoryMeta,
} from "@/lib/cloud-sync";
import {
  getBackupEmailAddress,
  getEmailBackupStatus,
  sendDailyEmailBackup,
  type EmailBackupStatus,
} from "@/lib/email-backup";
import {
  downloadFullBackup,
  getFullBackupStatus,
  listFullBackups,
  restoreFullBackup,
  saveFullBackupToCloud,
  type FullBackupMeta,
  type FullBackupStatus,
} from "@/lib/full-backup";
import {
  leanAppData,
  readStoreSnapshot,
  restoreAppData,
  SYNC_EVENT,
} from "@/lib/store";

function fmtWhen(ts: number) {
  if (!ts) return "—";
  try {
    return new Date(ts).toLocaleString();
  } catch {
    return "—";
  }
}

export function BackupRestoreClient() {
  const [localBackups, setLocalBackups] = useState<BackupMeta[]>([]);
  const [cloudHistory, setCloudHistory] = useState<CloudHistoryMeta[]>([]);
  const [fullBackups, setFullBackups] = useState<FullBackupMeta[]>([]);
  const [fullStatus, setFullStatus] = useState<FullBackupStatus | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const messageIsError = Boolean(
    message &&
      (/blocked|not found|failed|error|no places|summary only|invalid|missing|wrong password/i.test(
        message
      ) ||
        message.toLowerCase().includes("could not"))
  );
  const [busy, setBusy] = useState(false);
  const [emailStatus, setEmailStatus] = useState<EmailBackupStatus | null>(
    null
  );
  const [advancedUnlocked, setAdvancedUnlocked] = useState(false);
  const [advancedPassword, setAdvancedPassword] = useState("");
  const [advancedError, setAdvancedError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const refreshLocal = useCallback(async () => {
    if (!advancedUnlocked) return;
    setLocalBackups(await listLocalBackups());
  }, [advancedUnlocked]);

  const refreshFull = useCallback(async () => {
    setFullBackups(await listFullBackups(30));
    setFullStatus(getFullBackupStatus());
  }, []);

  const refreshAdvanced = useCallback(async () => {
    setLocalBackups(await listLocalBackups());
    setCloudHistory(await listCloudHistory(40));
  }, []);

  useEffect(() => {
    void refreshFull();
    setEmailStatus(getEmailBackupStatus());
    setFullStatus(getFullBackupStatus());
    let t: ReturnType<typeof setTimeout> | null = null;
    const onSync = () => {
      if (t) clearTimeout(t);
      t = setTimeout(() => void refreshLocal(), 1500);
    };
    window.addEventListener(SYNC_EVENT, onSync);
    return () => {
      window.removeEventListener(SYNC_EVENT, onSync);
      if (t) clearTimeout(t);
    };
  }, [refreshFull, refreshLocal]);

  useEffect(() => {
    if (!advancedUnlocked) {
      setLocalBackups([]);
      setCloudHistory([]);
      return;
    }
    void refreshAdvanced();
  }, [advancedUnlocked, refreshAdvanced]);

  const unlockAdvanced = (e: FormEvent) => {
    e.preventDefault();
    setAdvancedError(null);
    if (!verifyPassword(advancedPassword)) {
      setAdvancedError("Wrong password.");
      return;
    }
    setAdvancedUnlocked(true);
    setAdvancedPassword("");
  };

  const sendEmailBackupNow = async () => {
    setBusy(true);
    setMessage(null);
    const result = await sendDailyEmailBackup({ force: true });
    setEmailStatus(getEmailBackupStatus());
    setMessage(result.message);
    setBusy(false);
  };

  const saveFullNow = async () => {
    setBusy(true);
    setMessage(null);
    const result = await saveFullBackupToCloud({
      force: true,
      reason: "manual",
    });
    setFullStatus(getFullBackupStatus());
    setFullBackups(await listFullBackups(30));
    setMessage(result.message);
    setBusy(false);
  };

  const restoreFull = async (id: number) => {
    const ok = window.confirm(
      `Restore full backup #${id}?\n\nThis replaces data on this device and uploads to live cloud (app_state).`
    );
    if (!ok) return;
    setBusy(true);
    setMessage(null);
    const result = await restoreFullBackup(id);
    setMessage(result.message);
    setBusy(false);
  };

  const downloadFull = async (id: number) => {
    setBusy(true);
    setMessage(null);
    const result = await downloadFullBackup(id);
    setMessage(result.message);
    setBusy(false);
  };

  const restoreLocal = async (id: string) => {
    const ok = window.confirm(
      `Restore this on-device snapshot?\n\nThis replaces the current schedule/places/employees on this phone or laptop.`
    );
    if (!ok) return;
    setBusy(true);
    setMessage(null);
    const row = await getLocalBackup(id);
    if (!row || !hasContentData(row.payload)) {
      setMessage("That snapshot is empty or missing.");
      setBusy(false);
      return;
    }
    const applied = restoreAppData(row.payload, `local-${id}`, {
      allowShrink: true,
    });
    setMessage(
      applied
        ? `Restored on this device: ${contentSummary(row.payload)}. Tap Upload to cloud if you want live cloud to match.`
        : "Restore blocked."
    );
    setBusy(false);
  };

  const restoreCloud = async (id: number) => {
    const ok = window.confirm(
      `Restore cloud history #${id}?\n\nThis replaces data on this device and uploads to live cloud.`
    );
    if (!ok) return;
    setBusy(true);
    setMessage(null);
    const result = await restoreFromCloudHistory(id);
    setMessage(result.message);
    setBusy(false);
  };

  const exportNow = () => {
    const data = leanAppData(readStoreSnapshot());
    if (!hasContentData(data)) {
      setMessage("Nothing to download yet.");
      return;
    }
    downloadDataJson(data);
    setMessage(`Downloaded ${contentSummary(data)}.`);
  };

  const onImportFile = async (file: File | null) => {
    if (!file) return;
    setBusy(true);
    setMessage(null);
    try {
      const data = await readBackupFile(file);
      if (!hasContentData(data)) {
        setMessage("That file has no places/employees/jobs.");
        setBusy(false);
        return;
      }
      const okConfirm = window.confirm(
        `Import ${contentSummary(data)}?\n\nThis replaces data on this device.`
      );
      if (!okConfirm) {
        setBusy(false);
        return;
      }
      const ok = restoreAppData(data, "import-file", {
        allowShrink: true,
      });
      setMessage(
        ok
          ? `Imported ${contentSummary(data)}. Tap Upload to cloud if needed.`
          : "Import blocked."
      );
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Invalid JSON file.");
    }
    setBusy(false);
  };

  return (
    <div className="rounded-xl border bg-white p-5 shadow-sm space-y-5">
      <div className="flex items-start gap-3">
        <ShieldCheck className="h-5 w-5 text-teal-700 mt-0.5 shrink-0" />
        <div>
          <h2 className="text-xl font-bold text-slate-800">Backup & recover</h2>
          <p className="text-sm text-slate-500 mt-1">
            Full copies are stored in Supabase table{" "}
            <code className="text-xs bg-slate-100 px-1 rounded">
              app_full_backups
            </code>{" "}
            (reliable). Email is optional and may be summary-only if data is
            large.
          </p>
        </div>
      </div>

      {message ? (
        <p
          className={
            messageIsError
              ? "text-sm text-amber-800 font-medium"
              : "text-sm text-teal-700 font-medium"
          }
        >
          {message}
        </p>
      ) : null}

      <div className="rounded-lg border border-teal-200 bg-teal-50/60 p-3 space-y-2">
        <h3 className="font-semibold text-slate-800 flex items-center gap-2">
          <Database className="h-4 w-4 text-teal-700" />
          Full cloud backups (disaster recovery)
        </h3>
        <p className="text-sm text-slate-600">
          Every day the app saves the <strong>entire</strong> dataset into
          Supabase → Table Editor →{" "}
          <span className="font-medium">app_full_backups</span>. In a worst
          case: Restore here, or Download JSON and paste into{" "}
          <span className="font-medium">app_state</span> →{" "}
          <span className="font-medium">payload</span>.
        </p>
        {fullStatus ? (
          <p
            className={
              fullStatus.ok ? "text-sm text-teal-700" : "text-sm text-amber-800"
            }
          >
            Last save: {fullStatus.message}
            {fullStatus.at ? ` · ${fmtWhen(fullStatus.at)}` : ""}
          </p>
        ) : (
          <p className="text-sm text-slate-500">
            No full backup logged yet — open the app with cloud connected, or
            tap Save full backup now.
          </p>
        )}
        <Button
          type="button"
          variant="outline"
          className="gap-2"
          onClick={() => void saveFullNow()}
          disabled={busy}
        >
          <Database className="h-4 w-4" />
          Save full backup now
        </Button>
        {fullBackups.length > 0 ? (
          <ul className="space-y-2 max-h-48 overflow-auto pt-1">
            {fullBackups.map((b) => (
              <li
                key={b.id}
                className="flex flex-wrap items-center justify-between gap-2 text-sm border-b border-teal-100 pb-2"
              >
                <div className="min-w-0">
                  <p className="font-medium text-slate-800 truncate">
                    #{b.id} · {b.summary}
                  </p>
                  <p className="text-xs text-slate-500">
                    {fmtWhen(b.createdAt)} · {b.reason}
                  </p>
                </div>
                <div className="flex gap-1 shrink-0">
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={busy}
                    onClick={() => void downloadFull(b.id)}
                  >
                    Download
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={busy}
                    onClick={() => void restoreFull(b.id)}
                  >
                    Restore
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        ) : null}
      </div>

      <div className="rounded-lg border border-slate-200 bg-slate-50/80 p-3 space-y-2">
        <h3 className="font-semibold text-slate-800 flex items-center gap-2">
          <Mail className="h-4 w-4 text-teal-700" />
          Email notice (optional)
        </h3>
        <p className="text-sm text-slate-600">
          Free daily mail to{" "}
          <span className="font-medium">{getBackupEmailAddress()}</span>. If
          data is large, email may be summary-only — the{" "}
          <strong>full</strong> copy is in{" "}
          <span className="font-medium">app_full_backups</span> above.
        </p>
        {emailStatus ? (
          <p
            className={
              emailStatus.ok
                ? "text-sm text-teal-700"
                : "text-sm text-amber-800"
            }
          >
            Last try: {emailStatus.message}
            {emailStatus.at ? ` · ${fmtWhen(emailStatus.at)}` : ""}
          </p>
        ) : (
          <p className="text-sm text-slate-500">No email attempt logged yet.</p>
        )}
        <Button
          type="button"
          variant="outline"
          className="gap-2"
          onClick={() => void sendEmailBackupNow()}
          disabled={busy}
        >
          <Mail className="h-4 w-4" />
          Send backup email now
        </Button>
      </div>

      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          variant="outline"
          className="gap-2"
          onClick={exportNow}
          disabled={busy}
        >
          <Download className="h-4 w-4" />
          Download JSON
        </Button>
        <Button
          type="button"
          variant="outline"
          className="gap-2"
          onClick={() => fileRef.current?.click()}
          disabled={busy}
        >
          <Upload className="h-4 w-4" />
          Import JSON
        </Button>
        <input
          ref={fileRef}
          type="file"
          accept="application/json,.json"
          className="hidden"
          onChange={(e) => {
            void onImportFile(e.target.files?.[0] ?? null);
            e.target.value = "";
          }}
        />
        <Button
          type="button"
          variant="ghost"
          className="gap-2"
          onClick={() => {
            void refreshFull();
            if (advancedUnlocked) void refreshAdvanced();
          }}
          disabled={busy}
        >
          <History className="h-4 w-4" />
          Refresh list
        </Button>
      </div>

      <div className="rounded-lg border border-amber-200 bg-amber-50/50 p-4 space-y-3">
        <div className="flex items-start gap-2">
          <Lock className="h-4 w-4 text-amber-800 mt-0.5 shrink-0" />
          <div>
            <h3 className="font-semibold text-slate-800">
              Advanced restore points
            </h3>
            <p className="text-sm text-slate-600 mt-1">
              Password required. These are extra snapshots — prefer{" "}
              <strong>Full cloud backups</strong> above for normal recovery.
            </p>
            <ul className="mt-2 text-sm text-slate-600 list-disc pl-4 space-y-1">
              <li>
                <strong>On this device</strong> — automatic copies saved in this
                browser only (after edits/sync). Useful if this phone/laptop
                still has a good local snapshot.
              </li>
              <li>
                <strong>Cloud history</strong> — short trail of past cloud
                uploads (each sync/upload). Not the same as daily full backups;
                use only if you need an older sync moment.
              </li>
            </ul>
          </div>
        </div>

        {!advancedUnlocked ? (
          <form onSubmit={unlockAdvanced} className="space-y-3 max-w-sm">
            <div className="space-y-1.5">
              <Label htmlFor="advanced-restore-pass">Password</Label>
              <Input
                id="advanced-restore-pass"
                type="password"
                autoComplete="current-password"
                value={advancedPassword}
                onChange={(e) => setAdvancedPassword(e.target.value)}
                required
              />
            </div>
            {advancedError ? (
              <p className="text-sm text-red-600" role="alert">
                {advancedError}
              </p>
            ) : null}
            <Button type="submit" className="gap-2">
              <Lock className="h-4 w-4" />
              Unlock advanced restore
            </Button>
          </form>
        ) : (
          <div className="space-y-5 pt-1">
            <div className="space-y-2">
              <h4 className="font-semibold text-slate-800">On this device</h4>
              <p className="text-xs text-slate-500">
                Local browser snapshots only — not shared with other phones.
              </p>
              {localBackups.length === 0 ? (
                <p className="text-sm text-slate-500">
                  No snapshots yet — they appear after you edit or sync.
                </p>
              ) : (
                <ul className="divide-y rounded-lg border bg-white max-h-64 overflow-auto">
                  {localBackups.slice(0, 25).map((b) => (
                    <li
                      key={b.id}
                      className="flex items-center justify-between gap-3 px-3 py-2 text-sm"
                    >
                      <div className="min-w-0">
                        <p className="font-medium text-slate-800 truncate">
                          {b.id === "last_good"
                            ? "Last good copy"
                            : b.summary}
                        </p>
                        <p className="text-xs text-slate-500">
                          {fmtWhen(b.createdAt)} · {b.reason}
                          {b.id !== "last_good" ? ` · ${b.summary}` : ""}
                        </p>
                      </div>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        className="gap-1 shrink-0"
                        disabled={busy || b.contentScore === 0}
                        onClick={() => void restoreLocal(b.id)}
                      >
                        <RotateCcw className="h-3.5 w-3.5" />
                        Restore
                      </Button>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className="space-y-2">
              <h4 className="font-semibold text-slate-800">Cloud history</h4>
              <p className="text-xs text-slate-500">
                Older sync uploads in Supabase — separate from daily full
                backups.
              </p>
              {cloudHistory.length === 0 ? (
                <p className="text-sm text-slate-500">
                  No cloud history yet. After Upload / Sync, history starts
                  recording.
                </p>
              ) : (
                <ul className="divide-y rounded-lg border bg-white max-h-64 overflow-auto">
                  {cloudHistory.map((h) => (
                    <li
                      key={h.id}
                      className="flex items-center justify-between gap-3 px-3 py-2 text-sm"
                    >
                      <div className="min-w-0">
                        <p className="font-medium text-slate-800 truncate">
                          {h.summary || "Snapshot"}
                        </p>
                        <p className="text-xs text-slate-500">
                          {fmtWhen(h.createdAt)} · {h.reason}
                        </p>
                      </div>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        className="gap-1 shrink-0"
                        disabled={busy}
                        onClick={() => void restoreCloud(h.id)}
                      >
                        <RotateCcw className="h-3.5 w-3.5" />
                        Restore
                      </Button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
