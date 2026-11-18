import { cn } from "@/lib/utils";

interface DataTableProps {
  headers: string[];
  rows: (string | number)[][];
  className?: string;
}

export function DataTable({ headers, rows, className }: DataTableProps) {
  return (
    <div className={cn("overflow-hidden rounded-lg border bg-white shadow-sm", className)}>
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b bg-teal-50">
            {headers.map((header) => (
              <th
                key={header}
                className="px-4 py-3 text-left font-semibold text-teal-800"
              >
                {header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td colSpan={headers.length} className="px-4 py-8 text-center text-slate-500">
                No data available
              </td>
            </tr>
          ) : (
            rows.map((row, i) => (
              <tr
                key={i}
                className={cn(
                  "border-b transition-colors hover:bg-slate-50",
                  i % 2 === 1 && "bg-slate-50/50"
                )}
              >
                {row.map((cell, j) => (
                  <td key={j} className="px-4 py-3 text-slate-700">
                    {cell}
                  </td>
                ))}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}
