"use client";

import { FormEvent, useState } from "react";
import { Lock, Shield } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { verifyPassword } from "@/lib/auth";

/**
 * Settings requires the password on every visit (session unlock is not stored).
 */
export function SettingsLock({ children }: { children: React.ReactNode }) {
  const [unlocked, setUnlocked] = useState(false);
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (verifyPassword(password)) {
      setUnlocked(true);
      setPassword("");
      return;
    }
    setError("Wrong password.");
  };

  if (!unlocked) {
    return (
      <div className="mx-auto max-w-sm space-y-6">
        <div>
          <h1 className="text-3xl font-bold text-slate-800">Settings</h1>
          <p className="text-slate-500 mt-1">
            Enter your password to open settings.
          </p>
        </div>
        <form
          onSubmit={handleSubmit}
          className="rounded-xl border bg-white p-5 shadow-sm space-y-4"
        >
          <div className="flex items-center gap-2 text-slate-700">
            <Shield className="h-5 w-5 text-teal-600" />
            <p className="text-sm font-medium">Password required</p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="settings-pass">Password</Label>
            <Input
              id="settings-pass"
              type="password"
              autoComplete="current-password"
              autoFocus
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </div>
          {error && (
            <p className="text-sm text-red-600" role="alert">
              {error}
            </p>
          )}
          <Button type="submit" className="w-full gap-2">
            <Lock className="h-4 w-4" />
            Unlock settings
          </Button>
        </form>
      </div>
    );
  }

  return <>{children}</>;
}
