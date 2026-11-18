"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/** Old Cloud Sync URL — now lives under Settings. */
export default function SyncPage() {
  const router = useRouter();
  useEffect(() => {
    router.replace("/settings");
  }, [router]);
  return null;
}
