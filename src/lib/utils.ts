import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import { format, isValid } from "date-fns";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** DClean — amounts in euro. */
export function formatCurrency(amount: number): string {
  return new Intl.NumberFormat("it-IT", {
    style: "currency",
    currency: "EUR",
  }).format(amount);
}

/** Parse yyyy-MM-dd as a local calendar day (avoids UTC off-by-one). */
export function parseLocalDate(iso: string): Date {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso.trim());
  if (!m) return new Date(iso);
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

/**
 * Split a euro pool across n people in cents so shares always sum to the pool.
 * e.g. €100 / 3 → [33.34, 33.33, 33.33]
 */
export function splitPayShares(pool: number, n: number): number[] {
  if (n <= 0) return [];
  const totalCents = Math.round(pool * 100);
  const base = Math.floor(totalCents / n);
  let remainder = totalCents - base * n;
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    const cents = base + (remainder > 0 ? 1 : 0);
    if (remainder > 0) remainder -= 1;
    out.push(cents / 100);
  }
  return out;
}

export function formatDate(date: string | Date): string {
  const d =
    typeof date === "string"
      ? /^\d{4}-\d{2}-\d{2}$/.test(date)
        ? parseLocalDate(date)
        : new Date(date)
      : date;
  if (!isValid(d)) return String(date);
  return format(d, "MMM d, yyyy");
}
