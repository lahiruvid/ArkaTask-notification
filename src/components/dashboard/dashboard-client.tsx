"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { addDays, format, startOfDay } from "date-fns";
import {
  CalendarPlus,
  ChevronDown,
  ChevronUp,
  MessageCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { Employee, Job, Property } from "@/types/database";
import {
  getActiveEmployees,
  getActiveProperties,
  getAllJobs,
  getSettings,
  SYNC_EVENT,
} from "@/lib/store";
import {
  buildCleanerNotifications,
  sendWhatsAppBatch,
  toWhatsAppPhone,
  whatsAppUrl,
  type CleanerNotifyCard,
} from "@/lib/whatsapp";

function shortName(name: string) {
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0];
  return `${parts[0]} ${parts[parts.length - 1][0]}.`;
}

function DaySchedulePanel({
  title,
  subtitle,
  dateKey,
  jobs,
  properties,
  employees,
  accent,
}: {
  title: string;
  subtitle: string;
  dateKey: string;
  jobs: Job[];
  properties: Property[];
  employees: Employee[];
  accent: "today" | "tomorrow";
}) {
  const [openOverride, setOpenOverride] = useState<boolean | null>(null);
  const [notifyOpen, setNotifyOpen] = useState(false);
  const [batchBusy, setBatchBusy] = useState(false);
  const [batchProgress, setBatchProgress] = useState<string | null>(null);

  const dayJobs = useMemo(
    () =>
      jobs
        .filter(
          (j) =>
            j.date === dateKey &&
            j.status !== "cancelled" &&
            (j.job_assignments?.length ?? 0) > 0
        )
        .sort((a, b) => a.place_name.localeCompare(b.place_name)),
    [jobs, dateKey]
  );

  const hasSchedule = dayJobs.length > 0;
  const open = openOverride ?? hasSchedule;

  const assignedIds = new Set(dayJobs.map((j) => j.property_id));
  const unassigned = properties
    .filter((p) => !assignedIds.has(p.id))
    .sort((a, b) => a.name.localeCompare(b.name));

  const phoneById = useMemo(() => {
    const map = new Map<string, string | null>();
    for (const e of employees) map.set(e.id, e.phone);
    return map;
  }, [employees]);

  const nameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const e of employees) map.set(e.id, e.name);
    return map;
  }, [employees]);

  const companyName = getSettings().company_name;

  const notifications = useMemo(
    () =>
      buildCleanerNotifications(
        subtitle,
        dayJobs,
        phoneById,
        nameById,
        companyName
      ),
    [subtitle, dayJobs, phoneById, nameById, companyName]
  );

  const sendableCount = notifications.filter((c) => toWhatsAppPhone(c.phone)).length;

  const headerBg = accent === "today" ? "bg-teal-700" : "bg-slate-800";

  const openWhatsApp = (card: CleanerNotifyCard) => {
    const phone = toWhatsAppPhone(card.phone);
    if (!phone) return;
    window.open(whatsAppUrl(phone, card.message), "_blank", "noopener,noreferrer");
  };

  const sendAll = async () => {
    if (batchBusy || sendableCount === 0) return;
    setBatchBusy(true);
    setBatchProgress(`Sending 0 / ${sendableCount}…`);
    try {
      const { sent, skipped } = await sendWhatsAppBatch(
        notifications,
        (done, total) => setBatchProgress(`Sending ${done} / ${total}…`)
      );
      setBatchProgress(
        skipped > 0
          ? `Opened ${sent}. Skipped ${skipped} (no phone).`
          : `Opened ${sent} WhatsApp chat${sent === 1 ? "" : "s"}.`
      );
    } finally {
      setBatchBusy(false);
    }
  };

  return (
    <section className="rounded-xl border bg-white shadow-sm overflow-hidden flex flex-col">
      <div className={`${headerBg} text-white px-4 py-3`}>
        <button
          type="button"
          onClick={() => setOpenOverride(!open)}
          className="text-left w-full hover:brightness-110"
          aria-expanded={open}
        >
          <div className="flex items-start justify-between gap-2">
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-xl font-bold">{title}</h2>
                {open ? (
                  <ChevronUp className="h-5 w-5" />
                ) : (
                  <ChevronDown className="h-5 w-5" />
                )}
              </div>
              <p className="text-sm text-white/80">{subtitle}</p>
            </div>
            <div className="text-right">
              <p className="text-2xl font-bold leading-none">{dayJobs.length}</p>
              <p className="text-xs text-white/75">places set</p>
            </div>
          </div>
          <div className="mt-2 flex flex-wrap gap-2">
            <Badge className="bg-white/20 text-white border-0 hover:bg-white/20">
              {properties.length} places
            </Badge>
            {unassigned.length > 0 ? (
              <Badge className="bg-amber-400 text-amber-950 border-0 hover:bg-amber-400">
                {unassigned.length} empty
              </Badge>
            ) : dayJobs.length > 0 ? (
              <Badge className="bg-emerald-400 text-emerald-950 border-0 hover:bg-emerald-400">
                Fully assigned
              </Badge>
            ) : null}
          </div>
        </button>

        {dayJobs.length > 0 && (
          <div className="mt-3">
            <Button
              type="button"
              size="sm"
              className="w-full gap-2 bg-emerald-500 hover:bg-emerald-400 text-white border-0"
              onClick={(e) => {
                e.stopPropagation();
                setBatchProgress(null);
                setNotifyOpen(true);
              }}
            >
              <MessageCircle className="h-4 w-4" />
              WhatsApp notify cleaners
            </Button>
          </div>
        )}
      </div>

      {open && (
        <>
          <div className="overflow-y-auto max-h-[55vh] min-h-[160px]">
            {dayJobs.length === 0 ? (
              <div className="p-8 text-center space-y-3">
                <p className="text-slate-500 text-sm">No schedule yet.</p>
                <Link href="/calendar">
                  <Button size="sm">Set schedule</Button>
                </Link>
              </div>
            ) : (
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-slate-100">
                  <tr className="text-left text-[11px] uppercase text-slate-500">
                    <th className="px-3 py-2 w-8">#</th>
                    <th className="px-2 py-2">Place</th>
                    <th className="px-3 py-2">Cleaners</th>
                  </tr>
                </thead>
                <tbody>
                  {dayJobs.map((job, i) => (
                      <tr
                        key={job.id}
                        className={i % 2 ? "bg-slate-50/80" : "bg-white"}
                      >
                        <td className="px-3 py-2.5 text-xs text-slate-400">
                          {i + 1}
                        </td>
                        <td className="px-2 py-2.5">
                          <p className="font-semibold text-slate-800">
                            {job.place_name}
                          </p>
                          <p className="text-[11px] text-slate-500">
                            {job.owner_name}
                            {` · ${job.single_beds}S / ${job.double_beds}D`}
                          </p>
                          {job.notes?.trim() ? (
                            <p className="mt-0.5 text-[11px] text-teal-800 font-medium">
                              Note: {job.notes.trim()}
                            </p>
                          ) : null}
                        </td>
                        <td className="px-3 py-2.5">
                          <div className="flex flex-wrap gap-1">
                            {job.job_assignments.map((a) => (
                              <span
                                key={a.id}
                                className="rounded-md px-2 py-1 text-xs font-semibold text-white"
                                style={{
                                  backgroundColor:
                                    a.employees?.color_code || "#0d9488",
                                }}
                              >
                                {shortName(a.employee_name)}
                              </span>
                            ))}
                          </div>
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            )}
          </div>
          {unassigned.length > 0 && (
            <div className="border-t border-amber-200 bg-amber-50 px-3 py-2 max-h-24 overflow-y-auto">
              <p className="text-xs font-semibold text-amber-900">
                Not assigned ({unassigned.length})
              </p>
              <p className="text-xs text-amber-800">
                {unassigned.map((p) => p.name).join(" · ")}
              </p>
            </div>
          )}
        </>
      )}

      <Dialog
        open={notifyOpen}
        onOpenChange={(next) => {
          setNotifyOpen(next);
          if (!next) setBatchProgress(null);
        }}
      >
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>WhatsApp notify · {title}</DialogTitle>
            <DialogDescription>
              Each cleaner only sees places they are assigned to.
              Phone numbers need country code (e.g. 393331234567).
            </DialogDescription>
          </DialogHeader>

          {notifications.length > 0 && (
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <Button
                type="button"
                className="gap-2 bg-emerald-600 hover:bg-emerald-500 flex-1"
                disabled={batchBusy || sendableCount === 0}
                onClick={() => void sendAll()}
              >
                <MessageCircle className="h-4 w-4" />
                {batchBusy ? "Sending…" : `Send all (${sendableCount})`}
              </Button>
              {batchProgress ? (
                <p className="text-xs text-slate-600 sm:max-w-[40%]">{batchProgress}</p>
              ) : (
                <p className="text-[11px] text-slate-500 sm:max-w-[40%]">
                  Opens chats one by one — allow pop-ups if asked.
                </p>
              )}
            </div>
          )}

          <div className="space-y-3">
            {notifications.length === 0 ? (
              <p className="text-sm text-slate-500">
                No cleaners assigned this day.
              </p>
            ) : (
              notifications.map((card) => {
                const phone = toWhatsAppPhone(card.phone);
                return (
                  <div
                    key={card.employeeId}
                    className="rounded-lg border bg-slate-50 p-3 space-y-2"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="font-semibold text-slate-800">{card.name}</p>
                        <p className="text-xs text-slate-500">
                          {card.places.length} place
                          {card.places.length === 1 ? "" : "s"}
                          {card.phone ? ` · ${card.phone}` : " · no phone"}
                        </p>
                      </div>
                      <Button
                        size="sm"
                        className="gap-1.5 shrink-0 bg-emerald-600 hover:bg-emerald-500"
                        disabled={!phone || batchBusy}
                        onClick={() => openWhatsApp(card)}
                      >
                        <MessageCircle className="h-3.5 w-3.5" />
                        Send
                      </Button>
                    </div>
                    <ul className="text-xs text-slate-600 space-y-2 pl-1">
                      {card.places.map((p, i) => (
                        <li key={`${p.placeName}-${i}`}>
                          <span className="font-medium text-slate-800">
                            {i + 1}. {p.placeName}
                            {p.ownerName ? ` (${p.ownerName})` : ""}
                          </span>
                          <span className="block pl-3">
                            Beds: {p.singleBeds} single / {p.doubleBeds} double
                          </span>
                          <span className="block pl-3">
                            Your pay:{" "}
                            {new Intl.NumberFormat("it-IT", {
                              style: "currency",
                              currency: "EUR",
                            }).format(p.price)}
                          </span>
                          <span className="block pl-3">
                            Team: {p.team.join(", ")}
                          </span>
                          {p.note ? (
                            <span className="block pl-3 text-teal-800">
                              Note: {p.note}
                            </span>
                          ) : null}
                        </li>
                      ))}
                    </ul>
                    {!phone && (
                      <p className="text-[11px] text-amber-700">
                        Add a phone number on the Employees page to enable WhatsApp.
                      </p>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </DialogContent>
      </Dialog>
    </section>
  );
}

export function DashboardClient() {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [properties, setProperties] = useState<Property[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [dayAnchor, setDayAnchor] = useState(() => startOfDay(new Date()));

  const sync = useCallback(() => {
    setProperties(getActiveProperties());
    setEmployees(getActiveEmployees());
    setJobs(getAllJobs());
    setDayAnchor(startOfDay(new Date()));
  }, []);

  useEffect(() => {
    sync();
    window.addEventListener(SYNC_EVENT, sync);
    window.addEventListener("focus", sync);
    const onVisible = () => {
      if (document.visibilityState === "visible") sync();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.removeEventListener(SYNC_EVENT, sync);
      window.removeEventListener("focus", sync);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [sync]);

  const today = dayAnchor;
  const tomorrow = startOfDay(addDays(dayAnchor, 1));

  return (
    <div className="space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold text-slate-800">Dashboard</h1>
          <p className="text-slate-500 mt-1">
            Today and tomorrow — notify cleaners on WhatsApp.
          </p>
        </div>
        <Link href="/calendar">
          <Button size="lg" className="gap-2">
            <CalendarPlus className="h-5 w-5" />
            Set schedule
          </Button>
        </Link>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <DaySchedulePanel
          title="Today"
          subtitle={format(today, "EEEE, MMMM d")}
          dateKey={format(today, "yyyy-MM-dd")}
          jobs={jobs}
          properties={properties}
          employees={employees}
          accent="today"
        />
        <DaySchedulePanel
          title="Tomorrow"
          subtitle={format(tomorrow, "EEEE, MMMM d")}
          dateKey={format(tomorrow, "yyyy-MM-dd")}
          jobs={jobs}
          properties={properties}
          employees={employees}
          accent="tomorrow"
        />
      </div>
    </div>
  );
}
