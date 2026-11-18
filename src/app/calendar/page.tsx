import { QuickAssign } from "@/components/calendar/quick-assign";

export default function CalendarPage() {
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-3xl font-bold text-slate-800">Schedule</h1>
        <p className="text-slate-500 mt-1">
          Choose the date, tick cleaners for each place, done.
        </p>
      </div>
      <QuickAssign jobs={[]} properties={[]} employees={[]} />
    </div>
  );
}
