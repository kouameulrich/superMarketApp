"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { closeCashSession } from "@/lib/actions";
import { fmtMoney } from "@/lib/format";

export function SessionCloser({ storeId, storeName, expected }: { storeId: string; storeName: string; expected: number }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [counted, setCounted] = useState(expected.toFixed(2));
  const [error, setError] = useState<string | null>(null);

  const gap = (parseFloat(counted.replace(",", ".")) || 0) - expected;

  const submit = async () => {
    const res = await closeCashSession(storeId, parseFloat(counted.replace(",", ".")) || 0);
    if (res.ok) {
      setOpen(false);
      startTransition(() => router.refresh());
    } else setError(res.error);
  };

  return (
    <div className="mt-3 border-t border-slate-800 pt-3">
      {!open ? (
        <button onClick={() => setOpen(true)} className="w-full rounded-lg bg-slate-800 py-2 text-sm font-semibold text-slate-200 hover:bg-slate-700">
          Effectuer la clôture Z
        </button>
      ) : (
        <div className="space-y-2">
          <div>
            <label className="mb-1 block text-[11px] text-slate-400">Comptage physique des espèces ({storeName})</label>
            <input
              value={counted}
              onChange={(e) => setCounted(e.target.value)}
              inputMode="decimal"
              className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm tabular-nums outline-none focus:border-emerald-500"
            />
            <p className={`mt-1 text-xs tabular-nums ${Math.abs(gap) > 10 ? "text-red-300" : "text-emerald-300"}`}>
              Écart constaté : {gap > 0 ? "+" : ""}{fmtMoney(gap)} {Math.abs(gap) > 10 && "— justification requise (audit trail)"}
            </p>
            {error && <p className="text-xs text-red-300">{error}</p>}
          </div>
          <div className="flex gap-2">
            <button onClick={() => setOpen(false)} className="flex-1 rounded-lg border border-slate-700 py-2 text-xs text-slate-300 hover:border-slate-500">Annuler</button>
            <button onClick={() => void submit()} disabled={pending} className="flex-1 rounded-lg bg-emerald-500 py-2 text-xs font-bold text-slate-950 hover:bg-emerald-400 disabled:opacity-50">
              Clôturer la caisse (Z)
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
