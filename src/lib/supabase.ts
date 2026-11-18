import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export type CloudConfig = {
  supabaseUrl: string;
  supabaseAnonKey: string;
};

const SETTINGS_KEY = "dclean_cloud_config";
const DISABLED_KEY = "dclean_cloud_disabled";

let cachedClient: SupabaseClient | null = null;
let cachedConfigKey = "";
let configPromise: Promise<CloudConfig | null> | null = null;

/** Accept pasted URLs that wrongly include /rest/v1 or trailing paths */
export function normalizeSupabaseUrl(raw: string): string {
  return raw
    .trim()
    .replace(/[\u200b\u200c\u200d\ufeff]/g, "") // zero-width / BOM from mobile paste
    .replace(/\s+/g, "")
    .replace(/\/+$/, "")
    .replace(/\/rest\/v1.*$/i, "")
    .replace(/\/auth\/v1.*$/i, "")
    .replace(/\/+$/, "");
}

/** JWT keys often pick up newlines/spaces when pasted on phones */
export function normalizeAnonKey(raw: string): string {
  return raw
    .trim()
    .replace(/[\u200b\u200c\u200d\ufeff]/g, "")
    .replace(/\s+/g, "");
}

function isValidConfig(c: Partial<CloudConfig> | null | undefined): c is CloudConfig {
  if (!c?.supabaseUrl || !c?.supabaseAnonKey) return false;
  const url = normalizeSupabaseUrl(c.supabaseUrl);
  const key = normalizeAnonKey(c.supabaseAnonKey);
  if (url.includes("your_supabase")) return false;
  if (key.includes("your_supabase")) return false;
  if (!url.startsWith("http")) return false;
  return key.length > 20;
}

export function loadSavedCloudConfig(): CloudConfig | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CloudConfig;
    const cleaned = {
      supabaseUrl: normalizeSupabaseUrl(parsed.supabaseUrl ?? ""),
      supabaseAnonKey: normalizeAnonKey(parsed.supabaseAnonKey ?? ""),
    };
    return isValidConfig(cleaned) ? cleaned : null;
  } catch {
    return null;
  }
}

export function saveCloudConfig(config: CloudConfig | null) {
  if (typeof window === "undefined") return;
  cachedClient = null;
  cachedConfigKey = "";
  configPromise = null;
  if (!config) {
    localStorage.removeItem(SETTINGS_KEY);
    return;
  }
  // Explicit connect clears Disconnect opt-out
  localStorage.removeItem(DISABLED_KEY);
  const cleaned: CloudConfig = {
    supabaseUrl: normalizeSupabaseUrl(config.supabaseUrl),
    supabaseAnonKey: normalizeAnonKey(config.supabaseAnonKey),
  };
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(cleaned));
}

/** User tapped Disconnect — stop falling back to env/file config on this device. */
export function setCloudDisabled(disabled: boolean) {
  if (typeof window === "undefined") return;
  cachedClient = null;
  cachedConfigKey = "";
  configPromise = null;
  if (disabled) localStorage.setItem(DISABLED_KEY, "1");
  else localStorage.removeItem(DISABLED_KEY);
}

export function isCloudDisabled(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return localStorage.getItem(DISABLED_KEY) === "1";
  } catch {
    return false;
  }
}

async function loadFileConfig(): Promise<CloudConfig | null> {
  if (typeof window === "undefined") return null;
  try {
    const res = await fetch("/dclean-config.json", { cache: "no-store" });
    if (!res.ok) return null;
    const parsed = (await res.json()) as CloudConfig;
    return isValidConfig(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function loadEnvConfig(): CloudConfig | null {
  const c = {
    supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL ?? "",
    supabaseAnonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "",
  };
  return isValidConfig(c) ? c : null;
}

/** Settings → config.json → env (unless user disconnected this device) */
export async function resolveCloudConfig(): Promise<CloudConfig | null> {
  if (!configPromise) {
    configPromise = (async () => {
      if (isCloudDisabled()) return null;
      const saved = loadSavedCloudConfig();
      if (saved) return saved;
      const file = await loadFileConfig();
      if (file) return file;
      return loadEnvConfig();
    })();
  }
  return configPromise;
}

export async function getSupabaseClient(): Promise<SupabaseClient | null> {
  const config = await resolveCloudConfig();
  if (!config) return null;
  const url = normalizeSupabaseUrl(config.supabaseUrl);
  const key = `${url}|${config.supabaseAnonKey}`;
  if (cachedClient && cachedConfigKey === key) return cachedClient;
  cachedClient = createClient(url, config.supabaseAnonKey);
  cachedConfigKey = key;
  return cachedClient;
}

export function createSupabaseClient() {
  const env = loadEnvConfig();
  if (!env) return null;
  return createClient(env.supabaseUrl, env.supabaseAnonKey);
}

export async function isCloudConfigured(): Promise<boolean> {
  return (await resolveCloudConfig()) !== null;
}

export const isSupabaseConfigured = () => loadEnvConfig() !== null || loadSavedCloudConfig() !== null;
