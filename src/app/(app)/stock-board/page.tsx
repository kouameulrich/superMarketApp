import Link from "next/link";
import { resolveTenant, guardRoles } from "@/lib/tenant";
import { dlcDaysLeft, damageOf, stockOf, stockRowsForStore, replenishmentSuggestions, transferTransitRows } from "@/lib/stock";
import { fmtQty, fmtDateTime, MOVEMENT_LABEL } from "@/lib/format";
import { Badge, Bars, Card, CardHeader, StatCard } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function StockBoardPage() {
  const { tenant, session } = await resolveTenant();
  guardRoles(session.role, ["STOCK", "LOGISTICS", "ADMIN", "SUPER_ADMIN"]);

  const shops = tenant.stores.filter((s) => !s.isHub);
  const hub = tenant.stores.find((s) => s.isHub);

  // État de stock par magasin (hors hub)
  const perStore = shops.map((st) => ({ store: st, rows: stockRowsForStore(tenant, st.id) }));
  const flat = perStore.flatMap((ps) => ps.rows.map((r) => ({ store: ps.store, ...r })));
  const ruptures = flat.filter((r) => r.state === "OUT");
  const critiques = flat.filter((r) => r.state === "CRITICAL");
  const lows = flat.filter((r) => r.state === "LOW");

  // Top articles en tension (multi-magasins), regroupés par produit
  const tensionMap = new Map<string, {
    id: string; name: string; sku: string; min: number;
    perStore: { code: string; qty: number; state: string }[];
    total: number;
    worst: string;
  }>();
  for (const r of flat) {
    if (r.state === "OK") continue;
    const entry = tensionMap.get(r.product.id) ?? {
      id: r.product.id, name: r.product.name, sku: r.product.sku, min: r.product.minStockLevel,
      perStore: [], total: 0, worst: r.state,
    };
    entry.perStore.push({ code: r.store.code, qty: r.qty, state: r.state });
    entry.total += r.qty;
    if (r.state === "OUT") entry.worst = "OUT";
    else if (r.state === "CRITICAL" && entry.worst !== "OUT") entry.worst = "CRITICAL";
    tensionMap.set(r.product.id, entry);
  }
  const tensions = [...tensionMap.values()]
    .sort((a, b) => (a.worst === "OUT" ? -1 : b.worst === "OUT" ? 1 : a.worst === "CRITICAL" ? -1 : b.worst === "CRITICAL" ? 1 : 0) || b.total - a.total)
    .slice(0, 12);
  const transitByProduct = new Map<string, number>();
  for (const st of tenant.stores) {
    for (const p of tenant.products) {
      const tr = ((): number => {
        let qty = 0;
        for (const ot of tenant.transferOrders) {
          if (ot.status !== "SHIPPED" || ot.destinationStoreId !== st.id) continue;
          for (const it of ot.items) if (it.productId === p.id) qty += it.quantityShipped - it.quantityReceived - it.quantityDamaged;
        }
        return Math.max(0, qty);
      })();
      if (tr > 0) transitByProduct.set(p.id, (transitByProduct.get(p.id) ?? 0) + tr);
    }
  }

  // DLC : expirés puis ≤ 7 j
  const dlcRows = tenant.batches
    .map((b) => {
      const product = tenant.products.find((p) => p.id === b.productId);
      const store = tenant.stores.find((s) => s.id === b.storeId);
      return { ...b, productName: product?.name ?? "?", storeCode: store?.code ?? "?", days: dlcDaysLeft(b.dlc) };
    })
    .filter((b) => b.days <= 7)
    .sort((a, b) => a.days - b.days);
  const expired = dlcRows.filter((b) => b.days < 0);
  const expiring = dlcRows.filter((b) => b.days >= 0);

  // Zones casse / avarie (stock immobilisé)
  let damageTotal = 0;
  for (const s of tenant.stores) {
    for (const p of tenant.products) damageTotal += damageOf(tenant, s.id, p.id);
  }

  // Transferts en vol
  const inTransit = transferTransitRows(tenant);
  const toHandle = tenant.transferOrders
    .filter((o) => ["REQUESTED", "APPROVED", "IN_PREPARATION", "DISCREPANCY"].includes(o.status))
    .sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? ""));
  const awaitingReceptionQty = inTransit.reduce((a, x) => a + x.pending, 0);

  // Suggestions flux tiré
  const suggestions = shops
    .flatMap((st) =>
      replenishmentSuggestions(tenant, st.id, hub?.id ?? st.id).map((sg) => ({
        store: st.code, product: sg.product, qty: sg.qty, suggested: sg.suggested,
      })),
    )
    .slice(0, 8);

  // Volumétrie stock par magasin
  const storeChart = shops.map((st) => ({
    label: st.code,
    value: Math.round(tenant.products.reduce((a, p) => a + Math.max(0, stockOf(tenant, st.id, p.id)), 0)),
  }));
  const lastMovements = tenant.stockMovements.slice(0, 8);

  const statusBadge = (s: string) => (s === "OUT" ? "red" : s === "CRITICAL" ? "red" : s === "LOW" ? "amber" : "green");

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-white">Tableau de bord Stock — {tenant.name}</h1>
          <p className="mt-0.5 text-sm text-slate-400">
            Vue dédiée au gestionnaire de stock : ruptures, seuils, DLC, transit & casse — {shops.length} magasins + {hub ? "1 hub" : "aucun hub"}.
          </p>
        </div>
        <div className="flex gap-2">
          <Link href="/stock" className="rounded-lg bg-emerald-500 px-3.5 py-2 text-sm font-semibold text-slate-950 transition hover:bg-emerald-400">
            Gérer le stock
          </Link>
          <Link href="/transfers" className="rounded-lg border border-slate-700 bg-slate-900 px-3.5 py-2 text-sm text-slate-200 transition hover:border-slate-500">
            {toHandle.length + inTransit.length} OT à traiter
          </Link>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <StatCard label="Ruptures (magasins)" value={String(ruptures.length)} sub="article × magasin à zéro" tone={ruptures.length ? "red" : "green"} />
        <StatCard label="Critiques" value={String(critiques.length)} sub={`+ ${lows.length} sous seuil`} tone={critiques.length ? "amber" : "green"} />
        <StatCard label="Lots DLC ≤ 7 j" value={String(expiring.length)} sub={expired.length ? `${expired.length} lot(s) PÉRMÉ(s) à évacuer` : "aucun expiré"} tone={expired.length ? "red" : expiring.length ? "amber" : "green"} />
        <StatCard label="En transit (attente réception)" value={fmtQty(awaitingReceptionQty)} sub={`${inTransit.length} OT expédié(s)`} tone="blue" />
        <StatCard label="Zone casse / avarie" value={fmtQty(damageTotal)} sub="units immobilisées" tone={damageTotal ? "violet" : "green"} />
      </div>

      <div className="grid gap-4 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader
            title="Articles en tension — multi-magasins"
            subtitle="Ruptures, critiques et sous-seuils : le hub doit alimenter (flux tiré)"
            action={<Link href="/stock" className="text-xs text-sky-300 hover:underline">Stock détaillé →</Link>}
          />
          <div className="max-h-[420px] overflow-y-auto">
            <table className="w-full text-sm">
              <tbody className="divide-y divide-slate-800">
                {tensions.map((t) => (
                  <tr key={t.sku} className="hover:bg-slate-800/40">
                    <td className="px-4 py-2.5">
                      <p className="text-slate-100">{t.name}</p>
                      <p className="text-xs text-slate-500">{t.sku} · seuil {t.min}</p>
                    </td>
                    <td className="px-2 py-2.5">
                      <div className="flex flex-wrap gap-1">
                        {t.perStore.map((ps) => (
                          <span key={ps.code} className={`rounded px-1.5 py-0.5 text-[10px] tabular-nums ${
                            ps.state === "OUT" ? "bg-red-950 text-red-300" : ps.state === "CRITICAL" ? "bg-orange-950 text-orange-300" : "bg-amber-950 text-amber-300"
                          }`}>
                            {ps.code} {fmtQty(ps.qty)}
                          </span>
                        ))}
                      </div>
                    </td>
                    <td className="px-2 py-2.5 text-right">
                      {transitByProduct.get(t.id) ? (
                        <Badge tone="blue">en cong. {fmtQty(transitByProduct.get(t.id)!)}</Badge>
                      ) : (
                        <span className="text-xs text-slate-600">—</span>
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      <Badge tone={statusBadge(t.worst)}>{t.worst === "OUT" ? "Rupture" : t.worst === "CRITICAL" ? "Critique" : "Bas"}</Badge>
                    </td>
                  </tr>
                ))}
                {tensions.length === 0 && (
                  <tr><td colSpan={4} className="p-5 text-center text-sm text-slate-500">Tous les niveaux sont au vert — aucun écart au seuil.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </Card>

        <Card>
          <CardHeader title="Traçabilité DLC" subtitle="À consommer en priorité (FIFO)" action={<Link href="/stock" className="text-xs text-sky-300 hover:underline">Lots →</Link>} />
          <div className="max-h-80 overflow-y-auto">
            <table className="w-full text-sm">
              <tbody className="divide-y divide-slate-800">
                {[...expired, ...expiring].map((b) => (
                  <tr key={b.id}>
                    <td className="px-4 py-2">
                      <p className="text-slate-200">{b.productName}</p>
                      <p className="text-xs text-slate-500">{b.storeCode} · lot {b.batchNumber} · {fmtQty(b.quantity)}</p>
                    </td>
                    <td className="px-2 py-2 text-right">
                      <Badge tone={b.days < 0 ? "red" : b.days <= 2 ? "red" : "amber"}>
                        {b.days < 0 ? `Périmé J+${Math.abs(b.days)}` : b.days === 0 ? "Aujourd'hui" : `J-${b.days}`}
                      </Badge>
                    </td>
                  </tr>
                ))}
                {dlcRows.length === 0 && (<tr><td className="p-4 text-sm text-slate-500">Aucun lot sous 7 jours.</td></tr>)}
              </tbody>
            </table>
          </div>
        </Card>
      </div>

      <div className="grid gap-4 xl:grid-cols-3">
        <Card>
          <CardHeader title="Suggestions de réappro (flux tiré)" subtitle="Hub → magasins sous seuil" action={<Link href="/transfers" className="text-xs text-sky-300 hover:underline">Créer un OT →</Link>} />
          <div className="max-h-72 overflow-y-auto">
            <table className="w-full text-sm">
              <tbody className="divide-y divide-slate-800">
                {suggestions.map((sg, i) => (
                  <tr key={i}>
                    <td className="px-4 py-2">
                      <p className="text-slate-200">{sg.product.name}</p>
                      <p className="text-xs text-slate-500">{sg.store} · actuel {fmtQty(sg.qty)}</p>
                    </td>
                    <td className="px-4 py-2 text-right font-semibold tabular-nums text-emerald-300">+{fmtQty(sg.suggested)}</td>
                  </tr>
                ))}
                {suggestions.length === 0 && (<tr><td className="p-4 text-sm text-slate-500">Aucune suggestion (hub couvert).</td></tr>)}
              </tbody>
            </table>
          </div>
        </Card>

        <Card>
          <CardHeader title="Volumes stockés par magasin" subtitle="Unités disponibles (hors hub)" />
          <div className="p-4">
            <Bars data={storeChart} format={(n) => fmtQty(n)} />
          </div>
        </Card>

        <Card>
          <CardHeader title="Journal des derniers mouvements" subtitle="Traçabilité temps réel" />
          <ul className="divide-y divide-slate-800">
            {lastMovements.map((m) => (
              <li key={m.id} className="flex items-center justify-between gap-2 px-4 py-2 text-xs">
                <div className="min-w-0">
                  <p className="truncate text-slate-300">{tenant.products.find((p) => p.id === m.productId)?.name ?? "?"}</p>
                  <p className="text-slate-500">
                    {MOVEMENT_LABEL[m.type]} · {tenant.stores.find((s) => s.id === m.storeId)?.code} · {fmtDateTime(m.createdAt)}
                  </p>
                </div>
                <span className={`shrink-0 font-semibold tabular-nums ${["SUPPLIER_IN", "RETURN_IN", "TRANSFER_IN"].includes(m.type) ? "text-emerald-300" : m.type === "INVENTORY_ADJUST" && m.quantity < 0 ? "text-red-300" : m.type === "INVENTORY_ADJUST" ? "text-emerald-300" : "text-red-300"}`}>
                  {m.type === "INVENTORY_ADJUST" ? (m.quantity < 0 ? "" : "+") : ["SALE_POS", "TRANSFER_OUT", "LOSS_DAMAGE", "LOSS_TRANSIT", "DAMAGE_TRANSIT"].includes(m.type) ? "−" : "+"}
                  {fmtQty(Math.abs(m.quantity))}
                </span>
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </div>
  );
}
