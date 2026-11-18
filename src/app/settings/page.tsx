import { SettingsClient } from "@/components/settings/settings-client";
import { SettingsLock } from "@/components/auth/settings-lock";

export default function SettingsPage() {
  return (
    <SettingsLock>
      <SettingsClient />
    </SettingsLock>
  );
}
