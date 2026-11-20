"use client";

import { FormEvent, useLayoutEffect, useState } from "react";
import { KeyRound, Lock, Phone, UserRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { EmployeeTiles } from "@/components/employee/employee-tiles";
import { requestEmployeeLogin } from "@/components/employee/employee-api";
import { loadSavedCloudConfig } from "@/lib/supabase";
import {
  changePassword,
  changeUsername,
  getUsername,
  login,
  loginEmployee,
  pullCredentialsFromCloud,
  readSession,
  type AuthSession,
} from "@/lib/auth";

type Panel = "login" | "username" | "password" | "employee";

export function AuthGate({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = useState(false);
  const [session, setSession] = useState<AuthSession | null>(null);
  const [panel, setPanel] = useState<Panel>("login");
  const [username, setUsername] = useState("admin");
  const [password, setPassword] = useState("");
  const [phone, setPhone] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Change username form
  const [cuCurrentPass, setCuCurrentPass] = useState("");
  const [cuNewUser, setCuNewUser] = useState("");

  // Change password form
  const [cpCurrentPass, setCpCurrentPass] = useState("");
  const [cpNewPass, setCpNewPass] = useState("");
  const [cpConfirm, setCpConfirm] = useState("");

  useLayoutEffect(() => {
    let cancelled = false;
    // Read session before paint so refresh does not sit on "Loading…".
    setUsername(getUsername());
    setSession(readSession());
    setReady(true);

    (async () => {
      const pulled = await Promise.race([
        pullCredentialsFromCloud(),
        new Promise<Awaited<ReturnType<typeof pullCredentialsFromCloud>>>(
          (resolve) =>
            setTimeout(
              () =>
                resolve({
                  ok: false,
                  applied: false,
                  message: "timeout",
                }),
              4000
            )
        ),
      ]);
      if (cancelled) return;
      setUsername(getUsername());
      if (pulled.applied) {
        setInfo("Login loaded from cloud.");
      }
      try {
        const { maybeRunCloudKeepAlive } = await import("@/lib/cloud-keepalive");
        void maybeRunCloudKeepAlive();
      } catch {
        /* optional */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const resetChangeForms = () => {
    setCuCurrentPass("");
    setCuNewUser("");
    setCpCurrentPass("");
    setCpNewPass("");
    setCpConfirm("");
  };

  const openPanel = (next: Panel) => {
    setError(null);
    setInfo(null);
    resetChangeForms();
    setPanel(next);
    if (next === "username") setCuNewUser(getUsername());
  };

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setInfo(null);
    if (login(username, password)) {
      setSession({ role: "owner" });
      setPassword("");
      return;
    }
    setError("Wrong username or password.");
  };

  const handleEmployeeSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!loadSavedCloudConfig()) {
      setPanel("login");
      return;
    }
    setBusy(true);
    setError(null);
    setInfo(null);
    try {
      const result = await requestEmployeeLogin(phone);
      const next: AuthSession = {
        role: "employee",
        employeeId: result.employeeId,
        name: result.name,
        token: result.token,
        todayDate: result.todayDate,
        tomorrowDate: result.tomorrowDate,
        today: result.today ?? [],
        tomorrow: result.tomorrow ?? [],
      };
      loginEmployee(next);
      setPhone("");
      setSession(next);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "No employee found with that phone number."
      );
    } finally {
      setBusy(false);
    }
  };

  const handleChangeUsername = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setInfo(null);
    const result = await changeUsername(cuCurrentPass, cuNewUser);
    setBusy(false);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    setInfo(result.message);
    setUsername(getUsername());
    resetChangeForms();
    setPanel("login");
  };

  const handleChangePassword = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setInfo(null);
    const result = await changePassword(cpCurrentPass, cpNewPass, cpConfirm);
    setBusy(false);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    setInfo(result.message);
    resetChangeForms();
    setPanel("login");
  };

  if (!ready) {
    return <div className="min-h-screen bg-slate-50" />;
  }

  const employeeLoginEnabled = loadSavedCloudConfig() !== null;
  const shownPanel = employeeLoginEnabled || panel !== "employee" ? panel : "login";

  if (session?.role === "employee" && employeeLoginEnabled) {
    return (
      <EmployeeTiles
        name={session.name}
        token={session.token}
        todayDate={session.todayDate}
        tomorrowDate={session.tomorrowDate}
        today={session.today}
        tomorrow={session.tomorrow}
        onSignedOut={() => {
          setSession(null);
          setPanel("login");
          setError(null);
          setInfo(null);
        }}
      />
    );
  }

  if (session?.role !== "owner") {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
        <div className="w-full max-w-sm rounded-xl border bg-white p-6 shadow-sm space-y-5">
          <div className="flex items-center gap-3">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/favicon.svg"
              alt=""
              width={40}
              height={40}
              className="h-10 w-10 rounded-xl shadow-sm"
            />
            <div>
              <h1 className="text-xl font-black tracking-tight text-slate-900">
                ArkaTasks
              </h1>
              <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                {shownPanel === "login"
                  ? "Sign in"
                  : shownPanel === "employee"
                    ? "Employee login"
                    : shownPanel === "username"
                      ? "Change username"
                      : "Change password"}
              </p>
            </div>
          </div>

          {info ? (
            <p className="text-sm text-teal-700 font-medium">{info}</p>
          ) : null}
          {error ? (
            <p className="text-sm text-red-600" role="alert">
              {error}
            </p>
          ) : null}

          {shownPanel === "login" ? (
            <>
              <form onSubmit={handleSubmit} className="space-y-3">
                <div className="space-y-1.5">
                  <Label htmlFor="login-user">Username</Label>
                  <Input
                    id="login-user"
                    autoComplete="username"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    required
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="login-pass">Password</Label>
                  <Input
                    id="login-pass"
                    type="password"
                    autoComplete="current-password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                  />
                </div>
                <Button type="submit" className="w-full gap-2">
                  <Lock className="h-4 w-4" />
                  Sign in
                </Button>
              </form>

              <div className="pt-1 border-t space-y-2">
                <p className="text-xs text-slate-500">
                  Forgot? Ask your developer — they can see the login in
                  Supabase → <span className="font-medium">app_login</span>.
                </p>
                <div className="flex flex-wrap gap-2">
                  {employeeLoginEnabled ? (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="gap-1.5"
                      onClick={() => openPanel("employee")}
                    >
                      <Phone className="h-3.5 w-3.5" />
                      Employee Login
                    </Button>
                  ) : null}
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="gap-1.5"
                    onClick={() => openPanel("username")}
                  >
                    <UserRound className="h-3.5 w-3.5" />
                    Change username
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="gap-1.5"
                    onClick={() => openPanel("password")}
                  >
                    <KeyRound className="h-3.5 w-3.5" />
                    Change password
                  </Button>
                </div>
              </div>
            </>
          ) : null}

          {shownPanel === "employee" ? (
            <form onSubmit={handleEmployeeSubmit} className="space-y-3">
              <div className="space-y-1.5">
                <Label htmlFor="login-phone">Phone number</Label>
                <Input
                  id="login-phone"
                  type="tel"
                  inputMode="tel"
                  autoComplete="tel"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  required
                />
              </div>
              <Button type="submit" className="w-full gap-2" disabled={busy}>
                <Phone className="h-4 w-4" />
                {busy ? "Signing in…" : "Sign in"}
              </Button>
              <Button
                type="button"
                variant="ghost"
                className="w-full"
                onClick={() => openPanel("login")}
              >
                Back to sign in
              </Button>
            </form>
          ) : null}

          {shownPanel === "username" ? (
            <form onSubmit={handleChangeUsername} className="space-y-3">
              <div className="space-y-1.5">
                <Label htmlFor="cu-pass">Current password</Label>
                <Input
                  id="cu-pass"
                  type="password"
                  autoComplete="current-password"
                  value={cuCurrentPass}
                  onChange={(e) => setCuCurrentPass(e.target.value)}
                  required
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="cu-user">New username</Label>
                <Input
                  id="cu-user"
                  autoComplete="username"
                  value={cuNewUser}
                  onChange={(e) => setCuNewUser(e.target.value)}
                  required
                />
              </div>
              <Button type="submit" className="w-full gap-2" disabled={busy}>
                <UserRound className="h-4 w-4" />
                {busy ? "Saving…" : "Save username"}
              </Button>
              <Button
                type="button"
                variant="ghost"
                className="w-full"
                disabled={busy}
                onClick={() => openPanel("login")}
              >
                Back to sign in
              </Button>
            </form>
          ) : null}

          {shownPanel === "password" ? (
            <form onSubmit={handleChangePassword} className="space-y-3">
              <div className="space-y-1.5">
                <Label htmlFor="cp-current">Current password</Label>
                <Input
                  id="cp-current"
                  type="password"
                  autoComplete="current-password"
                  value={cpCurrentPass}
                  onChange={(e) => setCpCurrentPass(e.target.value)}
                  required
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="cp-new">New password</Label>
                <Input
                  id="cp-new"
                  type="password"
                  autoComplete="new-password"
                  value={cpNewPass}
                  onChange={(e) => setCpNewPass(e.target.value)}
                  required
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="cp-confirm">Confirm new password</Label>
                <Input
                  id="cp-confirm"
                  type="password"
                  autoComplete="new-password"
                  value={cpConfirm}
                  onChange={(e) => setCpConfirm(e.target.value)}
                  required
                />
              </div>
              <Button type="submit" className="w-full gap-2" disabled={busy}>
                <KeyRound className="h-4 w-4" />
                {busy ? "Saving…" : "Save password"}
              </Button>
              <Button
                type="button"
                variant="ghost"
                className="w-full"
                disabled={busy}
                onClick={() => openPanel("login")}
              >
                Back to sign in
              </Button>
            </form>
          ) : null}
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
