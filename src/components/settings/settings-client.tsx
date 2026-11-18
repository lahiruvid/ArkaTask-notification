"use client";

import { useCallback, useEffect, useState } from "react";
import { Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SyncClient } from "@/components/sync/sync-client";
import { BackupRestoreClient } from "@/components/settings/backup-restore-client";
import { CloudKeepAliveClient } from "@/components/settings/cloud-keepalive-client";
import { DeviceFolderBackupClient } from "@/components/settings/device-folder-backup-client";
import { getSettings, saveSettings, SYNC_EVENT } from "@/lib/store";

export function SettingsClient() {
  const [companyName, setCompanyName] = useState("");
  const [whatsapp, setWhatsapp] = useState("");
  const [savedMsg, setSavedMsg] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);

  const sync = useCallback(() => {
    if (dirty) return;
    const s = getSettings();
    setCompanyName(s.company_name);
    setWhatsapp(s.whatsapp ?? "");
  }, [dirty]);

  useEffect(() => {
    sync();
    window.addEventListener(SYNC_EVENT, sync);
    return () => window.removeEventListener(SYNC_EVENT, sync);
  }, [sync]);

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    saveSettings({
      company_name: companyName,
      whatsapp: whatsapp.trim() || null,
    });
    setDirty(false);
    setSavedMsg("Saved.");
    const s = getSettings();
    setCompanyName(s.company_name);
    setWhatsapp(s.whatsapp ?? "");
    window.setTimeout(() => setSavedMsg(null), 2500);
  };

  return (
    <div className="space-y-8 max-w-xl">
      <div>
        <h1 className="text-3xl font-bold text-slate-800">Settings</h1>
        <p className="text-slate-500 mt-1">
          Company details, cloud sync, and permanent backup / recovery.
        </p>
      </div>

      <form
        onSubmit={handleSave}
        className="rounded-xl border bg-white p-5 shadow-sm space-y-4"
      >
        <h2 className="text-xl font-bold text-slate-800">Company</h2>
        <div className="space-y-2">
          <Label>Company name</Label>
          <Input
            value={companyName}
            onChange={(e) => {
              setDirty(true);
              setCompanyName(e.target.value);
            }}
            placeholder="DClean"
            required
          />
          <p className="text-xs text-slate-500">
            Shown at the top of PDF reports.
          </p>
        </div>
        <div className="space-y-2">
          <Label>Your WhatsApp number</Label>
          <Input
            value={whatsapp}
            onChange={(e) => {
              setDirty(true);
              setWhatsapp(e.target.value);
            }}
            placeholder="393331234567"
            inputMode="tel"
          />
          <p className="text-xs text-slate-500">
            International format, no +. Every report WhatsApp send also opens
            your chat.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Button type="submit" className="gap-2">
            <Save className="h-4 w-4" />
            Save settings
          </Button>
          {savedMsg ? (
            <span className="text-sm text-teal-700 font-medium">{savedMsg}</span>
          ) : null}
        </div>
      </form>

      <BackupRestoreClient />

      <DeviceFolderBackupClient />

      <CloudKeepAliveClient />

      <SyncClient embedded />
    </div>
  );
}
