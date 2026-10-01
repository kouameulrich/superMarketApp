import type { ReactNode } from "react";

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <div className={`rounded-xl border border-slate-800 bg-slate-900/60 shadow-sm ${className}`}>
      {children}
    </div>
  );
}

export function CardHeader({ title, subtitle, action }: { title: string; subtitle?: string; action?: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-slate-800 px-5 py-3.5">
      <div>
        <h2 className="text-sm font-semibold text-slate-100">{title}</h2>
        {subtitle ? <p className="mt-0.5 text-xs text-slate-400">{subtitle}</p> : null}
      </div>
      {action}
    </div>
  );
}

const badgeStyles: Record<string, string> = {
  neutral: "bg-slate-800 text-slate-300 border-slate-700",
  green: "bg-emerald-950 text-emerald-300 border-emerald-800",
  amber: "bg-amber-950 text-amber-300 border-amber-800",
  red: "bg-red-950 text-red-300 border-red-800",
  blue: "bg-sky-950 text-sky-300 border-sky-800",
  violet: "bg-violet-950 text-violet-300 border-violet-800",
};

export function Badge({ children, tone = "neutral", className = "" }: { children: ReactNode; tone?: keyof typeof badgeStyles; className?: string }) {
  return (
    <span className={`inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[11px] font-medium ${badgeStyles[tone]} ${className}`}>
      {children}
    </span>
  );
}

export function StatCard({ label, value, sub, tone = "blue" }: { label: string; value: string; sub?: string; tone?: "blue" | "green" | "amber" | "red" | "violet" }) {
  const ring: Record<string, string> = {
    blue: "text-sky-300",
    green: "text-emerald-300",
    amber: "text-amber-300",
    red: "text-red-300",
    violet: "text-violet-300",
  };
  return (
    <Card className="p-4">
      <p className="text-xs font-medium uppercase tracking-wide text-slate-400">{label}</p>
      <p className={`mt-1.5 text-2xl font-semibold tabular-nums ${ring[tone]}`}>{value}</p>
      {sub ? <p className="mt-1 text-xs text-slate-500">{sub}</p> : null}
    </Card>
  );
}

/** Histogramme simple sans dépendance. */
export function Bars({ data, height = 120, format }: { data: { label: string; value: number }[]; height?: number; format?: (n: number) => string }) {
  const max = Math.max(...data.map((d) => d.value), 1);
  return (
    <div className="flex items-end gap-1.5 px-1" style={{ height }}>
      {data.map((d, i) => (
        <div key={i} className="group relative flex flex-1 flex-col items-center justify-end">
          <div
            className="w-full rounded-t bg-gradient-to-t from-sky-600/60 to-sky-400/80 transition-all group-hover:from-sky-500 group-hover:to-sky-300"
            style={{ height: `${Math.max(3, (d.value / max) * (height - 24))}px` }}
          />
          <span className="mt-1 text-[9px] text-slate-500">{d.label}</span>
          <span className="pointer-events-none absolute -top-6 hidden rounded bg-slate-800 px-1.5 py-0.5 text-[10px] text-slate-200 shadow group-hover:block">
            {format ? format(d.value) : d.value}
          </span>
        </div>
      ))}
    </div>
  );
}

export function TransferStatusBadge({ status }: { status: string }) {
  const map: Record<string, { tone: keyof typeof badgeStyles; label: string }> = {
    DRAFT: { tone: "neutral", label: "Brouillon" },
    REQUESTED: { tone: "blue", label: "Demandé" },
    APPROVED: { tone: "violet", label: "Validé" },
    IN_PREPARATION: { tone: "amber", label: "En préparation" },
    SHIPPED: { tone: "blue", label: "En transit" },
    RECEIVED: { tone: "green", label: "Clôturé" },
    DISCREPANCY: { tone: "red", label: "Écart constaté" },
    CANCELLED: { tone: "neutral", label: "Annulé" },
  };
  const s = map[status] ?? { tone: "neutral" as const, label: status };
  return <Badge tone={s.tone}>{s.label}</Badge>;
}

export function POStatusBadge({ status }: { status: string }) {
  const map: Record<string, { tone: keyof typeof badgeStyles; label: string }> = {
    DRAFT: { tone: "neutral", label: "Brouillon" },
    SENT: { tone: "blue", label: "Envoyée" },
    PARTIALLY_RECEIVED: { tone: "amber", label: "Partiellement reçue" },
    RECEIVED: { tone: "green", label: "Réceptionnée" },
    CANCELLED: { tone: "neutral", label: "Annulée" },
  };
  const s = map[status] ?? { tone: "neutral" as const, label: status };
  return <Badge tone={s.tone}>{s.label}</Badge>;
}
