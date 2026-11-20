import type {
  AppData,
  AppSettings,
  DefaultSchedule,
  Employee,
  Job,
  JobAssignment,
  Owner,
  Property,
  PropertyCostItem,
  PropertySize,
} from "@/types/database";
import { saveLocalBackup } from "@/lib/backup";
import { isMateriallyThinner } from "@/lib/merge-data";

const DEFAULT_COMPANY_NAME = "DClean";

/** All sizes that may appear in stored client data (includes legacy). */
const PROPERTY_SIZES: PropertySize[] = [
  "Monolocale",
  "Bilocale",
  "Trilocale",
  "Quadrilocale",
  "Quadrilocale +",
  "Doppia",
];

function normalizePropertySize(raw: unknown): PropertySize {
  const s = String(raw ?? "").trim();
  return (PROPERTY_SIZES as string[]).includes(s) ? (s as PropertySize) : "";
}

const STORE_KEY = "dclean_v1";
const UPDATED_KEY = "dclean_v1_updated_at";
const LEGACY_KEYS = [
  "cleansync_properties_v2",
  "cleansync_properties",
  "cleansync_employees",
  "cleansync_jobs",
];

export const SYNC_EVENT = "dclean-sync";
export const LOCAL_WRITE_EVENT = "dclean-local-write";

let memory: AppData | null = null;
let writeTimer: ReturnType<typeof setTimeout> | null = null;
let suppressCloudPush = false;
let localUpdatedAt = 0;
/** Wall-clock of last user edit (not cloud apply) — sync uses this to protect ticks. */
let lastUserEditAt = 0;

function emptyData(): AppData {
  return {
    properties: [],
    employees: [],
    jobs: [],
    owners: [],
    default_schedule: {},
    settings: {
      company_name: DEFAULT_COMPANY_NAME,
      whatsapp: null,
    },
  };
}

export function normalizeSettings(raw: unknown): AppSettings {
  const s = (raw ?? {}) as Partial<AppSettings>;
  const name = String(s.company_name ?? "").trim();
  const wa = String(s.whatsapp ?? "").trim();
  const genRaw = Number(s.sync_generation);
  const sync_generation =
    Number.isFinite(genRaw) && genRaw > 0 ? Math.floor(genRaw) : undefined;
  return {
    company_name: name || DEFAULT_COMPANY_NAME,
    whatsapp: wa || null,
    ...(sync_generation != null ? { sync_generation } : {}),
  };
}

export function getSyncGeneration(data: AppData): number {
  return normalizeSettings(data.settings).sync_generation ?? 0;
}

function normalizeDefaultSchedule(raw: unknown): DefaultSchedule {
  if (!raw || typeof raw !== "object") return {};
  const out: DefaultSchedule = {};
  for (const [propertyId, ids] of Object.entries(raw as Record<string, unknown>)) {
    if (!propertyId || !Array.isArray(ids)) continue;
    const employeeIds = ids
      .map((id) => String(id ?? "").trim())
      .filter(Boolean);
    // Keep empty arrays — "Save as default" may snapshot cleared places
    out[propertyId] = [...new Set(employeeIds)];
  }
  return out;
}

function uid(prefix: string) {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

/** Public id helper for UI create forms (avoids same-ms collisions). */
export function createId(prefix: string) {
  return uid(prefix);
}

function normalizeCostItem(
  c: Partial<PropertyCostItem> & { label?: string }
): PropertyCostItem | null {
  const label = (c.label ?? "").trim();
  if (!label) return null;
  return {
    id: c.id || uid("c"),
    label,
    amount: Number(c.amount) || 0,
  };
}

export function normalizeOwner(o: Partial<Owner> & { name?: string }): Owner {
  const wa = (o.whatsapp ?? "").toString().trim();
  return {
    id: o.id ?? uid("o"),
    name: (o.name ?? "").trim(),
    whatsapp: wa || null,
    archived: !!o.archived || undefined,
  };
}

export function normalizeProperty(p: Partial<Property> & { id?: string; name?: string }): Property {
  const hasSplit =
    p.single_beds !== undefined || p.double_beds !== undefined;
  const single = hasSplit
    ? Number(p.single_beds) || 0
    : Number(p.beds) || 0;
  const double = hasSplit ? Number(p.double_beds) || 0 : 0;

  const singleSheet = Number(p.single_sheet_cost) || 0;
  const doubleSheet = Number(p.double_sheet_cost) || 0;
  const extraSheetFlat = Number(p.extra_sheet_cost) || 0;
  const pillow = Number(p.pillow_cost) || 0;
  const legacySheet = Number(p.bedsheet_cost) || 0;

  // Pillow covers per bed — default 1 per single, 2 per double
  const hasPillowCovers =
    p.pillow_covers_single !== undefined || p.pillow_covers_double !== undefined;
  const pillowCoversSingle = hasPillowCovers
    ? Number(p.pillow_covers_single) || 0
    : 1;
  const pillowCoversDouble = hasPillowCovers
    ? Number(p.pillow_covers_double) || 0
    : 2;

  let extraCosts: PropertyCostItem[] = [];
  let other = 0;
  if (Array.isArray(p.extra_costs) && p.extra_costs.length > 0) {
    extraCosts = p.extra_costs
      .map(normalizeCostItem)
      .filter((c): c is PropertyCostItem => !!c);
    // Prefer the flat Extra cost field (UI) when present; else sum labeled items
    if (p.other_cost !== undefined || p.product_cost !== undefined) {
      other =
        p.other_cost !== undefined
          ? Number(p.other_cost) || 0
          : Number(p.product_cost) || 0;
    } else {
      other = extraCosts.reduce((s, c) => s + (Number(c.amount) || 0), 0);
    }
  } else {
    other =
      p.product_cost !== undefined
        ? Number(p.product_cost) || 0
        : p.other_cost !== undefined
          ? Number(p.other_cost) || 0
          : 0;
    extraCosts = [];
  }

  const extraPillows = Number(p.extra_pillows) || 0;
  // pillow_cost applies only to extra pillows (not bed pillow covers)
  const unitLinen =
    single * singleSheet + double * doubleSheet + extraPillows * pillow;
  // Prefer unit rates only when any rate is set; otherwise keep legacy flat linen
  // (saved properties always have sheet fields as 0, which used to wipe legacy totals).
  const useUnitRates = singleSheet > 0 || doubleSheet > 0 || pillow > 0;
  const bedsheetTotal = useUnitRates ? unitLinen : legacySheet || unitLinen;

  return {
    id: p.id ?? uid("p"),
    owner: (p.owner ?? "").trim(),
    name: (p.name ?? "Unnamed").trim(),
    size: normalizePropertySize(p.size),
    single_beds: single,
    double_beds: double,
    beds: single + double,
    pillow_covers_single: pillowCoversSingle,
    pillow_covers_double: pillowCoversDouble,
    extra_pillows: extraPillows,
    owner_amount:
      p.owner_amount !== undefined
        ? Number(p.owner_amount) || 0
        : Number(p.amount) || 0,
    employee_pay_amount:
      p.employee_pay_amount !== undefined
        ? Number(p.employee_pay_amount) || 0
        : Number(p.amount) || 0,
    amount:
      p.owner_amount !== undefined
        ? Number(p.owner_amount) || 0
        : Number(p.amount) || 0,
    single_sheet_cost: singleSheet,
    double_sheet_cost: doubleSheet,
    extra_sheet_cost: extraSheetFlat,
    pillow_cost: pillow,
    extra_costs: extraCosts,
    other_cost: other,
    bedsheet_cost: bedsheetTotal,
    product_cost: other,
    archived: !!p.archived,
    created_at: p.created_at,
    updated_at: p.updated_at || p.created_at,
  };
}

/** Day totals = beds × covers-per-bed from the property. */
export function pillowCoversForDay(
  property: Pick<Property, "pillow_covers_single" | "pillow_covers_double">,
  singleBeds: number,
  doubleBeds: number
): { single: number; double: number } {
  const perSingle = Number(property.pillow_covers_single) || 0;
  const perDouble = Number(property.pillow_covers_double) || 0;
  return {
    single: singleBeds * perSingle,
    double: doubleBeds * perDouble,
  };
}

/** Optional day overrides for rates / pillows / flat costs. */
export type JobCostOverride = {
  pillow_covers_single?: number;
  pillow_covers_double?: number;
  extra_pillows?: number;
  single_sheet_cost?: number;
  double_sheet_cost?: number;
  pillow_cost?: number;
  /** Flat Extra sheet cost (€) for the day */
  extra_sheet_cost?: number;
  other_cost?: number;
};

/** @deprecated use JobCostOverride */
export type PillowPerBedOverride = JobCostOverride;

/** Linen = bed rates + extra pillows; extra_sheet_cost / product = flat Money fields. */
export function computeJobCostsFromProperty(
  property: Pick<
    Property,
    | "single_sheet_cost"
    | "double_sheet_cost"
    | "extra_sheet_cost"
    | "pillow_cost"
    | "other_cost"
    | "bedsheet_cost"
    | "product_cost"
    | "single_beds"
    | "double_beds"
    | "pillow_covers_single"
    | "pillow_covers_double"
    | "extra_pillows"
  >,
  singleBeds: number,
  doubleBeds: number,
  override?: JobCostOverride
): {
  linen_cost: number;
  product_cost: number;
  extra_sheet_cost: number;
  pillow_count: number;
  pillow_covers_single: number;
  pillow_covers_double: number;
  extra_pillows: number;
} {
  const singleSheet =
    override?.single_sheet_cost !== undefined
      ? Number(override.single_sheet_cost) || 0
      : Number(property.single_sheet_cost) || 0;
  const doubleSheet =
    override?.double_sheet_cost !== undefined
      ? Number(override.double_sheet_cost) || 0
      : Number(property.double_sheet_cost) || 0;
  const extraSheetFlat =
    override?.extra_sheet_cost !== undefined
      ? Number(override.extra_sheet_cost) || 0
      : Number(property.extra_sheet_cost) || 0;
  const pillowRate =
    override?.pillow_cost !== undefined
      ? Number(override.pillow_cost) || 0
      : Number(property.pillow_cost) || 0;
  const other =
    override?.other_cost !== undefined
      ? Number(override.other_cost) || 0
      : property.other_cost !== undefined
        ? Number(property.other_cost) || 0
        : Number(property.product_cost) || 0;
  const rates = {
    pillow_covers_single:
      override?.pillow_covers_single !== undefined
        ? Number(override.pillow_covers_single) || 0
        : Number(property.pillow_covers_single) || 0,
    pillow_covers_double:
      override?.pillow_covers_double !== undefined
        ? Number(override.pillow_covers_double) || 0
        : Number(property.pillow_covers_double) || 0,
  };
  const covers = pillowCoversForDay(rates, singleBeds, doubleBeds);
  const extraPillows =
    override?.extra_pillows !== undefined
      ? Number(override.extra_pillows) || 0
      : Number(property.extra_pillows) || 0;
  const pillowCount = covers.single + covers.double + extraPillows;
  const linen =
    singleBeds * singleSheet +
    doubleBeds * doubleSheet +
    extraPillows * pillowRate;
  const hasOverrideRates =
    override?.single_sheet_cost !== undefined ||
    override?.double_sheet_cost !== undefined ||
    override?.pillow_cost !== undefined;
  const propHasUnitRates =
    (property.single_sheet_cost != null &&
      Number(property.single_sheet_cost) !== 0) ||
    (property.double_sheet_cost != null &&
      Number(property.double_sheet_cost) !== 0) ||
    (property.pillow_cost != null && Number(property.pillow_cost) !== 0);
  const linenFinal =
    !hasOverrideRates &&
    !propHasUnitRates &&
    singleSheet === 0 &&
    doubleSheet === 0 &&
    pillowRate === 0
      ? Number(property.bedsheet_cost) || 0
      : linen;
  return {
    linen_cost: Math.round(linenFinal * 100) / 100,
    product_cost: Math.round(other * 100) / 100,
    extra_sheet_cost: Math.round(extraSheetFlat * 100) / 100,
    pillow_count: pillowCount,
    pillow_covers_single: covers.single,
    pillow_covers_double: covers.double,
    extra_pillows: extraPillows,
  };
}

export function normalizeEmployee(e: Partial<Employee> & { id?: string; name?: string }): Employee {
  return {
    id: e.id ?? uid("e"),
    name: (e.name ?? "Unnamed").trim(),
    phone: e.phone ?? null,
    color_code: e.color_code || "#0d9488",
    archived: !!e.archived,
    created_at: e.created_at,
    updated_at: e.updated_at || e.created_at,
  };
}

export function normalizeJob(j: Partial<Job> & { id?: string }): Job {
  const id = j.id ?? uid("j");
  const assignments = (j.job_assignments ?? []).map((a) => ({
    id: a.id || uid("a"),
    job_id: id,
    employee_id: a.employee_id,
    employee_name:
      a.employee_name ||
      a.employees?.name ||
      "Cleaner",
  }));

  const status: Job["status"] =
    j.status === "completed" || j.status === "cancelled" ? j.status : "pending";

  return {
    id,
    property_id: j.property_id ?? "",
    date: j.date ?? "",
    status,
    linen_cost: Number(j.linen_cost) || 0,
    product_cost: Number(j.product_cost) || 0,
    charged_amount: Number(j.charged_amount) || 0,
    employee_pay_amount:
      j.employee_pay_amount !== undefined
        ? Number(j.employee_pay_amount) || 0
        : Number(j.charged_amount) || 0,
    place_name: j.place_name || j.properties?.name || "",
    owner_name: j.owner_name || j.properties?.owner || "",
    place_size: normalizePropertySize(j.place_size ?? j.properties?.size),
    single_beds: Number(j.single_beds) || 0,
    double_beds: Number(j.double_beds) || 0,
    pillow_covers_single:
      j.pillow_covers_single !== undefined
        ? Number(j.pillow_covers_single) || 0
        : Number(j.single_beds) || 0,
    pillow_covers_double:
      j.pillow_covers_double !== undefined
        ? Number(j.pillow_covers_double) || 0
        : (Number(j.double_beds) || 0) * 2,
    extra_pillows: Number(j.extra_pillows) || 0,
    extra_sheet_cost: Number(j.extra_sheet_cost) || 0,
    single_sheet_cost:
      j.single_sheet_cost !== undefined
        ? Number(j.single_sheet_cost) || 0
        : undefined,
    double_sheet_cost:
      j.double_sheet_cost !== undefined
        ? Number(j.double_sheet_cost) || 0
        : undefined,
    pillow_cost:
      j.pillow_cost !== undefined ? Number(j.pillow_cost) || 0 : undefined,
    notes: j.notes?.trim() ? j.notes.trim() : null,
    job_assignments: assignments,
    created_at: j.created_at,
    updated_at: j.updated_at || j.created_at,
    hours_worked: j.hours_worked,
  };
}

function nowIso() {
  return new Date().toISOString();
}

/** Local calendar day as yyyy-MM-dd (avoids UTC shift). */
function todayKey() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** True when Day details saved sheet/pillow rates on this job. */
function jobHasDayRateOverrides(
  j: Pick<Job, "single_sheet_cost" | "double_sheet_cost" | "pillow_cost"> | null
): boolean {
  if (!j) return false;
  return (
    j.single_sheet_cost !== undefined ||
    j.double_sheet_cost !== undefined ||
    j.pillow_cost !== undefined
  );
}

function nearlyEqualMoney(a: number, b: number): boolean {
  return Math.abs((Number(a) || 0) - (Number(b) || 0)) < 0.005;
}

function migrateLegacy(): AppData | null {
  if (typeof window === "undefined") return null;
  try {
    const props = localStorage.getItem("cleansync_properties_v2")
      || localStorage.getItem("cleansync_properties");
    const emps = localStorage.getItem("cleansync_employees");
    const jobs = localStorage.getItem("cleansync_jobs");
    if (!props && !emps && !jobs) return null;

    const properties = props
      ? (JSON.parse(props) as Partial<Property>[]).map(normalizeProperty)
      : [];
    const employees = emps
      ? (JSON.parse(emps) as Partial<Employee>[]).map(normalizeEmployee)
      : [];
    const rawJobs = jobs ? (JSON.parse(jobs) as Partial<Job>[]) : [];
    const propMap = new Map(properties.map((p) => [p.id, p]));
    const empMap = new Map(employees.map((e) => [e.id, e]));

    const normalizedJobs = rawJobs.map((j) => {
      const prop = propMap.get(j.property_id ?? "");
      return normalizeJob({
        ...j,
        place_name: j.place_name || prop?.name || j.properties?.name,
        owner_name: j.owner_name || prop?.owner || j.properties?.owner,
        job_assignments: (j.job_assignments ?? []).map((a) => ({
          ...a,
          employee_name:
            a.employee_name ||
            empMap.get(a.employee_id)?.name ||
            a.employees?.name ||
            "Cleaner",
        })),
      });
    });

    return {
      properties,
      employees,
      jobs: normalizedJobs,
      owners: ownersFromProperties(properties),
      default_schedule: {},
      settings: normalizeSettings(undefined),
    };
  } catch {
    return null;
  }
}

function ownersFromProperties(properties: Property[]): Owner[] {
  const seen = new Set<string>();
  const list: Owner[] = [];
  for (const p of properties) {
    const name = p.owner.trim();
    if (!name) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    list.push({ id: uid("o"), name, whatsapp: null });
  }
  return list.sort((a, b) => a.name.localeCompare(b.name));
}

function mergeOwners(stored: Owner[], properties: Property[]): Owner[] {
  const byKey = new Map<string, Owner>();
  for (const o of stored) {
    const n = o.name.trim();
    if (!n) continue;
    byKey.set(n.toLowerCase(), normalizeOwner(o));
  }
  for (const p of properties) {
    const n = p.owner.trim();
    if (!n) continue;
    const key = n.toLowerCase();
    if (!byKey.has(key)) {
      byKey.set(key, { id: uid("o"), name: n, whatsapp: null });
    }
  }
  return [...byKey.values()].sort((a, b) => a.name.localeCompare(b.name));
}

function clearWriteTimer() {
  if (writeTimer) {
    clearTimeout(writeTimer);
    writeTimer = null;
  }
}

/** Drop in-memory cache so the next read picks up disk (other tabs / cloud). */
export function invalidateStoreCache() {
  memory = null;
  localUpdatedAt = 0;
}

function readStore(): AppData {
  if (memory) return memory;
  if (typeof window === "undefined") return emptyData();

  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as AppData;
      const properties = (parsed.properties ?? []).map(normalizeProperty);
      const owners = mergeOwners(
        (parsed.owners ?? []).map(normalizeOwner),
        properties
      );
      memory = {
        properties,
        employees: (parsed.employees ?? []).map(normalizeEmployee),
        jobs: (parsed.jobs ?? []).map(normalizeJob),
        owners,
        default_schedule: normalizeDefaultSchedule(parsed.default_schedule),
        settings: normalizeSettings(parsed.settings),
      };
      return memory;
    }

    const legacy = migrateLegacy();
    if (legacy) {
      memory = legacy;
      flushNow();
      for (const k of LEGACY_KEYS) localStorage.removeItem(k);
      return memory;
    }
  } catch {
    // Preserve corrupt blob so it can be recovered / inspected
    try {
      const raw = localStorage.getItem(STORE_KEY);
      if (raw) localStorage.setItem(`${STORE_KEY}_corrupt`, raw);
    } catch {
      /* ignore */
    }
  }

  memory = emptyData();
  return memory;
}

// Other browser tabs update localStorage — refresh our cache.
if (typeof window !== "undefined") {
  window.addEventListener("storage", (e) => {
    if (e.key === STORE_KEY || e.key === UPDATED_KEY) {
      invalidateStoreCache();
      window.dispatchEvent(new Event(SYNC_EVENT));
    }
  });
  // Never lose the last keystroke on tab close / background
  window.addEventListener("pagehide", () => {
    if (writeTimer) {
      clearTimeout(writeTimer);
      writeTimer = null;
      flushNow();
    }
  });
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden" && writeTimer) {
      clearTimeout(writeTimer);
      writeTimer = null;
      flushNow();
    }
  });
}

export function leanAppData(data: AppData): AppData {
  return {
    properties: data.properties.map((p) => ({
      id: p.id,
      owner: p.owner,
      name: p.name,
      size: p.size || "",
      beds: p.beds,
      single_beds: p.single_beds,
      double_beds: p.double_beds,
      pillow_covers_single: p.pillow_covers_single,
      pillow_covers_double: p.pillow_covers_double,
      extra_pillows: p.extra_pillows ?? 0,
      owner_amount: p.owner_amount,
      employee_pay_amount: p.employee_pay_amount,
      amount: p.owner_amount ?? p.amount,
      single_sheet_cost: p.single_sheet_cost,
      double_sheet_cost: p.double_sheet_cost,
      extra_sheet_cost: p.extra_sheet_cost ?? 0,
      pillow_cost: p.pillow_cost,
      extra_costs: (p.extra_costs ?? []).map((c) => ({
        id: c.id,
        label: c.label,
        amount: c.amount,
      })),
      other_cost: p.other_cost,
      bedsheet_cost: p.bedsheet_cost,
      product_cost: p.product_cost,
      archived: !!p.archived,
      created_at: p.created_at,
      updated_at: p.updated_at || p.created_at,
    })),
    employees: data.employees.map((e) => ({
      id: e.id,
      name: e.name,
      phone: e.phone,
      color_code: e.color_code,
      archived: !!e.archived,
      created_at: e.created_at,
      updated_at: e.updated_at || e.created_at,
    })),
    jobs: data.jobs.map((j) => ({
      id: j.id,
      property_id: j.property_id,
      date: j.date,
      status: j.status,
      linen_cost: j.linen_cost,
      product_cost: j.product_cost,
      charged_amount: j.charged_amount,
      employee_pay_amount: j.employee_pay_amount,
      place_name: j.place_name,
      owner_name: j.owner_name,
      place_size: j.place_size || "",
      single_beds: j.single_beds,
      double_beds: j.double_beds,
      pillow_covers_single: j.pillow_covers_single,
      pillow_covers_double: j.pillow_covers_double,
      extra_pillows: j.extra_pillows ?? 0,
      extra_sheet_cost: j.extra_sheet_cost ?? 0,
      single_sheet_cost: j.single_sheet_cost,
      double_sheet_cost: j.double_sheet_cost,
      pillow_cost: j.pillow_cost,
      hours_worked: j.hours_worked,
      notes: j.notes || undefined,
      created_at: j.created_at,
      updated_at: j.updated_at || j.created_at,
      job_assignments: j.job_assignments.map((a) => ({
        id: a.id,
        job_id: j.id,
        employee_id: a.employee_id,
        employee_name: a.employee_name,
      })),
    })),
    owners: (data.owners ?? []).map((o) => ({
      id: o.id,
      name: o.name,
      whatsapp: o.whatsapp || null,
      archived: !!o.archived,
    })),
    default_schedule: normalizeDefaultSchedule(data.default_schedule),
    settings: normalizeSettings(data.settings),
  };
}

export function readStoreSnapshot(): AppData {
  return readStore();
}

export function getLocalUpdatedAt() {
  if (localUpdatedAt) return localUpdatedAt;
  if (typeof window === "undefined") return 0;
  const raw = localStorage.getItem(UPDATED_KEY);
  localUpdatedAt = raw ? Number(raw) || 0 : 0;
  return localUpdatedAt;
}

export function setLocalUpdatedAt(ts: number) {
  localUpdatedAt = ts;
  if (typeof window !== "undefined") {
    localStorage.setItem(UPDATED_KEY, String(ts));
  }
}

function dataContentScore(data: AppData): number {
  return (
    (data.properties?.length ?? 0) +
    (data.employees?.length ?? 0) +
    (data.jobs?.length ?? 0)
  );
}

/**
 * Apply cloud payload without re-uploading (avoids sync loops).
 * Never replaces local work data with an empty cloud payload.
 */
export function applyCloudData(
  data: AppData,
  updatedAt: number,
  opts?: {
    keepLocalSettings?: boolean;
    keepLocalOwners?: boolean;
    keepLocalSchedule?: boolean;
    /** Allow empty / thinner cloud to wipe local (almost never). */
    allowEmptyOverwrite?: boolean;
    allowShrink?: boolean;
  }
): boolean {
  // Persist in-flight edits first so we never drop unflushed local work.
  // Suppress push so the flush does not race a cloud upload mid-apply.
  suppressCloudPush = true;
  if (writeTimer) {
    clearWriteTimer();
    flushNow();
  }
  const local = memory ?? (typeof window !== "undefined" ? readStore() : emptyData());
  const incomingScore = dataContentScore(data);
  const localScore = dataContentScore(local);

  // HARD GUARD: empty cloud must never erase local places/jobs
  if (incomingScore === 0 && localScore > 0 && !opts?.allowEmptyOverwrite) {
    suppressCloudPush = false;
    void saveLocalBackup(leanAppData(local), "blocked-empty-cloud");
    return false;
  }

  // HARD GUARD: thinner non-empty payload must not erase richer local data
  if (
    localScore > 0 &&
    isMateriallyThinner(data, local) &&
    !opts?.allowShrink &&
    !opts?.allowEmptyOverwrite
  ) {
    suppressCloudPush = false;
    void saveLocalBackup(leanAppData(local), "blocked-thin-cloud");
    return false;
  }

  // Snapshot local before any cloud replace
  if (localScore > 0) {
    void saveLocalBackup(leanAppData(local), "before-cloud-apply");
  }
  const properties = (data.properties ?? []).map(normalizeProperty);
  const cloudOwners = (data.owners ?? []).map(normalizeOwner);
  const localOwners = (local.owners ?? []).map(normalizeOwner);
  const ownersBase = mergeOwners(
    mergeOwnerWhatsapp(
      opts?.keepLocalOwners ? localOwners : cloudOwners,
      opts?.keepLocalOwners ? cloudOwners : localOwners
    ),
    properties
  );

  const cloudSettings = normalizeSettings(data.settings);
  const localSettings = normalizeSettings(local.settings);
  memory = {
    properties,
    employees: (data.employees ?? []).map(normalizeEmployee),
    jobs: (data.jobs ?? []).map(normalizeJob),
    owners: ownersBase,
    default_schedule:
      opts?.keepLocalSchedule
        ? normalizeDefaultSchedule(local.default_schedule)
        : normalizeDefaultSchedule(data.default_schedule),
    settings: opts?.keepLocalSettings
      ? localSettings
      : normalizeSettings({
          ...cloudSettings,
          company_name:
            cloudSettings.company_name || localSettings.company_name,
          whatsapp:
            cloudSettings.whatsapp !== undefined
              ? cloudSettings.whatsapp
              : localSettings.whatsapp,
          sync_generation: Math.max(
            cloudSettings.sync_generation ?? 0,
            localSettings.sync_generation ?? 0
          ) || undefined,
        }),
  };
  if (typeof window !== "undefined") {
    const lean = leanAppData(memory);
    localStorage.setItem(STORE_KEY, JSON.stringify(lean));
    setLocalUpdatedAt(updatedAt);
    void saveLocalBackup(lean, "after-cloud-apply");
    window.dispatchEvent(new Event(SYNC_EVENT));
  }
  suppressCloudPush = false;
  return true;
}

/** Full replace from backup / import. Never applies empty/thin over richer local. */
export function restoreAppData(
  data: AppData,
  reason = "restore",
  opts?: { allowShrink?: boolean }
): boolean {
  const local = readStore();
  const incomingScore = dataContentScore(data);
  const localScore = dataContentScore(local);
  if (incomingScore === 0 && localScore > 0) {
    void saveLocalBackup(leanAppData(local), "blocked-empty-restore");
    return false;
  }
  if (
    localScore > 0 &&
    isMateriallyThinner(data, local) &&
    !opts?.allowShrink
  ) {
    void saveLocalBackup(leanAppData(local), "blocked-thin-restore");
    return false;
  }
  if (localScore > 0) {
    void saveLocalBackup(leanAppData(local), `before-${reason}`);
  }
  clearWriteTimer();
  const properties = (data.properties ?? []).map(normalizeProperty);
  memory = {
    properties,
    employees: (data.employees ?? []).map(normalizeEmployee),
    jobs: (data.jobs ?? []).map(normalizeJob),
    owners: mergeOwners(
      (data.owners ?? []).map(normalizeOwner),
      properties
    ),
    default_schedule: normalizeDefaultSchedule(data.default_schedule),
    settings: normalizeSettings(data.settings),
  };
  flushNow();
  void saveLocalBackup(leanAppData(memory), reason);
  return true;
}

/** Copy WhatsApp from local owners onto cloud owners with the same name when missing. */
function mergeOwnerWhatsapp(cloud: Owner[], local: Owner[]): Owner[] {
  const localByName = new Map(
    local.map((o) => [o.name.trim().toLowerCase(), o] as const)
  );
  const merged = cloud.map((o) => {
    if (toDigits(o.whatsapp)) return o;
    const loc = localByName.get(o.name.trim().toLowerCase());
    if (loc?.whatsapp) return normalizeOwner({ ...o, whatsapp: loc.whatsapp });
    return o;
  });
  // Keep local-only owners (with WhatsApp) that cloud dropped
  for (const loc of local) {
    const key = loc.name.trim().toLowerCase();
    if (!key) continue;
    if (!merged.some((o) => o.name.trim().toLowerCase() === key)) {
      merged.push(normalizeOwner(loc));
    }
  }
  return merged;
}

function toDigits(phone: string | null | undefined): string {
  return (phone ?? "").replace(/\D/g, "");
}

/**
 * Active employee whose phone matches the typed number.
 * Digits only. A stored +39 prefix still matches the local number.
 */
export function findActiveEmployeeByPhone(input: string): Employee | null {
  const typed = toDigits(input);
  if (!typed) return null;
  const employees = getActiveEmployees().filter(
    (e) => toDigits(e.phone).length > 0
  );
  const exact = employees.find((e) => toDigits(e.phone) === typed);
  if (exact) return exact;
  if (typed.length < 8) return null;
  return (
    employees.find((e) => {
      const stored = toDigits(e.phone);
      if (stored.length < 8) return false;
      return stored.endsWith(typed) || typed.endsWith(stored);
    }) ?? null
  );
}

function scheduleWrite(data: AppData) {
  memory = data;
  if (typeof window === "undefined") return;
  // Mark dirty immediately so a cloud pull cannot overwrite in-memory edits
  // before the debounced flush writes localStorage.
  localUpdatedAt = Date.now();
  if (!suppressCloudPush) lastUserEditAt = localUpdatedAt;
  clearWriteTimer();
  // Always flush current `memory` — never a stale closed-over snapshot.
  writeTimer = setTimeout(() => {
    writeTimer = null;
    flushNow();
  }, 120);
}

/** True while a debounced local write has not flushed yet. */
export function hasPendingLocalWrite() {
  return writeTimer !== null;
}

/** Last time the user changed local data (ticks, forms, etc.). */
export function getLastUserEditAt() {
  return lastUserEditAt;
}

function flushNow() {
  if (typeof window === "undefined" || !memory) return;
  const lean = leanAppData(memory);
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(lean));
    setLocalUpdatedAt(Date.now());
    void saveLocalBackup(
      lean,
      suppressCloudPush ? "sync-write" : "edit"
    );
    window.dispatchEvent(new Event(SYNC_EVENT));
    if (!suppressCloudPush) {
      window.dispatchEvent(new Event(LOCAL_WRITE_EVENT));
    }
  } catch {
    // Quota / private mode — still snapshot to IndexedDB when possible
    void saveLocalBackup(lean, "flush-failed-idb");
    window.dispatchEvent(new Event(SYNC_EVENT));
  }
}

/** Flush pending debounced write immediately (tab close / hide). */
export function flushPendingLocalWrite() {
  if (writeTimer) {
    clearWriteTimer();
    flushNow();
  }
}

/** Load app data. Never seeds fake demo rows — owner starts clean. */
export function loadAppData(): AppData {
  return readStore();
}

export function getActiveProperties(): Property[] {
  return readStore()
    .properties.filter((p) => !p.archived)
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** All places including archived (for past/today schedule display). */
export function getAllProperties(): Property[] {
  return [...readStore().properties].sort((a, b) =>
    a.name.localeCompare(b.name)
  );
}

export function getActiveEmployees(): Employee[] {
  return readStore()
    .employees.filter((e) => !e.archived)
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** All employees including archived (for past/today schedule display). */
export function getAllEmployees(): Employee[] {
  return [...readStore().employees].sort((a, b) =>
    a.name.localeCompare(b.name)
  );
}

export function getAllJobs(): Job[] {
  return enrichJobs(readStore());
}

function enrichJobs(data: AppData): Job[] {
  const propMap = new Map(data.properties.map((p) => [p.id, p]));
  const empMap = new Map(data.employees.map((e) => [e.id, e]));

  return data.jobs.map((job) => {
    const prop = propMap.get(job.property_id);
    const assignments: JobAssignment[] = job.job_assignments.map((a) => {
      const emp = empMap.get(a.employee_id);
      return {
        ...a,
        employee_name: a.employee_name || emp?.name || "Cleaner",
        employees: emp
          ? emp
          : {
              id: a.employee_id,
              name: a.employee_name || "Cleaner",
              phone: null,
              color_code: "#64748b",
              archived: true,
            },
      };
    });

    return {
      ...job,
      place_name: job.place_name || prop?.name || "Place",
      owner_name: job.owner_name || prop?.owner || "",
      properties: prop
        ? prop
        : {
            id: job.property_id,
            owner: job.owner_name || "",
            name: job.place_name || "Place",
            size: "",
            beds: (job.single_beds || 0) + (job.double_beds || 0),
            single_beds: job.single_beds || 0,
            double_beds: job.double_beds || 0,
            pillow_covers_single:
              job.pillow_covers_single ?? (job.single_beds || 0),
            pillow_covers_double:
              job.pillow_covers_double ?? (job.double_beds || 0) * 2,
            extra_pillows: job.extra_pillows ?? 0,
            owner_amount: job.charged_amount,
            employee_pay_amount:
              job.employee_pay_amount ?? job.charged_amount,
            amount: job.charged_amount,
            single_sheet_cost: 0,
            double_sheet_cost: 0,
            extra_sheet_cost: job.extra_sheet_cost ?? 0,
            pillow_cost: 0,
            extra_costs: [],
            other_cost: job.product_cost,
            bedsheet_cost: job.linen_cost,
            product_cost: job.product_cost,
            archived: true,
          },
      job_assignments: assignments,
    };
  });
}

export function saveProperties(properties: Property[]) {
  const data = readStore();
  if (properties.length === 0 && data.properties.length > 0) return;
  scheduleWrite({ ...data, properties: properties.map(normalizeProperty) });
}

export function saveEmployees(employees: Employee[]) {
  const data = readStore();
  if (employees.length === 0 && data.employees.length > 0) return;
  scheduleWrite({ ...data, employees: employees.map(normalizeEmployee) });
}

export function saveJobs(jobs: Job[]) {
  const data = readStore();
  if (jobs.length === 0 && data.jobs.length > 0) return;
  scheduleWrite({ ...data, jobs: jobs.map(normalizeJob) });
}

export function upsertJobForPlace(args: {
  date: string;
  property: Property;
  employeeIds: string[];
  employees: Employee[];
  singleBeds?: number;
  doubleBeds?: number;
}) {
  const data = readStore();
  const { date, property, employeeIds, employees } = args;
  const existingIdx = data.jobs.findIndex(
    (j) => j.property_id === property.id && j.date === date
  );

  if (employeeIds.length === 0) {
    // Soft-clear: cancel but keep assignments/beds/notes for history & revive.
    // updated_at ensures cloud sync does not resurrect the old ticks.
    if (existingIdx >= 0) {
      const existing = data.jobs[existingIdx];
      const next = [...data.jobs];
      next[existingIdx] = normalizeJob({
        ...existing,
        status: "cancelled",
        updated_at: nowIso(),
      });
      scheduleWrite({ ...data, jobs: next });
    }
    return;
  }

  const empMap = new Map(employees.map((e) => [e.id, e]));
  const existing = existingIdx >= 0 ? data.jobs[existingIdx] : null;
  const jobId = existing?.id ?? uid("j");
  const isHistorical = date < todayKey();

  const singleBeds =
    args.singleBeds !== undefined
      ? args.singleBeds
      : existing?.single_beds !== undefined && existingIdx >= 0
        ? existing.single_beds
        : property.single_beds;
  const doubleBeds =
    args.doubleBeds !== undefined
      ? args.doubleBeds
      : existing?.double_beds !== undefined && existingIdx >= 0
        ? existing.double_beds
        : property.double_beds;

  const bedsChanged =
    !existing ||
    existing.single_beds !== singleBeds ||
    existing.double_beds !== doubleBeds;

  // Day-details rates lock linen/extras; plain ticks follow the property.
  const hasDayRates = jobHasDayRateOverrides(existing);
  const dayOverride: JobCostOverride | undefined = existing
    ? {
        extra_pillows: hasDayRates ? existing.extra_pillows : undefined,
        single_sheet_cost: existing.single_sheet_cost,
        double_sheet_cost: existing.double_sheet_cost,
        pillow_cost: existing.pillow_cost,
        extra_sheet_cost: hasDayRates ? existing.extra_sheet_cost : undefined,
        other_cost: hasDayRates ? existing.product_cost : undefined,
        pillow_covers_single:
          singleBeds > 0 && existing.single_beds === singleBeds
            ? Math.round(
                (existing.pillow_covers_single || 0) / Math.max(1, singleBeds)
              )
            : undefined,
        pillow_covers_double:
          doubleBeds > 0 && existing.double_beds === doubleBeds
            ? Math.round(
                (existing.pillow_covers_double || 0) / Math.max(1, doubleBeds)
              )
            : undefined,
      }
    : undefined;

  const costs = computeJobCostsFromProperty(
    property,
    singleBeds,
    doubleBeds,
    dayOverride
  );

  // Past days: keep cost/name snapshots unless beds change (or day rates exist).
  const keepHistoricalCosts =
    isHistorical && !!existing && !bedsChanged && !hasDayRates;

  const job: Job = normalizeJob({
    id: jobId,
    property_id: property.id,
    date,
    // Re-assigning cleaners revives a cancelled day
    status:
      existing?.status === "cancelled"
        ? "pending"
        : existing?.status ?? "pending",
    notes: existing?.notes ?? null,
    linen_cost: keepHistoricalCosts ? existing.linen_cost : costs.linen_cost,
    product_cost: keepHistoricalCosts
      ? existing.product_cost
      : costs.product_cost,
    charged_amount:
      existing?.charged_amount ??
      property.owner_amount ??
      property.amount,
    employee_pay_amount:
      existing?.employee_pay_amount ??
      property.employee_pay_amount ??
      property.owner_amount ??
      property.amount,
    place_name:
      isHistorical && existing?.place_name
        ? existing.place_name
        : property.name,
    owner_name:
      isHistorical && existing?.owner_name
        ? existing.owner_name
        : property.owner,
    place_size: property.size || existing?.place_size || "",
    single_beds: singleBeds,
    double_beds: doubleBeds,
    pillow_covers_single: keepHistoricalCosts
      ? existing.pillow_covers_single
      : costs.pillow_covers_single,
    pillow_covers_double: keepHistoricalCosts
      ? existing.pillow_covers_double
      : costs.pillow_covers_double,
    extra_pillows: keepHistoricalCosts
      ? existing.extra_pillows
      : costs.extra_pillows,
    extra_sheet_cost: keepHistoricalCosts
      ? existing.extra_sheet_cost
      : costs.extra_sheet_cost,
    single_sheet_cost: existing?.single_sheet_cost,
    double_sheet_cost: existing?.double_sheet_cost,
    // Snapshot pillow rate so archived places / rate changes don't rewrite invoices
    pillow_cost:
      existing?.pillow_cost !== undefined
        ? existing.pillow_cost
        : Number(property.pillow_cost) || 0,
    job_assignments: employeeIds.map((employeeId) => ({
      id:
        existing?.job_assignments.find((a) => a.employee_id === employeeId)
          ?.id ?? uid("a"),
      job_id: jobId,
      employee_id: employeeId,
      employee_name:
        empMap.get(employeeId)?.name ||
        existing?.job_assignments.find((a) => a.employee_id === employeeId)
          ?.employee_name ||
        "Cleaner",
    })),
    created_at: existing?.created_at,
    updated_at: nowIso(),
  });

  const next = [...data.jobs];
  if (existingIdx >= 0) next[existingIdx] = job;
  else next.push(job);
  scheduleWrite({ ...data, jobs: next });
}

/** Update day-specific bed counts when a job already exists for that place/date. */
export function updateJobBedsForPlace(args: {
  date: string;
  propertyId: string;
  singleBeds: number;
  doubleBeds: number;
  pillowCoversPerSingle?: number;
  pillowCoversPerDouble?: number;
}) {
  const data = readStore();
  const existingIdx = data.jobs.findIndex(
    (j) => j.property_id === args.propertyId && j.date === args.date
  );
  if (existingIdx < 0) return false;
  const job = data.jobs[existingIdx];
  const property =
    data.properties.find((p) => p.id === args.propertyId) ??
    ({
      single_sheet_cost: 0,
      double_sheet_cost: 0,
      extra_sheet_cost: 0,
      pillow_cost: 0,
      other_cost: job.product_cost,
      bedsheet_cost: job.linen_cost,
      product_cost: job.product_cost,
      pillow_covers_single: 1,
      pillow_covers_double: 2,
      extra_pillows: job.extra_pillows ?? 0,
    } as Property);
  const costs = computeJobCostsFromProperty(
    property,
    args.singleBeds,
    args.doubleBeds,
    {
      pillow_covers_single: args.pillowCoversPerSingle,
      pillow_covers_double: args.pillowCoversPerDouble,
      extra_pillows: job.extra_pillows,
      single_sheet_cost: job.single_sheet_cost,
      double_sheet_cost: job.double_sheet_cost,
      extra_sheet_cost: job.extra_sheet_cost,
      pillow_cost: job.pillow_cost,
      other_cost: job.product_cost,
    }
  );
  const next = [...data.jobs];
  next[existingIdx] = normalizeJob({
    ...job,
    single_beds: args.singleBeds,
    double_beds: args.doubleBeds,
    pillow_covers_single: costs.pillow_covers_single,
    pillow_covers_double: costs.pillow_covers_double,
    extra_pillows: costs.extra_pillows,
    linen_cost: costs.linen_cost,
    product_cost: costs.product_cost,
    extra_sheet_cost: costs.extra_sheet_cost,
    updated_at: nowIso(),
  });
  scheduleWrite({ ...data, jobs: next });
  return true;
}

/**
 * Day details: beds, pillows, money, sheet rates, notes for one place/date.
 * Creates a cancelled placeholder job if none exists yet (so rates persist).
 */
export function saveJobDayDetails(args: {
  date: string;
  property: Property;
  notes: string;
  singleBeds: number;
  doubleBeds: number;
  pillowCoversPerSingle: number;
  pillowCoversPerDouble: number;
  extraPillows: number;
  ownerAmount: number;
  employeePayAmount: number;
  extraCost: number;
  singleSheetCost: number;
  doubleSheetCost: number;
  extraSheetCost: number;
  pillowUnitCost: number;
}): boolean {
  const data = readStore();
  const existingIdx = data.jobs.findIndex(
    (j) => j.property_id === args.property.id && j.date === args.date
  );
  const existing = existingIdx >= 0 ? data.jobs[existingIdx] : null;
  const override: JobCostOverride = {
    pillow_covers_single: args.pillowCoversPerSingle,
    pillow_covers_double: args.pillowCoversPerDouble,
    extra_pillows: args.extraPillows,
    single_sheet_cost: args.singleSheetCost,
    double_sheet_cost: args.doubleSheetCost,
    extra_sheet_cost: args.extraSheetCost,
    pillow_cost: args.pillowUnitCost,
    other_cost: args.extraCost,
  };
  const costs = computeJobCostsFromProperty(
    args.property,
    args.singleBeds,
    args.doubleBeds,
    override
  );
  const jobId = existing?.id ?? uid("j");
  const isHistorical = args.date < todayKey();
  // Details-only saves must not steal schedule LWW from remote ticks:
  // keep prior updated_at when status stays cancelled (placeholder / soft-clear).
  const preserveScheduleClock =
    (existing?.status ?? "cancelled") === "cancelled";
  const job = normalizeJob({
    id: jobId,
    property_id: args.property.id,
    date: args.date,
    status: existing?.status ?? "cancelled",
    notes: args.notes.trim() || null,
    linen_cost: costs.linen_cost,
    product_cost: costs.product_cost,
    charged_amount: args.ownerAmount,
    employee_pay_amount: args.employeePayAmount,
    place_name:
      isHistorical && existing?.place_name
        ? existing.place_name
        : args.property.name,
    owner_name:
      isHistorical && existing?.owner_name
        ? existing.owner_name
        : args.property.owner,
    place_size: args.property.size || existing?.place_size || "",
    single_beds: args.singleBeds,
    double_beds: args.doubleBeds,
    pillow_covers_single: costs.pillow_covers_single,
    pillow_covers_double: costs.pillow_covers_double,
    extra_pillows: costs.extra_pillows,
    single_sheet_cost: args.singleSheetCost,
    double_sheet_cost: args.doubleSheetCost,
    extra_sheet_cost: args.extraSheetCost,
    pillow_cost: args.pillowUnitCost,
    job_assignments: existing?.job_assignments ?? [],
    created_at: existing?.created_at,
    updated_at: preserveScheduleClock
      ? existing?.updated_at || existing?.created_at || "1970-01-01T00:00:00.000Z"
      : nowIso(),
  });
  const next = [...data.jobs];
  if (existingIdx >= 0) next[existingIdx] = job;
  else next.push(job);
  scheduleWrite({ ...data, jobs: next });
  return true;
}

/** @deprecated prefer saveJobDayDetails */
export function updateJobDayDetails(args: {
  jobId: string;
  notes: string;
  singleBeds: number;
  doubleBeds: number;
  pillowCoversPerSingle?: number;
  pillowCoversPerDouble?: number;
}) {
  const data = readStore();
  const job = data.jobs.find((j) => j.id === args.jobId);
  if (!job) return false;
  const property = data.properties.find((p) => p.id === job.property_id);
  if (!property) return false;
  return saveJobDayDetails({
    date: job.date,
    property,
    notes: args.notes,
    singleBeds: args.singleBeds,
    doubleBeds: args.doubleBeds,
    pillowCoversPerSingle:
      args.pillowCoversPerSingle ??
      (args.singleBeds > 0
        ? Math.round(job.pillow_covers_single / args.singleBeds)
        : property.pillow_covers_single),
    pillowCoversPerDouble:
      args.pillowCoversPerDouble ??
      (args.doubleBeds > 0
        ? Math.round(job.pillow_covers_double / args.doubleBeds)
        : property.pillow_covers_double),
    extraPillows: job.extra_pillows ?? property.extra_pillows ?? 0,
    ownerAmount:
      job.charged_amount !== undefined && job.charged_amount !== null
        ? Number(job.charged_amount)
        : property.owner_amount,
    employeePayAmount:
      job.employee_pay_amount !== undefined
        ? Number(job.employee_pay_amount) || 0
        : property.employee_pay_amount,
    extraCost: Number(job.product_cost) || property.product_cost || 0,
    singleSheetCost:
      job.single_sheet_cost ?? property.single_sheet_cost ?? 0,
    doubleSheetCost:
      job.double_sheet_cost ?? property.double_sheet_cost ?? 0,
    extraSheetCost:
      job.extra_sheet_cost ?? property.extra_sheet_cost ?? 0,
    pillowUnitCost: job.pillow_cost ?? property.pillow_cost ?? 0,
  });
}

export function updateJobNotes(jobId: string, notes: string) {
  const data = readStore();
  const next = data.jobs.map((j) =>
    j.id === jobId
      ? normalizeJob({
          ...j,
          notes: notes.trim() || null,
          updated_at: nowIso(),
        })
      : j
  );
  scheduleWrite({ ...data, jobs: next });
}

export function updateJobStatus(
  jobId: string,
  status: "pending" | "completed" | "cancelled"
) {
  const data = readStore();
  const next = data.jobs.map((j) =>
    j.id === jobId
      ? normalizeJob({ ...j, status, updated_at: nowIso() })
      : j
  );
  scheduleWrite({ ...data, jobs: next });
}

export function archiveProperty(id: string) {
  const data = readStore();
  const today = todayKey();
  // Past + today: keep jobs (reports + read-only calendar).
  // Tomorrow+: keep only if already ticked (has assignees); otherwise cancel.
  const jobs = data.jobs.map((j) => {
    if (
      j.property_id !== id ||
      j.date <= today ||
      j.status === "cancelled"
    ) {
      return j;
    }
    const ticked = (j.job_assignments ?? []).length > 0;
    if (ticked) return j;
    return normalizeJob({ ...j, status: "cancelled", updated_at: nowIso() });
  });
  const schedule = { ...normalizeDefaultSchedule(data.default_schedule) };
  delete schedule[id];
  scheduleWrite({
    ...data,
    properties: data.properties.map((p) =>
      p.id === id
        ? { ...p, archived: true, updated_at: nowIso() }
        : p
    ),
    jobs,
    default_schedule: schedule,
  });
}

export function unarchiveProperty(id: string) {
  const data = readStore();
  scheduleWrite({
    ...data,
    properties: data.properties.map((p) =>
      p.id === id
        ? { ...p, archived: false, updated_at: nowIso() }
        : p
    ),
  });
}

export function archiveEmployee(id: string) {
  const data = readStore();
  // Keep every existing assignment (past/today/future ticks) for reports +
  // read-only calendar. Unticked nights never listed them. Drop from the
  // default template so Apply default cannot re-add them.
  const schedule = { ...normalizeDefaultSchedule(data.default_schedule) };
  for (const [propId, ids] of Object.entries(schedule)) {
    schedule[propId] = ids.filter((empId) => empId !== id);
  }
  scheduleWrite({
    ...data,
    employees: data.employees.map((e) =>
      e.id === id
        ? { ...e, archived: true, updated_at: nowIso() }
        : e
    ),
    default_schedule: schedule,
  });
}

export function unarchiveEmployee(id: string) {
  const data = readStore();
  scheduleWrite({
    ...data,
    employees: data.employees.map((e) =>
      e.id === id
        ? { ...e, archived: false, updated_at: nowIso() }
        : e
    ),
  });
}

export function addProperty(property: Property) {
  const data = readStore();
  const next = normalizeProperty(property);
  const owners = mergeOwners(data.owners ?? [], [...data.properties, next]);
  scheduleWrite({
    ...data,
    properties: [...data.properties, next],
    owners,
  });
}

export function updateProperty(id: string, property: Property) {
  const data = readStore();
  const prev = data.properties.find((p) => p.id === id);
  const next = normalizeProperty({
    ...property,
    id,
    updated_at: nowIso(),
    created_at: prev?.created_at || property.created_at,
  });
  const properties = data.properties.map((p) => (p.id === id ? next : p));
  const owners = mergeOwners(data.owners ?? [], properties);
  // Only refresh today/future job snapshots — past reports stay historical.
  const today = todayKey();
  const prevOwner =
    prev?.owner_amount ?? prev?.amount ?? 0;
  const prevEmpPay =
    prev?.employee_pay_amount ?? prev?.owner_amount ?? prev?.amount ?? 0;
  const prevOther =
    prev?.other_cost ?? prev?.product_cost ?? 0;
  const jobs = data.jobs.map((j) => {
    if (j.property_id !== id || j.date < today) return j;
    // Keep day-specific money/rate overrides; refresh linen from current rates.
    // Treat rates that still match the previous property as non-custom (legacy tick stamp).
    const ratesMatchPrevProperty =
      !!prev &&
      jobHasDayRateOverrides(j) &&
      nearlyEqualMoney(j.single_sheet_cost ?? 0, prev.single_sheet_cost) &&
      nearlyEqualMoney(j.double_sheet_cost ?? 0, prev.double_sheet_cost) &&
      nearlyEqualMoney(j.pillow_cost ?? 0, prev.pillow_cost);
    const extraCostCustom =
      !!prev && !nearlyEqualMoney(j.product_cost ?? 0, prevOther);
    const extraSheetCustom =
      !!prev &&
      !nearlyEqualMoney(j.extra_sheet_cost ?? 0, prev.extra_sheet_cost ?? 0);
    const pillowsCustom =
      !!prev &&
      (Number(j.extra_pillows) || 0) !== (Number(prev.extra_pillows) || 0);
    const hasDayRates =
      (jobHasDayRateOverrides(j) && !ratesMatchPrevProperty) ||
      extraCostCustom ||
      extraSheetCustom ||
      pillowsCustom;
    const costs = computeJobCostsFromProperty(
      next,
      j.single_beds,
      j.double_beds,
      {
        pillow_covers_single:
          j.single_beds > 0
            ? Math.round(j.pillow_covers_single / j.single_beds)
            : undefined,
        pillow_covers_double:
          j.double_beds > 0
            ? Math.round(j.pillow_covers_double / j.double_beds)
            : undefined,
        extra_pillows: hasDayRates ? j.extra_pillows : undefined,
        single_sheet_cost: hasDayRates ? j.single_sheet_cost : undefined,
        double_sheet_cost: hasDayRates ? j.double_sheet_cost : undefined,
        extra_sheet_cost: hasDayRates ? j.extra_sheet_cost : undefined,
        pillow_cost: hasDayRates ? j.pillow_cost : undefined,
        other_cost: hasDayRates ? j.product_cost : undefined,
      }
    );
    const chargedStillDefault = nearlyEqualMoney(j.charged_amount, prevOwner);
    const empPayStillDefault = nearlyEqualMoney(
      j.employee_pay_amount ?? j.charged_amount,
      prevEmpPay
    );
    // Do NOT bump job.updated_at — property price edits must not resurrect remote unticks
    return normalizeJob({
      ...j,
      place_name: next.name,
      owner_name: next.owner,
      place_size: next.size || j.place_size || "",
      charged_amount: chargedStillDefault
        ? next.owner_amount
        : j.charged_amount,
      employee_pay_amount: empPayStillDefault
        ? next.employee_pay_amount
        : j.employee_pay_amount,
      linen_cost: costs.linen_cost,
      product_cost: costs.product_cost,
      extra_sheet_cost: hasDayRates
        ? j.extra_sheet_cost
        : costs.extra_sheet_cost,
      pillow_covers_single: costs.pillow_covers_single,
      pillow_covers_double: costs.pillow_covers_double,
      extra_pillows: costs.extra_pillows,
      single_sheet_cost: hasDayRates ? j.single_sheet_cost : undefined,
      double_sheet_cost: hasDayRates ? j.double_sheet_cost : undefined,
      pillow_cost: hasDayRates ? j.pillow_cost : undefined,
      updated_at: j.updated_at || j.created_at,
    });
  });
  scheduleWrite({ ...data, properties, owners, jobs });
}

export function getOwners(): Owner[] {
  const data = readStore();
  return mergeOwners(data.owners ?? [], data.properties).filter(
    (o) => !o.archived
  );
}

export function getDefaultSchedule(): DefaultSchedule {
  return normalizeDefaultSchedule(readStore().default_schedule);
}

export function hasDefaultSchedule(): boolean {
  // Any saved snapshot counts — including all places empty ([])
  return Object.keys(getDefaultSchedule()).length > 0;
}

/**
 * Snapshot this day’s ticks exactly (including empty / cleared places).
 * Returns how many places were stored in the default.
 */
export function saveDefaultScheduleFromDay(date: string): number {
  const data = readStore();
  const activeEmp = new Set(
    data.employees.filter((e) => !e.archived).map((e) => e.id)
  );
  const activeProps = data.properties.filter((p) => !p.archived);
  if (activeProps.length === 0) return 0;

  const jobByProp = new Map<string, (typeof data.jobs)[0]>();
  for (const job of data.jobs) {
    if (job.date !== date) continue;
    jobByProp.set(job.property_id, job);
  }

  const next: DefaultSchedule = {};
  for (const prop of activeProps) {
    const job = jobByProp.get(prop.id);
    if (!job || job.status === "cancelled") {
      next[prop.id] = [];
      continue;
    }
    const ids = (job.job_assignments ?? [])
      .map((a) => a.employee_id)
      .filter((id) => activeEmp.has(id));
    next[prop.id] = [...new Set(ids)];
  }
  scheduleWrite({ ...data, default_schedule: next });
  return Object.keys(next).length;
}

/**
 * Replace the day’s schedule with a template (saved default or copied day).
 * Allows today and future; never rewrites past days.
 * Optional bedOverrides fills single/double beds from a source day.
 * Returns how many places were written.
 */
export function applyScheduleTemplateToDay(
  date: string,
  template: DefaultSchedule,
  opts?: {
    bedByProperty?: Record<
      string,
      { single: number; double: number }
    >;
  }
): number {
  const data = readStore();
  // Never rewrite past history
  if (date < todayKey()) return 0;
  const normalized = normalizeDefaultSchedule(template);
  if (Object.keys(normalized).length === 0) return 0;

  const employees = data.employees.filter((e) => !e.archived);
  const allEmpMap = new Map(data.employees.map((e) => [e.id, e]));
  const empMap = new Map(employees.map((e) => [e.id, e]));
  const activeEmpIds = new Set(employees.map((e) => e.id));
  const archivedEmpIds = new Set(
    data.employees.filter((e) => e.archived).map((e) => e.id)
  );
  const properties = data.properties.filter((p) => !p.archived);
  const propMap = new Map(properties.map((p) => [p.id, p]));
  const bedByProperty = opts?.bedByProperty ?? {};

  const archivedAssigneesOn = (job: (typeof data.jobs)[0] | null | undefined) =>
    [
      ...new Set(
        (job?.job_assignments ?? [])
          .map((a) => a.employee_id)
          .filter((id) => archivedEmpIds.has(id))
      ),
    ];

  // Exact apply: every active place gets template assignees (or clear if missing/empty)
  const plan = new Map<string, string[]>();
  for (const p of properties) {
    const raw = normalized[p.id];
    plan.set(
      p.id,
      raw ? raw.filter((id) => activeEmpIds.has(id)) : []
    );
  }

  let jobs = [...data.jobs];
  let written = 0;

  for (const [propertyId, templateIds] of plan) {
    const property = propMap.get(propertyId);
    if (!property) continue;

    const existingIdx = jobs.findIndex(
      (j) => j.property_id === propertyId && j.date === date
    );
    const existing = existingIdx >= 0 ? jobs[existingIdx] : null;
    // Soft-cleared days must not resurrect archived cleaners from leftover assignments
    const keepArchived =
      existing && existing.status !== "cancelled"
        ? archivedAssigneesOn(existing)
        : [];
    const employeeIds = [...new Set([...templateIds, ...keepArchived])];

    if (employeeIds.length === 0) {
      // Clear place — soft-cancel if a job exists; skip if already empty
      if (existingIdx >= 0 && existing && existing.status !== "cancelled") {
        jobs[existingIdx] = normalizeJob({
          ...existing,
          status: "cancelled",
          updated_at: nowIso(),
        });
        written += 1;
      } else if (
        existingIdx >= 0 &&
        existing &&
        existing.status === "cancelled"
      ) {
        written += 1;
      } else {
        written += 1;
      }
      continue;
    }

    const jobId = existing?.id ?? uid("j");
    const bedOverride = bedByProperty[propertyId];
    const singleBeds =
      bedOverride?.single !== undefined
        ? bedOverride.single
        : existing?.single_beds !== undefined
          ? existing.single_beds
          : property.single_beds;
    const doubleBeds =
      bedOverride?.double !== undefined
        ? bedOverride.double
        : existing?.double_beds !== undefined
          ? existing.double_beds
          : property.double_beds;
    const hasDayRates = jobHasDayRateOverrides(existing);
    const costs = computeJobCostsFromProperty(
      property,
      singleBeds,
      doubleBeds,
      existing
        ? {
            extra_pillows: hasDayRates ? existing.extra_pillows : undefined,
            single_sheet_cost: existing.single_sheet_cost,
            double_sheet_cost: existing.double_sheet_cost,
            pillow_cost: existing.pillow_cost,
            extra_sheet_cost: hasDayRates
              ? existing.extra_sheet_cost
              : undefined,
            other_cost: hasDayRates ? existing.product_cost : undefined,
            pillow_covers_single:
              singleBeds > 0
                ? Math.round(
                    (existing.pillow_covers_single || 0) /
                      Math.max(1, singleBeds)
                  )
                : undefined,
            pillow_covers_double:
              doubleBeds > 0
                ? Math.round(
                    (existing.pillow_covers_double || 0) /
                      Math.max(1, doubleBeds)
                  )
                : undefined,
          }
        : undefined
    );

    const job = normalizeJob({
      id: jobId,
      property_id: property.id,
      date,
      status: "pending",
      notes: existing?.notes ?? null,
      linen_cost: costs.linen_cost,
      product_cost: costs.product_cost,
      charged_amount:
        existing?.charged_amount ??
        property.owner_amount ??
        property.amount,
      employee_pay_amount:
        existing?.employee_pay_amount ??
        property.employee_pay_amount ??
        property.owner_amount ??
        property.amount,
      place_name: property.name,
      owner_name: property.owner,
      place_size: property.size || existing?.place_size || "",
      single_beds: singleBeds,
      double_beds: doubleBeds,
      pillow_covers_single: costs.pillow_covers_single,
      pillow_covers_double: costs.pillow_covers_double,
      extra_pillows: costs.extra_pillows,
      extra_sheet_cost: costs.extra_sheet_cost,
      single_sheet_cost: existing?.single_sheet_cost,
      double_sheet_cost: existing?.double_sheet_cost,
      pillow_cost:
        existing?.pillow_cost !== undefined
          ? existing.pillow_cost
          : Number(property.pillow_cost) || 0,
      job_assignments: employeeIds.map((employeeId) => ({
        id:
          existing?.job_assignments.find((a) => a.employee_id === employeeId)
            ?.id ?? uid("a"),
        job_id: jobId,
        employee_id: employeeId,
        employee_name:
          empMap.get(employeeId)?.name ||
          allEmpMap.get(employeeId)?.name ||
          existing?.job_assignments.find((a) => a.employee_id === employeeId)
            ?.employee_name ||
          "Cleaner",
      })),
      created_at: existing?.created_at,
      updated_at: nowIso(),
    });

    if (existingIdx >= 0) jobs[existingIdx] = job;
    else jobs.push(job);
    written += 1;
  }

  scheduleWrite({ ...data, jobs });
  return written;
}

/** Apply the saved default template onto a day (today or future). */
export function applyDefaultScheduleToDay(date: string): number {
  return applyScheduleTemplateToDay(date, getDefaultSchedule());
}

/**
 * Copy ticks + beds from any source day onto the target day (today or future).
 * Fills the target schedule fields to match the source layout.
 */
export function copyScheduleFromDayToDay(
  sourceDate: string,
  targetDate: string
): number {
  if (sourceDate === targetDate) return 0;
  if (targetDate < todayKey()) return 0;

  const data = readStore();
  const activeEmp = new Set(
    data.employees.filter((e) => !e.archived).map((e) => e.id)
  );
  const activeProps = data.properties.filter((p) => !p.archived);
  if (activeProps.length === 0) return 0;

  const jobByProp = new Map<string, (typeof data.jobs)[0]>();
  for (const job of data.jobs) {
    if (job.date !== sourceDate) continue;
    jobByProp.set(job.property_id, job);
  }

  const template: DefaultSchedule = {};
  const bedByProperty: Record<string, { single: number; double: number }> = {};
  for (const prop of activeProps) {
    const job = jobByProp.get(prop.id);
    if (!job || job.status === "cancelled") {
      template[prop.id] = [];
      continue;
    }
    template[prop.id] = [
      ...new Set(
        (job.job_assignments ?? [])
          .map((a) => a.employee_id)
          .filter((id) => activeEmp.has(id))
      ),
    ];
    bedByProperty[prop.id] = {
      single: Number(job.single_beds) || 0,
      double: Number(job.double_beds) || 0,
    };
  }

  return applyScheduleTemplateToDay(targetDate, template, { bedByProperty });
}

export function addOwner(name: string, whatsapp?: string) {
  const trimmed = name.trim();
  if (!trimmed) return false;
  const data = readStore();
  const exists = (data.owners ?? []).some(
    (o) => o.name.toLowerCase() === trimmed.toLowerCase()
  );
  if (exists) return false;
  const wa = (whatsapp ?? "").trim();
  scheduleWrite({
    ...data,
    owners: mergeOwners(
      [
        ...(data.owners ?? []),
        { id: uid("o"), name: trimmed, whatsapp: wa || null },
      ],
      data.properties
    ),
  });
  return true;
}

export function updateOwnerWhatsapp(id: string, whatsapp: string) {
  const data = readStore();
  const wa = whatsapp.trim();
  const owners = (data.owners ?? []).map((o) =>
    o.id === id ? normalizeOwner({ ...o, whatsapp: wa || null }) : o
  );
  scheduleWrite({ ...data, owners });
}

/** Soft-remove an owner only if no active property still uses that name. */
export function removeOwner(id: string): { ok: boolean; reason?: string } {
  const data = readStore();
  const owner = (data.owners ?? []).find((o) => o.id === id);
  if (!owner) return { ok: false, reason: "missing" };
  const inUse = data.properties.some(
    (p) =>
      !p.archived &&
      p.owner.trim().toLowerCase() === owner.name.trim().toLowerCase()
  );
  if (inUse) {
    return { ok: false, reason: "in_use" };
  }
  scheduleWrite({
    ...data,
    owners: (data.owners ?? []).map((o) =>
      o.id === id ? normalizeOwner({ ...o, archived: true }) : o
    ),
  });
  return { ok: true };
}

export function restoreOwner(id: string) {
  const data = readStore();
  scheduleWrite({
    ...data,
    owners: (data.owners ?? []).map((o) =>
      o.id === id ? normalizeOwner({ ...o, archived: false }) : o
    ),
  });
}

export function addEmployee(employee: Employee) {
  const data = readStore();
  scheduleWrite({
    ...data,
    employees: [...data.employees, normalizeEmployee(employee)],
  });
}

export function updateEmployee(
  id: string,
  patch: Partial<Pick<Employee, "name" | "phone" | "color_code">>
) {
  const data = readStore();
  const nextName =
    patch.name !== undefined ? patch.name.trim() : undefined;
  const employees = data.employees.map((e) =>
    e.id === id
      ? normalizeEmployee({
          ...e,
          ...patch,
          name: nextName !== undefined ? nextName : e.name,
          phone:
            patch.phone !== undefined
              ? patch.phone?.trim() || null
              : e.phone,
          updated_at: nowIso(),
        })
      : e
  );
  const today = todayKey();
  const jobs =
    nextName !== undefined
      ? data.jobs.map((j) => {
          // Keep historical report names; only refresh today and future
          if (j.date < today) return j;
          return {
            ...j,
            job_assignments: j.job_assignments.map((a) =>
              a.employee_id === id ? { ...a, employee_name: nextName } : a
            ),
          };
        })
      : data.jobs;
  scheduleWrite({ ...data, employees, jobs });
}

/** Compatibility helpers used by older call sites */
export function loadCalendarData(
  _fp?: Property[],
  _fe?: Employee[],
  _fj?: Job[]
) {
  const data = loadAppData();
  return {
    properties: getActiveProperties(),
    employees: getActiveEmployees(),
    jobs: enrichJobs(data),
  };
}

export function setStoredProperties(properties: Property[]) {
  saveProperties(properties);
}

export function setStoredEmployees(employees: Employee[]) {
  saveEmployees(employees);
}

export function setStoredJobs(jobs: Job[]) {
  saveJobs(jobs);
}

export function getStoredProperties(fallback: Property[] = []) {
  const list = getActiveProperties();
  return list.length ? list : fallback.map(normalizeProperty);
}

export function getStoredEmployees(fallback: Employee[] = []) {
  const list = getActiveEmployees();
  return list.length ? list : fallback.map(normalizeEmployee);
}

export function serializeJobs(jobs: Job[]) {
  return jobs.map(normalizeJob);
}

export function initLocalStore(
  properties: Property[],
  employees: Employee[],
  jobs: Job[]
) {
  if (typeof window === "undefined") return;
  const existing = localStorage.getItem(STORE_KEY);
  if (existing) return;
  // Never write an empty shell — wait for real data or cloud merge
  if (properties.length === 0 && employees.length === 0 && jobs.length === 0) {
    return;
  }
  scheduleWrite({
    properties: properties.map(normalizeProperty),
    employees: employees.map(normalizeEmployee),
    jobs: jobs.map(normalizeJob),
    owners: ownersFromProperties(properties.map(normalizeProperty)),
    default_schedule: {},
    settings: normalizeSettings(undefined),
  });
}

export function getSettings(): AppSettings {
  return normalizeSettings(readStore().settings);
}

export function saveSettings(settings: Partial<AppSettings>) {
  const data = readStore();
  const next = normalizeSettings({
    ...data.settings,
    ...settings,
  });
  scheduleWrite({ ...data, settings: next });
  return next;
}
