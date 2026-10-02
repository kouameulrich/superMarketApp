import Link from "next/link";
import { resolveTenant } from "@/lib/tenant";
import { dlcDaysLeft, stockRowsForStore } from "@/lib/stock";
import { fmtMoney, fmtDateTime, MOVEMENT_LABEL, fmtQty } from "@/lib/format";
import { Badge, Bars, Card, CardHeader, StatCard } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const { tenant } = await resolveTenant();

  const today = new Date().toISOString().slice(0, 10);
  const salesToday = tenant.sales.filter((s) => s.createdAt.slice(0, 10) === today);
  const caToday = salesToday.reduce((a, s) => a + (s.status === "RETURNED" ? -s.total : s.total), 0);
  const marginToday = salesToday.filter((s) => s.status === "COMPLETED").reduce((a, s) => a + s.margin, 0);
  const panierMoyen = salesToday.filter((s) => s.status === "COMPLETED").length
    ? caToday / Math.max(1, salesToday.filter((s) => s.status === "COMPLETED").length)
    : 0;

  // CA des 14 derniers jours
  const days: { label: string; value: number }[] = [];
  for (let d = 13; d >= 0; d--) {
    const dt = new Date();
    dt.setDate(dt.getDate() - d);
    const key = dt.toISOString().slice(0, 10);
    const ca = tenant.sales
      .filter((s) => s.createdAt.slice(0, 10) === key)
      .reduce((a, s) => a + (s.status === "RETURNED" ? -s.total : s.total), 0);
    days.push({ label: `${String(dt.getDate()).padStart(2, "0")}/${String(dt.getMonth() + 1).padStart(2, "0")}`, value: ca });
  }

  // Alertes stock (hors hub) & ruptures
  const alerts: { store: string; name: string; qty: number; min: number; kind: string }[] = [];
  for (const store of tenant.stores.filter((s) => !s.isHub)) {
    for (const row of stockRowsForStore(tenant, store.id)) {
      if (row.state !== "OK") {
        alerts.push({
          store: store.code,
          name: row.product.name,
          qty: row.qty,
          min: row.product.minStockLevel,
          kind: row.state,
        });
      }
    }
  }
  const outOfStock = alerts.filter((a) => a.kind === "OUT" || a.kind === "CRITICAL");
  const lowStock = alerts.filter((a) => a.kind === "LOW").length;

  // DLC critiques (< 5 j)
  const dlcAlerts = tenant.batches
    .map((b) => {
      const product = tenant.products.find((p) => p.id === b.productId);
      const store = tenant.stores.find((s) => s.id === b.storeId);
      return { ...b, productName: product?.name ?? "?", storeCode: store?.code ?? "?", days: dlcDaysLeft(b.dlc) };
    })
    .filter((b) => b.days <= 5)
    .sort((a, b) => a.days - b.days)
    .slice(0, 6);

  const openSessions = tenant.cashSessions.filter((c) => c.status === "OPEN");
  const lastMovements = tenant.stockMovements.slice(0, 7);
  const openTransfers = tenant.transferOrders.filter((o) => ["REQUESTED", "APPROVED", "IN_PREPARATION", "SHIPPED", "DISCREPANCY"].includes(o.status));

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-white">Tableau de bord — {tenant.name}</h1>
          <p className="mt-0.5 text-sm text-slate-400">
            Vision multi-sites temps réel · {tenant.stores.filter((s) => !s.isHub).length} magasins + hub · Les données sont isolées par schéma tenant.
          </p>
        </div>
        <div className="flex gap-2">
          <Link href="/pos" className="rounded-lg bg-emerald-500 px-3.5 py-2 text-sm font-semibold text-slate-950 transition hover:bg-emerald-400">
            Ouvrir la caisse
          </Link>
          <Link href="/transfers" className="rounded-lg border border-slate-700 bg-slate-900 px-3.5 py-2 text-sm text-slate-200 transition hover:border-slate-500">
            {openTransfers.length} OT en cours
          </Link>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <StatCard label="CA du jour" value={fmtMoney(caToday)} sub={`${salesToday.length} ticket(s)`} tone="green" />
        <StatCard label="Panier moyen" value={fmtMoney(panierMoyen)} sub="tickets réussis du jour" />
        <StatCard label="Marge brute du jour" value={fmtMoney(marginToday)} sub="sur tickets du jour" tone="violet" />
        <StatCard label="Ruptures critiques" value={String(outOfStock.length)} sub={`${lowStock} article(s) sous seuil`} tone={outOfStock.length ? "red" : "green"} />
        <StatCard label="Lots DLC < 5 j" value={String(dlcAlerts.length)} sub="pertes évitables : -25 %/objectif" tone={dlcAlerts.length ? "amber" : "green"} />
      </div>

      <div className="grid gap-4 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader
            title="Chiffre d'affaires — 14 derniers jours"
            subtitle="Toutes enseignes confondues (net des retours)"
            action={<Badge tone="green">temps réel</Badge>}
          />
          <div className="p-4">
            <Bars data={days} format={(n) => fmtMoney(n)} />
          </div>
        </Card>

        <Card>
          <CardHeader title="Caisses ouvertes" subtitle="Sessions en cours (rapport X disponible)" />
          <div className="divide-y divide-slate-800">
            {openSessions.length === 0 && <p className="p-4 text-sm text-slate-500">Aucune session ouverte.</p>}
            {openSessions.map((s) => {
              const store = tenant.stores.find((st) => st.id === s.storeId);
              const ca = tenant.sales
                .filter((x) => s.ticketNumbers.includes(x.ticketNumber))
                .reduce((a, x) => a + (x.status === "RETURNED" ? -x.total : x.total), 0);
              return (
                <div key={s.id} className="flex items-center justify-between px-4 py-3 text-sm">
                  <div>
                    <p className="font-medium text-slate-200">{store?.name}</p>
                    <p className="text-xs text-slate-500">Ouverte {new Date(s.openedAt).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })} · {s.ticketNumbers.length} tickets</p>
                  </div>
                  <span className="font-semibold tabular-nums text-emerald-300">{fmtMoney(ca)}</span>
                </div>
              );
            })}
          </div>
          <CardHeader title="Derniers mouvements de stock" subtitle="Journal temps réel" />
          <ul className="divide-y divide-slate-800">
            {lastMovements.map((m) => (
              <li key={m.id} className="flex items-center justify-between gap-2 px-4 py-2 text-xs">
                <div className="min-w-0">
                  <p className="truncate text-slate-300">{tenant.products.find((p) => p.id === m.productId)?.name ?? "?"}</p>
                  <p className="text-slate-500">
                    {MOVEMENT_LABEL[m.type]} · {tenant.stores.find((s) => s.id === m.storeId)?.code} · {fmtDateTime(m.createdAt)}
                  </p>
                </div>
                <span className={`shrink-0 font-semibold tabular-nums ${["SUPPLIER_IN", "RETURN_IN", "TRANSFER_IN"].includes(m.type) ? "text-emerald-300" : "text-red-300"}`}>
                  {["SALE_POS", "TRANSFER_OUT", "LOSS_DAMAGE", "LOSS_TRANSIT", "DAMAGE_TRANSIT"].includes(m.type) ? "−" : "+"}
                  {fmtQty(m.quantity)}
                </span>
              </li>
            ))}
          </ul>
        </Card>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader title="Réapprovisionnement requis" subtitle="Seuils mini franchisés (flux tiré / poussé)" action={<Link href="/stock" className="text-xs text-sky-300 hover:underline">Voir le stock →</Link>} />
          <div className="max-h-72 overflow-y-auto">
            <table className="w-full text-sm">
              <tbody className="divide-y divide-slate-800">
                {alerts.slice(0, 10).map((a, i) => (
                  <tr key={i}>
                    <td className="px-4 py-2">
                      <p className="text-slate-200">{a.name}</p>
                      <p className="text-xs text-slate-500">{a.store} · seuil {a.min}</p>
                    </td>
                    <td className="px-4 py-2 text-right">
                      <Badge tone={a.kind === "OUT" ? "red" : a.kind === "CRITICAL" ? "red" : "amber"}>
                        {a.kind === "OUT" ? "Rupture" : a.kind === "CRITICAL" ? "Critique" : "Bas"} · {fmtQty(a.qty)}
                      </Badge>
                    </td>
                  </tr>
                ))}
                {alerts.length === 0 && <tr><td className="p-4 text-sm text-slate-500">Aucun article sous le seuil.</td></tr>}
              </tbody>
            </table>
          </div>
        </Card>

        <Card>
          <CardHeader title="Traçabilité DLC" subtitle="Lots proches de la date limite — alerte visuelle" action={<Link href="/stock" className="text-xs text-sky-300 hover:underline">Gérer les lots →</Link>} />
          <div className="max-h-72 overflow-y-auto">
            <table className="w-full text-sm">
              <tbody className="divide-y divide-slate-800">
                {dlcAlerts.map((b) => (
                  <tr key={b.id}>
                    <td className="px-4 py-2">
                      <p className="text-slate-200">{b.productName}</p>
                      <p className="text-xs text-slate-500">{b.storeCode} · lot {b.batchNumber} · {fmtQty(b.quantity)} en lot</p>
                    </td>
                    <td className="px-4 py-2 text-right">
                      <Badge tone={b.days <= 0 ? "red" : b.days <= 2 ? "red" : "amber"}>
                        {b.days <= 0 ? "Périmé" : `J-${b.days}`}
                      </Badge>
                    </td>
                  </tr>
                ))}
                {dlcAlerts.length === 0 && <tr><td className="p-4 text-sm text-slate-500">Aucun lot critique.</td></tr>}
              </tbody>
            </table>
          </div>
        </Card>
      </div>
      <p className="pb-4 text-center text-[10px] text-slate-600">
        Multi-tenant : les données affichées proviennent exclusivement du schéma « {tenant.slug} » — aucune fuite inter-tenant (PRD §4.1).
      </p>
    </div>
  );
}
