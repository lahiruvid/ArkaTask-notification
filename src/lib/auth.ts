/**
 * Simple client-side gate for a single-user static app.
 * Session persists across reloads; Settings still asks for the password each visit.
 * Credentials also sync to Supabase `app_login` so the developer can look them up.
 */

import { getSupabaseClient } from "@/lib/supabase";

const SESSION_KEY = "dclean_auth_session_v1";
const CRED_KEY = "dclean_auth_cred_v1";

export const DEFAULT_USERNAME = "admin";
export const DEFAULT_PASSWORD = "admin";

export type StoredCred = {
  username: string;
  password: string;
};

function readCred(): StoredCred {
  if (typeof window === "undefined") {
    return { username: DEFAULT_USERNAME, password: DEFAULT_PASSWORD };
  }
  try {
    const raw = localStorage.getItem(CRED_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<StoredCred>;
      const username = (parsed.username || "").trim() || DEFAULT_USERNAME;
      const password =
        parsed.password !== undefined && parsed.password !== null
          ? String(parsed.password)
          : DEFAULT_PASSWORD;
      return { username, password };
    }
  } catch {
    /* ignore */
  }
  return { username: DEFAULT_USERNAME, password: DEFAULT_PASSWORD };
}

function writeCred(cred: StoredCred) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(
      CRED_KEY,
      JSON.stringify({
        username: cred.username.trim() || DEFAULT_USERNAME,
        password: cred.password.length > 0 ? cred.password : DEFAULT_PASSWORD,
      } satisfies StoredCred)
    );
  } catch {
    /* ignore */
  }
}

export function getUsername(): string {
  return readCred().username;
}

export function getCredentials(): StoredCred {
  return readCred();
}

export function isLoggedIn(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return localStorage.getItem(SESSION_KEY) === "1";
  } catch {
    return false;
  }
}

export function login(username: string, password: string): boolean {
  const cred = readCred();
  const u = username.trim();
  if (u !== cred.username || password !== cred.password) {
    return false;
  }
  try {
    localStorage.setItem(SESSION_KEY, "1");
  } catch {
    /* ignore */
  }
  return true;
}

export function logout() {
  try {
    localStorage.removeItem(SESSION_KEY);
  } catch {
    /* ignore */
  }
}

/** Settings / sensitive actions — password only (username already logged in). */
export function verifyPassword(password: string): boolean {
  return password === readCred().password;
}

/** Write credentials locally (and optionally push to cloud). */
export function setCredentials(username: string, password: string) {
  writeCred({
    username: username.trim() || DEFAULT_USERNAME,
    password: password.length > 0 ? password : DEFAULT_PASSWORD,
  });
}

/** Push current local credentials to Supabase `app_login` (plain text for recovery). */
export async function pushCredentialsToCloud(): Promise<{
  ok: boolean;
  message: string;
}> {
  try {
    const supabase = await getSupabaseClient();
    if (!supabase) {
      return {
        ok: false,
        message:
          "Cloud not connected — credentials saved on this device only. Connect cloud in Settings to back them up.",
      };
    }
    const cred = readCred();
    const now = new Date().toISOString();
    const { error } = await supabase.from("app_login").upsert(
      {
        id: "main",
        username: cred.username,
        password: cred.password,
        updated_at: now,
      },
      { onConflict: "id" }
    );
    if (error) {
      return {
        ok: false,
        message:
          error.message.includes("app_login") || error.code === "42P01"
            ? "Cloud table app_login missing — run the latest schema.sql in Supabase SQL Editor."
            : error.message,
      };
    }
    return { ok: true, message: "Saved to cloud (Supabase → app_login)." };
  } catch (e) {
    return {
      ok: false,
      message: e instanceof Error ? e.message : "Could not save to cloud.",
    };
  }
}

/**
 * Pull credentials from Supabase into this device.
 * Used on the login screen so devices share the same username/password.
 */
export async function pullCredentialsFromCloud(): Promise<{
  ok: boolean;
  applied: boolean;
  message: string;
}> {
  try {
    const supabase = await getSupabaseClient();
    if (!supabase) {
      return { ok: false, applied: false, message: "Cloud not configured." };
    }
    const { data, error } = await supabase
      .from("app_login")
      .select("username, password, updated_at")
      .eq("id", "main")
      .maybeSingle();
    if (error) {
      return {
        ok: false,
        applied: false,
        message:
          error.message.includes("app_login") || error.code === "42P01"
            ? "Cloud table app_login missing — run schema.sql."
            : error.message,
      };
    }
    if (!data) {
      // Never seed cloud with factory defaults (admin/admin) — that can wipe a real password.
      const local = readCred();
      const isFactoryDefault =
        local.username === DEFAULT_USERNAME &&
        local.password === DEFAULT_PASSWORD;
      if (isFactoryDefault) {
        return {
          ok: true,
          applied: false,
          message:
            "No cloud login yet. Change username/password once to create app_login, or keep using local.",
        };
      }
      const push = await pushCredentialsToCloud();
      return {
        ok: push.ok,
        applied: false,
        message: push.ok
          ? "Created app_login from this device."
          : push.message,
      };
    }
    const username = String(data.username ?? "").trim() || DEFAULT_USERNAME;
    const password =
      data.password !== undefined && data.password !== null
        ? String(data.password)
        : DEFAULT_PASSWORD;
    const local = readCred();
    if (local.username === username && local.password === password) {
      return { ok: true, applied: false, message: "Credentials already match cloud." };
    }
    writeCred({ username, password });
    return {
      ok: true,
      applied: true,
      message: "Loaded username/password from cloud.",
    };
  } catch (e) {
    return {
      ok: false,
      applied: false,
      message: e instanceof Error ? e.message : "Could not load from cloud.",
    };
  }
}

export async function changeUsername(
  currentPassword: string,
  newUsername: string
): Promise<{ ok: boolean; message: string }> {
  const cred = readCred();
  if (currentPassword !== cred.password) {
    return { ok: false, message: "Current password is wrong." };
  }
  const next = newUsername.trim();
  if (!next) {
    return { ok: false, message: "New username cannot be empty." };
  }
  if (next === cred.username) {
    return { ok: false, message: "That is already the username." };
  }
  writeCred({ username: next, password: cred.password });
  const cloud = await pushCredentialsToCloud();
  return {
    ok: true,
    message: cloud.ok
      ? `Username changed to “${next}”. Also saved in Supabase → Table Editor → app_login.`
      : `Username changed to “${next}” on this device. ${cloud.message}`,
  };
}

export async function changePassword(
  currentPassword: string,
  newPassword: string,
  confirmPassword: string
): Promise<{ ok: boolean; message: string }> {
  const cred = readCred();
  if (currentPassword !== cred.password) {
    return { ok: false, message: "Current password is wrong." };
  }
  if (!newPassword) {
    return { ok: false, message: "New password cannot be empty." };
  }
  if (newPassword !== confirmPassword) {
    return { ok: false, message: "New password and confirmation do not match." };
  }
  if (newPassword === cred.password) {
    return { ok: false, message: "That is already the password." };
  }
  writeCred({ username: cred.username, password: newPassword });
  const cloud = await pushCredentialsToCloud();
  return {
    ok: true,
    message: cloud.ok
      ? "Password changed. Also saved in Supabase → Table Editor → app_login."
      : `Password changed on this device. ${cloud.message}`,
  };
}
