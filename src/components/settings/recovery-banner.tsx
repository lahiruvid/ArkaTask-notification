"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, RotateCcw, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { getLastGoodBackup } from "@/lib/backup";
import { hasContentData } from "@/lib/cloud-sync";
import { readStoreSnapshot, restoreAppData, SYNC_EVENT } from "@/lib/store";

/**
 * If this device looks empty but IndexedDB still has a last_good snapshot,
 * offer one-tap restore (survives accidental wipe / empty sync).
 * Re-checks after cloud sync so a late pull can hide a false empty banner.
 */
export function RecoveryBanner() {
  const [open, setOpen] = useState(false);
  const [summary, setSummary] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;

    const check = async () => {
      const local = readStoreSnapshot();
      if (hasContentData(local)) {
        if (!cancelled) setOpen(false);
        return;
      }
      const good = await getLastGoodBackup();
      if (cancelled || !good || good.contentScore <= 0) return;
      setSummary(good.summary);
      setOpen(true);
    };

    void check();
    // Cloud pull often finishes a few seconds after boot — recheck then.
    const t1 = window.setTimeout(() => void check(), 2500);
    const t2 = window.setTimeout(() => void check(), 8000);
    const onSync = () => void check();
    window.addEventListener(SYNC_EVENT, onSync);

    return () => {
      cancelled = true;
      window.clearTimeout(t1);
      window.clearTimeout(t2);
      window.removeEventListener(SYNC_EVENT, onSync);
    };
  }, []);

  if (!open) return null;

  return (
    <div className="border-b border-amber-200 bg-amber-50 px-4 py-3">
      <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-3">
        <div className="flex items-start gap-2 text-sm text-amber-950">
          <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
          <p>
            This device looks empty, but a local backup is available:{" "}
            <span className="font-semibold">{summary}</span>. Restore it?
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            className="gap-1"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              const good = await getLastGoodBackup();
              if (good?.payload) {
                const ok = restoreAppData(good.payload, "recovery-banner");
                if (!ok) {
                  window.alert(
                    "Restore blocked — backup was empty or smaller than current data."
                  );
                  setBusy(false);
                  return;
                }
              }
              setOpen(false);
              setBusy(false);
            }}
          >
            <RotateCcw className="h-3.5 w-3.5" />
            Restore backup
          </Button>
          <Button
            size="sm"
            variant="ghost"
            disabled={busy}
            onClick={() => setOpen(false)}
            aria-label="Dismiss"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}
