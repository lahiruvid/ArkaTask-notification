"use client";

import { useEffect } from "react";
import { RecoveryBanner } from "@/components/settings/recovery-banner";

/** Starts cloud pull/push so phone and laptop share one dataset. */
export function CloudSyncProvider({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    let cancelled = false;
    const afterSyncTimers: number[] = [];
    let keepAliveTimer = 0;

    void (async () => {
      const { bootstrapCloudSync, hasContentData } = await import("@/lib/cloud-sync");
      const { leanAppData, readStoreSnapshot } = await import("@/lib/store");
      const { saveLocalBackup } = await import("@/lib/backup");

      const snap = readStoreSnapshot();
      if (hasContentData(snap)) {
        void saveLocalBackup(leanAppData(snap), "boot");
      }

      await bootstrapCloudSync();
      if (cancelled) return;

      afterSyncTimers.push(
        window.setTimeout(() => {
          void import("@/lib/full-backup").then((m) => m.maybeSaveDailyFullBackup());
        }, 1500)
      );
      afterSyncTimers.push(
        window.setTimeout(() => {
          void import("@/lib/device-folder-backup").then((m) =>
            m.maybeSaveDailyDeviceBackup()
          );
        }, 2500)
      );
      afterSyncTimers.push(
        window.setTimeout(() => {
          void import("@/lib/email-backup").then((m) => m.maybeSendDailyEmailBackup());
        }, 3500)
      );
    })();

    keepAliveTimer = window.setTimeout(() => {
      void import("@/lib/cloud-keepalive").then((m) => m.maybeRunCloudKeepAlive());
    }, 8000);

    const onVisible = () => {
      if (document.visibilityState === "visible") {
        void import("@/lib/cloud-keepalive").then((m) => m.maybeRunCloudKeepAlive());
      }
    };
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      cancelled = true;
      window.clearTimeout(keepAliveTimer);
      for (const id of afterSyncTimers) window.clearTimeout(id);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  return (
    <>
      <RecoveryBanner />
      {children}
    </>
  );
}
