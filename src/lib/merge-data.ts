/**
 * Union-merge two AppData snapshots so devices accumulate data instead of
 * overwriting each other. Places/employees/owners/jobs are kept from both sides.
 *
 * Schedule ticks (job_assignments + job status) are last-write-wins per job so
 * an intentional untick is never resurrected by an older cloud copy.
 */
import type {
  AppData,
  AppSettings,
  DefaultSchedule,
  Employee,
  Job,
  JobAssignment,
  Owner,
  Property,
} from "@/types/database";

export function contentScore(data: AppData): number {
  return (
    (data.properties?.length ?? 0) +
    (data.employees?.length ?? 0) +
    (data.jobs?.length ?? 0)
  );
}

function num(v: number | undefined | null): number {
  if (v === undefined || v === null || Number.isNaN(Number(v))) return 0;
  return Number(v);
}

/** Prefer-side wins even for intentional 0 (LWW). */
function pickNum(
  primary: number | undefined | null,
  secondary: number | undefined | null
): number {
  if (primary !== undefined && primary !== null && !Number.isNaN(Number(primary))) {
    return Number(primary);
  }
  return num(secondary);
}

function jobUpdatedMs(j: Job): number {
  const t = j.updated_at || j.created_at;
  if (!t) return 0;
  const n = Date.parse(t);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Pick which job copy wins schedule fields.
 * Newer updated_at wins (LWW). Tie → app-level prefer.
 * Completed only beats an older non-completed when timestamps are equal/missing.
 * Day-details cancelled placeholders (no assignees) never wipe an active remote schedule.
 */
function isDetailsPlaceholder(j: Job): boolean {
  return (
    j.status === "cancelled" && !(j.job_assignments && j.job_assignments.length)
  );
}

function jobPreferSide(a: Job, b: Job, prefer: "a" | "b"): "a" | "b" {
  const aPh = isDetailsPlaceholder(a);
  const bPh = isDetailsPlaceholder(b);
  if (aPh && !bPh && b.status !== "cancelled") return "b";
  if (bPh && !aPh && a.status !== "cancelled") return "a";

  const aMs = jobUpdatedMs(a);
  const bMs = jobUpdatedMs(b);
  if (aMs > bMs) return "a";
  if (bMs > aMs) return "b";

  // Same/missing time: completed wins over cancel/pending (don't lose finished work)
  if (a.status === "completed" && b.status !== "completed") return "a";
  if (b.status === "completed" && a.status !== "completed") return "b";
  return prefer;
}

function mergeJob(a: Job, b: Job, prefer: "a" | "b"): Job {
  const side = jobPreferSide(a, b, prefer);
  const primary = side === "a" ? a : b;
  const secondary = side === "a" ? b : a;

  // Assignments are NOT unioned — untick / clear must stick.
  const assignments: JobAssignment[] = [...(primary.job_assignments ?? [])];

  return {
    ...secondary,
    ...primary,
    id: primary.id,
    status: primary.status,
    // Cleared notes must stick — prefer-side wins even when null
    notes: primary.notes ?? null,
    place_name: primary.place_name || secondary.place_name,
    owner_name: primary.owner_name || secondary.owner_name,
    linen_cost: pickNum(primary.linen_cost, secondary.linen_cost),
    product_cost: pickNum(primary.product_cost, secondary.product_cost),
    charged_amount: pickNum(primary.charged_amount, secondary.charged_amount),
    employee_pay_amount: pickNum(
      primary.employee_pay_amount,
      secondary.employee_pay_amount
    ),
    single_beds: pickNum(primary.single_beds, secondary.single_beds),
    double_beds: pickNum(primary.double_beds, secondary.double_beds),
    pillow_covers_single: pickNum(
      primary.pillow_covers_single,
      secondary.pillow_covers_single
    ),
    pillow_covers_double: pickNum(
      primary.pillow_covers_double,
      secondary.pillow_covers_double
    ),
    extra_pillows: pickNum(primary.extra_pillows, secondary.extra_pillows),
    place_size: primary.place_size || secondary.place_size || "",
    // LWW winner only — cleared/absent day rates must not resurrect from loser
    single_sheet_cost: primary.single_sheet_cost,
    double_sheet_cost: primary.double_sheet_cost,
    pillow_cost: primary.pillow_cost,
    extra_sheet_cost: pickNum(
      primary.extra_sheet_cost,
      secondary.extra_sheet_cost
    ),
    job_assignments: assignments,
    created_at: primary.created_at || secondary.created_at,
    updated_at:
      primary.updated_at ||
      secondary.updated_at ||
      primary.created_at ||
      secondary.created_at,
    hours_worked: primary.hours_worked ?? secondary.hours_worked,
  };
}

function entityUpdatedMs(
  e: { updated_at?: string; created_at?: string }
): number {
  const raw = e.updated_at || e.created_at || "";
  const ms = raw ? Date.parse(raw) : 0;
  return Number.isFinite(ms) ? ms : 0;
}

function mergeArchivedFlag(
  a: { archived?: boolean; updated_at?: string; created_at?: string },
  b: { archived?: boolean; updated_at?: string; created_at?: string },
  prefer: "a" | "b"
): boolean {
  const aMs = entityUpdatedMs(a);
  const bMs = entityUpdatedMs(b);
  if (aMs > bMs) return !!a.archived;
  if (bMs > aMs) return !!b.archived;
  // Tie: keep archived if either side archived (safer than resurrecting)
  if (a.archived || b.archived) return true;
  return prefer === "a" ? !!a.archived : !!b.archived;
}

function mergeProperty(a: Property, b: Property, prefer: "a" | "b"): Property {
  const aMs = entityUpdatedMs(a);
  const bMs = entityUpdatedMs(b);
  const side: "a" | "b" =
    aMs > bMs ? "a" : bMs > aMs ? "b" : prefer;
  const primary = side === "a" ? a : b;
  const secondary = side === "a" ? b : a;
  return {
    ...secondary,
    ...primary,
    archived: mergeArchivedFlag(a, b, prefer),
    name: primary.name || secondary.name,
    owner: primary.owner || secondary.owner,
    extra_pillows: pickNum(primary.extra_pillows, secondary.extra_pillows),
    extra_sheet_cost: pickNum(
      primary.extra_sheet_cost,
      secondary.extra_sheet_cost
    ),
    updated_at:
      primary.updated_at ||
      secondary.updated_at ||
      primary.created_at ||
      secondary.created_at,
  };
}

function mergeEmployee(a: Employee, b: Employee, prefer: "a" | "b"): Employee {
  const aMs = entityUpdatedMs(a);
  const bMs = entityUpdatedMs(b);
  const side: "a" | "b" =
    aMs > bMs ? "a" : bMs > aMs ? "b" : prefer;
  const primary = side === "a" ? a : b;
  const secondary = side === "a" ? b : a;
  return {
    ...secondary,
    ...primary,
    archived: mergeArchivedFlag(a, b, prefer),
    name: primary.name || secondary.name,
    // Cleared phone must stick
    phone:
      primary.phone !== undefined ? primary.phone : secondary.phone ?? null,
    updated_at:
      primary.updated_at ||
      secondary.updated_at ||
      primary.created_at ||
      secondary.created_at,
  };
}

function mergeOwner(a: Owner, b: Owner, prefer: "a" | "b"): Owner {
  const primary = prefer === "a" ? a : b;
  const secondary = prefer === "a" ? b : a;
  return {
    ...secondary,
    ...primary,
    archived: mergeArchivedFlag(a, b, prefer),
    name: primary.name || secondary.name,
    whatsapp:
      primary.whatsapp !== undefined
        ? primary.whatsapp
        : secondary.whatsapp ?? null,
  };
}

function mergeSettings(a: AppSettings, b: AppSettings, prefer: "a" | "b"): AppSettings {
  const primary = prefer === "a" ? a : b;
  const secondary = prefer === "a" ? b : a;
  const genA = a.sync_generation ?? 0;
  const genB = b.sync_generation ?? 0;
  return {
    company_name: primary.company_name || secondary.company_name,
    whatsapp:
      primary.whatsapp !== undefined
        ? primary.whatsapp
        : secondary.whatsapp ?? null,
    // Always keep the higher generation so a purge cannot be undone by merge
    ...(Math.max(genA, genB) > 0
      ? { sync_generation: Math.max(genA, genB) }
      : {}),
  };
}

function mergeSchedule(
  a: DefaultSchedule,
  b: DefaultSchedule,
  prefer: "a" | "b"
): DefaultSchedule {
  // Whole-schedule LWW — deletions / empty places on prefer side stick
  const primary = prefer === "a" ? a ?? {} : b ?? {};
  const out: DefaultSchedule = {};
  for (const [k, ids] of Object.entries(primary)) {
    out[k] = Array.isArray(ids) ? [...ids] : [];
  }
  return out;
}

export function mergeAppData(
  local: AppData,
  cloud: AppData,
  prefer: "local" | "cloud" = "local"
): AppData {
  const preferA = prefer === "local" ? "a" : "b";

  const props = new Map<string, Property>();
  for (const p of local.properties ?? []) props.set(p.id, p);
  for (const p of cloud.properties ?? []) {
    const prev = props.get(p.id);
    props.set(p.id, prev ? mergeProperty(prev, p, preferA) : p);
  }

  const emps = new Map<string, Employee>();
  for (const e of local.employees ?? []) emps.set(e.id, e);
  for (const e of cloud.employees ?? []) {
    const prev = emps.get(e.id);
    emps.set(e.id, prev ? mergeEmployee(prev, e, preferA) : e);
  }

  const owners = new Map<string, Owner>();
  for (const o of local.owners ?? []) {
    const key = o.id || o.name.trim().toLowerCase();
    owners.set(key, o);
  }
  for (const o of cloud.owners ?? []) {
    const key = o.id || o.name.trim().toLowerCase();
    const prev = owners.get(key);
    owners.set(key, prev ? mergeOwner(prev, o, preferA) : o);
  }

  const jobsById = new Map<string, Job>();
  const jobsByPlaceDate = new Map<string, string>();

  const ingest = (job: Job, side: "a" | "b") => {
    const placeKey = `${job.property_id}|${job.date}`;
    const existingPlaceId = jobsByPlaceDate.get(placeKey);
    if (existingPlaceId && existingPlaceId !== job.id) {
      const existing = jobsById.get(existingPlaceId)!;
      // Always merge as (local=a, cloud=b) order for stable prefer semantics
      const localJob = side === "a" ? job : existing;
      const cloudJob = side === "a" ? existing : job;
      const merged = mergeJob(localJob, cloudJob, preferA);
      jobsById.delete(existingPlaceId);
      jobsById.delete(job.id);
      jobsById.set(merged.id, merged);
      jobsByPlaceDate.set(placeKey, merged.id);
      return;
    }
    const prev = jobsById.get(job.id);
    if (prev) {
      // prev was from local (a) when ingesting cloud (b)
      const merged =
        side === "b" ? mergeJob(prev, job, preferA) : mergeJob(job, prev, preferA);
      jobsById.set(merged.id, merged);
      jobsByPlaceDate.set(placeKey, merged.id);
    } else {
      jobsById.set(job.id, job);
      jobsByPlaceDate.set(placeKey, job.id);
    }
  };

  for (const j of local.jobs ?? []) ingest(j, "a");
  for (const j of cloud.jobs ?? []) ingest(j, "b");

  return {
    properties: [...props.values()],
    employees: [...emps.values()],
    jobs: [...jobsById.values()],
    owners: [...owners.values()],
    default_schedule: mergeSchedule(
      local.default_schedule ?? {},
      cloud.default_schedule ?? {},
      preferA
    ),
    settings: mergeSettings(
      local.settings ?? { company_name: "DClean", whatsapp: null },
      cloud.settings ?? { company_name: "DClean", whatsapp: null },
      preferA
    ),
  };
}

export function isMateriallyThinner(
  candidate: AppData,
  baseline: AppData
): boolean {
  const c = contentScore(candidate);
  const b = contentScore(baseline);
  if (b === 0) return false;
  if (c === 0) return true;
  const cJobs = candidate.jobs?.length ?? 0;
  const bJobs = baseline.jobs?.length ?? 0;
  if (c < b) return true;
  // Any job loss is material — do not let props/emps offset deleted jobs
  if (bJobs > 0 && cJobs < bJobs) return true;
  const cProps = candidate.properties?.length ?? 0;
  const bProps = baseline.properties?.length ?? 0;
  if (bProps > 0 && cProps < bProps) return true;
  const cEmps = candidate.employees?.length ?? 0;
  const bEmps = baseline.employees?.length ?? 0;
  if (bEmps > 0 && cEmps < bEmps) return true;
  return false;
}
