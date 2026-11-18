"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  addDays,
  addMonths,
  addWeeks,
  eachDayOfInterval,
  endOfDay,
  endOfMonth,
  endOfWeek,
  format,
  getDate,
  isWithinInterval,
  startOfDay,
  startOfMonth,
  startOfWeek,
  subDays,
  subMonths,
  subWeeks,
} from "date-fns";
import {
  ChevronLeft,
  ChevronRight,
  FileDown,
  Grid3X3,
  List,
  MessageCircle,
  Users,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  formatCurrency,
  formatDate,
  cn,
  parseLocalDate,
  splitPayShares,
} from "@/lib/utils";
import {
  getAllJobs,
  getAllProperties,
  getOwners,
  getSettings,
  SYNC_EVENT,
} from "@/lib/store";
import {
  buildReportWhatsAppMessage,
  openWhatsAppChatsSequential,
  toWhatsAppPhone,
} from "@/lib/whatsapp";
import type {
  EmployeeDayPlaceRow,
  EmployeeReportRow,
  Job,
  Owner,
  Property,
  ReportRow,
} from "@/types/database";
import Link from "next/link";

type Period = "day" | "week" | "month";
type ReportView = "detail" | "calendar" | "employee";

/** App owner (Settings company) — not a property owner */
const COMPANY_FILTER = "__company__";

function buildRows(
  jobs: Job[],
  from: Date,
  to: Date,
  ownerFilter: string,
  sizeByPropertyId?: Map<string, string>,
  pillowRateByPropertyId?: Map<string, number>
): ReportRow[] {
  const filterOwner =
    ownerFilter === "all" || ownerFilter === COMPANY_FILTER
      ? "all"
      : ownerFilter;
  return jobs
    .filter((j) => {
      if (j.status === "cancelled") return false;
      if ((j.job_assignments?.length ?? 0) === 0) return false;
      const d = parseLocalDate(j.date);
      if (!isWithinInterval(d, { start: from, end: to })) return false;
      if (filterOwner !== "all" && j.owner_name !== filterOwner) return false;
      return true;
    })
    .sort(
      (a, b) =>
        a.date.localeCompare(b.date) || a.place_name.localeCompare(b.place_name)
    )
    .map((j) => {
      const extraPillows = Number(j.extra_pillows) || 0;
      const pillowRate =
        j.pillow_cost !== undefined
          ? Number(j.pillow_cost) || 0
          : pillowRateByPropertyId?.get(j.property_id) ?? 0;
      const extraPillowCost =
        Math.round(extraPillows * pillowRate * 100) / 100;
      return {
        date: j.date,
        place: j.place_name || "Unknown",
        owner: j.owner_name || "—",
        propertyId: j.property_id,
        size:
          j.place_size ||
          sizeByPropertyId?.get(j.property_id) ||
          "—",
        cleaners:
          j.job_assignments.map((a) => a.employee_name).join(", ") || "—",
        placePrice: Number(j.charged_amount) || 0,
        productCost: Number(j.product_cost) || 0,
        extraSheetCost: Number(j.extra_sheet_cost) || 0,
        otherCost: Number(j.linen_cost) || 0,
        extraPillowCost,
        extraPillows,
        singleBeds: Number(j.single_beds) || 0,
        doubleBeds: Number(j.double_beds) || 0,
        pillowCoversSingle: Number(j.pillow_covers_single) || 0,
        pillowCoversDouble: Number(j.pillow_covers_double) || 0,
      };
    });
}

/** Owner Imp.Totale = Importo + extra pillows + Extra cost + Extra sheet cost. */
function rowTotal(r: ReportRow) {
  return (
    (Number(r.placePrice) || 0) +
    (Number(r.extraPillowCost) || 0) +
    (Number(r.productCost) || 0) +
    (Number(r.extraSheetCost) || 0)
  );
}

/** Small-text breakdown of owner add-ons for Imp.Totale. */
function extrasNote(r: ReportRow): string | null {
  const parts: string[] = [];
  const pillow = Number(r.extraPillowCost) || 0;
  const extra = Number(r.productCost) || 0;
  const extraSheet = Number(r.extraSheetCost) || 0;
  if (pillow > 0) {
    const n = Number(r.extraPillows) || 0;
    parts.push(
      n > 0
        ? `Cuscini extra ×${n} ${formatCurrency(pillow)}`
        : `Cuscini extra ${formatCurrency(pillow)}`
    );
  }
  if (extraSheet > 0) {
    parts.push(`Costo lenzuola extra ${formatCurrency(extraSheet)}`);
  }
  if (extra > 0) {
    parts.push(`Costo extra ${formatCurrency(extra)}`);
  }
  return parts.length ? parts.join(" · ") : null;
}

/** Day view: one row per place — employees, pay each, total employee pay */
function buildEmployeeDayPlaceRows(
  jobs: Job[],
  from: Date,
  to: Date
): EmployeeDayPlaceRow[] {
  const rows: EmployeeDayPlaceRow[] = [];
  for (const j of jobs) {
    if (j.status === "cancelled") continue;
    const team = j.job_assignments ?? [];
    if (team.length === 0) continue;
    const d = parseLocalDate(j.date);
    if (!isWithinInterval(d, { start: from, end: to })) continue;

    const amount =
      j.employee_pay_amount !== undefined
        ? Number(j.employee_pay_amount) || 0
        : Number(j.charged_amount) || 0;
    const shares = splitPayShares(amount, team.length);
    const payByEmployee = shares[0] ?? 0;
    const uneven =
      shares.length > 1 && shares.some((s) => s !== shares[0]);
    const payNote = uneven
      ? `${formatCurrency(Math.min(...shares))}–${formatCurrency(Math.max(...shares))}`
      : undefined;
    const employees = [
      ...new Set(
        team.map((a) => a.employee_name || "Cleaner").filter(Boolean)
      ),
    ].sort((a, b) => a.localeCompare(b));

    rows.push({
      propertyId: j.property_id,
      place: j.place_name || "Unknown",
      employees,
      teamSize: team.length,
      payByEmployee,
      payNote,
      amount,
    });
  }
  return rows.sort((a, b) => a.place.localeCompare(b.place));
}

/** e.g. "100,00 € ÷ 2 = 50,00 €" */
function formatPaySplit(amount: number, teamSize: number, payByEmployee: number) {
  return `${formatCurrency(amount)} ÷ ${teamSize} = ${formatCurrency(payByEmployee)}`;
}

/** One row per employee: merged dates & places, amount = Σ (employee pay ÷ team size) */
function buildEmployeeRows(jobs: Job[], from: Date, to: Date): EmployeeReportRow[] {
  const map = new Map<
    string,
    { name: string; dates: Set<string>; places: Set<string>; amountCents: number }
  >();

  for (const j of jobs) {
    if (j.status === "cancelled") continue;
    const team = j.job_assignments ?? [];
    if (team.length === 0) continue;
    const d = parseLocalDate(j.date);
    if (!isWithinInterval(d, { start: from, end: to })) continue;

    const payPool =
      j.employee_pay_amount !== undefined
        ? Number(j.employee_pay_amount) || 0
        : Number(j.charged_amount) || 0;
    const shares = splitPayShares(payPool, team.length);
    const place = j.place_name || "Unknown";

    team.forEach((a, i) => {
      const shareCents = Math.round((shares[i] ?? 0) * 100);
      const cur = map.get(a.employee_id) ?? {
        name: a.employee_name || "Cleaner",
        dates: new Set<string>(),
        places: new Set<string>(),
        amountCents: 0,
      };
      cur.name = a.employee_name || cur.name;
      cur.dates.add(j.date);
      cur.places.add(place);
      cur.amountCents += shareCents;
      map.set(a.employee_id, cur);
    });
  }

  return [...map.entries()]
    .map(([employeeId, v]) => ({
      employeeId,
      name: v.name,
      dates: [...v.dates].sort(),
      places: [...v.places].sort((a, b) => a.localeCompare(b)),
      amount: v.amountCents / 100,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

function formatDateList(dates: string[]): string {
  if (dates.length === 0) return "—";
  // Compact: "1, 3, 5 Jul 2026" when same month/year; else full list
  const parsed = dates.map((d) => parseLocalDate(d));
  const sameMonth =
    parsed.length > 1 &&
    parsed.every(
      (d) =>
        d.getMonth() === parsed[0].getMonth() &&
        d.getFullYear() === parsed[0].getFullYear()
    );
  if (sameMonth) {
    const days = parsed.map((d) => format(d, "d")).join(", ");
    return `${days} ${format(parsed[0], "MMM yyyy")}`;
  }
  return dates.map((d) => formatDate(d)).join(", ");
}

export function ReportsClient() {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [properties, setProperties] = useState<Property[]>([]);
  const [ownerRecords, setOwnerRecords] = useState<Owner[]>([]);
  const [companyName, setCompanyName] = useState("DClean");
  const [myWhatsapp, setMyWhatsapp] = useState<string | null>(null);
  const [period, setPeriod] = useState<Period>("week");
  const [reportView, setReportView] = useState<ReportView>("detail");
  const [anchor, setAnchor] = useState(new Date());
  const [ownerFilter, setOwnerFilter] = useState(COMPANY_FILTER);
  const [waOpen, setWaOpen] = useState(false);
  const [waBusy, setWaBusy] = useState(false);
  const [waMsg, setWaMsg] = useState<string | null>(null);

  const sync = useCallback(() => {
    setProperties(getAllProperties());
    setJobs(getAllJobs());
    setOwnerRecords(getOwners());
    const s = getSettings();
    setCompanyName(s.company_name);
    setMyWhatsapp(s.whatsapp);
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

  const range = useMemo(() => {
    if (period === "day") {
      return { from: startOfDay(anchor), to: endOfDay(anchor) };
    }
    if (period === "week") {
      return {
        from: startOfWeek(anchor, { weekStartsOn: 1 }),
        to: endOfWeek(anchor, { weekStartsOn: 1 }),
      };
    }
    return { from: startOfMonth(anchor), to: endOfMonth(anchor) };
  }, [period, anchor]);

  const owners = useMemo(() => {
    // All owners entered in Properties → Owners, plus any names still
    // on places/jobs (history) so the filter never hides a known client.
    const fromRecords = ownerRecords.map((o) => o.name).filter(Boolean);
    const fromJobs = jobs.map((j) => j.owner_name).filter(Boolean);
    const fromProps = properties.map((p) => p.owner).filter(Boolean);
    return [
      ...new Set([...fromRecords, ...fromJobs, ...fromProps]),
    ].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
  }, [ownerRecords, jobs, properties]);

  const sizeByPropertyId = useMemo(() => {
    const m = new Map<string, string>();
    for (const p of properties) {
      if (p.size) m.set(p.id, p.size);
    }
    return m;
  }, [properties]);

  const pillowRateByPropertyId = useMemo(() => {
    const m = new Map<string, number>();
    for (const p of properties) {
      m.set(p.id, Number(p.pillow_cost) || 0);
    }
    return m;
  }, [properties]);

  const rows = useMemo(
    () =>
      buildRows(
        jobs,
        range.from,
        range.to,
        ownerFilter,
        sizeByPropertyId,
        pillowRateByPropertyId
      ),
    [jobs, range, ownerFilter, sizeByPropertyId, pillowRateByPropertyId]
  );

  const employeeRows = useMemo(
    () => buildEmployeeRows(jobs, range.from, range.to),
    [jobs, range]
  );

  const employeeDayPlaceRows = useMemo(
    () => buildEmployeeDayPlaceRows(jobs, range.from, range.to),
    [jobs, range]
  );

  const employeeTotals = useMemo(
    () => ({
      employees: employeeRows.length,
      // Sum of per-cleaner distinct dates (= employee-days, not calendar days)
      days: employeeRows.reduce((s, r) => s + r.dates.length, 0),
      amount: employeeRows.reduce((s, r) => s + r.amount, 0),
    }),
    [employeeRows]
  );

  const employeeDayTotals = useMemo(
    () => ({
      places: employeeDayPlaceRows.length,
      amount: employeeDayPlaceRows.reduce((s, r) => s + r.amount, 0),
    }),
    [employeeDayPlaceRows]
  );

  const dayColumns = useMemo(
    () => eachDayOfInterval({ start: range.from, end: range.to }),
    [range]
  );

  const calendarPlaces = useMemo(() => {
    const map = new Map<
      string,
      { place: string; days: Map<number, number> }
    >();
    for (const r of rows) {
      const key = r.propertyId || `${r.owner}|${r.place}`;
      const day = getDate(parseLocalDate(r.date));
      const cur = map.get(key) ?? {
        place: r.place,
        days: new Map<number, number>(),
      };
      // Sum owner total (Importo + extras) per calendar day
      cur.days.set(day, (cur.days.get(day) || 0) + rowTotal(r));
      map.set(key, cur);
    }
    return [...map.entries()]
      .sort(([, a], [, b]) => a.place.localeCompare(b.place))
      .map(([propertyKey, info], i) => {
        const daySet = new Set(info.days.keys());
        const amount = [...info.days.values()].reduce((s, v) => s + v, 0);
        const prices = [...info.days.values()];
        const uniform =
          prices.length > 0 && prices.every((p) => p === prices[0]);
        const unit = prices[0] || 0;
        return {
          no: i + 1,
          propertyId: propertyKey,
          place: info.place,
          days: daySet,
          count: daySet.size,
          price: unit,
          amount,
          amountLabel:
            daySet.size === 0
              ? "—"
              : uniform
                ? `${formatCurrency(unit)} × ${String(daySet.size).padStart(2, "0")}`
                : formatCurrency(amount),
        };
      });
  }, [rows]);

  const calendarGrandTotal = useMemo(
    () => calendarPlaces.reduce((s, p) => s + p.amount, 0),
    [calendarPlaces]
  );

  const totals = useMemo(
    () =>
      rows.reduce(
        (acc, r) => ({
          placePrice: acc.placePrice + r.placePrice,
          productCost: acc.productCost + r.productCost,
          otherCost: acc.otherCost + r.otherCost,
          singleBeds: acc.singleBeds + r.singleBeds,
          doubleBeds: acc.doubleBeds + r.doubleBeds,
          pillowCoversSingle: acc.pillowCoversSingle + r.pillowCoversSingle,
          pillowCoversDouble: acc.pillowCoversDouble + r.pillowCoversDouble,
          grand: acc.grand + rowTotal(r),
        }),
        {
          placePrice: 0,
          productCost: 0,
          otherCost: 0,
          singleBeds: 0,
          doubleBeds: 0,
          pillowCoversSingle: 0,
          pillowCoversDouble: 0,
          grand: 0,
        }
      ),
    [rows]
  );

  const rangeLabel =
    period === "day"
      ? format(anchor, "EEEE, MMM d, yyyy")
      : period === "week"
        ? `${format(range.from, "MMM d")} – ${format(range.to, "MMM d, yyyy")}`
        : format(range.from, "MMMM yyyy");

  const isCompanyFilter = ownerFilter === COMPANY_FILTER;

  const clientName = isCompanyFilter
    ? companyName
    : ownerFilter === "all"
      ? `${companyName} — All owners`
      : ownerFilter;

  const ownerPhoneByName = useMemo(() => {
    const map = new Map<string, string | null>();
    for (const o of ownerRecords) {
      map.set(o.name.toLowerCase(), o.whatsapp ?? null);
    }
    return map;
  }, [ownerRecords]);

  const whatsappRecipients = useMemo(() => {
    if (isCompanyFilter) {
      return [
        {
          name: companyName,
          phone: myWhatsapp,
          hasPhone: !!toWhatsAppPhone(myWhatsapp),
          isSelf: true as const,
        },
      ];
    }
    const names =
      ownerFilter === "all"
        ? [...new Set(rows.map((r) => r.owner).filter((n) => n && n !== "—"))]
        : [ownerFilter];
    return names.map((name) => {
      const phone = ownerPhoneByName.get(name.toLowerCase()) ?? null;
      return {
        name,
        phone,
        hasPhone: !!toWhatsAppPhone(phone),
        isSelf: false as const,
      };
    });
  }, [
    isCompanyFilter,
    ownerFilter,
    rows,
    ownerPhoneByName,
    companyName,
    myWhatsapp,
  ]);

  const ownersWithWhatsApp = useMemo(
    () => whatsappRecipients.filter((r) => r.hasPhone),
    [whatsappRecipients]
  );

  const exportDetail = async (
    pdfRows = rows,
    pdfClientName = clientName
  ) => {
    const { generateDetailReportPDF } = await import("@/lib/pdf");
    generateDetailReportPDF({
      clientName: pdfClientName,
      periodLabel: rangeLabel,
      periodKind: period,
      rows: pdfRows,
      companyName,
    });
  };

  const exportCalendar = async (
    pdfRows = rows,
    pdfClientName = clientName
  ) => {
    const { generateCalendarReportPDF } = await import("@/lib/pdf");
    generateCalendarReportPDF({
      clientName: pdfClientName,
      periodLabel: rangeLabel,
      from: range.from,
      to: range.to,
      rows: pdfRows,
      companyName,
    });
  };

  const exportEmployees = async () => {
    const { generateEmployeeReportPDF } = await import("@/lib/pdf");
    if (period === "day") {
      generateEmployeeReportPDF({
        title: "Employee Pay",
        periodLabel: rangeLabel,
        periodKind: "day",
        dayPlaceRows: employeeDayPlaceRows,
        companyName,
      });
      return;
    }
    generateEmployeeReportPDF({
      title: "Employee amounts",
      periodLabel: rangeLabel,
      periodKind: period,
      rows: employeeRows,
      companyName,
    });
  };

  const downloadCurrent = async () => {
    if (reportView === "detail") await exportDetail();
    else if (reportView === "calendar") await exportCalendar();
    else await exportEmployees();
  };

  const canDownload =
    reportView === "employee"
      ? period === "day"
        ? employeeDayPlaceRows.length > 0
        : employeeRows.length > 0
      : rows.length > 0;

  const canSendWhatsApp =
    !!toWhatsAppPhone(myWhatsapp) &&
    (reportView === "employee"
      ? period === "day"
        ? employeeDayPlaceRows.length > 0
        : employeeRows.length > 0
      : rows.length > 0 &&
        (isCompanyFilter || ownersWithWhatsApp.length > 0));

  const sendReportWhatsApp = async () => {
    if (!canSendWhatsApp) return;
    setWaBusy(true);
    setWaMsg(null);

    if (!toWhatsAppPhone(myWhatsapp)) {
      setWaMsg(
        "Your WhatsApp is missing. Set it under Settings."
      );
      setWaBusy(false);
      return;
    }

    // Employee pay — always to yourself (field checklist for the day)
    if (reportView === "employee") {
      await exportEmployees();
      const { opened } = await openWhatsAppChatsSequential([
        {
          phone: myWhatsapp,
          message: buildReportWhatsAppMessage(
            "Employee Pay",
            rangeLabel,
            companyName
          ),
        },
      ]);
      setWaMsg(
        opened > 0
          ? "PDF downloaded. Opened your WhatsApp chat — attach the PDF for work."
          : "Could not open WhatsApp."
      );
      setWaBusy(false);
      return;
    }

    if (rows.length === 0) {
      setWaBusy(false);
      return;
    }

    // App owner selected — full report to yourself only
    if (isCompanyFilter) {
      if (reportView === "detail") await exportDetail(rows, companyName);
      else await exportCalendar(rows, companyName);
      const { opened } = await openWhatsAppChatsSequential([
        {
          phone: myWhatsapp,
          message: buildReportWhatsAppMessage(
            companyName,
            rangeLabel,
            companyName
          ),
        },
      ]);
      setWaMsg(
        opened > 0
          ? "PDF downloaded. Opened your WhatsApp chat — attach the PDF."
          : "Could not open WhatsApp."
      );
      setWaBusy(false);
      return;
    }

    if (ownersWithWhatsApp.length === 0) {
      setWaMsg(
        ownerFilter === "all"
          ? "No owners in this report have a WhatsApp number. Set them under Properties → Owners."
          : "This owner has no WhatsApp number. Set it under Properties → Owners."
      );
      setWaBusy(false);
      return;
    }

    const chats: { phone: string | null; message: string }[] = [];

    for (const recipient of ownersWithWhatsApp) {
      const ownerRows =
        ownerFilter === "all"
          ? rows.filter((r) => r.owner === recipient.name)
          : rows;
      if (reportView === "detail") {
        await exportDetail(ownerRows, recipient.name);
      } else {
        await exportCalendar(ownerRows, recipient.name);
      }
      chats.push({
        phone: recipient.phone,
        message: buildReportWhatsAppMessage(
          recipient.name,
          rangeLabel,
          companyName
        ),
      });
      await new Promise((r) => setTimeout(r, 350));
    }

    // Full filtered PDF for you (all owners or the selected one)
    if (reportView === "detail") await exportDetail();
    else await exportCalendar();
    chats.push({
      phone: myWhatsapp,
      message: buildReportWhatsAppMessage(
        ownerFilter === "all" ? "All owners" : ownerFilter,
        rangeLabel,
        companyName
      ),
    });

    const { opened } = await openWhatsAppChatsSequential(chats);
    const skipped = whatsappRecipients.length - ownersWithWhatsApp.length;
    setWaMsg(
      opened > 0
        ? `PDF downloaded. Opened ${opened} WhatsApp chat${opened === 1 ? "" : "s"} (owners + you)${
            skipped > 0 ? ` · ${skipped} owner(s) skipped (no WhatsApp)` : ""
          }. Attach the matching PDF in each chat.`
        : "Could not open WhatsApp."
    );
    setWaBusy(false);
  };

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-3xl font-bold text-slate-800">Reports</h1>
        <p className="text-slate-500 mt-1">
          Detail, Calendar, or Employee Pay — table matches the PDF you download.
        </p>
      </div>

      <div className="rounded-xl border bg-white p-4 shadow-sm space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          {reportView === "employee" && (
            <Button
              size="sm"
              variant={period === "day" ? "default" : "outline"}
              onClick={() => setPeriod("day")}
            >
              Day
            </Button>
          )}
          <Button
            size="sm"
            variant={period === "week" ? "default" : "outline"}
            onClick={() => setPeriod("week")}
          >
            Weekly
          </Button>
          <Button
            size="sm"
            variant={period === "month" ? "default" : "outline"}
            onClick={() => setPeriod("month")}
          >
            Monthly
          </Button>
          <Button
            size="icon"
            variant="outline"
            onClick={() =>
              setAnchor((d) =>
                period === "day"
                  ? subDays(d, 1)
                  : period === "week"
                    ? subWeeks(d, 1)
                    : subMonths(d, 1)
              )
            }
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Button size="sm" variant="outline" onClick={() => setAnchor(new Date())}>
            {period === "day"
              ? "Today"
              : period === "week"
                ? "This week"
                : "This month"}
          </Button>
          <Button
            size="icon"
            variant="outline"
            onClick={() =>
              setAnchor((d) =>
                period === "day"
                  ? addDays(d, 1)
                  : period === "week"
                    ? addWeeks(d, 1)
                    : addMonths(d, 1)
              )
            }
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
          {period === "day" ? (
            <>
              <Input
                type="date"
                className="h-9 w-[160px]"
                value={format(anchor, "yyyy-MM-dd")}
                onChange={(e) => {
                  if (!e.target.value) return;
                  setAnchor(parseLocalDate(e.target.value));
                }}
              />
              <span className="text-sm font-semibold text-slate-800">
                {format(anchor, "EEEE, MMM d")}
              </span>
            </>
          ) : (
            <span className="text-sm font-semibold text-slate-800">
              {rangeLabel}
            </span>
          )}
          <div className="flex-1" />
          {reportView !== "employee" && (
            <Select value={ownerFilter} onValueChange={setOwnerFilter}>
              <SelectTrigger className="w-[180px] h-9">
                <SelectValue placeholder="Owner / client" />
              </SelectTrigger>
              <SelectContent className="max-h-72">
                <SelectItem value={COMPANY_FILTER}>
                  {companyName}
                  {toWhatsAppPhone(myWhatsapp) ? " · WhatsApp" : ""}
                </SelectItem>
                {owners.map((o) => {
                  const hasWa = !!toWhatsAppPhone(
                    ownerPhoneByName.get(o.toLowerCase())
                  );
                  return (
                    <SelectItem key={o} value={o}>
                      {hasWa ? `${o} · WhatsApp` : o}
                    </SelectItem>
                  );
                })}
              </SelectContent>
            </Select>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2 border-t pt-3">
          <span className="text-xs font-semibold uppercase tracking-wide text-slate-500 mr-1">
            Report type
          </span>
          <Button
            size="sm"
            variant={reportView === "detail" ? "default" : "outline"}
            className="gap-1.5"
            onClick={() => {
              setReportView("detail");
              setPeriod((p) => (p === "day" ? "week" : p));
            }}
          >
            <List className="h-4 w-4" />
            Detail
          </Button>
          <Button
            size="sm"
            variant={reportView === "calendar" ? "default" : "outline"}
            className="gap-1.5"
            onClick={() => {
              setReportView("calendar");
              setPeriod((p) => (p === "day" ? "week" : p));
            }}
          >
            <Grid3X3 className="h-4 w-4" />
            Calendar
          </Button>
          <Button
            size="sm"
            variant={reportView === "employee" ? "default" : "outline"}
            className="gap-1.5"
            onClick={() => {
              setReportView("employee");
              setPeriod("day");
            }}
          >
            <Users className="h-4 w-4" />
            Employee Pay
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="gap-1.5 ml-auto"
            onClick={downloadCurrent}
            disabled={!canDownload}
          >
            <FileDown className="h-4 w-4" />
            Download PDF
          </Button>
          <Button
            size="sm"
            className="gap-1.5"
            onClick={() => {
              setWaMsg(null);
              setWaOpen(true);
            }}
            disabled={!canDownload}
          >
            <MessageCircle className="h-4 w-4" />
            Send WhatsApp PDF
          </Button>
        </div>

      </div>

      <div className="rounded-xl border bg-white shadow-sm overflow-hidden">
        <div className="overflow-auto max-h-[65vh]">
          {reportView === "detail" && (
            <DetailTable rows={rows} period={period} totals={totals} />
          )}
          {reportView === "calendar" && (
            <CalendarTable
              places={calendarPlaces}
              dayColumns={dayColumns}
              period={period}
              totalJobs={rows.length}
              grandTotal={calendarGrandTotal}
            />
          )}
          {reportView === "employee" &&
            (period === "day" ? (
              <EmployeeDayPlaceTable
                rows={employeeDayPlaceRows}
                totals={employeeDayTotals}
              />
            ) : (
              <EmployeeTable
                rows={employeeRows}
                period={period}
                totals={employeeTotals}
              />
            ))}
        </div>
      </div>

      <Dialog open={waOpen} onOpenChange={setWaOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Send report PDF via WhatsApp</DialogTitle>
            <DialogDescription>
              Downloads the PDF, then opens WhatsApp. Attach the file in the
              chat (WhatsApp cannot auto-attach from the browser).
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 text-sm">
            {reportView === "employee" ? (
              <div className="rounded-md border bg-slate-50 px-3 py-2 space-y-2">
                <p className="text-slate-500">
                  Report: Employee Pay · {rangeLabel}
                </p>
                <p>
                  <span className="text-slate-500">Send to you: </span>
                  {toWhatsAppPhone(myWhatsapp) ? (
                    <span className="font-medium text-slate-800">
                      {myWhatsapp}
                    </span>
                  ) : (
                    <span className="text-amber-800">
                      Missing — set under{" "}
                      <Link href="/settings" className="underline font-medium">
                        Settings
                      </Link>
                    </span>
                  )}
                </p>
                <p className="text-xs text-slate-500">
                  {period === "day"
                    ? `${employeeDayPlaceRows.length} place${
                        employeeDayPlaceRows.length === 1 ? "" : "s"
                      } · ${formatCurrency(employeeDayTotals.amount)} total`
                    : `${employeeRows.length} employee${
                        employeeRows.length === 1 ? "" : "s"
                      } · ${formatCurrency(employeeTotals.amount)} total`}
                </p>
              </div>
            ) : (
              <div className="rounded-md border bg-slate-50 px-3 py-2 space-y-2">
                <p className="text-slate-500">
                  Report: {reportView === "detail" ? "Detail" : "Calendar"} ·{" "}
                  {rangeLabel}
                </p>
                <p>
                  <span className="text-slate-500">
                    {isCompanyFilter
                      ? "Send to:"
                      : ownerFilter === "all"
                        ? "Owners:"
                        : "Owner:"}{" "}
                  </span>
                  <span className="font-medium text-slate-800">
                    {isCompanyFilter
                      ? companyName
                      : ownerFilter === "all"
                        ? "All owners"
                        : ownerFilter}
                  </span>
                </p>
                <ul className="space-y-1 text-xs">
                  {whatsappRecipients.map((r) => (
                    <li key={r.name} className="flex justify-between gap-2">
                      <span className="text-slate-700">
                        {r.name}
                        {r.isSelf ? " (you)" : ""}
                      </span>
                      {r.hasPhone ? (
                        <span className="text-teal-700 font-medium">
                          {r.phone}
                        </span>
                      ) : (
                        <span className="text-amber-800">
                          No WhatsApp —{" "}
                          <Link
                            href={r.isSelf ? "/settings" : "/properties"}
                            className="underline font-medium"
                          >
                            {r.isSelf ? "Settings" : "Properties → Owners"}
                          </Link>
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
                {!isCompanyFilter ? (
                  <p>
                    <span className="text-slate-500">Also to you: </span>
                    {toWhatsAppPhone(myWhatsapp) ? (
                      <span className="font-medium text-slate-800">
                        {myWhatsapp}
                      </span>
                    ) : (
                      <span className="text-amber-800">
                        Missing — set under{" "}
                        <Link
                          href="/settings"
                          className="underline font-medium"
                        >
                          Settings
                        </Link>
                      </span>
                    )}
                  </p>
                ) : null}
              </div>
            )}
            <p className="text-xs text-slate-500">
              {reportView === "employee" || isCompanyFilter
                ? "Downloads the PDF and opens your WhatsApp. Attach the file in the chat."
                : "Downloads a PDF per owner with WhatsApp, then opens those chats plus yours. Attach the matching PDF in each chat."}
            </p>
            {waMsg ? (
              <p
                className={
                  /could not|missing|no whatsapp|fail/i.test(waMsg)
                    ? "rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-amber-900 text-xs"
                    : "rounded-md border border-teal-200 bg-teal-50 px-3 py-2 text-teal-900 text-xs"
                }
              >
                {waMsg}
              </p>
            ) : null}
            <div className="flex justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => setWaOpen(false)}
              >
                Close
              </Button>
              <Button
                type="button"
                className="gap-1.5"
                disabled={!canSendWhatsApp || waBusy}
                onClick={sendReportWhatsApp}
              >
                <MessageCircle className="h-4 w-4" />
                {waBusy ? "Sending…" : "Download & open WhatsApp"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function EmployeeDayPlaceTable({
  rows,
  totals,
}: {
  rows: EmployeeDayPlaceRow[];
  totals: { places: number; amount: number };
}) {
  return (
    <table className="w-full text-sm">
      <thead className="sticky top-0 z-10 bg-teal-700 text-white">
        <tr className="text-left text-[10px] uppercase tracking-wide">
          <th className="px-3 py-3 w-12">No.</th>
          <th className="px-3 py-3">Place</th>
          <th className="px-3 py-3">Employees</th>
          <th className="px-3 py-3 text-right">Calculation</th>
          <th className="px-3 py-3 text-right">Pay by employee</th>
          <th className="px-3 py-3 text-right">Amount</th>
        </tr>
      </thead>
      <tbody>
        {rows.length === 0 ? (
          <tr>
            <td colSpan={6} className="px-4 py-12 text-center text-slate-500">
              No employee jobs on this day.
            </td>
          </tr>
        ) : (
          rows.map((r, i) => (
            <tr
              key={`${r.propertyId}-${r.place}-${i}`}
              className={cn("border-b", i % 2 ? "bg-slate-50/80" : "bg-white")}
            >
              <td className="px-3 py-2.5 text-slate-500 align-top">{i + 1}</td>
              <td className="px-3 py-2.5 font-medium text-slate-800 align-top">
                {r.place}
              </td>
              <td className="px-3 py-2.5 text-slate-700 align-top">
                {r.employees.join(", ")}{" "}
                <span className="text-slate-400">({r.teamSize})</span>
              </td>
              <td className="px-3 py-2.5 text-right text-slate-600 align-top whitespace-nowrap text-xs sm:text-sm">
                {r.payNote
                  ? `${formatCurrency(r.amount)} ÷ ${r.teamSize}`
                  : formatPaySplit(r.amount, r.teamSize, r.payByEmployee)}
              </td>
              <td className="px-3 py-2.5 text-right font-semibold text-teal-700 align-top whitespace-nowrap">
                {r.payNote || formatCurrency(r.payByEmployee)}
              </td>
              <td className="px-3 py-2.5 text-right font-semibold text-slate-800 align-top whitespace-nowrap">
                {formatCurrency(r.amount)}
              </td>
            </tr>
          ))
        )}
      </tbody>
      {rows.length > 0 && (
        <tfoot className="sticky bottom-0 bg-teal-50 border-t-2 border-teal-200 font-semibold text-teal-900">
          <tr>
            <td className="px-3 py-3" colSpan={5}>
              TOTAL ({totals.places} places)
            </td>
            <td className="px-3 py-3 text-right">
              {formatCurrency(totals.amount)}
            </td>
          </tr>
        </tfoot>
      )}
    </table>
  );
}

function EmployeeTable({
  rows,
  period,
  totals,
}: {
  rows: EmployeeReportRow[];
  period: Period;
  totals: {
    employees: number;
    days: number;
    amount: number;
  };
}) {
  return (
    <table className="w-full text-sm">
      <thead className="sticky top-0 z-10 bg-teal-700 text-white">
        <tr className="text-left text-[10px] uppercase tracking-wide">
          <th className="px-3 py-3 w-12">No.</th>
          <th className="px-3 py-3">Employee</th>
          <th className="px-3 py-3">Dates worked</th>
          <th className="px-3 py-3">Places</th>
          <th className="px-3 py-3 text-right">Amount</th>
        </tr>
      </thead>
      <tbody>
        {rows.length === 0 ? (
          <tr>
            <td colSpan={5} className="px-4 py-12 text-center text-slate-500">
              No employee jobs in this {period}.
            </td>
          </tr>
        ) : (
          rows.map((r, i) => (
            <tr
              key={r.employeeId}
              className={cn("border-b", i % 2 ? "bg-slate-50/80" : "bg-white")}
            >
              <td className="px-3 py-2.5 text-slate-500 align-top">{i + 1}</td>
              <td className="px-3 py-2.5 font-medium text-slate-800 align-top whitespace-nowrap">
                {r.name}
              </td>
              <td className="px-3 py-2.5 text-slate-700 align-top">
                {formatDateList(r.dates)}
              </td>
              <td className="px-3 py-2.5 text-slate-700 align-top">
                {r.places.join(" · ")}
              </td>
              <td className="px-3 py-2.5 text-right font-semibold text-teal-700 align-top whitespace-nowrap">
                {formatCurrency(r.amount)}
              </td>
            </tr>
          ))
        )}
      </tbody>
      {rows.length > 0 && (
        <tfoot className="sticky bottom-0 bg-teal-50 border-t-2 border-teal-200 font-semibold text-teal-900">
          <tr>
            <td className="px-3 py-3" colSpan={4}>
              TOTAL ({totals.employees} employees · {totals.days} employee-days)
            </td>
            <td className="px-3 py-3 text-right">
              {formatCurrency(totals.amount)}
            </td>
          </tr>
        </tfoot>
      )}
    </table>
  );
}

function DetailTable({
  rows,
  period,
  totals,
}: {
  rows: ReportRow[];
  period: Period;
  totals: {
    placePrice: number;
    singleBeds: number;
    doubleBeds: number;
    pillowCoversSingle: number;
    pillowCoversDouble: number;
    grand: number;
  };
}) {
  return (
    <table className="w-full text-sm">
      <thead className="sticky top-0 z-10 bg-teal-700 text-white">
        <tr className="text-left text-[10px] uppercase tracking-wide">
          <th className="px-3 py-3">Data</th>
          <th className="px-3 py-3">Appartamenti</th>
          <th className="px-3 py-3">Intervento</th>
          <th className="px-3 py-3 text-right">Importo</th>
          <th className="px-3 py-3 text-center">Letto Matrimoniale</th>
          <th className="px-3 py-3 text-center">Letto Singolo</th>
          <th className="px-3 py-3 text-right">Imp.Totale</th>
        </tr>
      </thead>
      <tbody>
        {rows.length === 0 ? (
          <tr>
            <td colSpan={7} className="px-4 py-12 text-center text-slate-500">
              No jobs in this {period}.
            </td>
          </tr>
        ) : (
          rows.map((r, i) => {
            const note = extrasNote(r);
            return (
            <tr
              key={`${r.date}-${r.place}-${i}`}
              className={cn("border-b", i % 2 ? "bg-slate-50/80" : "bg-white")}
            >
              <td className="px-3 py-2.5 whitespace-nowrap">{formatDate(r.date)}</td>
              <td className="px-3 py-2.5 font-medium">{r.place}</td>
              <td className="px-3 py-2.5">{r.size || "—"}</td>
              <td className="px-3 py-2.5 text-right font-semibold text-teal-700">
                {formatCurrency(r.placePrice)}
              </td>
              <td className="px-3 py-2.5 text-center">{r.doubleBeds}</td>
              <td className="px-3 py-2.5 text-center">{r.singleBeds}</td>
              <td className="px-3 py-2.5 text-right font-semibold">
                <div>{formatCurrency(rowTotal(r))}</div>
                {note ? (
                  <div className="text-[10px] font-normal text-slate-500 leading-tight mt-0.5">
                    {note}
                  </div>
                ) : null}
              </td>
            </tr>
            );
          })
        )}
      </tbody>
      {rows.length > 0 && (
        <tfoot className="sticky bottom-0 bg-teal-50 border-t-2 border-teal-200 font-semibold text-teal-900">
          <tr>
            <td className="px-3 py-3" colSpan={3}>
              Totale ({rows.length})
            </td>
            <td className="px-3 py-3 text-right">
              {formatCurrency(totals.placePrice)}
            </td>
            <td className="px-3 py-3 text-center">{totals.doubleBeds}</td>
            <td className="px-3 py-3 text-center">{totals.singleBeds}</td>
            <td className="px-3 py-3 text-right">
              {formatCurrency(totals.grand)}
            </td>
          </tr>
        </tfoot>
      )}
    </table>
  );
}

function CalendarTable({
  places,
  dayColumns,
  period,
  totalJobs,
  grandTotal,
}: {
  places: {
    no: number;
    propertyId?: string;
    place: string;
    days: Set<number>;
    count: number;
    price: number;
    amount: number;
    amountLabel: string;
  }[];
  dayColumns: Date[];
  period: Period;
  totalJobs: number;
  grandTotal: number;
}) {
  const dayNums = dayColumns.map((d) => getDate(d));

  return (
    <table className="w-full text-sm border-collapse min-w-[720px]">
      <thead className="sticky top-0 z-10 bg-teal-700 text-white">
        <tr className="text-[10px] uppercase tracking-wide">
          <th className="sticky left-0 z-20 bg-teal-700 px-2 py-3 text-left w-10">
            No.
          </th>
          <th
            className="sticky z-20 bg-teal-700 px-2 py-3 text-left min-w-[140px]"
            style={{ left: 40 }}
          >
            House Name
          </th>
          {dayNums.map((d) => (
            <th key={d} className="px-1 py-3 text-center font-bold w-8">
              {d}
            </th>
          ))}
          <th className="px-2 py-3 text-right min-w-[88px] bg-teal-800">
            Amount
          </th>
        </tr>
      </thead>
      <tbody>
        {places.length === 0 ? (
          <tr>
            <td
              colSpan={3 + dayNums.length}
              className="px-4 py-12 text-center text-slate-500"
            >
              No jobs in this {period}.
            </td>
          </tr>
        ) : (
          places.map((p, i) => (
            <tr
              key={p.propertyId || p.place}
              className={cn("border-b", i % 2 ? "bg-slate-50/80" : "bg-white")}
            >
              <td className="sticky left-0 z-10 bg-inherit px-2 py-2 text-xs text-slate-500">
                {p.no}
              </td>
              <td
                className="sticky z-10 bg-inherit px-2 py-2 font-medium text-slate-800 whitespace-nowrap"
                style={{ left: 40 }}
              >
                {p.place}
              </td>
              {dayNums.map((d) => (
                <td key={d} className="px-1 py-2 text-center">
                  {p.days.has(d) ? (
                    <span className="font-bold text-teal-700">X</span>
                  ) : (
                    <span className="text-slate-200">·</span>
                  )}
                </td>
              ))}
              <td
                className="px-2 py-2 text-right text-xs font-semibold text-teal-800 whitespace-nowrap"
                title={`${formatCurrency(p.price)} × ${p.count} days = ${formatCurrency(p.amount)}`}
              >
                {p.amountLabel}
              </td>
            </tr>
          ))
        )}
      </tbody>
      {places.length > 0 && (
        <tfoot className="sticky bottom-0 bg-teal-50 border-t-2 border-teal-200 font-semibold text-teal-900">
          <tr>
            <td className="px-2 py-3" colSpan={2}>
              TOTAL ({totalJobs} cleanings · {places.length} places)
            </td>
            <td className="px-2 py-3 text-center text-xs" colSpan={dayNums.length}>
              Amount = Importo + extra pillows + Extra cost
            </td>
            <td className="px-2 py-3 text-right">
              {formatCurrency(grandTotal)}
            </td>
          </tr>
        </tfoot>
      )}
    </table>
  );
}
