"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Cloud,
  RefreshCw,
  CheckCircle2,
  AlertCircle,
  Download,
  Eraser,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  connectAndSync,
  contentSummary,
  disconnectCloud,
  forcePullFromCloud,
  getSyncStatus,
  hasContentData,
  pullFromCloud,
  pushToCloud,
  resetCloudSyncState,
  subscribeSyncStatus,
} from "@/lib/cloud-sync";
import { readStoreSnapshot } from "@/lib/store";
import {
  loadSavedCloudConfig,
  saveCloudConfig,
  setCloudDisabled,
  type CloudConfig,
} from "@/lib/supabase";

export function SyncClient({ embedded = false }: { embedded?: boolean }) {
  const [url, setUrl] = useState("");
  const [key, setKey] = useState("");
  const [status, setStatus] = useState(getSyncStatus());
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [pendingConfig, setPendingConfig] = useState<CloudConfig | null>(null);
  const [localSummary, setLocalSummary] = useState("");

  useEffect(() => {
    const saved = loadSavedCloudConfig();
    if (saved) {
      setUrl(saved.supabaseUrl);
      setKey(saved.supabaseAnonKey);
    }
    return subscribeSyncStatus(() => setStatus(getSyncStatus()));
  }, []);

  const runConnect = useCallback(async (config: CloudConfig) => {
    setBusy(true);
    setMessage(null);
    setConfirmOpen(false);
    setPendingConfig(null);
    resetCloudSyncState();
    saveCloudConfig(config);
    // Always clear local and load from this cloud — never upload on connect
    const result = await connectAndSync();
    setMessage(result.message);
    setBusy(false);
  }, []);

  const save = useCallback(async () => {
    const config: CloudConfig = {
      supabaseUrl: url.trim(),
      supabaseAnonKey: key.trim(),
    };
    if (!config.supabaseUrl || !config.supabaseAnonKey) {
      setMessage("Enter Project URL and anon public key first.");
      return;
    }

    const local = readStoreSnapshot();
    if (hasContentData(local)) {
      setLocalSummary(contentSummary(local));
      setPendingConfig(config);
      setConfirmOpen(true);
      return;
    }

    await runConnect(config);
  }, [url, key, runConnect]);

  const syncNow = async () => {
    setBusy(true);
    setMessage(null);
    const pull = await pullFromCloud({ respectPendingWrite: false });
    if (pull === "skip") {
      const s = getSyncStatus();
      setMessage(
        s.status === "not_configured"
          ? "Cloud not connected — save Project URL and anon key first."
          : s.lastError || "Sync failed."
      );
      setBusy(false);
      return;
    }

    const local = readStoreSnapshot();
    if (pull === "applied" || pull === "merged") {
      setMessage(
        `Synced (merge — nothing deleted): ${contentSummary(local)}.`
      );
    } else if (pull === "uploaded") {
      setMessage(`Uploaded to cloud: ${contentSummary(local)}.`);
    } else if (pull === "empty") {
      setMessage(
        "No places/employees/jobs in cloud yet. Add data on one device, tap Sync now, then Sync now on the other."
      );
    } else {
      setMessage(
        hasContentData(local)
          ? `Already up to date (${contentSummary(local)}).`
          : "Synced — no work data yet."
      );
    }
    setBusy(false);
  };

  const downloadFromCloud = async () => {
    if (
      !window.confirm(
        "Merge cloud data into THIS device? Local places/jobs are kept — nothing is wiped."
      )
    ) {
      return;
    }
    setBusy(true);
    setMessage(null);
    const result = await forcePullFromCloud();
    const local = readStoreSnapshot();
    if (result === "applied" || result === "merged") {
      setMessage(`Merged from cloud: ${contentSummary(local)}.`);
    } else if (result === "empty") {
      setMessage("Cloud has no places/employees/jobs to download.");
    } else if (result === "skip") {
      const s = getSyncStatus();
      setMessage(s.lastError || "Download failed.");
    } else if (result === "kept_local") {
      setMessage("Kept local data (cloud was thinner — blocked wipe).");
    } else {
      setMessage("Download finished.");
    }
    setBusy(false);
  };

  const uploadToCloud = async () => {
    const local = readStoreSnapshot();
    if (!hasContentData(local)) {
      setMessage("Nothing to upload — this device has no places/employees/jobs.");
      return;
    }
    if (
      !window.confirm(
        `Merge this device’s data into cloud?\n${contentSummary(local)}\n\nExisting cloud places/employees/jobs are kept. Cloud is not cleared. Other devices: Save & connect to load.`
      )
    ) {
      return;
    }
    setBusy(true);
    setMessage(null);
    resetCloudSyncState();
    const ok = await pushToCloud(true, { allowShrink: false, replace: false });
    const s = getSyncStatus();
    setMessage(
      ok
        ? `Merged into cloud (nothing cleared): ${contentSummary(local)}. Other devices: Save & connect.`
        : s.lastError || "Upload failed."
    );
    setBusy(false);
  };

  const clear = () => {
    saveCloudConfig(null);
    setCloudDisabled(true);
    disconnectCloud();
    setUrl("");
    setKey("");
    setMessage("Cloud disconnected on this device (local data kept)");
  };

  const statusLabel =
    status.status === "synced"
      ? "Synced"
      : status.status === "syncing"
        ? "Syncing…"
        : status.status === "error"
          ? "Error"
          : status.status === "not_configured"
            ? "Not connected"
            : "Ready";

  return (
    <div className={embedded ? "space-y-4" : "space-y-6 max-w-xl"}>
      <div>
        {embedded ? (
          <h2 className="text-xl font-bold text-slate-800">Cloud Sync</h2>
        ) : (
          <h1 className="text-3xl font-bold text-slate-800">Cloud Sync</h1>
        )}
        <p className="text-slate-500 mt-1">
          Free storage (Supabase) so phone and laptop share schedules. Save
          &amp; connect always clears this device and loads from that cloud —
          it never uploads local data into the cloud.
        </p>
      </div>

      <div className="rounded-lg border bg-white p-5 shadow-sm space-y-3">
        <div className="flex items-center gap-2 text-sm">
          <Cloud className="h-4 w-4 text-teal-600" />
          <span className="font-medium text-slate-800">Status: {statusLabel}</span>
          {status.status === "synced" && (
            <CheckCircle2 className="h-4 w-4 text-emerald-600" />
          )}
          {status.status === "error" && (
            <AlertCircle className="h-4 w-4 text-red-500" />
          )}
        </div>
        {status.lastError && (
          <p className="text-sm text-red-600">{status.lastError}</p>
        )}
        {message && (
          <p
            className={
              /fail|error|could not|not connected/i.test(message)
                ? "text-sm text-amber-800"
                : "text-sm text-teal-700"
            }
          >
            {message}
          </p>
        )}
      </div>

      <div className="rounded-lg border bg-white p-5 shadow-sm space-y-4">
        <h2 className="font-semibold text-slate-800">Setup (once, free)</h2>
        <ol className="text-sm text-slate-600 space-y-2 list-decimal pl-5">
          <li>
            Create a free project at{" "}
            <a
              className="text-teal-700 underline"
              href="https://supabase.com"
              target="_blank"
              rel="noreferrer"
            >
              supabase.com
            </a>{" "}
            and run <code className="text-xs bg-slate-100 px-1 rounded">schema.sql</code>
          </li>
          <li>
            Project Settings → API → copy <strong>Project URL</strong> and{" "}
            <strong>anon public</strong> key
          </li>
          <li>
            Paste keys → <strong>Save &amp; connect</strong> — clears this
            device and downloads from that cloud
          </li>
        </ol>

        <div className="space-y-2">
          <Label>Project URL</Label>
          <Input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://xxxx.supabase.co"
            autoComplete="off"
          />
          <p className="text-xs text-slate-500">
            Use only the base URL — no <code>/rest/v1</code> at the end.
          </p>
        </div>
        <div className="space-y-2">
          <Label>anon public key</Label>
          <Input
            value={key}
            onChange={(e) => setKey(e.target.value)}
            placeholder="eyJhbGciOi..."
            autoComplete="off"
          />
        </div>

        <div className="flex flex-wrap gap-2">
          <Button onClick={() => void save()} disabled={busy || !url.trim() || !key.trim()}>
            Save &amp; connect
          </Button>
          <Button
            type="button"
            variant="outline"
            className="gap-2"
            onClick={() => void syncNow()}
            disabled={busy}
          >
            <RefreshCw className="h-4 w-4" />
            Sync now
          </Button>
          <Button
            type="button"
            variant="outline"
            className="gap-2"
            onClick={() => void downloadFromCloud()}
            disabled={busy}
          >
            <Download className="h-4 w-4" />
            Download from cloud
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={() => void uploadToCloud()}
            disabled={busy}
          >
            Upload to cloud
          </Button>
          <Button type="button" variant="ghost" onClick={clear} disabled={busy}>
            Disconnect
          </Button>
        </div>
      </div>

      <p className="text-xs text-slate-500">
        Save &amp; connect never uploads. <strong>Upload to cloud</strong> merges
        this device into cloud without clearing existing cloud rows.
      </p>

      <Dialog
        open={confirmOpen}
        onOpenChange={(open) => {
          if (busy) return;
          setConfirmOpen(open);
          if (!open) setPendingConfig(null);
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Clear local and load cloud?</DialogTitle>
            <DialogDescription>
              This device has data ({localSummary}). Save &amp; connect will{" "}
              <strong>clear it</strong> and download from the Project URL you
              entered. Cloud data is never cleared by this step.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 pt-1">
            <Button
              type="button"
              className="w-full gap-2 h-auto py-3 flex-col items-start text-left bg-amber-700 hover:bg-amber-800"
              disabled={busy || !pendingConfig}
              onClick={() => pendingConfig && void runConnect(pendingConfig)}
            >
              <span className="flex items-center gap-2 font-semibold">
                <Eraser className="h-4 w-4" />
                Clear local &amp; get data from cloud
              </span>
              <span className="text-xs font-normal opacity-90">
                Wipe this device’s schedules and load whatever is in that cloud.
              </span>
            </Button>
            <Button
              type="button"
              variant="ghost"
              className="w-full"
              disabled={busy}
              onClick={() => {
                setConfirmOpen(false);
                setPendingConfig(null);
              }}
            >
              Cancel
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
