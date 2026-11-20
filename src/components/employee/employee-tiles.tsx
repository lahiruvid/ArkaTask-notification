"use client";

import { useState } from "react";
import { Building2, LogOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import { logout, type EmployeeApartment } from "@/lib/auth";
import { formatDate } from "@/lib/utils";
import { requestMarkClean, signOutEmployee } from "@/components/employee/employee-api";

export function EmployeeTiles({
  name,
  token,
  todayDate,
  tomorrowDate,
  today,
  tomorrow,
  onSignedOut,
}: {
  name: string;
  token: string;
  todayDate: string;
  tomorrowDate: string;
  today: EmployeeApartment[];
  tomorrow: EmployeeApartment[];
  onSignedOut: () => void;
}) {
  const [which, setWhich] = useState<"today" | "tomorrow">("today");
  const [cleaned, setCleaned] = useState<Record<string, boolean>>({});
  const [error, setError] = useState<string | null>(null);

  const date = which === "today" ? todayDate : tomorrowDate;
  const apartments = which === "today" ? today : tomorrow;

  const tap = async (place: EmployeeApartment) => {
    const key = `${date}:${place.apartmentId}`;
    if (cleaned[key]) return;
    setError(null);
    setCleaned((current) => ({ ...current, [key]: true }));
    try {
      await requestMarkClean(token, place.apartmentId, date);
    } catch (e) {
      setCleaned((current) => ({ ...current, [key]: false }));
      setError(e instanceof Error ? e.message : "Could not mark this apartment clean.");
    }
  };

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="mx-auto flex min-h-screen w-full max-w-lg flex-col px-4 py-6">
        <header className="flex items-start justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">
              {which === "today" ? "Today" : "Tomorrow"}
            </p>
            <h1 className="mt-1 text-2xl font-black tracking-tight text-slate-900">
              {name}
            </h1>
            <p className="mt-1 text-sm text-slate-500">
              {date ? formatDate(date) : ""}
            </p>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="gap-1.5 shrink-0"
            onClick={() => {
              logout();
              void signOutEmployee();
              onSignedOut();
            }}
          >
            <LogOut className="h-3.5 w-3.5" />
            Sign out
          </Button>
        </header>

        <div className="mt-5 grid grid-cols-2 gap-2">
          <Button
            type="button"
            variant={which === "today" ? "default" : "outline"}
            onClick={() => setWhich("today")}
          >
            Today
          </Button>
          <Button
            type="button"
            variant={which === "tomorrow" ? "default" : "outline"}
            onClick={() => setWhich("tomorrow")}
          >
            Tomorrow
          </Button>
        </div>

        {error ? (
          <p className="mt-4 text-sm text-red-600" role="alert">
            {error}
          </p>
        ) : null}

        <section className="mt-4 flex-1" aria-label="Apartments to clean">
          {apartments.length === 0 ? (
            <div className="rounded-xl border bg-white px-4 py-10 text-center text-sm text-slate-500 shadow-sm">
              No apartments to clean {which}.
            </div>
          ) : (
            <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {apartments.map((place) => {
                const key = `${date}:${place.apartmentId}`;
                const done = !!cleaned[key];
                return (
                  <li key={place.apartmentId}>
                    <button
                      type="button"
                      onClick={() => void tap(place)}
                      className={
                        done
                          ? "flex w-full items-center gap-3 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-left shadow-sm"
                          : "flex w-full items-center gap-3 rounded-xl border bg-white p-4 text-left shadow-sm"
                      }
                    >
                      <span
                        className={
                          done
                            ? "flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-emerald-100 text-emerald-700"
                            : "flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-orange-50 text-orange-600"
                        }
                      >
                        <Building2 className="h-5 w-5" />
                      </span>
                      <span className="font-semibold text-slate-900">
                        {place.name}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
