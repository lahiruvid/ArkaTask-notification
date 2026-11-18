/**
 * Daily email backup — 100% free via FormSubmit (no API keys, no paid plan).
 * Destination: dcleanmilanoitalia@gmail.com
 *
 * First submission only: FormSubmit emails “Activate Form” to that inbox.
 * After one click Activate, daily backups arrive at no cost.
 */
import type { AppData } from "@/types/database";
import { leanAppData, readStoreSnapshot } from "@/lib/store";
import { saveLocalBackup, summarizeData } from "@/lib/backup";
import { hasContentData } from "@/lib/cloud-sync";

/** Owner inbox for free daily backups (FormSubmit). */
export const BACKUP_EMAIL = "dcleanmilanoitalia@gmail.com";

const SENT_KEY = "dclean_email_backup_day_v2";
const STATUS_KEY = "dclean_email_backup_status_v2";
const ACTIVATED_KEY = "dclean_formsubmit_activated_v2";
const MARKER = "ARKATASK_BACKUP_V1";
/** FormSubmit AJAX bodies often fail above ~45–60KB */
const MAX_JSON_CHARS = 45000;

export type EmailBackupStatus = {
  at: number;
  ok: boolean;
  message: string;
  day?: string;
};

function todayKeyLocal(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function alreadySentToday(): boolean {
  if (typeof window === "undefined") return true;
  try {
    return localStorage.getItem(SENT_KEY) === todayKeyLocal();
  } catch {
    return false;
  }
}

function markSentToday() {
  try {
    localStorage.setItem(SENT_KEY, todayKeyLocal());
  } catch {
    /* ignore */
  }
}

function isFormSubmitActivated(): boolean {
  try {
    return localStorage.getItem(ACTIVATED_KEY) === BACKUP_EMAIL;
  } catch {
    return false;
  }
}

function markFormSubmitActivated() {
  try {
    localStorage.setItem(ACTIVATED_KEY, BACKUP_EMAIL);
  } catch {
    /* ignore */
  }
}

function setStatus(ok: boolean, message: string, day?: string) {
  try {
    const row: EmailBackupStatus = {
      at: Date.now(),
      ok,
      message,
      day,
    };
    localStorage.setItem(STATUS_KEY, JSON.stringify(row));
  } catch {
    /* ignore */
  }
}

export function getEmailBackupStatus(): EmailBackupStatus | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(STATUS_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as EmailBackupStatus;
  } catch {
    return null;
  }
}

export function getBackupEmailAddress(): string {
  return BACKUP_EMAIL;
}

/** Build the restore package (same shape Settings → Import expects). */
export function buildEmailBackupPayload(data: AppData): {
  marker: string;
  exportedAt: string;
  summary: string;
  data: AppData;
} {
  const lean = leanAppData(data);
  return {
    marker: MARKER,
    exportedAt: new Date().toISOString(),
    summary: summarizeData(lean),
    data: lean,
  };
}

/**
 * Parse a pasted email backup / JSON file for restore.
 * Accepts raw AppData, email wrapper { marker, data }, or BEGIN/END markers.
 */
export function parseEmailBackupJson(raw: string): AppData {
  let text = raw.trim();
  const begin = `-----BEGIN ${MARKER}-----`;
  const end = `-----END ${MARKER}-----`;
  const beginIdx = text.indexOf(begin);
  const endIdx = text.indexOf(end);
  if (beginIdx >= 0 && endIdx > beginIdx) {
    text = text.slice(beginIdx + begin.length, endIdx).trim();
  }

  const parsed = JSON.parse(text) as unknown;
  if (!parsed || typeof parsed !== "object") {
    throw new Error("Invalid backup JSON");
  }
  const obj = parsed as Record<string, unknown>;
  if (obj.marker === MARKER && obj.data && typeof obj.data === "object") {
    const inner = obj.data as Record<string, unknown>;
    // Summary-only email (counts, not arrays) cannot be restored
    if (
      typeof obj.note === "string" ||
      !Array.isArray(inner.properties) ||
      !Array.isArray(inner.employees) ||
      !Array.isArray(inner.jobs)
    ) {
      throw new Error(
        "This email backup is a summary only (file too large for email). Use Settings → Download JSON, or restore from device/cloud backups."
      );
    }
    return leanAppData(obj.data as unknown as AppData);
  }
  if (
    obj.data &&
    typeof obj.data === "object" &&
    Array.isArray((obj.data as AppData).jobs)
  ) {
    return leanAppData(obj.data as unknown as AppData);
  }
  return leanAppData(obj as unknown as AppData);
}

type FormSubmitResult = {
  ok: boolean;
  needsActivation: boolean;
  message: string;
};

/** Free FormSubmit AJAX — no account fees, no API key. */
async function postFormSubmit(
  fields: Record<string, string>
): Promise<FormSubmitResult> {
  const res = await fetch(
    `https://formsubmit.co/ajax/${encodeURIComponent(BACKUP_EMAIL)}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        _captcha: "false",
        _template: "box",
        ...fields,
      }),
    }
  );

  const body = (await res.json().catch(() => null)) as {
    success?: string | boolean;
    message?: string;
  } | null;

  const message = (body?.message || "").trim();
  const needsActivation = /activat/i.test(message);
  const ok =
    res.ok &&
    (body?.success === "true" || body?.success === true) &&
    !needsActivation;

  return {
    ok,
    needsActivation,
    message:
      message ||
      (ok
        ? "Sent."
        : res.ok
          ? "FormSubmit did not accept the email."
          : `HTTP ${res.status}`),
  };
}

/** Tiny ping — triggers FormSubmit’s free “Activate Form” email once. */
async function sendActivationPing(): Promise<FormSubmitResult> {
  return postFormSubmit({
    _subject: "ArkaTasks — confirm free email backups",
    name: "ArkaTasks",
    email: BACKUP_EMAIL,
    message:
      "Please click Activate / Confirm so ArkaTasks can send free daily backups to dcleanmilanoitalia@gmail.com. Check Spam/Junk if you do not see this.",
  });
}

export type SendBackupResult = {
  ok: boolean;
  message: string;
  needsActivation?: boolean;
};

/**
 * Send (or retry) the daily backup email now — free FormSubmit only.
 * `force` ignores the once-per-day guard (for Settings “Send now”).
 */
export async function sendDailyEmailBackup(
  opts?: { force?: boolean }
): Promise<SendBackupResult> {
  if (typeof window === "undefined") {
    return { ok: false, message: "Not in browser." };
  }
  if (!opts?.force && alreadySentToday()) {
    return {
      ok: true,
      message: "Already sent today on this device (free daily limit).",
    };
  }

  const snap = readStoreSnapshot();
  if (!hasContentData(snap)) {
    const msg = "No data to email yet (app looks empty).";
    setStatus(false, msg);
    return { ok: false, message: msg };
  }

  const day = todayKeyLocal();
  const package_ = buildEmailBackupPayload(snap);
  // Compact JSON — pretty-print often exceeds free FormSubmit size limits
  let jsonBody = JSON.stringify(package_);
  let includedFullJson = true;
  if (jsonBody.length > MAX_JSON_CHARS) {
    includedFullJson = false;
    jsonBody = JSON.stringify({
      marker: MARKER,
      exportedAt: package_.exportedAt,
      summary: package_.summary,
      note: "Full JSON was too large for free email. Use Settings → Download JSON, or restore from cloud / device backups.",
      data: {
        properties: package_.data.properties?.length ?? 0,
        employees: package_.data.employees?.length ?? 0,
        jobs: package_.data.jobs?.length ?? 0,
      },
    });
  }

  const subject = `ArkaTasks backup ${day} — ${package_.summary}`;
  // Always keep a free on-device copy even if email fails
  void saveLocalBackup(package_.data, `daily-email-${day}`);

  try {
    // Activate inbox once (new address needs its own FormSubmit confirm)
    if (!isFormSubmitActivated()) {
      const ping = await sendActivationPing();
      if (ping.needsActivation || !ping.ok) {
        const msg = ping.needsActivation
          ? `Free FormSubmit sent an ACTIVATION email to ${BACKUP_EMAIL}. Open Gmail (and Spam), click Activate, then tap “Send backup email now” again.`
          : `Could not reach free email service: ${ping.message}. Device backup was still saved.`;
        setStatus(false, msg, day);
        return {
          ok: false,
          message: msg,
          needsActivation: ping.needsActivation,
        };
      }
      // Ping succeeded without activation message → already active
      markFormSubmitActivated();
    }

    const result = await postFormSubmit({
      _subject: subject,
      name: "ArkaTasks Daily Backup",
      email: BACKUP_EMAIL,
      summary: package_.summary,
      instructions: includedFullJson
        ? "RESTORE: Settings → Backup & recover → Import JSON. Save the backup_json field as a .json file and import it."
        : "Full JSON was too large for free email. Use Settings → Download JSON backup, or restore from cloud history / device backups.",
      backup_json: jsonBody,
    });

    if (result.needsActivation) {
      try {
        localStorage.removeItem(ACTIVATED_KEY);
      } catch {
        /* ignore */
      }
      const msg = `FormSubmit needs activation: check ${BACKUP_EMAIL} (and Spam) for “Activate Form”, click it, then send again. Free — no payment required.`;
      setStatus(false, msg, day);
      return { ok: false, message: msg, needsActivation: true };
    }

    if (!result.ok) {
      setStatus(false, result.message, day);
      return { ok: false, message: result.message };
    }

    markFormSubmitActivated();
    markSentToday();
    if (!includedFullJson) {
      const msg = `Email sent to ${BACKUP_EMAIL} with SUMMARY only (data too large for free email). Full backup is on this device + cloud — use Settings → Download JSON for a full file.`;
      setStatus(true, msg, day);
      return { ok: true, message: msg };
    }
    const msg = `Free backup emailed to ${BACKUP_EMAIL}.`;
    setStatus(true, msg, day);
    return { ok: true, message: msg };
  } catch (e) {
    const msg =
      e instanceof Error ? e.message : "Email backup failed (network).";
    setStatus(false, msg, day);
    return { ok: false, message: msg };
  }
}

/**
 * Silently email a backup once per local calendar day (free).
 * Safe to call on every app boot after sync has settled.
 */
export async function maybeSendDailyEmailBackup(): Promise<void> {
  if (typeof window === "undefined") return;
  if (alreadySentToday()) return;
  await sendDailyEmailBackup({ force: false });
}
