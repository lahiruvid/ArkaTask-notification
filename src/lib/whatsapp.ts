import { splitPayShares } from "@/lib/utils";

/** Build wa.me URL. Phone should include country code when possible. */
export function toWhatsAppPhone(phone: string | null | undefined): string | null {
  if (!phone) return null;
  const digits = phone.replace(/\D/g, "");
  if (digits.length < 8) return null;
  return digits;
}

export function whatsAppUrl(phone: string, message: string): string {
  return `https://wa.me/${phone}?text=${encodeURIComponent(message)}`;
}

function formatPrice(amount: number): string {
  return new Intl.NumberFormat("it-IT", {
    style: "currency",
    currency: "EUR",
  }).format(amount);
}

export interface CleanerNotifyPlace {
  placeName: string;
  ownerName: string;
  singleBeds: number;
  doubleBeds: number;
  price: number;
  note?: string | null;
  /** Everyone assigned to this place, including the recipient. */
  team: string[];
}

export interface CleanerNotifyCard {
  employeeId: string;
  name: string;
  phone: string | null;
  places: CleanerNotifyPlace[];
  message: string;
}

/**
 * One WhatsApp card per cleaner, listing only places they are assigned to.
 * Includes beds, price, and day note for each place.
 */
export function buildCleanerNotifications(
  dayLabel: string,
  jobs: {
    place_name: string;
    owner_name: string;
    status?: string;
    notes?: string | null;
    single_beds?: number;
    double_beds?: number;
    charged_amount?: number;
    employee_pay_amount?: number;
    job_assignments: {
      employee_id: string;
      employee_name: string;
      employees?: { phone?: string | null; name?: string } | null;
    }[];
  }[],
  phoneByEmployeeId: Map<string, string | null>,
  nameByEmployeeId?: Map<string, string>,
  companyName?: string
): CleanerNotifyCard[] {
  const brand = (companyName ?? "").trim() || "DClean";
  const byCleaner = new Map<
    string,
    { name: string; phone: string | null; places: CleanerNotifyPlace[] }
  >();

  for (const job of jobs) {
    if (job.job_assignments.length === 0) continue;
    if (job.status === "cancelled") continue;

    const team = job.job_assignments.map(
      (a) => nameByEmployeeId?.get(a.employee_id) ?? a.employee_name
    );
    const payPool =
      job.employee_pay_amount !== undefined
        ? Number(job.employee_pay_amount) || 0
        : Number(job.charged_amount) || 0;
    const shares = splitPayShares(payPool, team.length);

    job.job_assignments.forEach((a, i) => {
      const share = shares[i] ?? 0;
      const liveName =
        nameByEmployeeId?.get(a.employee_id) ?? a.employee_name;
      const existing = byCleaner.get(a.employee_id) ?? {
        name: liveName,
        phone:
          phoneByEmployeeId.get(a.employee_id) ??
          a.employees?.phone ??
          null,
        places: [],
      };
      existing.places.push({
        placeName: job.place_name,
        ownerName: job.owner_name,
        singleBeds: Number(job.single_beds) || 0,
        doubleBeds: Number(job.double_beds) || 0,
        price: share,
        note: job.notes?.trim() || null,
        team,
      });
      byCleaner.set(a.employee_id, existing);
    });
  }

  return [...byCleaner.entries()]
    .map(([employeeId, data]) => {
      const lines = [
        `Hi ${data.name}, Your cleaning schedule for ${dayLabel}:`,
        "",
      ];

      data.places.forEach((p, i) => {
        const place =
          p.ownerName.trim().length > 0
            ? `${p.placeName} (${p.ownerName})`
            : p.placeName;
        lines.push(`${i + 1}. ${place}`);
        lines.push(
          `   Beds: ${p.singleBeds} single / ${p.doubleBeds} double`
        );
        lines.push(`   Your pay: ${formatPrice(p.price)}`);
        lines.push(`   Team: ${p.team.join(", ")}`);
        if (p.note) {
          lines.push(`   Note: ${p.note}`);
        }
        lines.push("");
      });

      lines.push(brand);

      return {
        employeeId,
        name: data.name,
        phone: data.phone,
        places: data.places,
        message: lines.join("\n"),
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** Open WhatsApp chats one-by-one (browsers block many popups at once). */
export async function sendWhatsAppBatch(
  cards: CleanerNotifyCard[],
  onProgress?: (done: number, total: number) => void
): Promise<{ sent: number; skipped: number }> {
  const sendable = cards.filter((c) => toWhatsAppPhone(c.phone));
  let sent = 0;
  for (let i = 0; i < sendable.length; i++) {
    const card = sendable[i];
    const phone = toWhatsAppPhone(card.phone)!;
    window.open(whatsAppUrl(phone, card.message), "_blank", "noopener,noreferrer");
    sent += 1;
    onProgress?.(sent, sendable.length);
    if (i < sendable.length - 1) {
      await new Promise((r) => setTimeout(r, 700));
    }
  }
  return { sent, skipped: cards.length - sendable.length };
}

export function buildReportWhatsAppMessage(
  ownerName: string,
  periodLabel: string,
  companyName: string
): string {
  const brand = companyName.trim() || "DClean";
  return [
    `Report ${periodLabel} — ${ownerName}`,
    "",
    `From ${brand}. Please find the PDF attached.`,
  ].join("\n");
}

/** Open one WhatsApp chat. Returns false if phone invalid. */
export function openWhatsAppChat(
  phone: string | null | undefined,
  message: string
): boolean {
  const digits = toWhatsAppPhone(phone);
  if (!digits) return false;
  window.open(whatsAppUrl(digits, message), "_blank", "noopener,noreferrer");
  return true;
}

/** Open chats in sequence (owner first, then optional self). */
export async function openWhatsAppChatsSequential(
  chats: { phone: string | null | undefined; message: string }[]
): Promise<{ opened: number; skipped: number }> {
  let opened = 0;
  let skipped = 0;
  for (let i = 0; i < chats.length; i++) {
    const ok = openWhatsAppChat(chats[i].phone, chats[i].message);
    if (ok) opened += 1;
    else skipped += 1;
    if (ok && i < chats.length - 1) {
      await new Promise((r) => setTimeout(r, 700));
    }
  }
  return { opened, skipped };
}
