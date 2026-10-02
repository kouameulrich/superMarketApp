import { resolveTenant, guardRoles } from "@/lib/tenant";
import { stockRowsForStore, movementsFor, dlcDaysLeft, transitOf } from "@/lib/stock";
import { fmtMoney, fmtDateTime, fmtQty, MOVEMENT_LABEL } from "@/lib/format";
import { Badge, Card, CardHeader, StatCard } from "@/components/ui";
import { StockClient } from "@/components/StockClient";

export const dynamic = "force-dynamic";

export default async function StockPage() {
  const { tenant, session } = await resolveTenant();
  guardRoles(session.role, ["STOCK", "LOGISTICS", "ADMIN", "SUPER_ADMIN"]);
  const defaultStore = tenant.stores.find((s) => !s.isHub) ?? tenant.stores[0];

  const rows = stockRowsForStore(tenant, defaultStore.id).map((r) => ({
    productId: r.product.id,
    sku: r.product.sku,
    name: r.product.name,
    category: r.product.category,
    unit: r.product.unit,
    qty: r.qty,
    transit: r.transit,
    min: r.product.minStockLevel,
    state: r.state,
  }));

  const hub = tenant.stores.find((s) => s.isHub);
  const hubRows = hub ? stockRowsForStore(tenant, hub.id) : [];

  const movements = movementsFor(tenant, { storeId: defaultStore.id, limit: 25 }).map((m) => ({
    id: m.id,
    date: fmtDateTime(m.createdAt),
    type: m.type,
    typeLabel: MOVEMENT_LABEL[m.type],
    ref: m.reference,
    note: m.note ?? "",
    productName: tenant.products.find((p) => p.id === m.productId)?.name ?? "?",
    qty: m.quantity,
  }));

  const batches = tenant.batches
    .filter((b) => b.storeId === defaultStore.id)
    .map((b) => ({
      id: b.id,
      productName: tenant.products.find((p) => p.id === b.productId)?.name ?? "?",
      batchNumber: b.batchNumber,
      dlc: b.dlc,
      days: dlcDaysLeft(b.dlc),
      quantity: b.quantity,
    }))
    .sort((a, b) => a.days - b.days);

  // Emplacements virtuels
  const virtualRows = tenant.products
    .map((p) => ({
      name: p.name,
      transit: transitOf(tenant, defaultStore.id, p.id),
      avarie: tenant.stockMovements
        .filter((m) => m.storeId === defaultStore.id && m.productId === p.id && m.type === "DAMAGE_TRANSIT")
        .reduce((a, m) => a + m.quantity, 0),
    }))
    .filter((r) => r.transit > 0 || r.avarie > 0);

  const stockValue = rows.reduce((a, r) => {
    const prod = tenant.products.find((p) => p.id === r.productId);
    return a + (prod ? r.qty * prod.costPrice : 0);
  }, 0);
  const lossValue = tenant.stockMovements
    .filter((m) => m.storeId === defaultStore.id && (m.type === "LOSS_DAMAGE" || m.type === "LOSS_TRANSIT" || m.type === "DAMAGE_TRANSIT"))
    .reduce((a, m) => a + m.quantity * (tenant.products.find((p) => p.id === m.productId)?.costPrice ?? 0), 0);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold text-white">Stocks, DLC & mouvements</h1>
        <p className="mt-0.5 text-sm text-slate-400">
          Journal temps réel · seuils de réapprovisionnement · traçabilité des lots (DLC) · emplacements virtuels (transit, avarie).
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Valeur du stock (PA HT)" value={fmtMoney(stockValue)} sub={defaultStore.name} tone="green" />
        <StatCard label="Pertes & casse cumulées" value={fmtMoney(lossValue)} sub="objectif : −25 % de pertes" tone="red" />
        <StatCard
          label="Articles à réappro"
          value={String(rows.filter((r) => r.state !== "OK").length)}
          sub="sous le seuil minimum"
          tone="amber"
        />
        <StatCard
          label="Lots DLC < 5 j"
          value={String(batches.filter((b) => b.days <= 5).length)}
          sub="sur ce magasin"
          tone="violet"
        />
      </div>

      <div className="grid gap-4 xl:grid-cols-3">
        <div className="xl:col-span-2">
          <StockClient
            stores={tenant.stores.map((s) => ({ id: s.id, code: s.code, name: s.name, isHub: s.isHub }))}
            initialStoreId={defaultStore.id}
            rows={rows}
            movements={movements}
            batches={batches}
            virtualRows={virtualRows}
            hubStock={hubRows.reduce<Record<string, number>>((acc, r) => ({ ...acc, [r.product.id]: r.qty }), {})}
          />
        </div>

        <div className="space-y-4">
          <Card>
            <CardHeader title="Hub logistique — disponibilité" subtitle={hub?.name ?? "Aucun hub"} />
            <div className="max-h-56 overflow-y-auto p-2">
              <table className="w-full text-xs">
                <tbody className="divide-y divide-slate-800">
                  {hubRows.slice(0, 12).map((r) => (
                    <tr key={r.product.id}>
                      <td className="px-2 py-1.5 text-slate-300">{r.product.name}</td>
                      <td className={`px-2 py-1.5 text-right font-semibold tabular-nums ${r.state === "OK" ? "text-emerald-300" : "text-amber-300"}`}>{fmtQty(r.qty)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>

          <Card>
            <CardHeader title="Aide-mémoire workflow OT" subtitle="Chaîne logistique inter-magasins (PRD §3.3)" />
            <ol className="space-y-2 p-4 text-xs text-slate-400">
              <li><span className="font-semibold text-slate-200">1. Demande</span> — magasin sous seuil → OT <Badge tone="blue">DEMANDÉ</Badge></li>
              <li><span className="font-semibold text-slate-200">2. Validation</span> — hub vérifie la dispo → <Badge tone="violet">VALIDÉ</Badge> puis préparation</li>
              <li><span className="font-semibold text-slate-200">3. Expédition</span> — débit source, crédit <Badge tone="blue">In-Transit</Badge>, bordereau QR</li>
              <li><span className="font-semibold text-slate-200">4. Réception</span> — scan PDA, contrôle quantités, écarts imputés</li>
            </ol>
          </Card>
        </div>
      </div>
    </div>
  );
}
