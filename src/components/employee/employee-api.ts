import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { EmployeeApartment } from "@/lib/auth";
import { loadSavedCloudConfig, type CloudConfig } from "@/lib/supabase";

export type EmployeeLoginResponse = {
  /** Supabase Auth access token (RS256/ES256, issued by Supabase). Never minted here. */
  token: string;
  employeeId: string;
  name: string;
  todayDate: string;
  tomorrowDate: string;
  today: EmployeeApartment[];
  tomorrow: EmployeeApartment[];
};

const loginBase =
  process.env.NEXT_PUBLIC_LOGIN_SERVICE_URL || "https://15.236.133.124:8081";
const cleanBase =
  process.env.NEXT_PUBLIC_CLEAN_EVENT_SERVICE_URL || "https://15.236.133.124:8082";

// Separate storage key so the employee's Supabase Auth session never changes the
// owner's sync client. RLS on app_state allows the anon role only, and a shared
// session would switch those requests to the authenticated role.
const EMPLOYEE_AUTH_STORAGE_KEY = "arkatasks-employee-auth";

let authClient: SupabaseClient | null = null;
let authClientKey = "";

function employeeAuthClient(cloud: CloudConfig): SupabaseClient {
  const key = `${cloud.supabaseUrl}|${cloud.supabaseAnonKey}`;
  if (authClient && authClientKey === key) return authClient;
  authClient = createClient(cloud.supabaseUrl, cloud.supabaseAnonKey, {
    auth: {
      storageKey: EMPLOYEE_AUTH_STORAGE_KEY,
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: false,
    },
  });
  authClientKey = key;
  return authClient;
}

/**
 * Supabase-issued access token for this device. Reuses a live session, otherwise
 * signs in anonymously. Needs "Allow anonymous sign-ins" in the Supabase dashboard.
 */
async function signInForAccessToken(cloud: CloudConfig): Promise<string> {
  const auth = employeeAuthClient(cloud).auth;
  const { data: current } = await auth.getSession();
  if (current.session?.access_token) return current.session.access_token;
  const { data, error } = await auth.signInAnonymously();
  if (error || !data.session?.access_token) {
    throw new Error(
      error?.message || "Supabase did not return a sign-in token. Enable anonymous sign-ins in Supabase."
    );
  }
  return data.session.access_token;
}

/** Current access token, refreshed by supabase-js when it is near expiry. Null when signed out. */
async function currentAccessToken(): Promise<string | null> {
  const cloud = loadSavedCloudConfig();
  if (!cloud) return null;
  const { data } = await employeeAuthClient(cloud).auth.getSession();
  return data.session?.access_token ?? null;
}

/** Ends the employee's Supabase Auth session on this device. Best effort. */
export async function signOutEmployee(): Promise<void> {
  const cloud = loadSavedCloudConfig();
  if (!cloud) return;
  try {
    await employeeAuthClient(cloud).auth.signOut({ scope: "local" });
  } catch {
    // Local sign-out only. Nothing else to clean up.
  }
}

function digits(value: string | null | undefined): string {
  return (value ?? "").replace(/\D/g, "");
}

function phonesMatch(stored: string, typed: string): boolean {
  if (!stored || !typed) return false;
  if (stored === typed) return true;
  if (stored.length < 8 || typed.length < 8) return false;
  return stored.endsWith(typed) || typed.endsWith(stored);
}

function romeDay(offset: number): string {
  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Rome",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
  if (offset === 0) return today;
  const [year, month, day] = today.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day + offset)).toISOString().slice(0, 10);
}

function apartmentsFor(
  jobs: Array<Record<string, unknown>> | undefined,
  employeeId: string,
  day: string
): EmployeeApartment[] {
  const list: EmployeeApartment[] = [];
  for (const job of jobs ?? []) {
    if (job.date !== day) continue;
    if (String(job.status ?? "").toLowerCase() === "cancelled") continue;
    const assignments = (job.job_assignments as Array<Record<string, unknown>> | undefined) ?? [];
    const mine = assignments.some((row) => row.employee_id === employeeId);
    if (!mine) continue;
    const apartmentId = String(job.property_id ?? "");
    const name = String(job.place_name ?? "").trim();
    if (!apartmentId || !name) continue;
    if (list.some((row) => row.apartmentId === apartmentId)) continue;
    list.push({ apartmentId, name });
  }
  list.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
  return list;
}

export async function requestEmployeeLogin(
  phone: string
): Promise<EmployeeLoginResponse> {
  const cloud = loadSavedCloudConfig();
  if (!cloud) {
    throw new Error("Add the Supabase project URL and anon key in settings first.");
  }
  // Read-only client without a session, so app_state is read with the anon role as before.
  const supabase = createClient(cloud.supabaseUrl, cloud.supabaseAnonKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  const { data, error } = await supabase
    .from("app_state")
    .select("payload")
    .eq("id", "main")
    .maybeSingle();
  if (error) {
    throw new Error(error.message || "Could not read employees from Supabase.");
  }
  const payload = (data?.payload ?? {}) as {
    employees?: Array<Record<string, unknown>>;
    jobs?: Array<Record<string, unknown>>;
  };
  const typed = digits(phone);
  const match = (payload.employees ?? []).find((employee) => {
    if (employee.archived === true) return false;
    return phonesMatch(digits(String(employee.phone ?? "")), typed);
  });
  if (!match) {
    throw new Error("No employee found with that phone number.");
  }
  const employeeId = String(match.id ?? "");
  const name = String(match.name ?? "").trim();
  const todayDate = romeDay(0);
  const tomorrowDate = romeDay(1);
  // The phone matched. Now get a Supabase Auth token for the calls to EC2.
  let accessToken = "";
  try {
    accessToken = await signInForAccessToken(cloud);
  } catch (e) {
    console.warn("Supabase sign-in failed:", e instanceof Error ? e.message : e);
  }
  const granted: EmployeeLoginResponse = {
    token: accessToken,
    employeeId,
    name,
    todayDate,
    tomorrowDate,
    today: apartmentsFor(payload.jobs, employeeId, todayDate),
    tomorrow: apartmentsFor(payload.jobs, employeeId, tomorrowDate),
  };
  if (!accessToken) return granted;
  try {
    // Same request: the Supabase token proves the session, then EC2 stores the
    // project URL and anon key (public values only, never a service_role key).
    const response = await fetch(`${loginBase}/api/login`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({
        phone,
        supabaseUrl: cloud.supabaseUrl,
        supabaseAnonKey: cloud.supabaseAnonKey,
      }),
    });
    if (response.ok) {
      const issued = (await response.json()) as Omit<EmployeeLoginResponse, "token">;
      if (issued.employeeId) return { ...issued, token: accessToken };
    }
  } catch {
    // The phone check already succeeded. Key storage can be retried on the next login.
  }
  return granted;
}

export async function requestMarkClean(
  token: string,
  apartmentId: string,
  date: string
): Promise<void> {
  const fresh = (await currentAccessToken().catch(() => null)) || token;
  if (!fresh) {
    throw new Error("Sign out and sign in again to mark apartments clean.");
  }
  let response: Response;
  try {
    response = await fetch(`${cleanBase}/api/cleans`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${fresh}`,
      },
      body: JSON.stringify({ apartmentId, date }),
    });
  } catch {
    throw new Error("Could not mark this apartment clean.");
  }
  if (response.status === 401) {
    throw new Error("Your sign-in expired. Sign out and sign in again.");
  }
  if (!response.ok && response.status !== 409) {
    const body = (await response.json().catch(() => null)) as { error?: string; message?: string } | null;
    throw new Error(body?.error || body?.message || "Could not mark this apartment clean.");
  }
}
