import Link from "next/link";
import { resolveTenant, guardRoles } from "@/lib/tenant";
import { transferTransitRows } from "@/lib/stock";
import { fmtDateTime, fmtQty, MOVEMENT_LABEL } from "@/lib/format";
import { Badge, Card, CardHeader, StatCard } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function LogisticsBoardPage() {
  const { tenant, session } = await resolveTenant();
  guardRoles(session.role, ["LOGISTICS", "ADMIN", "SUPER_ADMIN"]);

  const store = (id: string) => tenant.stores.find((s) => s.id === id);
  const today = new Date().toISOString().slice(0, 10);

  const toTreat = tenant.transferOrders
    .filter((o) => ["REQUESTED", "APPROVED", "IN_PREPARATION"].includes(o.status))
    .sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? ""));
  const inTransit = transferTransitRows(tenant);
  const discrepancies = tenant.transferOrders.filter((o) => o.status === "DISCREPANCY");
  const receptionPending = tenant.purchaseOrders
    .filter((p) => ["SENT", "PARTIALLY_RECEIVED"].includes(p.status))
    .sort((a, b) => (a.expectedAt ?? "").localeCompare(b.expectedAt ?? ""));
  const latePos = receptionPending.filter((p) => p.expectedAt.slice(0, 10) < today);
  const lastLogistic = tenant.stockMovements
    .filter((m) => ["TRANSFER_OUT", "TRANSFER_IN", "DAMAGE_TRANSIT", "LOSS_TRANSIT", "SUPPLIER_IN"].includes(m.type))
    .slice(0, 9);

  const pendingQty = inTransit.reduce((a, x) => a + x.pending, 0);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-white">Tableau de bord Logistique — {tenant.name}</h1>
          <p className="mt-0.5 text-sm text-slate-400">
            Flux inter-sites & achats : expéditions, réceptions fournisseurs, écarts — {tenant.stores.find((s) => s.isHub) ? `hub ${tenant.stores.find((s) => s.isHub)!.code}` : "aucun hub"}.
          </p>
        </div>
        <div className="flex gap-2">
          <Link href="/transfers" className="rounded-lg bg-emerald-500 px-3.5 py-2 text-sm font-semibold text-slate-950 transition hover:bg-emerald-400">
            Créer / gérer un OT
          </Link>
          <Link href="/suppliers" className="rounded-lg border border-slate-700 bg-slate-900 px-3.5 py-2 text-sm text-slate-200 transition hover:border-slate-500">
            Achats fournisseurs
          </Link>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <StatCard label="OT à traiter" value={String(toTreat.length)} sub="transferts demandés / approuvés / préparation" tone={toTreat.length ? "amber" : "green"} />
        <StatCard label="En transit" value={String(inTransit.length)} sub={`${fmtQty(pendingQty)} unité(s) attendue(s)`} tone="blue" />
        <StatCard label="Écarts à résoudre" value={String(discrepancies.length)} sub="réceptions non conformes" tone={discrepancies.length ? "red" : "green"} />
        <StatCard label="Réceptions attendues" value={String(receptionPending.length)} sub={`${latePos.length} retard(s)`} tone={latePos.length ? "amber" : "green"} />
        <StatCard label="Fournisseurs actifs" value={String(tenant.suppliers.length)} sub="partenaires référencés" />
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader title="À expédier — ordres de transfert" subtitle="Demandés, approuvés ou en préparation (hub/magasins)" action={<Link href="/transfers" className="text-xs text-sky-300 hover:underline">Workflow complet →</Link>} />
          <div className="max-h-80 overflow-y-auto">
            <table className="w-full text-sm">
              <tbody className="divide-y divide-slate-800">
                {toTreat.map((o) => (
                  <tr key={o.id} className="hover:bg-slate-800/40">
                    <td className="px-4 py-2.5">
                      <p className="font-medium text-slate-100">
                        <Link href={`/transfers/${o.id}`} className="hover:text-emerald-300">{o.codeReference}</Link>
                      </p>
                      <p className="text-xs text-slate-500">
                        {store(o.sourceStoreId)?.code} → {store(o.destinationStoreId)?.code} · {o.items.length} ligne(s) · demandé le {fmtDateTime(o.createdAt)}
                      </p>
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      <Badge tone={o.strategy === "PULL" ? "blue" : "green"}>{o.strategy}</Badge>{" "}
                      <Badge tone={o.status === "REQUESTED" ? "amber" : o.status === "IN_PREPARATION" ? "blue" : "green"}>
                        {o.status === "REQUESTED" ? "Demandé" : o.status === "APPROVED" ? "Approuvé" : "En préparation"}
                      </Badge>
                    </td>
                  </tr>
                ))}
                {toTreat.length === 0 && (<tr><td colSpan={2} className="p-5 text-center text-sm text-slate-500">Rien à expédier.</td></tr>)}
              </tbody>
            </table>
          </div>
        </Card>

        <Card>
          <CardHeader title="À réceptionner — en transit vers les magasins" subtitle="Zones virtuelles In-Transit (stock rapproché, non vendable)" />
          <div className="max-h-80 overflow-y-auto">
            <table className="w-full text-sm">
              <tbody className="divide-y divide-slate-800">
                {inTransit.map(({ ot, pending }) => (
                  <tr key={ot.id} className="hover:bg-slate-800/40">
                    <td className="px-4 py-2.5">
                      <p className="font-medium text-slate-100">
                        <Link href={`/transfers/${ot.id}`} className="hover:text-emerald-300">{ot.codeReference}</Link>
                      </p>
                      <p className="text-xs text-slate-500">
                        {store(ot.sourceStoreId)?.code} → {store(ot.destinationStoreId)?.code} · expédié le {ot.shippedAt ? fmtDateTime(ot.shippedAt) : "—"}
                      </p>
                    </td>
                    <td className="px-4 py-2.5 text-right"><Badge tone="blue">{fmtQty(pending)} u.</Badge></td>
                  </tr>
                ))}
                {inTransit.length === 0 && (<tr><td colSpan={2} className="p-5 text-center text-sm text-slate-500">Aucun flux en transit.</td></tr>)}
              </tbody>
            </table>
          </div>
        </Card>

        <Card>
          <CardHeader
            title="Réceptions fournisseurs attendues"
            subtitle="BC envoyés — rapprochement BL à la réception"
            action={<Link href="/suppliers" className="text-xs text-sky-300 hover:underline">Achats →</Link>}
          />
          <div className="max-h-80 overflow-y-auto">
            <table className="w-full text-sm">
              <tbody className="divide-y divide-slate-800">
                {receptionPending.map((po) => {
                  const late = po.expectedAt.slice(0, 10) < today;
                  return (
                    <tr key={po.id} className="hover:bg-slate-800/40">
                      <td className="px-4 py-2.5">
                        <p className="font-medium text-slate-100">{po.code}</p>
                        <p className="text-xs text-slate-500">
                          {tenant.suppliers.find((sp) => sp.id === po.supplierId)?.name ?? "?"} · {store(po.storeId)?.code} · attendu le {po.expectedAt.slice(0, 10)}
                        </p>
                      </td>
                      <td className="px-4 py-2.5 text-right">
                        {late ? <Badge tone="red">Retard</Badge> : <Badge tone="green">À venir</Badge>}{" "}
                        <Badge tone={po.status === "PARTIALLY_RECEIVED" ? "amber" : "blue"}>
                          {po.status === "PARTIALLY_RECEIVED" ? "Partiel" : "Envoyé"}
                        </Badge>
                      </td>
                    </tr>
                  );
                })}
                {receptionPending.length === 0 && (<tr><td colSpan={2} className="p-5 text-center text-sm text-slate-500">Aucune réception en attente.</td></tr>)}
              </tbody>
            </table>
          </div>
        </Card>

        <Card>
          <CardHeader title="Journal logistique (flux inter-sites & achats)" subtitle="Départs, arrivées, casse en transit" />
          <ul className="divide-y divide-slate-800">
            {lastLogistic.map((m) => (
              <li key={m.id} className="flex items-center justify-between gap-2 px-4 py-2 text-xs">
                <div className="min-w-0">
                  <p className="truncate text-slate-300">{tenant.products.find((p) => p.id === m.productId)?.name ?? "?"}</p>
                  <p className="text-slate-500">
                    {MOVEMENT_LABEL[m.type]} · {tenant.stores.find((s) => s.id === m.storeId)?.code} · {fmtDateTime(m.createdAt)}
                  </p>
                </div>
                <span className={`shrink-0 font-semibold tabular-nums ${["SUPPLIER_IN", "TRANSFER_IN"].includes(m.type) ? "text-emerald-300" : "text-red-300"}`}>
                  {fmtQty(m.quantity)}
                </span>
              </li>
            ))}
            {lastLogistic.length === 0 && (<li className="p-4 text-sm text-slate-500">Aucun flux enregistré.</li>)}
          </ul>
        </Card>
      </div>
    </div>
  );
}
