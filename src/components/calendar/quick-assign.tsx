"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import {
  addDays,
  format,
  isSameDay,
  startOfDay,
  subDays,
} from "date-fns";
import { BookmarkPlus, ClipboardList, Copy, Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { Employee, Job, Property } from "@/types/database";
import { verifyPassword } from "@/lib/auth";
import {
  applyDefaultScheduleToDay,
  copyScheduleFromDayToDay,
  computeJobCostsFromProperty,
  getActiveEmployees,
  getActiveProperties,
  getAllEmployees,
  getAllJobs,
  getAllProperties,
  hasDefaultSchedule,
  saveDefaultScheduleFromDay,
  SYNC_EVENT,
  updateJobBedsForPlace,
  saveJobDayDetails,
  upsertJobForPlace,
} from "@/lib/store";
import { cn, formatCurrency, parseLocalDate } from "@/lib/utils";

/** Dates strictly older than 3 days require password to edit. */
const OLD_SCHEDULE_UNLOCK_KEY = "dclean_old_schedule_edit_v1";

function historyEditCutoffKey(now = new Date()): string {
  return format(subDays(startOfDay(now), 3), "yyyy-MM-dd");
}

function needsPasswordForScheduleDate(dateKey: string): boolean {
  return dateKey < historyEditCutoffKey();
}

function readOldScheduleUnlocked(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return sessionStorage.getItem(OLD_SCHEDULE_UNLOCK_KEY) === "1";
  } catch {
    return false;
  }
}

function writeOldScheduleUnlocked() {
  try {
    sessionStorage.setItem(OLD_SCHEDULE_UNLOCK_KEY, "1");
  } catch {
    /* ignore */
  }
}

interface QuickAssignProps {
  jobs: Job[];
  properties: Property[];
  employees: Employee[];
}

function shortName(name: string) {
  const parts = name.trim().split(/\s+/);
  return parts[0]?.slice(0, 8) || "?";
}

type BedDraft = { single: number; double: number };

const NOTE_SUGGESTIONS = [
  "Keys with reception",
  "Extra towels",
  "Early checkout",
  "Late checkout",
];

export function QuickAssign(_props: QuickAssignProps) {
  const today = startOfDay(new Date());
  const tomorrow = startOfDay(addDays(new Date(), 1));
  const [selectedDate, setSelectedDate] = useState(tomorrow);
  const [properties, setProperties] = useState<Property[]>([]);
  const [allProperties, setAllProperties] = useState<Property[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [allEmployees, setAllEmployees] = useState<Employee[]>([]);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [bedDrafts, setBedDrafts] = useState<Record<string, BedDraft>>({});
  const [detailPropertyId, setDetailPropertyId] = useState<string | null>(null);
  const [detailSingle, setDetailSingle] = useState(0);
  const [detailDouble, setDetailDouble] = useState(0);
  const [detailPillowPerSingle, setDetailPillowPerSingle] = useState(1);
  const [detailPillowPerDouble, setDetailPillowPerDouble] = useState(2);
  const [detailExtraPillows, setDetailExtraPillows] = useState(0);
  const [detailOwnerPay, setDetailOwnerPay] = useState(0);
  const [detailEmployeePay, setDetailEmployeePay] = useState(0);
  const [detailExtraCost, setDetailExtraCost] = useState(0);
  const [detailExtraSheetCost, setDetailExtraSheetCost] = useState(0);
  const [detailSingleSheet, setDetailSingleSheet] = useState(0);
  const [detailDoubleSheet, setDetailDoubleSheet] = useState(0);
  const [detailPillowRate, setDetailPillowRate] = useState(0);
  const [detailNote, setDetailNote] = useState("");
  const [hasDefault, setHasDefault] = useState(false);
  const [historyUnlocked, setHistoryUnlocked] = useState(readOldScheduleUnlocked);
  const [historyPwOpen, setHistoryPwOpen] = useState(false);
  const [historyPassword, setHistoryPassword] = useState("");
  const [historyPwError, setHistoryPwError] = useState<string | null>(null);
  const pendingHistoryEdit = useRef<(() => void) | null>(null);
  const [applyOpen, setApplyOpen] = useState(false);
  const [applyMode, setApplyMode] = useState<"default" | "day">("default");
  const [copyFromDate, setCopyFromDate] = useState(() =>
    format(subDays(startOfDay(new Date()), 1), "yyyy-MM-dd")
  );

  const sync = useCallback(() => {
    setProperties(getActiveProperties());
    setAllProperties(getAllProperties());
    setEmployees(getActiveEmployees());
    setAllEmployees(getAllEmployees());
    setJobs(getAllJobs());
    setHasDefault(hasDefaultSchedule());
  }, []);

  useEffect(() => {
    sync();
    window.addEventListener(SYNC_EVENT, sync);
    window.addEventListener("focus", sync);
    return () => {
      window.removeEventListener(SYNC_EVENT, sync);
      window.removeEventListener("focus", sync);
    };
  }, [sync]);

  const dateKey = format(selectedDate, "yyyy-MM-dd");
  const todayKeyStr = format(today, "yyyy-MM-dd");
  /** Past only (today may receive Apply / copy). */
  const isPast = dateKey < todayKeyStr;
  /** Past + today: always show removed (locked). Tomorrow+: only if already ticked. */
  const isPastOrToday = dateKey <= todayKeyStr;
  /** Older than 3 days: edits need login password (unlocked for this tab session). */

  const withHistoryPassword = useCallback(
    (action: () => void, opts?: { unlockOnly?: boolean }) => {
      if (!needsPasswordForScheduleDate(dateKey) || historyUnlocked) {
        if (!opts?.unlockOnly) action();
        return;
      }
      // Keep latest pending action; ignore unlock-only if a real edit is queued
      if (opts?.unlockOnly && pendingHistoryEdit.current) {
        setHistoryPassword("");
        setHistoryPwError(null);
        setHistoryPwOpen(true);
        return;
      }
      pendingHistoryEdit.current = opts?.unlockOnly ? null : action;
      setHistoryPassword("");
      setHistoryPwError(null);
      setHistoryPwOpen(true);
    },
    [dateKey, historyUnlocked]
  );

  const confirmHistoryPassword = (e: FormEvent) => {
    e.preventDefault();
    setHistoryPwError(null);
    if (!verifyPassword(historyPassword)) {
      setHistoryPwError("Wrong password.");
      return;
    }
    writeOldScheduleUnlocked();
    setHistoryUnlocked(true);
    setHistoryPwOpen(false);
    setHistoryPassword("");
    const pending = pendingHistoryEdit.current;
    pendingHistoryEdit.current = null;
    pending?.();
  };

  useEffect(() => {
    setBedDrafts({});
  }, [dateKey]);

  /** Includes cancelled — for beds/notes history when day was cleared. */
  const jobRecordByProperty = useMemo(() => {
    const map = new Map<string, Job>();
    for (const job of jobs) {
      if (job.date !== dateKey) continue;
      map.set(job.property_id, job);
    }
    return map;
  }, [jobs, dateKey]);

  /** Active schedule only — cancelled days look empty in the grid. */
  const jobByProperty = useMemo(() => {
    const map = new Map<string, Job>();
    for (const [id, job] of jobRecordByProperty) {
      if (job.status === "cancelled") continue;
      map.set(id, job);
    }
    return map;
  }, [jobRecordByProperty]);

  /** Employee ids assigned on this date (non-cancelled jobs). */
  const assignedEmployeeIdsOnDay = useMemo(() => {
    const onDay = new Set<string>();
    for (const job of jobByProperty.values()) {
      for (const a of job.job_assignments ?? []) {
        onDay.add(a.employee_id);
      }
    }
    return onDay;
  }, [jobByProperty]);

  /**
   * Columns for this date:
   * - Active cleaners always
   * - Archived: past/today if on any job record; tomorrow+ only if still ticked
   */
  const displayEmployees = useMemo(() => {
    const byId = new Map<string, Employee>();
    for (const e of employees) byId.set(e.id, e);

    const archivedVisible = allEmployees.filter((e) => {
      if (!e.archived) return false;
      if (isPastOrToday) {
        for (const job of jobRecordByProperty.values()) {
          if ((job.job_assignments ?? []).some((a) => a.employee_id === e.id)) {
            return true;
          }
        }
        return false;
      }
      return assignedEmployeeIdsOnDay.has(e.id);
    });
    for (const e of archivedVisible) byId.set(e.id, e);
    return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [
    isPastOrToday,
    employees,
    allEmployees,
    jobRecordByProperty,
    assignedEmployeeIdsOnDay,
  ]);

  /**
   * Rows for this date:
   * - Active places always
   * - Archived: past/today if any job that day; tomorrow+ only if ticked (assignees)
   */
  const displayProperties = useMemo(() => {
    const byId = new Map<string, Property>();
    for (const p of properties) byId.set(p.id, p);

    const archivedVisible = allProperties.filter((p) => {
      if (!p.archived) return false;
      if (isPastOrToday) {
        // Prefer real schedule history (assignees), not empty cancelled stubs
        const job = jobRecordByProperty.get(p.id);
        if (!job) return false;
        if (job.status === "cancelled") {
          return (job.job_assignments?.length ?? 0) > 0;
        }
        return true;
      }
      const job = jobByProperty.get(p.id);
      return !!job && (job.job_assignments?.length ?? 0) > 0;
    });
    for (const p of archivedVisible) byId.set(p.id, p);
    return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [
    isPastOrToday,
    properties,
    allProperties,
    jobRecordByProperty,
    jobByProperty,
  ]);

  const bedsFor = (property: Property): BedDraft => {
    const draft = bedDrafts[property.id];
    if (draft) return draft;
    const job = jobRecordByProperty.get(property.id);
    if (job) {
      return { single: job.single_beds, double: job.double_beds };
    }
    return {
      single: property.single_beds,
      double: property.double_beds,
    };
  };

  const setBeds = (property: Property, next: BedDraft) => {
    if (property.archived) return;
    // Don't apply a half-typed bed value after password unlock — unlock first
    if (needsPasswordForScheduleDate(dateKey) && !historyUnlocked) {
      withHistoryPassword(() => {}, { unlockOnly: true });
      return;
    }
    setBedDrafts((prev) => ({ ...prev, [property.id]: next }));
    const job = jobByProperty.get(property.id);
    if (job && job.job_assignments.length > 0) {
      const perSingle =
        job.single_beds > 0
          ? Math.round(
              (job.pillow_covers_single || 0) / Math.max(1, job.single_beds)
            )
          : property.pillow_covers_single;
      const perDouble =
        job.double_beds > 0
          ? Math.round(
              (job.pillow_covers_double || 0) / Math.max(1, job.double_beds)
            )
          : property.pillow_covers_double;
      updateJobBedsForPlace({
        date: dateKey,
        propertyId: property.id,
        singleBeds: next.single,
        doubleBeds: next.double,
        pillowCoversPerSingle: perSingle,
        pillowCoversPerDouble: perDouble,
      });
      sync();
    }
  };

  const toggleTick = (property: Property, employeeId: string) => {
    if (property.archived) return;

    withHistoryPassword(() => {
      const emp = allEmployees.find((e) => e.id === employeeId);
      // Read from store — React state can lag behind rapid ticks
      const existing = getAllJobs().find(
        (j) =>
          j.property_id === property.id &&
          j.date === dateKey &&
          j.status !== "cancelled"
      );
      const activeIds = new Set(employees.map((e) => e.id));
      const archivedIds = new Set(
        allEmployees.filter((e) => e.archived).map((e) => e.id)
      );
      // Always preserve archived assignees when editing other ticks
      const current = new Set(
        (existing?.job_assignments ?? [])
          .map((a) => a.employee_id)
          .filter((id) => activeIds.has(id) || archivedIds.has(id))
      );
      const isAssigned = current.has(employeeId);
      // Archived cleaners: untick only on future nights; never new-assign
      if (emp?.archived) {
        if (!isAssigned || isPastOrToday) return;
      }

      if (isAssigned) current.delete(employeeId);
      else current.add(employeeId);

      const beds = bedsFor(property);
      upsertJobForPlace({
        date: dateKey,
        property,
        employeeIds: [...current],
        employees: allEmployees,
        singleBeds: beds.single,
        doubleBeds: beds.double,
      });
      setBedDrafts((prev) => {
        const copy = { ...prev };
        delete copy[property.id];
        return copy;
      });
      sync();
    });
  };

  const detailProperty = useMemo(
    () =>
      detailPropertyId
        ? displayProperties.find((p) => p.id === detailPropertyId) ??
          properties.find((p) => p.id === detailPropertyId) ??
          null
        : null,
    [displayProperties, properties, detailPropertyId]
  );

  const detailJob = detailProperty
    ? jobByProperty.get(detailProperty.id) ?? null
    : null;

  const detailCosts = detailProperty
    ? computeJobCostsFromProperty(
        detailProperty,
        detailSingle,
        detailDouble,
        {
          pillow_covers_single: detailPillowPerSingle,
          pillow_covers_double: detailPillowPerDouble,
          extra_pillows: detailExtraPillows,
          single_sheet_cost: detailSingleSheet,
          double_sheet_cost: detailDoubleSheet,
          extra_sheet_cost: detailExtraSheetCost,
          pillow_cost: detailPillowRate,
          other_cost: detailExtraCost,
        }
      )
    : null;

  const openDetails = (property: Property) => {
    if (property.archived) return;
    withHistoryPassword(() => openDetailsUnlocked(property));
  };

  const openDetailsUnlocked = (property: Property) => {
    const beds = bedsFor(property);
    const job = jobRecordByProperty.get(property.id);
    setDetailPropertyId(property.id);
    setDetailSingle(beds.single);
    setDetailDouble(beds.double);
    // Per-bed rates from job bed counts (not draft) to avoid wrong ratios
    const rateSingleBeds = job?.single_beds ?? beds.single;
    const rateDoubleBeds = job?.double_beds ?? beds.double;
    setDetailPillowPerSingle(
      job && rateSingleBeds > 0
        ? Math.round(job.pillow_covers_single / rateSingleBeds)
        : Number(property.pillow_covers_single) || 0
    );
    setDetailPillowPerDouble(
      job && rateDoubleBeds > 0
        ? Math.round(job.pillow_covers_double / rateDoubleBeds)
        : Number(property.pillow_covers_double) || 0
    );
    setDetailExtraPillows(
      job?.extra_pillows ?? (Number(property.extra_pillows) || 0)
    );
    setDetailOwnerPay(
      job
        ? job.charged_amount !== undefined && job.charged_amount !== null
          ? Number(job.charged_amount)
          : Number(property.owner_amount) || Number(property.amount) || 0
        : Number(property.owner_amount) || Number(property.amount) || 0
    );
    setDetailEmployeePay(
      job && job.employee_pay_amount !== undefined
        ? Number(job.employee_pay_amount) || 0
        : Number(property.employee_pay_amount) ||
            Number(property.owner_amount) ||
            0
    );
    setDetailExtraCost(
      job
        ? Number(job.product_cost) || 0
        : Number(property.product_cost) || Number(property.other_cost) || 0
    );
    setDetailExtraSheetCost(
      job
        ? Number(job.extra_sheet_cost) || 0
        : Number(property.extra_sheet_cost) || 0
    );
    setDetailSingleSheet(
      job?.single_sheet_cost ?? (Number(property.single_sheet_cost) || 0)
    );
    setDetailDoubleSheet(
      job?.double_sheet_cost ?? (Number(property.double_sheet_cost) || 0)
    );
    setDetailPillowRate(
      job?.pillow_cost ?? (Number(property.pillow_cost) || 0)
    );
    setDetailNote(job?.notes ?? "");
  };

  const saveDetails = () => {
    if (!detailProperty) return;
    withHistoryPassword(() => {
      const beds = { single: detailSingle, double: detailDouble };
      setBedDrafts((prev) => ({ ...prev, [detailProperty.id]: beds }));

      saveJobDayDetails({
        date: dateKey,
        property: detailProperty,
        notes: detailNote,
        singleBeds: detailSingle,
        doubleBeds: detailDouble,
        pillowCoversPerSingle: detailPillowPerSingle,
        pillowCoversPerDouble: detailPillowPerDouble,
        extraPillows: detailExtraPillows,
        ownerAmount: detailOwnerPay,
        employeePayAmount: detailEmployeePay,
        extraCost: detailExtraCost,
        singleSheetCost: detailSingleSheet,
        doubleSheetCost: detailDoubleSheet,
        extraSheetCost: detailExtraSheetCost,
        pillowUnitCost: detailPillowRate,
      });

      setDetailPropertyId(null);
      setDetailNote("");
      sync();
    });
  };

  const sortedProperties = useMemo(
    () => [...displayProperties].sort((a, b) => a.name.localeCompare(b.name)),
    [displayProperties]
  );

  const assignedCount = properties.filter((p) => {
    const j = jobByProperty.get(p.id);
    if (!j) return false;
    return (j.job_assignments ?? []).length > 0;
  }).length;
  const total = properties.length;
  const done = total > 0 && assignedCount === total;

  const handleSaveDefault = () => {
    if (properties.length === 0) {
      window.alert("Add places first, then save a default schedule.");
      return;
    }
    const ok = window.confirm(
      `Save this day’s schedule as the default?\n\n${assignedCount} of ${total} places have cleaners (empty places are saved too).\n\nThen use Apply default on today or any future night to fill that day from this layout (or copy from any other date).`
    );
    if (!ok) return;
    const n = saveDefaultScheduleFromDay(dateKey);
    setHasDefault(n > 0);
    window.alert(
      n > 0
        ? `Default saved (${n} places, including empties). Use Apply default to fill another night.`
        : "Nothing to save."
    );
    sync();
  };

  const openApplyDialog = () => {
    if (isPast) {
      window.alert(
        "Apply / copy fills today or a future night only — past days stay as history."
      );
      return;
    }
    if (properties.length === 0) {
      window.alert("Add places first.");
      return;
    }
    setApplyMode(hasDefault ? "default" : "day");
    setCopyFromDate(
      format(subDays(selectedDate, 1), "yyyy-MM-dd") === dateKey
        ? format(subDays(selectedDate, 2), "yyyy-MM-dd")
        : format(subDays(selectedDate, 1), "yyyy-MM-dd")
    );
    setApplyOpen(true);
  };

  const confirmApplyOrCopy = () => {
    if (isPast) return;
    const run = () => {
      let n = 0;
      if (applyMode === "default") {
        if (!hasDefault) {
          window.alert(
            "No saved default yet. Choose “Copy from a date”, or Save as default first."
          );
          return;
        }
        n = applyDefaultScheduleToDay(dateKey);
      } else {
        if (!copyFromDate || copyFromDate === dateKey) {
          window.alert("Pick a different date to copy from.");
          return;
        }
        n = copyScheduleFromDayToDay(copyFromDate, dateKey);
      }
      setBedDrafts({});
      setApplyOpen(false);
      sync();
      if (n === 0) {
        window.alert(
          applyMode === "default"
            ? "Could not apply default (no places)."
            : "Nothing copied — source day may be empty or same as target."
        );
      }
    };
    withHistoryPassword(run);
  };

  return (
    <div className="space-y-4">
      <div className="rounded-xl border bg-white p-4 shadow-sm space-y-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-teal-700">
            Step 1 · Choose date
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <Button
              size="lg"
              variant={isSameDay(selectedDate, today) ? "default" : "outline"}
              onClick={() => setSelectedDate(today)}
            >
              Today
            </Button>
            <Button
              size="lg"
              variant={isSameDay(selectedDate, tomorrow) ? "default" : "outline"}
              onClick={() => setSelectedDate(tomorrow)}
            >
              Tomorrow
            </Button>
            <input
              type="date"
              value={dateKey}
              onChange={(e) => {
                if (!e.target.value) return;
                setSelectedDate(startOfDay(parseLocalDate(e.target.value)));
              }}
              className="h-11 rounded-md border border-input bg-white px-3 text-sm"
            />
            <span className="text-sm font-medium text-slate-600">
              {format(selectedDate, "EEEE, MMM d")}
            </span>
          </div>
          {needsPasswordForScheduleDate(dateKey) ? (
            <p className="mt-2 text-sm text-amber-800 flex items-start gap-1.5">
              <Lock className="h-4 w-4 mt-0.5 shrink-0" />
              <span>
                This day is older than 3 days.
                {historyUnlocked
                  ? " Editing unlocked for this session."
                  : " Password required to change ticks, beds, or day details."}
              </span>
            </p>
          ) : null}
        </div>

        <div className="flex flex-col sm:flex-row sm:items-center gap-3 justify-between border-t pt-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-teal-700">
              Step 2 · Tick cleaners · beds · day details
            </p>
            <p className="text-sm text-slate-500 mt-0.5">
              Save as default stores any day. Apply default fills{" "}
              <span className="font-medium text-slate-700">this date</span> from
              the saved default, or copies ticks and beds from any other date.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="gap-1.5"
              onClick={handleSaveDefault}
              disabled={properties.length === 0}
            >
              <BookmarkPlus className="h-4 w-4" />
              Save as default
            </Button>
            <Button
              type="button"
              size="sm"
              className="gap-1.5"
              onClick={openApplyDialog}
              disabled={properties.length === 0 || isPast}
              title={
                isPast
                  ? "Select today or a future night to fill"
                  : "Fill this day from default or any date"
              }
            >
              <Copy className="h-4 w-4" />
              Apply default
            </Button>
            <div
              className={cn(
                "rounded-lg px-4 py-2 text-sm font-semibold",
                done
                  ? "bg-emerald-100 text-emerald-800"
                  : "bg-amber-100 text-amber-900"
              )}
            >
              {assignedCount} / {total} places done{done ? " ✓" : ""}
            </div>
          </div>
        </div>
      </div>

      {sortedProperties.length === 0 || displayEmployees.length === 0 ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-5 text-amber-900 text-sm">
          {sortedProperties.length === 0
            ? properties.length === 0
              ? "Add properties first (Properties page), then come back."
              : "No places on this day (removed places only appear if they were already scheduled/ticked)."
            : "Add employees first (Employees page), then come back."}
        </div>
      ) : (
        <div className="rounded-xl border bg-white shadow-sm overflow-hidden">
          <div className="overflow-auto max-h-[calc(100vh-260px)] min-h-[360px]">
            <table className="w-full border-collapse text-sm table-fixed min-w-[640px]">
              <thead className="sticky top-0 z-20">
                <tr className="bg-teal-700 text-white">
                  <th className="sticky left-0 z-30 bg-teal-700 text-left px-2 py-2 w-[130px] border-r border-teal-600">
                    Place
                  </th>
                  <th
                    className="sticky z-30 bg-teal-800 px-1 py-2 w-[58px] text-center text-[10px] font-bold leading-tight border-r border-teal-600"
                    style={{ left: 130 }}
                    title="Single beds today"
                  >
                    Single
                  </th>
                  <th
                    className="sticky z-30 bg-teal-800 px-1 py-2 w-[58px] text-center text-[10px] font-bold leading-tight border-r border-teal-600"
                    style={{ left: 188 }}
                    title="Double beds today"
                  >
                    Double
                  </th>
                  {displayEmployees.map((emp) => (
                    <th
                      key={emp.id}
                      className={cn(
                        "px-0.5 py-1.5 text-center font-semibold w-10",
                        emp.archived && "bg-slate-600/80 text-slate-300"
                      )}
                      title={
                        emp.archived
                          ? `${emp.name} (removed — view only)`
                          : emp.name
                      }
                    >
                      <div
                        className={cn(
                          "mx-auto mb-0.5 h-2 w-2 rounded-full",
                          emp.archived && "grayscale opacity-50"
                        )}
                        style={{ backgroundColor: emp.color_code }}
                      />
                      <span
                        className={cn(
                          "block text-[10px] leading-tight truncate px-0.5",
                          emp.archived && "text-slate-300"
                        )}
                      >
                        {shortName(emp.name)}
                      </span>
                      {emp.archived ? (
                        <span className="block text-[8px] font-normal text-slate-400 leading-none mt-0.5">
                          off
                        </span>
                      ) : null}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sortedProperties.map((property, index) => {
                  const job = jobByProperty.get(property.id);
                  const jobRecord = jobRecordByProperty.get(property.id);
                  const notePreview = jobRecord?.notes?.trim() || "";
                  const assignedIds = new Set(
                    (job?.job_assignments ?? []).map((a) => a.employee_id)
                  );
                  const isDone = assignedIds.size > 0;
                  const beds = bedsFor(property);
                  const placeLocked = !!property.archived;

                  return (
                    <tr
                      key={property.id}
                      className={cn(
                        "border-b",
                        placeLocked
                          ? "bg-slate-200/90 text-slate-500"
                          : cn(
                              index % 2 === 1 ? "bg-slate-50/80" : "bg-white",
                              !isDone && "bg-amber-50/70"
                            )
                      )}
                    >
                      <td
                        className={cn(
                          "sticky left-0 z-10 px-2 py-1 border-r border-slate-200 w-[130px]",
                          placeLocked
                            ? "bg-slate-200/95"
                            : "bg-inherit"
                        )}
                      >
                        <div className="flex items-start gap-1 min-w-0">
                          <span
                            className={cn(
                              "text-[9px] w-3 shrink-0 tabular-nums pt-0.5",
                              placeLocked ? "text-slate-400" : "text-slate-400"
                            )}
                          >
                            {index + 1}
                          </span>
                          <div className="min-w-0 leading-tight flex-1">
                            <div className="flex items-start gap-0.5">
                              <div className="min-w-0 flex-1">
                                <p
                                  className={cn(
                                    "font-medium text-xs truncate",
                                    placeLocked
                                      ? "text-slate-500"
                                      : "text-slate-800"
                                  )}
                                >
                                  {property.name}
                                  {placeLocked ? (
                                    <span className="ml-1 text-[9px] font-normal text-slate-400">
                                      (removed)
                                    </span>
                                  ) : null}
                                </p>
                                <p
                                  className={cn(
                                    "text-[10px] truncate",
                                    placeLocked
                                      ? "text-slate-400"
                                      : "text-slate-500"
                                  )}
                                >
                                  {property.owner || "—"}
                                </p>
                              </div>
                              <button
                                type="button"
                                title={
                                  placeLocked
                                    ? "Removed place — view only"
                                    : "Day details"
                                }
                                aria-label={`Details · ${property.name}`}
                                disabled={placeLocked}
                                onClick={() => openDetails(property)}
                                className={cn(
                                  "mt-0.5 shrink-0 rounded p-0.5",
                                  placeLocked
                                    ? "cursor-not-allowed text-slate-300 opacity-40"
                                    : notePreview
                                      ? "text-teal-700 bg-teal-50 hover:bg-teal-100"
                                      : "text-slate-400 hover:text-teal-700 hover:bg-slate-100"
                                )}
                              >
                                <ClipboardList className="h-3.5 w-3.5" />
                              </button>
                            </div>
                            {notePreview ? (
                              <p
                                className={cn(
                                  "mt-0.5 text-[10px] truncate",
                                  placeLocked
                                    ? "text-slate-400"
                                    : "text-teal-800"
                                )}
                              >
                                {notePreview}
                              </p>
                            ) : null}
                          </div>
                        </div>
                      </td>
                      <td
                        className={cn(
                          "sticky z-10 px-0.5 py-1 border-r border-slate-200 w-[58px]",
                          placeLocked ? "bg-slate-200/95" : "bg-inherit"
                        )}
                        style={{ left: 130 }}
                      >
                        <input
                          type="number"
                          min={0}
                          inputMode="numeric"
                          disabled={placeLocked}
                          aria-label={`Single beds · ${property.name}`}
                          value={beds.single}
                          onChange={(e) =>
                            setBeds(property, {
                              single: Math.max(
                                0,
                                parseInt(e.target.value, 10) || 0
                              ),
                              double: beds.double,
                            })
                          }
                          className={cn(
                            "h-7 w-full rounded border px-0.5 text-center text-xs tabular-nums focus:outline-none",
                            placeLocked
                              ? "cursor-not-allowed border-slate-300 bg-slate-300/80 text-slate-500"
                              : "border-slate-200 bg-white focus:border-teal-500"
                          )}
                        />
                      </td>
                      <td
                        className={cn(
                          "sticky z-10 px-0.5 py-1 border-r border-slate-200 w-[58px]",
                          placeLocked ? "bg-slate-200/95" : "bg-inherit"
                        )}
                        style={{ left: 188 }}
                      >
                        <input
                          type="number"
                          min={0}
                          inputMode="numeric"
                          disabled={placeLocked}
                          aria-label={`Double beds · ${property.name}`}
                          value={beds.double}
                          onChange={(e) =>
                            setBeds(property, {
                              single: beds.single,
                              double: Math.max(
                                0,
                                parseInt(e.target.value, 10) || 0
                              ),
                            })
                          }
                          className={cn(
                            "h-7 w-full rounded border px-0.5 text-center text-xs tabular-nums focus:outline-none",
                            placeLocked
                              ? "cursor-not-allowed border-slate-300 bg-slate-300/80 text-slate-500"
                              : "border-slate-200 bg-white focus:border-teal-500"
                          )}
                        />
                      </td>
                      {displayEmployees.map((emp) => {
                        const checked = assignedIds.has(emp.id);
                        // Archived: view-only on past/today; on tomorrow+ can untick if assigned
                        const canUntickArchived =
                          !!emp.archived &&
                          checked &&
                          !placeLocked &&
                          !isPastOrToday;
                        const locked =
                          placeLocked ||
                          (!!emp.archived && !canUntickArchived);
                        return (
                          <td
                            key={emp.id}
                            className={cn(
                              "px-0.5 py-1 text-center w-10",
                              locked && "bg-slate-200/70"
                            )}
                          >
                            <button
                              type="button"
                              disabled={locked}
                              aria-label={
                                locked
                                  ? `${emp.name} — view only`
                                  : canUntickArchived
                                    ? `Unassign archived ${emp.name}`
                                    : `${checked ? "Unassign" : "Assign"} ${emp.name}`
                              }
                              title={
                                placeLocked
                                  ? "Archived place — view only"
                                  : canUntickArchived
                                    ? "Archived cleaner — tap to remove from this night"
                                    : emp.archived
                                      ? "Archived cleaner — view only"
                                      : undefined
                              }
                              onClick={() => toggleTick(property, emp.id)}
                              className={cn(
                                "mx-auto flex h-7 w-7 items-center justify-center rounded border-2",
                                locked && "cursor-not-allowed",
                                checked
                                  ? locked
                                    ? "border-slate-400 bg-slate-400 text-slate-100 grayscale"
                                    : canUntickArchived
                                      ? "border-slate-500 bg-slate-500 text-white"
                                      : "border-transparent text-white"
                                  : locked
                                    ? "border-slate-300 bg-slate-300/90"
                                    : "border-slate-200 bg-white hover:border-teal-400"
                              )}
                              style={
                                checked && !locked && !canUntickArchived
                                  ? {
                                      backgroundColor: emp.color_code,
                                      borderColor: emp.color_code,
                                    }
                                  : undefined
                              }
                            >
                              {checked ? (
                                <span className="text-xs font-bold">✓</span>
                              ) : null}
                            </button>
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <Dialog
        open={detailPropertyId !== null}
        onOpenChange={(open) => {
          if (!open) {
            setDetailPropertyId(null);
            setDetailNote("");
          }
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Day details</DialogTitle>
            <DialogDescription>
              {detailProperty
                ? `${detailProperty.name}${
                    detailProperty.owner ? ` · ${detailProperty.owner}` : ""
                  } · ${format(selectedDate, "EEE, MMM d")}`
                : "Beds, note, and costs for this place today."}
            </DialogDescription>
          </DialogHeader>
          {detailProperty && detailCosts ? (
            <div className="space-y-4">
              <section className="space-y-2">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-teal-700">
                  2 · Beds &amp; pillows
                </p>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <Label htmlFor="detail-single">Single beds</Label>
                    <Input
                      id="detail-single"
                      type="number"
                      min={0}
                      value={detailSingle}
                      onChange={(e) =>
                        setDetailSingle(
                          Math.max(0, parseInt(e.target.value, 10) || 0)
                        )
                      }
                    />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="detail-double">Double beds</Label>
                    <Input
                      id="detail-double"
                      type="number"
                      min={0}
                      value={detailDouble}
                      onChange={(e) =>
                        setDetailDouble(
                          Math.max(0, parseInt(e.target.value, 10) || 0)
                        )
                      }
                    />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="detail-pillow-s">Pillow per single bed</Label>
                    <Input
                      id="detail-pillow-s"
                      type="number"
                      min={0}
                      value={detailPillowPerSingle}
                      onChange={(e) =>
                        setDetailPillowPerSingle(
                          Math.max(0, parseInt(e.target.value, 10) || 0)
                        )
                      }
                    />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="detail-pillow-d">Pillow per double bed</Label>
                    <Input
                      id="detail-pillow-d"
                      type="number"
                      min={0}
                      value={detailPillowPerDouble}
                      onChange={(e) =>
                        setDetailPillowPerDouble(
                          Math.max(0, parseInt(e.target.value, 10) || 0)
                        )
                      }
                    />
                  </div>
                  <div className="space-y-1 col-span-2">
                    <Label htmlFor="detail-extra-pillows">
                      Number of extra pillows
                    </Label>
                    <Input
                      id="detail-extra-pillows"
                      type="number"
                      min={0}
                      value={detailExtraPillows}
                      onChange={(e) =>
                        setDetailExtraPillows(
                          Math.max(0, parseInt(e.target.value, 10) || 0)
                        )
                      }
                    />
                  </div>
                </div>
              </section>

              <section className="space-y-2">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-teal-700">
                  3 · Money (€)
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                  <div className="space-y-1">
                    <Label htmlFor="detail-owner">Owner Pay (€)</Label>
                    <Input
                      id="detail-owner"
                      type="number"
                      step="0.01"
                      min={0}
                      value={detailOwnerPay}
                      onChange={(e) =>
                        setDetailOwnerPay(
                          Math.max(0, parseFloat(e.target.value) || 0)
                        )
                      }
                    />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="detail-emp">Employee Pay (€)</Label>
                    <Input
                      id="detail-emp"
                      type="number"
                      step="0.01"
                      min={0}
                      value={detailEmployeePay}
                      onChange={(e) =>
                        setDetailEmployeePay(
                          Math.max(0, parseFloat(e.target.value) || 0)
                        )
                      }
                    />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="detail-extra-cost">Extra cost (€)</Label>
                    <Input
                      id="detail-extra-cost"
                      type="number"
                      step="0.01"
                      min={0}
                      value={detailExtraCost}
                      onChange={(e) =>
                        setDetailExtraCost(
                          Math.max(0, parseFloat(e.target.value) || 0)
                        )
                      }
                    />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="detail-extra-sheet">
                      Extra sheet cost (€)
                    </Label>
                    <Input
                      id="detail-extra-sheet"
                      type="number"
                      step="0.01"
                      min={0}
                      value={detailExtraSheetCost}
                      onChange={(e) =>
                        setDetailExtraSheetCost(
                          Math.max(0, parseFloat(e.target.value) || 0)
                        )
                      }
                    />
                  </div>
                </div>
              </section>

              <section className="space-y-2">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-teal-700">
                  4 · Sheet &amp; pillow rates (€)
                </p>
                <div className="grid grid-cols-3 gap-3">
                  <div className="space-y-1">
                    <Label htmlFor="detail-sheet-s">Per single bed</Label>
                    <Input
                      id="detail-sheet-s"
                      type="number"
                      step="0.01"
                      min={0}
                      value={detailSingleSheet}
                      onChange={(e) =>
                        setDetailSingleSheet(
                          Math.max(0, parseFloat(e.target.value) || 0)
                        )
                      }
                    />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="detail-sheet-d">Per double bed</Label>
                    <Input
                      id="detail-sheet-d"
                      type="number"
                      step="0.01"
                      min={0}
                      value={detailDoubleSheet}
                      onChange={(e) =>
                        setDetailDoubleSheet(
                          Math.max(0, parseFloat(e.target.value) || 0)
                        )
                      }
                    />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="detail-pillow-rate">Per extra pillow</Label>
                    <Input
                      id="detail-pillow-rate"
                      type="number"
                      step="0.01"
                      min={0}
                      value={detailPillowRate}
                      onChange={(e) =>
                        setDetailPillowRate(
                          Math.max(0, parseFloat(e.target.value) || 0)
                        )
                      }
                    />
                  </div>
                </div>
              </section>

              <div className="space-y-2">
                <Label htmlFor="job-note">Note for cleaners</Label>
                <textarea
                  id="job-note"
                  rows={3}
                  value={detailNote}
                  onChange={(e) => setDetailNote(e.target.value)}
                  placeholder="e.g. Keys with reception, extra towels…"
                  className="flex w-full rounded-md border border-input bg-white px-3 py-2 text-sm shadow-sm placeholder:text-slate-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-600"
                />
                <div className="flex flex-wrap gap-1.5">
                  {NOTE_SUGGESTIONS.map((s) => (
                    <button
                      key={s}
                      type="button"
                      onClick={() =>
                        setDetailNote((prev) =>
                          prev.trim() ? `${prev.trim()}, ${s}` : s
                        )
                      }
                      className="rounded-md border border-slate-200 bg-slate-50 px-2 py-1 text-xs text-slate-700 hover:border-teal-400 hover:bg-teal-50"
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </div>

              <div className="rounded-lg border bg-slate-50 p-3 space-y-1.5 text-sm">
                <p className="text-xs font-semibold uppercase tracking-wide text-teal-700">
                  Calcolo costi
                </p>
                <div className="flex justify-between text-slate-600">
                  <span>
                    Letti singoli ({detailSingle} ×{" "}
                    {formatCurrency(detailSingleSheet)})
                  </span>
                  <span>
                    {formatCurrency(detailSingle * detailSingleSheet)}
                  </span>
                </div>
                <div className="flex justify-between text-slate-600">
                  <span>
                    Letti doppi ({detailDouble} ×{" "}
                    {formatCurrency(detailDoubleSheet)})
                  </span>
                  <span>
                    {formatCurrency(detailDouble * detailDoubleSheet)}
                  </span>
                </div>
                <div className="flex justify-between text-slate-600">
                  <span>
                    Cuscini extra ({detailExtraPillows} ×{" "}
                    {formatCurrency(detailPillowRate)})
                  </span>
                  <span>
                    {formatCurrency(detailExtraPillows * detailPillowRate)}
                  </span>
                </div>
                {detailSingleSheet === 0 &&
                detailDoubleSheet === 0 &&
                detailPillowRate === 0 &&
                detailCosts.linen_cost > 0 ? (
                  <div className="flex justify-between text-slate-600">
                    <span>Biancheria fissa (legacy)</span>
                    <span>{formatCurrency(detailCosts.linen_cost)}</span>
                  </div>
                ) : null}
                {detailCosts.extra_sheet_cost > 0 ? (
                  <div className="flex justify-between text-slate-600">
                    <span>Costo lenzuola extra</span>
                    <span>{formatCurrency(detailCosts.extra_sheet_cost)}</span>
                  </div>
                ) : null}
                {detailCosts.product_cost > 0 ? (
                  <div className="flex justify-between text-slate-600">
                    <span>Costo extra</span>
                    <span>{formatCurrency(detailCosts.product_cost)}</span>
                  </div>
                ) : null}
                <div className="flex justify-between font-semibold text-slate-800 border-t pt-1.5 mt-1">
                  <span>Totale biancheria + extra</span>
                  <span>
                    {formatCurrency(
                      detailCosts.linen_cost +
                        detailCosts.extra_sheet_cost +
                        detailCosts.product_cost
                    )}
                  </span>
                </div>
                <p className="text-[11px] text-slate-500 pt-1">
                  Proprietario: {formatCurrency(detailOwnerPay)} · Dipendente:{" "}
                  {formatCurrency(detailEmployeePay)}
                </p>
              </div>

              <div className="flex justify-end gap-2 pt-1">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    setDetailPropertyId(null);
                    setDetailNote("");
                  }}
                >
                  Cancel
                </Button>
                <Button type="button" onClick={saveDetails}>
                  Save details
                </Button>
              </div>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>

      <Dialog open={applyOpen} onOpenChange={setApplyOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Apply / copy schedule</DialogTitle>
            <DialogDescription>
              Fill{" "}
              <span className="font-medium text-slate-800">
                {format(selectedDate, "EEEE, MMM d")}
              </span>{" "}
              with the saved default, or copy ticks and beds from any other
              day.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <label className="flex items-start gap-2 text-sm cursor-pointer">
                <input
                  type="radio"
                  className="mt-1"
                  name="apply-mode"
                  checked={applyMode === "default"}
                  onChange={() => setApplyMode("default")}
                  disabled={!hasDefault}
                />
                <span>
                  <span className="font-medium text-slate-800">
                    Saved default
                  </span>
                  <span className="block text-slate-500">
                    {hasDefault
                      ? "Use the layout from Save as default"
                      : "No default saved yet — save one first, or copy from a date"}
                  </span>
                </span>
              </label>
              <label className="flex items-start gap-2 text-sm cursor-pointer">
                <input
                  type="radio"
                  className="mt-1"
                  name="apply-mode"
                  checked={applyMode === "day"}
                  onChange={() => setApplyMode("day")}
                />
                <span>
                  <span className="font-medium text-slate-800">
                    Copy from any date
                  </span>
                  <span className="block text-slate-500">
                    Copies cleaners and bed counts into this day’s fields
                  </span>
                </span>
              </label>
            </div>
            {applyMode === "day" ? (
              <div className="space-y-1.5">
                <Label htmlFor="copy-from-date">Copy from</Label>
                <input
                  id="copy-from-date"
                  type="date"
                  value={copyFromDate}
                  onChange={(e) => setCopyFromDate(e.target.value)}
                  className="flex h-10 w-full rounded-md border border-input bg-white px-3 text-sm"
                />
                {copyFromDate === dateKey ? (
                  <p className="text-xs text-amber-800">
                    Pick a different date than the one you are filling.
                  </p>
                ) : null}
              </div>
            ) : null}
            <div className="flex justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => setApplyOpen(false)}
              >
                Cancel
              </Button>
              <Button
                type="button"
                className="gap-2"
                onClick={confirmApplyOrCopy}
                disabled={
                  (applyMode === "default" && !hasDefault) ||
                  (applyMode === "day" &&
                    (!copyFromDate || copyFromDate === dateKey))
                }
              >
                <Copy className="h-4 w-4" />
                Fill this day
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog
        open={historyPwOpen}
        onOpenChange={(open) => {
          if (!open) {
            setHistoryPwOpen(false);
            setHistoryPassword("");
            setHistoryPwError(null);
            pendingHistoryEdit.current = null;
          }
        }}
      >
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Password required</DialogTitle>
            <DialogDescription>
              Schedules older than 3 days need your login password to edit.
              After unlock, you can edit old days for this browser tab.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={confirmHistoryPassword} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="history-edit-pass">Password</Label>
              <Input
                id="history-edit-pass"
                type="password"
                autoComplete="current-password"
                autoFocus
                value={historyPassword}
                onChange={(e) => setHistoryPassword(e.target.value)}
                required
              />
            </div>
            {historyPwError ? (
              <p className="text-sm text-red-600" role="alert">
                {historyPwError}
              </p>
            ) : null}
            <div className="flex justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setHistoryPwOpen(false);
                  setHistoryPassword("");
                  setHistoryPwError(null);
                  pendingHistoryEdit.current = null;
                }}
              >
                Cancel
              </Button>
              <Button type="submit" className="gap-2">
                <Lock className="h-4 w-4" />
                Unlock &amp; continue
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
