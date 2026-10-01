import { resolveTenant } from "@/lib/tenant";
import { stockRowsForStore } from "@/lib/stock";
import { fmtDateTime, fmtMoney, fmtNum } from "@/lib/format";
import { Card, CardHeader, POStatusBadge, StatCard } from "@/components/ui";
import { PurchasesClient } from "@/components/PurchasesClient";

export const dynamic = "force-dynamic";

export default async function SuppliersPage() {
  const { tenant } = await resolveTenant();
  const hub = tenant.stores.find((s) => s.isHub);

  const suggestions = hub
    ? stockRowsForStore(tenant, hub.id)
        .filter((r) => r.state !== "OK" && r.state !== "CRITICAL")
        .map((r) => ({ productId: r.product.id, name: r.product.name, sku: r.product.sku, qty: r.qty, suggested: Math.max(10, Math.ceil(r.product.minStockLevel * 1.5 - r.qty)) }))
        .slice(0, 12)
    : [];

  const pos = tenant.purchaseOrders.map((po) => {
    const supplier = tenant.suppliers.find((s) => s.id === po.supplierId);
    const ordered = po.items.reduce((a, i) => a + i.quantityOrdered * i.unitCost, 0);
    const received = po.items.reduce((a, i) => a + i.quantityReceived * i.unitCost, 0);
    return {
      id: po.id,
      code: po.code,
      supplierName: supplier?.name ?? "?",
      status: po.status,
      lines: po.items.length,
      orderedValue: ordered,
      receivedValue: received,
      blNumber: po.blNumber,
      createdAt: fmtDateTime(po.createdAt),
      expectedAt: fmtDateTime(po.expectedAt),
      items: po.items.map((i) => ({
        id: i.id,
        productName: tenant.products.find((p) => p.id === i.productId)?.name ?? "?",
        ordered: i.quantityOrdered,
        alreadyReceived: i.quantityReceived,
        unitCost: i.unitCost,
      })),
    };
  });

  const openValue = pos.filter((p) => ["DRAFT", "SENT"].includes(p.status)).reduce((a, p) => a + p.orderedValue, 0);
  const receptionnee = pos.filter((p) => p.status === "RECEIVED").length;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold text-white">Fournisseurs & Achats</h1>
        <p className="mt-0.5 text-sm text-slate-400">
          Annuaire fournisseurs · bons de commande (manuels ou suggérés) · réceptions avec rapprochement BC/BL et mise à jour automatique des stocks.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Fournisseurs actifs" value={String(tenant.suppliers.length)} sub="conditions & délais négociés" />
        <StatCard label="Commandes en cours" value={String(pos.filter((p) => ["DRAFT", "SENT"].includes(p.status)).length)} sub={`${fmtMoney(openValue)} engagés`} tone="amber" />
        <StatCard label="Réceptions à finaliser" value={String(pos.filter((p) => p.status === "PARTIALLY_RECEIVED").length)} sub="partiellement reçues" tone="red" />
        <StatCard label="Commandes réceptionnées" value={String(receptionnee)} sub="stock hub alimenté" tone="green" />
      </div>

      <Card>
        <CardHeader title="Annuaire fournisseurs" subtitle="Conditions tarifaires, délais de livraison et modes de règlement" />
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-sm">
            <thead className="text-left text-[11px] uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-2.5">Code</th>
                <th className="px-2 py-2.5">Fournisseur</th>
                <th className="px-2 py-2.5">Contact</th>
                <th className="px-2 py-2.5 text-right">Délai</th>
                <th className="px-2 py-2.5">Règlement</th>
                <th className="px-2 py-2.5 text-right">Articles référencés</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800">
              {tenant.suppliers.map((s) => (
                <tr key={s.id} className="hover:bg-slate-800/40">
                  <td className="px-4 py-2.5 font-mono text-xs text-slate-300">{s.code}</td>
                  <td className="px-2 py-2.5 font-medium text-slate-100">{s.name}</td>
                  <td className="px-2 py-2.5 text-xs text-slate-400">{s.email} · {s.phone}</td>
                  <td className="px-2 py-2.5 text-right tabular-nums text-slate-300">{s.leadTimeDays} j</td>
                  <td className="px-2 py-2.5 text-slate-300">{s.paymentTerms}</td>
                  <td className="px-2 py-2.5 text-right tabular-nums text-slate-300">{fmtNum(tenant.products.filter((p) => p.supplierId === s.id).length)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <PurchasesClient pos={pos} suppliers={tenant.suppliers.map((s) => ({ id: s.id, name: s.name }))} allProducts={tenant.products.map((p) => ({ id: p.id, name: p.name, cost: p.costPrice }))} suggestions={suggestions} />
    </div>
  );
}
