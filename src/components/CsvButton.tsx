"use client";

import type { ReactNode } from "react";

/** Séparateur « ; » + BOM UTF-8 : ouverture directe dans Excel FR. */
export function buildCsv(headers: string[], rows: (string | number)[][]): string {
  const esc = (v: string | number): string => {
    const s = String(v ?? "");
    return /[";\n\r]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
  };
  return "\uFEFF" + [headers, ...rows].map((r) => r.map(esc).join(";")).join("\r\n");
}

export function downloadCsv(filename: string, headers: string[], rows: (string | number)[][]): void {
  const blob = new Blob([buildCsv(headers, rows)], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename.endsWith(".csv") ? filename : `${filename}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

export function CsvButton({
  filename,
  headers,
  rows,
  children,
}: {
  filename: string;
  headers: string[];
  rows: (string | number)[][];
  children?: ReactNode;
}) {
  return (
    <button
      onClick={() => downloadCsv(filename, headers, rows)}
      className="rounded-lg border border-slate-700 bg-slate-900 px-3 py-1.5 text-xs text-slate-300 transition hover:border-emerald-500 hover:text-emerald-300"
    >
      {children ?? "⇩ Export CSV"}
    </button>
  );
}
