import Link from "next/link";
import { resolveTenant } from "@/lib/tenant";
import { fmtDateTime, fmtQty } from "@/lib/format";
import { Badge, Card, CardHeader, StatCard, TransferStatusBadge } from "@/components/ui";
import { TransferCreateClient } from "@/components/TransferCreateClient";

export const dynamic = "force-dynamic";

export default async function TransfersPage() {
  const { tenant } = await resolveTenant();
  const storeName = (id: string) => tenant.stores.find((s) => s.id === id)?.code ?? "?";

  const ots = tenant.transferOrders;
  const inTransit = ots.filter((o) => o.status === "SHIPPED");
  const discrepancies = ots.filter((o) => o.status === "DISCREPANCY");
  const pendingFlow = ots.filter((o) => ["REQUESTED", "APPROVED", "IN_PREPARATION"].includes(o.status));

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold text-white">Transferts inter-magasins</h1>
        <p className="mt-0.5 text-sm text-slate-400">
          Ordres de transfert (OT) · flux tiré (seuils) et poussé (prorata ventes) · emplacements virtuels In-Transit & Avarie.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="OT en transit" value={String(inTransit.length)} sub={`${inTransit.reduce((a, o) => a + o.items.reduce((b, i) => b + (i.quantityShipped - i.quantityReceived - i.quantityDamaged), 0), 0)} unités en route`} tone="blue" />
        <StatCard label="En attente hub" value={String(pendingFlow.length)} sub="demandé / validé / préparation" tone="amber" />
        <StatCard label="Écarts à régulariser" value={String(discrepancies.length)} sub="manquants ou casse constatés" tone={discrepancies.length ? "red" : "green"} />
        <StatCard label="OT clôturés (30 j)" value={String(ots.filter((o) => o.status === "RECEIVED").length)} sub="reçus conformes" tone="green" />
      </div>

      <TransferCreateClient
        stores={tenant.stores.map((s) => ({ id: s.id, code: s.code, name: s.name, isHub: s.isHub }))}
        products={tenant.products.map((p) => ({ id: p.id, name: p.name, sku: p.sku }))}
      />

      <Card>
        <CardHeader title="Ordres de transfert" subtitle="Workflow : BROUILLON → DEMANDÉ → VALIDÉ → EN_PRÉPARATION → EN_TRANSIT → CLÔTURÉ / ÉCART_CONSTATÉ" />
        <div className="max-h-[55vh] overflow-auto">
          <table className="w-full min-w-[860px] text-sm">
            <thead className="sticky top-0 bg-slate-900 text-left text-[11px] uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-2.5">Référence</th>
                <th className="px-2 py-2.5">Itinéraire</th>
                <th className="px-2 py-2.5">Stratégie</th>
                <th className="px-2 py-2.5 text-center">Lignes</th>
                <th className="px-2 py-2.5">Créé le</th>
                <th className="px-2 py-2.5">Statut</th>
                <th className="px-2 py-2.5" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800">
              {ots.map((o) => (
                <tr key={o.id} className="hover:bg-slate-800/40">
                  <td className="px-4 py-2.5 font-mono text-xs text-slate-200">{o.codeReference}</td>
                  <td className="px-2 py-2.5">
                    <span className="text-slate-200">{storeName(o.sourceStoreId)}</span>
                    <span className="mx-1.5 text-slate-500">→</span>
                    <span className="text-slate-200">{storeName(o.destinationStoreId)}</span>
                  </td>
                  <td className="px-2 py-2.5">
                    <Badge tone={o.strategy === "PULL" ? "blue" : "violet"}>{o.strategy === "PULL" ? "Flux tiré" : "Flux poussé"}</Badge>
                  </td>
                  <td className="px-2 py-2.5 text-center tabular-nums text-slate-300">{o.items.length}</td>
                  <td className="px-2 py-2.5 text-xs text-slate-400">{fmtDateTime(o.createdAt)}</td>
                  <td className="px-2 py-2.5"><TransferStatusBadge status={o.status} /></td>
                  <td className="px-2 py-2.5 text-right">
                    <Link href={`/transfers/${o.id}`} className="rounded border border-slate-700 px-2 py-1 text-xs text-slate-300 hover:border-emerald-500">Ouvrir →</Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
