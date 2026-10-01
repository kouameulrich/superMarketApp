"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { updateTransferStatus, type ReceivePayload } from "@/lib/actions";
import { fmtDateTime } from "@/lib/format";
import { Card, CardHeader } from "@/components/ui";

interface Item { id: string; name: string; shipped: number }

interface Reception {
  itemId: string;
  qtyReceived: string;
  qtyDamaged: string;
  reason: string;
}

export function TransferWorkflowClient({
  otId, status, code, items, shippedAt,
}: {
  otId: string;
  status: string;
  code: string;
  items: Item[];
  shippedAt: string | null;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [fakeScan, setFakeScan] = useState("");
  const [showReception, setShowReception] = useState(false);
  const [receptions, setReceptions] = useState<Reception[]>(items.map((i) => ({ itemId: i.id, qtyReceived: String(i.shipped), qtyDamaged: "0", reason: "" })));

  const run = async (action: Parameters<typeof updateTransferStatus>[1], payload?: { receive: ReceivePayload[] }) => {
    setError(null);
    const res = await updateTransferStatus(otId, action, payload);
    if (res.ok) {
      setShowReception(false);
      startTransition(() => router.refresh());
    } else setError(res.error);
  };

  const validateReceptions = useMemo(() => {
    return receptions.every((r) => {
      const qtyRec = parseFloat(r.qtyReceived) || 0;
      const qtyDam = parseFloat(r.qtyDamaged) || 0;
      return qtyRec >= 0 && qtyDam >= 0 && (qtyRec + qtyDam > 0 || r.reason.length > 0);
    });
  }, [receptions]);

  const totalMissing = receptions.reduce((acc, r) => {
    const shipped = items.find((i) => i.id === r.itemId)?.shipped ?? 0;
    return acc + Math.max(0, shipped - (parseFloat(r.qtyReceived) || 0) - (parseFloat(r.qtyDamaged) || 0));
  }, 0);

  const buttons: { label: string; action: Parameters<typeof updateTransferStatus>[1]; cls: string }[] = [];
  if (status === "DRAFT") {
    buttons.push({ label: "Envoyer la demande (→ DEMANDÉ)", action: "SUBMIT", cls: "bg-sky-500 hover:bg-sky-400 text-slate-950" });
    buttons.push({ label: "Annuler l'OT", action: "CANCEL", cls: "border border-slate-600 text-slate-300" });
  }
  if (status === "REQUESTED") {
    buttons.push({ label: "Valider la disponibilité (→ VALIDÉ)", action: "APPROVE", cls: "bg-violet-500 hover:bg-violet-400 text-slate-950" });
    buttons.push({ label: "Annuler", action: "CANCEL", cls: "border border-slate-600 text-slate-300" });
  }
  if (status === "APPROVED") {
    buttons.push({ label: "Préparer la commande (→ EN_PRÉPARATION)", action: "PREPARE", cls: "bg-amber-500 hover:bg-amber-400 text-slate-950" });
  }
  if (status === "IN_PREPARATION") {
    buttons.push({ label: "Expédier — débit stock source, crédit In-Transit (→ SHIPPED)", action: "SHIP", cls: "bg-emerald-500 hover:bg-emerald-400 text-slate-950" });
  }

  return (
    <Card>
      <CardHeader
        title="Actions workflow"
        subtitle={
          status === "SHIPPED" && shippedAt
            ? `Expédié le ${fmtDateTime(shippedAt)} — bordereau ${code}`
            : status === "DISCREPANCY"
              ? "Des écarts (manquants/casse) ont été constatés : imputez-les puis clôturez."
              : "Les écritures de stock sont générées automatiquement à chaque étape."
        }
      />
      {error && <p className="mx-4 mt-3 rounded-lg border border-red-800 bg-red-950 px-3 py-2 text-sm text-red-300">{error}</p>}

      {status === "SHIPPED" && (
        <div className="border-b border-slate-800 px-4 py-3">
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-2.5">
              {Array.from({ length: 8 }).map((_, i) => (
                <svg key={i} viewBox="0 0 21 21" className="h-10 w-10 bg-white p-0.5" aria-hidden>
                  {Array.from({ length: 21 }).map((_, r) => (
                    <rect
                      key={r}
                      x={r}
                      y={(r * (i + 3)) % 21}
                      width={1}
                      height={1}
                      className={((r + i) * 7) % 3 === 0 ? "fill-slate-900" : "fill-white"}
                    />
                  ))}
                </svg>
              ))}
            </div>
            <div className="text-xs text-slate-400">
              <p className="font-mono text-sm text-slate-200">{code}</p>
              Bordereau QR — scan à l&apos;arrivée sur le PDA du magasin destinataire.
            </div>
            <button
              onClick={() => { setFakeScan(`SCAN:${code}`); setTimeout(() => setFakeScan(""), 2500); }}
              className="ml-auto rounded-lg border border-slate-600 px-3 py-2 text-xs text-slate-300 hover:border-emerald-500"
            >
              Scanner le bordereau
            </button>
          </div>
          {fakeScan && <p className="mt-2 text-xs text-emerald-300">✔ Bordereau scanné : {fakeScan} — saisie des quantités ci-dessous.</p>}
          <button
            onClick={() => setShowReception((v) => !v)}
            className="mt-3 rounded-lg bg-emerald-500 px-4 py-2 text-sm font-semibold text-slate-950 hover:bg-emerald-400"
          >
            Réception contrôlée (PDA) — saisir les quantités
          </button>
        </div>
      )}

      {status === "SHIPPED" && showReception && (
        <div className="border-b border-slate-800 bg-slate-950/40 p-4">
          <table className="w-full text-sm">
            <thead className="text-left text-[11px] uppercase text-slate-500">
              <tr>
                <th className="pb-2">Article</th>
                <th className="pb-2 text-right">Expédié</th>
                <th className="pb-2 text-right">Reçu (conformes)</th>
                <th className="pb-2 text-right">Casse en transit</th>
                <th className="pb-2">Observation / motif</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800">
              {items.map((item, idx) => {
                const rec = receptions[idx];
                const missing = item.shipped - (parseFloat(rec?.qtyReceived ?? "0") || 0) - (parseFloat(rec?.qtyDamaged ?? "0") || 0);
                return (
                  <tr key={item.id}>
                    <td className="py-2 pr-3 text-slate-200">{item.name}</td>
                    <td className="py-2 text-right tabular-nums text-slate-300">{item.shipped}</td>
                    <td className="py-2 pl-2 text-right">
                      <input
                        value={rec?.qtyReceived ?? ""}
                        onChange={(e) => setReceptions((prev) => prev.map((r, i) => (i === idx ? { ...r, qtyReceived: e.target.value } : r)))}
                        type="number"
                        className="w-20 rounded border border-slate-700 bg-slate-950 px-2 py-1 text-right tabular-nums outline-none focus:border-emerald-500"
                      />
                    </td>
                    <td className="py-2 pl-2 text-right">
                      <input
                        value={rec?.qtyDamaged ?? ""}
                        onChange={(e) => setReceptions((prev) => prev.map((r, i) => (i === idx ? { ...r, qtyDamaged: e.target.value } : r)))}
                        type="number"
                        className="w-20 rounded border border-slate-700 bg-slate-950 px-2 py-1 text-right tabular-nums outline-none focus:border-amber-500"
                      />
                    </td>
                    <td className="py-2 pl-2">
                      <input
                        value={rec?.reason ?? ""}
                        onChange={(e) => setReceptions((prev) => prev.map((r, i) => (i === idx ? { ...r, reason: e.target.value } : r)))}
                        placeholder={missing > 0 ? `${missing} unité(s) manquante(s) — motif obligatoire` : "Optionnel"}
                        className="w-full max-w-xs rounded border border-slate-700 bg-slate-950 px-2 py-1 text-xs outline-none focus:border-emerald-500"
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <p className="text-xs text-slate-400">
              {totalMissing > 0 || receptions.some((r) => (parseFloat(r.qtyDamaged) || 0) > 0)
                ? "⚠ Des écarts seront imputés : manquants au compte de perte, casse vers la zone Avarie."
                : "Aucun écart — OT clôturé directement en RECEIVED."}
            </p>
            <button
              onClick={() =>
                void run("RECEIVE", {
                  receive: receptions.map((r) => ({
                    itemId: r.itemId,
                    quantityReceived: parseFloat(r.qtyReceived) || 0,
                    quantityDamaged: parseFloat(r.qtyDamaged) || 0,
                    discrepancyReason: r.reason || undefined,
                  })),
                })
              }
              disabled={pending || !validateReceptions}
              className="ml-auto rounded-lg bg-emerald-500 px-4 py-2 text-sm font-semibold text-slate-950 hover:bg-emerald-400 disabled:opacity-40"
            >
              Confirmer la réception
            </button>
          </div>
        </div>
      )}

      <div className="flex flex-wrap gap-2 p-4">
        {buttons.map((b) => (
          <button
            key={b.label}
            onClick={() => void run(b.action)}
            disabled={pending}
            className={`rounded-lg px-3.5 py-2 text-sm font-semibold transition disabled:opacity-50 ${b.cls}`}
          >
            {b.label}
          </button>
        ))}
        {status === "DISCREPANCY" && (
          <button
            onClick={() => void run("RESOLVE")}
            disabled={pending}
            className="rounded-lg bg-emerald-500 px-3.5 py-2 text-sm font-semibold text-slate-950 hover:bg-emerald-400 disabled:opacity-50"
          >
            Régulariser les écarts & clôturer (→ RECEIVED)
          </button>
        )}
        {["RECEIVED", "CANCELLED"].includes(status) && (
          <p className="self-center text-xs text-slate-500">OT clôturé — opérations terminées. Consultez le journal des mouvements pour l&apos;historique des écritures.</p>
        )}
      </div>
    </Card>
  );
}
