import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import {
  eachDayOfInterval,
  endOfMonth,
  format,
  getDate,
  startOfMonth,
} from "date-fns";
import type { ReportRow } from "@/types/database";
import { formatCurrency, formatDate, parseLocalDate } from "@/lib/utils";

function money(n: number) {
  return formatCurrency(n);
}

/** Owner Imp.Totale = Importo + cuscini extra + costo extra + costo lenzuola extra. */
function totalOf(r: ReportRow) {
  return (
    (Number(r.placePrice) || 0) +
    (Number(r.extraPillowCost) || 0) +
    (Number(r.productCost) || 0) +
    (Number(r.extraSheetCost) || 0)
  );
}

function extrasNote(r: ReportRow): string {
  const parts: string[] = [];
  const pillow = Number(r.extraPillowCost) || 0;
  const extra = Number(r.productCost) || 0;
  const extraSheet = Number(r.extraSheetCost) || 0;
  if (pillow > 0) {
    const n = Number(r.extraPillows) || 0;
    parts.push(
      n > 0
        ? `Cuscini extra ×${n} ${money(pillow)}`
        : `Cuscini extra ${money(pillow)}`
    );
  }
  if (extraSheet > 0) {
    parts.push(`Costo lenzuola extra ${money(extraSheet)}`);
  }
  if (extra > 0) parts.push(`Costo extra ${money(extra)}`);
  return parts.join(" · ");
}

/** Client detail report — matches APT MAGGIO style */
export function generateDetailReportPDF(args: {
  clientName: string;
  periodLabel: string;
  periodKind: "day" | "week" | "month";
  rows: ReportRow[];
  companyName?: string;
}): void {
  const { clientName, periodLabel, periodKind, rows } = args;
  const brand = (args.companyName ?? "").trim() || "DClean";
  const doc = new jsPDF("landscape");
  const kindLabel =
    periodKind === "day"
      ? "Daily"
      : periodKind === "week"
        ? "Weekly"
        : "Monthly";

  doc.setFontSize(16);
  doc.setTextColor(13, 148, 136);
  doc.text(brand, 14, 16);

  doc.setFontSize(12);
  doc.setTextColor(30, 41, 59);
  doc.text(clientName, 14, 24);

  doc.setFontSize(10);
  doc.setTextColor(100, 116, 139);
  doc.text(`${kindLabel} report — ${periodLabel}`, 14, 30);

  autoTable(doc, {
    startY: 36,
    head: [
      [
        "DATA",
        "APPARTAMENTI",
        "INTERVENTO",
        "IMPORTO",
        "LETTO MATRIMONIALE",
        "LETTO SINGOLO",
        "IMP.TOTALE",
      ],
    ],
    body: rows.map((r) => {
      const note = extrasNote(r);
      return [
        formatDate(r.date),
        r.place,
        r.size || "—",
        money(r.placePrice),
        String(r.doubleBeds),
        String(r.singleBeds),
        note ? `${money(totalOf(r))}\n${note}` : money(totalOf(r)),
      ];
    }),
    foot: [
      [
        "",
        "",
        `Totale (${rows.length})`,
        money(rows.reduce((s, r) => s + r.placePrice, 0)),
        String(rows.reduce((s, r) => s + r.doubleBeds, 0)),
        String(rows.reduce((s, r) => s + r.singleBeds, 0)),
        money(rows.reduce((s, r) => s + totalOf(r), 0)),
      ],
    ],
    theme: "grid",
    headStyles: {
      fillColor: [15, 118, 110],
      textColor: 255,
      fontSize: 7,
      fontStyle: "bold",
    },
    footStyles: {
      fillColor: [240, 253, 250],
      textColor: [15, 118, 110],
      fontStyle: "bold",
      fontSize: 7,
    },
    styles: { fontSize: 7, cellPadding: 2 },
    columnStyles: {
      0: { cellWidth: 24 },
      1: { cellWidth: 40 },
      2: { cellWidth: 28 },
      3: { halign: "right", cellWidth: 24 },
      4: { halign: "center", cellWidth: 32 },
      5: { halign: "center", cellWidth: 28 },
      6: { halign: "right", cellWidth: 40 },
    },
    didParseCell: (data) => {
      if (
        data.section === "body" &&
        data.column.index === 6 &&
        String(data.cell.raw).includes("\n")
      ) {
        data.cell.styles.fontSize = 6;
        data.cell.styles.valign = "middle";
      }
    },
  });

  const safe = clientName.replace(/\s+/g, "_");
  doc.save(`${safe}_detail_${periodLabel.replace(/\s+/g, "_")}.pdf`);
}

/** Calendar grid — matches NICK GIUGNO Excel (X per day + amount = price × days) */
export function generateCalendarReportPDF(args: {
  clientName: string;
  periodLabel: string;
  from: Date;
  to: Date;
  rows: ReportRow[];
  companyName?: string;
}): void {
  const { clientName, periodLabel, from, to, rows } = args;
  const brand = (args.companyName ?? "").trim() || "DClean";
  const days = eachDayOfInterval({ start: from, end: to });
  const dayNums = days.map((d) => getDate(d));

  const byPlace = new Map<string, { place: string; days: Map<number, number> }>();
  for (const r of rows) {
    const key = r.propertyId || `${r.owner}|${r.place}`;
    const day = getDate(parseLocalDate(r.date));
    const cur = byPlace.get(key) ?? {
      place: r.place,
      days: new Map<number, number>(),
    };
    cur.days.set(day, (cur.days.get(day) || 0) + totalOf(r));
    byPlace.set(key, cur);
  }

  const placeEntries = [...byPlace.values()].sort((a, b) =>
    a.place.localeCompare(b.place)
  );
  let grandTotal = 0;

  const doc = new jsPDF("landscape");
  doc.setFontSize(16);
  doc.setTextColor(13, 148, 136);
  doc.text(brand, 14, 14);

  doc.setFontSize(11);
  doc.setTextColor(30, 41, 59);
  doc.text(clientName, 14, 21);

  doc.setFontSize(9);
  doc.setTextColor(100, 116, 139);
  doc.text(`Calendar report — ${periodLabel}`, 14, 27);

  const head = ["No.", "House Name", ...dayNums.map(String), "Amount"];
  const body = placeEntries.map((info, i) => {
    const cleanDays = info.days.size;
    const amount = [...info.days.values()].reduce((s, v) => s + v, 0);
    grandTotal += amount;
    const prices = [...info.days.values()];
    const uniform = prices.length > 0 && prices.every((p) => p === prices[0]);
    const amountLabel =
      cleanDays === 0
        ? "—"
        : uniform
          ? `${money(prices[0])} × ${String(cleanDays).padStart(2, "0")}`
          : money(amount);
    return [
      String(i + 1),
      info.place,
      ...dayNums.map((d) => (info.days.has(d) ? "X" : "")),
      amountLabel,
    ];
  });

  const amountColIndex = 2 + dayNums.length;

  autoTable(doc, {
    startY: 32,
    head: [head],
    body:
      body.length > 0
        ? body
        : [["—", "No cleanings in this period", ...dayNums.map(() => ""), ""]],
    theme: "grid",
    headStyles: {
      fillColor: [15, 118, 110],
      textColor: 255,
      fontSize: 6,
      fontStyle: "bold",
      halign: "center",
      cellPadding: 1,
    },
    styles: {
      fontSize: 6,
      cellPadding: 1,
      halign: "center",
      valign: "middle",
      minCellHeight: 5,
    },
    columnStyles: {
      0: { cellWidth: 8, fontStyle: "bold" },
      1: { cellWidth: 32, halign: "left", fontSize: 6 },
      [amountColIndex]: {
        cellWidth: 22,
        halign: "right",
        fontStyle: "bold",
        fontSize: 6,
      },
    },
    didParseCell: (data) => {
      if (
        data.section === "body" &&
        data.column.index >= 2 &&
        data.column.index < amountColIndex
      ) {
        if (String(data.cell.raw).toUpperCase() === "X") {
          data.cell.styles.fontStyle = "bold";
          data.cell.styles.textColor = [15, 118, 110];
        }
      }
    },
  });

  const finalY =
    (doc as jsPDF & { lastAutoTable: { finalY: number } }).lastAutoTable.finalY +
    8;
  doc.setFontSize(9);
  doc.setTextColor(30, 41, 59);
  doc.text(`TOTAL cleanings: ${rows.length}`, 14, finalY);
  doc.text(`Places: ${placeEntries.length}`, 70, finalY);
  doc.text(`TOTAL amount: ${money(grandTotal)}`, 120, finalY);
  doc.setFontSize(7);
  doc.setTextColor(100, 116, 139);
  doc.text(
    "Amount = sum of owner fees for each day cleaned.",
    14,
    finalY + 6
  );

  const safe = clientName.replace(/\s+/g, "_");
  doc.save(`${safe}_calendar_${periodLabel.replace(/\s+/g, "_")}.pdf`);
}

/** Employee report — day = per place; week/month = per employee */
export function generateEmployeeReportPDF(args: {
  title?: string;
  periodLabel: string;
  periodKind: "day" | "week" | "month";
  rows?: {
    name: string;
    dates: string[];
    places: string[];
    amount: number;
  }[];
  dayPlaceRows?: {
    place: string;
    employees: string[];
    teamSize: number;
    payByEmployee: number;
    amount: number;
    payNote?: string;
  }[];
  companyName?: string;
}): void {
  const { periodLabel, periodKind } = args;
  const brand = (args.companyName ?? "").trim() || "DClean";
  const title = args.title ?? "Employee amounts";
  const doc = new jsPDF("landscape");
  const kindLabel =
    periodKind === "day"
      ? "Daily"
      : periodKind === "week"
        ? "Weekly"
        : "Monthly";

  doc.setFontSize(16);
  doc.setTextColor(13, 148, 136);
  doc.text(brand, 14, 16);

  doc.setFontSize(12);
  doc.setTextColor(30, 41, 59);
  doc.text(title, 14, 24);

  doc.setFontSize(10);
  doc.setTextColor(100, 116, 139);
  doc.text(`${kindLabel} employee report — ${periodLabel}`, 14, 30);

  if (periodKind === "day") {
    const dayRows = args.dayPlaceRows ?? [];
    autoTable(doc, {
      startY: 36,
      head: [
        [
          "No.",
          "Place",
          "Employees",
          "Calculation",
          "Pay by employee",
          "Amount",
        ],
      ],
      body: dayRows.map((r, i) => [
        String(i + 1),
        r.place,
        `${r.employees.join(", ")} (${r.teamSize})`,
        r.payNote
          ? `${money(r.amount)} / ${r.teamSize} (${r.payNote})`
          : `${money(r.amount)} / ${r.teamSize} = ${money(r.payByEmployee)}`,
        r.payNote || money(r.payByEmployee),
        money(r.amount),
      ]),
      foot: [
        [
          "",
          "TOTAL",
          `${dayRows.length} places`,
          "",
          "",
          money(dayRows.reduce((s, r) => s + r.amount, 0)),
        ],
      ],
      theme: "grid",
      headStyles: {
        fillColor: [15, 118, 110],
        textColor: 255,
        fontSize: 8,
        fontStyle: "bold",
      },
      footStyles: {
        fillColor: [240, 253, 250],
        textColor: [15, 118, 110],
        fontStyle: "bold",
        fontSize: 8,
      },
      styles: { fontSize: 7, cellPadding: 2, overflow: "linebreak" },
      columnStyles: {
        0: { cellWidth: 12, halign: "center" },
        1: { cellWidth: 40 },
        2: { cellWidth: 55 },
        3: { cellWidth: 55, halign: "right" },
        4: { cellWidth: 32, halign: "right", fontStyle: "bold" },
        5: { cellWidth: 30, halign: "right", fontStyle: "bold" },
      },
    });

    doc.setFontSize(8);
    doc.setTextColor(100, 116, 139);
    const yDay =
      (doc as jsPDF & { lastAutoTable: { finalY: number } }).lastAutoTable
        .finalY + 8;
    doc.text(
      "Calculation = employee pay / number of employees on that place. Amount = full employee pay.",
      14,
      yDay
    );
    doc.save(`employees_${periodLabel.replace(/\s+/g, "_")}.pdf`);
    return;
  }

  const rows = args.rows ?? [];
  const formatDates = (dates: string[]) => {
    if (dates.length === 0) return "—";
    const parsed = dates.map((d) => parseLocalDate(d));
    const sameMonth =
      parsed.length > 1 &&
      parsed.every(
        (d) =>
          d.getMonth() === parsed[0].getMonth() &&
          d.getFullYear() === parsed[0].getFullYear()
      );
    if (sameMonth) {
      return `${parsed.map((d) => format(d, "d")).join(", ")} ${format(parsed[0], "MMM yyyy")}`;
    }
    return dates.map((d) => formatDate(d)).join(", ");
  };

  autoTable(doc, {
    startY: 36,
    head: [["No.", "Employee", "Dates worked", "Places", "Amount"]],
    body: rows.map((r, i) => [
      String(i + 1),
      r.name,
      formatDates(r.dates),
      r.places.join(" · "),
      money(r.amount),
    ]),
    foot: [
      [
        "",
        "TOTAL",
        `${rows.reduce((s, r) => s + r.dates.length, 0)} work days`,
        `${rows.length} employees`,
        money(rows.reduce((s, r) => s + r.amount, 0)),
      ],
    ],
    theme: "grid",
    headStyles: {
      fillColor: [15, 118, 110],
      textColor: 255,
      fontSize: 9,
      fontStyle: "bold",
    },
    footStyles: {
      fillColor: [240, 253, 250],
      textColor: [15, 118, 110],
      fontStyle: "bold",
      fontSize: 9,
    },
    styles: { fontSize: 8, cellPadding: 3, overflow: "linebreak" },
    columnStyles: {
      0: { cellWidth: 14, halign: "center" },
      1: { cellWidth: 40 },
      2: { cellWidth: 55 },
      3: { cellWidth: 100 },
      4: { cellWidth: 30, halign: "right", fontStyle: "bold" },
    },
  });

  doc.setFontSize(8);
  doc.setTextColor(100, 116, 139);
  const y =
    (doc as jsPDF & { lastAutoTable: { finalY: number } }).lastAutoTable.finalY +
    8;
  doc.text(
    "Amount = sum of (employee pay amount / team size) for each place worked.",
    14,
    y
  );

  doc.save(`employees_${periodLabel.replace(/\s+/g, "_")}.pdf`);
}

/** @deprecated use generateDetailReportPDF */
export function generateInvoicePDF(
  client: { id: string; name: string; email: string | null; phone: string | null },
  periodStart: Date,
  rows: ReportRow[]
): void {
  const periodLabel = format(startOfMonth(periodStart), "MMMM yyyy");
  generateDetailReportPDF({
    clientName: client.name,
    periodLabel,
    periodKind: "month",
    rows: rows.map((r) => ({
      ...r,
      singleBeds: r.singleBeds ?? 0,
      doubleBeds: r.doubleBeds ?? 0,
      pillowCoversSingle: r.pillowCoversSingle ?? 0,
      pillowCoversDouble: r.pillowCoversDouble ?? 0,
      extraPillowCost: r.extraPillowCost ?? 0,
      extraPillows: r.extraPillows ?? 0,
      productCost: r.productCost ?? 0,
      extraSheetCost: r.extraSheetCost ?? 0,
    })),
  });
}

export function monthBounds(d: Date) {
  return { from: startOfMonth(d), to: endOfMonth(d) };
}
