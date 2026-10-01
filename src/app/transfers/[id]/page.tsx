import Link from "next/link";
import { notFound } from "next/navigation";
import { resolveTenant } from "@/lib/tenant";
import { fmtDateTime, fmtQty, TRANSFER_STATUS_LABEL } from "@/lib/format";
import { Card, CardHeader, TransferStatusBadge } from "@/components/ui";
import { TransferWorkflowClient } from "@/components/TransferWorkflowClient";

export const dynamic = "force-dynamic";

const STEPS = [
  { key: "DRAFT", label: "Brouillon" },
  { key: "REQUESTED", label: "Demandé" },
  { key: "APPROVED", label: "Validé" },
  { key: "IN_PREPARATION", label: "Préparation" },
  { key: "SHIPPED", label: "En transit" },
  { key: "RECEIVED", label: "Clôturé" },
];

export default async function TransferDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { tenant } = await resolveTenant();
  const ot = tenant.transferOrders.find((o) => o.id === id);
  if (!ot) notFound();

  const store = (sid: string) => tenant.stores.find((s) => s.id === sid);
  const src = store(ot.sourceStoreId);
  const dst = store(ot.destinationStoreId);
  const stepIndex =
    ot.status === "DISCREPANCY" ? STEPS.length - 1 : STEPS.findIndex((s) => s.key === ot.status);

  const items = ot.items.map((it) => ({
    id: it.id,
    productName: tenant.products.find((p) => p.id === it.productId)?.name ?? "?",
    sku: tenant.products.find((p) => p.id === it.productId)?.sku ?? "",
    requested: it.quantityRequested,
    shipped: it.quantityShipped,
    received: it.quantityReceived,
    damaged: it.quantityDamaged,
    reason: it.discrepancyReason,
  }));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <Link href="/transfers" className="text-xs text-sky-300 hover:underline">← Tous les OT</Link>
          <h1 className="mt-1 font-mono text-xl font-semibold text-white">{ot.codeReference}</h1>
          <p className="text-sm text-slate-400">
            <span className="text-slate-200">{src?.name}</span> → <span className="text-slate-200">{dst?.name}</span>
            {" · "}Demandé par {ot.requestedBy} le {fmtDateTime(ot.createdAt)}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Card className="px-3 py-2 text-center">
            <p className="text-[10px] uppercase text-slate-500">Stratégie</p>
            <p className="text-sm font-semibold text-violet-300">{ot.strategy === "PULL" ? "Flux tiré" : "Flux poussé"}</p>
          </Card>
          <TransferStatusBadge status={ot.status} />
        </div>
      </div>

      {/* Stepper workflow */}
      <Card className="px-5 py-4">
        <ol className="flex flex-wrap items-center gap-y-2 text-xs">
          {STEPS.map((s, i) => {
            const done = i < stepIndex || ot.status === "RECEIVED";
            const active = i === stepIndex;
            return (
              <li key={s.key} className="flex items-center">
                <span className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1 ${
                  done ? "border-emerald-800 bg-emerald-950 text-emerald-300" : active ? "border-sky-700 bg-sky-950 text-sky-300" : "border-slate-700 bg-slate-950 text-slate-500"
                }`}>
                  <span className={`h-1.5 w-1.5 rounded-full ${done ? "bg-emerald-400" : active ? "bg-sky-400" : "bg-slate-600"}`} />
                  {s.label}
                </span>
                {i < STEPS.length - 1 && <span className="mx-2 h-px w-6 bg-slate-700" />}
              </li>
            );
          })}
          {ot.status === "DISCREPANCY" && (
            <li className="ml-3"><span className="rounded-full border border-red-800 bg-red-950 px-2.5 py-1 text-red-300">Écart constaté — à régulariser</span></li>
          )}
        </ol>
      </Card>

      <Card>
        <CardHeader title="Lignes du transfert" subtitle="Quantités demandées / expédiées / reçues — contrôle à l'arrivée sur PDA" />
        <table className="w-full text-sm">
          <thead className="border-b border-slate-800 text-left text-[11px] uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-4 py-2.5">Article</th>
              <th className="px-2 py-2.5 text-right">Demandé</th>
              <th className="px-2 py-2.5 text-right">Expédié</th>
              <th className="px-2 py-2.5 text-right">Reçu</th>
              <th className="px-2 py-2.5 text-right">Casse</th>
              <th className="px-2 py-2.5">Observation</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800">
            {items.map((it) => {
              const missing = it.shipped - it.received - it.damaged;
              return (
                <tr key={it.id}>
                  <td className="px-4 py-2.5">
                    <p className="text-slate-100">{it.productName}</p>
                    <p className="text-[11px] text-slate-500">{it.sku}</p>
                  </td>
                  <td className="px-2 py-2.5 text-right tabular-nums text-slate-300">{fmtQty(it.requested)}</td>
                  <td className="px-2 py-2.5 text-right tabular-nums text-slate-300">{it.shipped ? fmtQty(it.shipped) : "—"}</td>
                  <td className="px-2 py-2.5 text-right tabular-nums text-emerald-300">{it.received ? fmtQty(it.received) : it.shipped ? "—" : ""}</td>
                  <td className="px-2 py-2.5 text-right tabular-nums text-amber-300">{it.damaged ? fmtQty(it.damaged) : "—"}</td>
                  <td className="px-2 py-2.5 text-xs">
                    {missing > 0 && <span className="mr-2 text-red-300">Manquant : {fmtQty(missing)}</span>}
                    {it.reason && <span className="text-slate-400">{it.reason}</span>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Card>

      <TransferWorkflowClient
        otId={ot.id}
        status={ot.status}
        code={ot.codeReference}
        items={items.map((it) => ({ id: it.id, name: it.productName, shipped: it.shipped }))}
        shippedAt={ot.shippedAt}
      />

      <Card>
        <CardHeader title="Lien avec la chaîne logistique" subtitle="Rappels du modèle organisationnel (PRD §3.3)" />
        <ul className="space-y-1.5 p-4 text-xs text-slate-400">
          <li>· Stock <b className="text-slate-200">source</b>: débité à l&apos;expédition (<span className="text-red-300">TRANSFER_OUT</span>).</li>
          <li>· Emplacement virtuel <b className="text-sky-200">In-Transit</b>: crédité à l&apos;expédition (<span className="text-sky-300">TRANSIT_ENTRY</span>), débité à la réception ou sur écart.</li>
          <li>· Zone virtuelle <b className="text-amber-200">Avarie/Casse</b>: alimentée par la casse en transit avec photo justificative (PDA).</li>
          <li>· Stock <b className="text-slate-200">destinataire</b>: crédité à la réception contrôlée (<span className="text-emerald-300">TRANSFER_IN</span>).</li>
        </ul>
      </Card>
      <p className="text-[10px] text-slate-600">Statuts techniques : {TRANSFER_STATUS_LABEL[ot.status]} (DRAFT, REQUESTED, APPROVED, IN_PREPARATION, SHIPPED, RECEIVED, CANCELLED, DISCREPANCY)</p>
    </div>
  );
}
