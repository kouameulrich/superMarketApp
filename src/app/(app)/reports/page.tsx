import { resolveTenant, guardRoles } from "@/lib/tenant";
import { fmtMoney, fmtDateTime, fmtNum, PAYMENT_LABEL, CASH_GAP_JUSTIFICATION_THRESHOLD } from "@/lib/format";
import { Badge, Bars, Card, CardHeader, StatCard } from "@/components/ui";
import { SessionCloser } from "@/components/SessionCloser";
import { CsvButton } from "@/components/CsvButton";

export const dynamic = "force-dynamic";

export default async function ReportsPage() {
  const { tenant, session } = await resolveTenant();
  guardRoles(session.role, ["ADMIN", "SUPER_ADMIN"]);
  const store = (id: string) => tenant.stores.find((s) => s.id === id);

  const completed = tenant.sales.filter((s) => s.status === "COMPLETED");
  const returns = tenant.sales.filter((s) => s.status === "RETURNED");
  const caTotal = completed.reduce((a, s) => a + s.total, 0) - returns.reduce((a, s) => a + s.total, 0);
  const marginTotal = completed.reduce((a, s) => a + s.margin, 0);
  const txCount = completed.length;

  // CA par magasin
  const byStore = tenant.stores
    .filter((s) => !s.isHub)
    .map((s) => ({
      label: s.code,
      value: completed.filter((x) => x.storeId === s.id).reduce((a, x) => a + x.total, 0),
    }));

  // Top ventes (30 j)
  const limit30 = Date.now() - 30 * 86400000;
  const topSales = Object.values(
    tenant.sales
      .filter((s) => s.status === "COMPLETED" && new Date(s.createdAt).getTime() >= limit30)
      .flatMap((s) => s.items)
      .reduce<Record<string, { name: string; qty: number; ca: number; margin: number }>>((acc, it) => {
        acc[it.productId] ??= { name: it.name, qty: 0, ca: 0, margin: 0 };
        acc[it.productId].qty += it.quantity;
        acc[it.productId].ca += it.quantity * it.unitPrice;
        acc[it.productId].margin += it.quantity * (it.unitPrice / (1 + it.vatRate) - it.costPrice);
        return acc;
      }, {}),
  )
    .sort((a, b) => b.ca - a.ca)
    .slice(0, 8);

  // Heures de pointe
  const byHour = Array.from({ length: 24 }, (_, h) => ({
    label: `${String(h).padStart(2, "0")}h`,
    value: completed.filter((s) => new Date(s.createdAt).getHours() === h).reduce((a, s) => a + s.total, 0),
  })).filter((x) => x.value > 0);

  // Répartition par mode de paiement
  const byMethod = ["CASH", "CARD", "MOBILE_MONEY", "VOUCHER"].map((m) => ({
    method: m,
    count: completed.filter((s) => s.payments[0]?.method === m).length,
    amount: completed.filter((s) => s.payments[0]?.method === m).reduce((a, s) => a + s.payments[0].amount, 0),
  }));

  // Sessions X / Z
  const openSessions = tenant.cashSessions.filter((c) => c.status === "OPEN");
  const closedSessions = tenant.cashSessions
    .filter((c) => c.status === "CLOSED")
    .sort((a, b) => (b.closedAt ?? "").localeCompare(a.closedAt ?? ""));

  const reportRows = closedSessions.map((c) => {
    const sales = tenant.sales.filter((s) => c.ticketNumbers.includes(s.ticketNumber));
    const cashExpected =
      c.openingFloat +
      sales
        .filter((s) => s.status === "COMPLETED" && s.payments.some((p) => p.method === "CASH"))
        .reduce((a, s) => a + s.payments[0].amount - s.change, 0) -
      sales.filter((s) => s.status === "RETURNED").reduce((a, s) => a + s.total, 0);
    return {
      id: c.id,
      storeCode: store(c.storeId)?.code ?? "?",
      openedAt: fmtDateTime(c.openedAt),
      closedAt: c.closedAt ? fmtDateTime(c.closedAt) : "—",
      tickets: c.ticketNumbers.length,
      expected: cashExpected,
      counted: c.countedCash ?? 0,
      gap: (c.countedCash ?? 0) - cashExpected,
    };
  });

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold text-white">Rapports & Analytics</h1>
        <p className="mt-0.5 text-sm text-slate-400">
          CA multi-sites, heures de pointe, marges, rapports de caisse X (intermédiaire) et Z (fin de journée) — exports CSV / Excel.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="CA cumulé (14 j)" value={fmtMoney(caTotal)} sub={`${txCount} tickets · ${returns.length} retour(s)`} tone="green" />
        <StatCard label="Marge brute cumulée" value={fmtMoney(marginTotal)} sub={`${fmtNum((marginTotal / Math.max(1, caTotal)) * 100, 1)} % du CA`} tone="violet" />
        <StatCard label="Sessions de caisse" value={String(openSessions.length)} sub="ouvertes à l'instant" tone="blue" />
        <StatCard label="Écarts de caisse" value={fmtNum(reportRows.reduce((a, r) => a + Math.abs(r.gap), 0)) + " FCFA"} sub="absolu, sur sessions closes" tone={reportRows.some((r) => Math.abs(r.gap) > CASH_GAP_JUSTIFICATION_THRESHOLD) ? "red" : "green"} />
      </div>

      <div className="grid gap-4 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader title="CA par établissement" subtitle="Tickets réussis, 14 derniers jours" />
          <div className="p-4">
            <Bars data={byStore} format={(n) => fmtMoney(n)} />
          </div>
        </Card>
        <Card>
          <CardHeader
            title="Modes de paiement"
            subtitle="Multimode : espèces, CB, Mobile Money, bon d'achat"
            action={
              <CsvButton
                filename={`modes-paiement-${new Date().toISOString().slice(0, 10)}`}
                headers={["Mode de paiement", "Nombre", "Montant FCFA"]}
                rows={byMethod.map((m) => [PAYMENT_LABEL[m.method], m.count, m.amount])}
              />
            }
          />
          <div className="space-y-2 p-4">
            {byMethod.map((m) => (
              <div key={m.method} className="flex items-center justify-between rounded-lg bg-slate-950/60 px-3 py-2 text-sm">
                <span className="text-slate-300">{PAYMENT_LABEL[m.method]}</span>
                <span className="text-xs text-slate-500">{m.count} occ.</span>
                <span className="tabular-nums font-semibold text-slate-100">{fmtMoney(m.amount)}</span>
              </div>
            ))}
          </div>
        </Card>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader
            title="Top ventes (30 jours)"
            subtitle="CA TTC et marge par article"
            action={
              <CsvButton
                filename={`top-ventes-${new Date().toISOString().slice(0, 10)}`}
                headers={["Article", "Quantité", "CA TTC FCFA", "Marge FCFA"]}
                rows={topSales.map((t) => [t.name, t.qty, t.ca, t.margin])}
              />
            }
          />
          <table className="w-full text-sm">
            <tbody className="divide-y divide-slate-800">
              {topSales.map((t, i) => (
                <tr key={i}>
                  <td className="px-4 py-2 text-slate-200">{t.name}</td>
                  <td className="px-2 py-2 text-right tabular-nums text-slate-400">{fmtNum(t.qty, 1)} u.</td>
                  <td className="px-2 py-2 text-right font-semibold tabular-nums text-emerald-300">{fmtMoney(t.ca)}</td>
                  <td className="px-2 py-2 text-right tabular-nums text-violet-300">{fmtMoney(t.margin)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
        <Card>
          <CardHeader title="Heures de pointe" subtitle="Répartition du CA par heure de passage" />
          <div className="p-4">
            <Bars data={byHour} height={140} format={(n) => fmtMoney(n)} />
          </div>
        </Card>
      </div>

      <Card>
        <CardHeader
          title="Rapport X — sessions en cours"
          subtitle="Rapport intermédiaire : espèces théoriques attendues avant clôture"
          action={<Badge tone="blue">rapport X</Badge>}
        />
        <div className="grid gap-3 p-4 md:grid-cols-2">
          {openSessions.map((s) => {
            const cashRows = tenant.sales.filter((x) => s.ticketNumbers.includes(x.ticketNumber));
            const expected =
              s.openingFloat +
              cashRows.filter((x) => x.status === "COMPLETED" && x.payments.some((p) => p.method === "CASH")).reduce((a, x) => a + x.payments[0].amount - x.change, 0) -
              cashRows.filter((x) => x.status === "RETURNED").reduce((a, x) => a + x.total, 0);
            const ca = cashRows.reduce((a, x) => a + (x.status === "RETURNED" ? -x.total : x.total), 0);
            return (
              <div key={s.id} className="rounded-lg border border-slate-800 bg-slate-950/50 p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="font-semibold text-slate-100">{store(s.storeId)?.name}</p>
                    <p className="text-xs text-slate-500">Ouverte le {fmtDateTime(s.openedAt)} · {s.ticketNumbers.length} tickets</p>
                  </div>
                  <Badge tone="green">ouverte</Badge>
                </div>
                <dl className="mt-3 space-y-1 text-sm">
                  <div className="flex justify-between"><dt className="text-slate-400">Fond de caisse</dt><dd className="tabular-nums text-slate-200">{fmtMoney(s.openingFloat)}</dd></div>
                  <div className="flex justify-between"><dt className="text-slate-400">CA cumulé session</dt><dd className="tabular-nums text-emerald-300">{fmtMoney(ca)}</dd></div>
                  <div className="flex justify-between font-semibold"><dt className="text-slate-300">Espèces attendues</dt><dd className="tabular-nums text-amber-300">{fmtMoney(expected)}</dd></div>
                </dl>
                <SessionCloser storeId={s.storeId} storeName={store(s.storeId)?.name ?? ""} expected={expected} />
              </div>
            );
          })}
          {openSessions.length === 0 && <p className="text-sm text-slate-500">Aucune session ouverte — faites des ventes via le POS.</p>}
        </div>
      </Card>

      <Card>
        <CardHeader
          title="Rapport Z — historique des clôtures"
          subtitle="Contrôle des écarts (comptage physique vs théorique). Un écart >5 000 FCFA exige une justification."
          action={
            <CsvButton
              filename={`rapport-z-${new Date().toISOString().slice(0, 10)}`}
              headers={["Magasin", "Ouverture", "Clôture", "Tickets", "Théorique FCFA", "Compté FCFA", "Écart FCFA"]}
              rows={reportRows.map((r) => [r.storeCode, r.openedAt, r.closedAt, r.tickets, r.expected, r.counted, r.gap])}
            />
          }
        />
        <div className="max-h-[40vh] overflow-auto">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-slate-900 text-left text-[11px] uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-2.5">Magasin</th>
                <th className="px-2 py-2.5">Ouverture</th>
                <th className="px-2 py-2.5">Clôture</th>
                <th className="px-2 py-2.5 text-center">Tickets</th>
                <th className="px-2 py-2.5 text-right">Théorique</th>
                <th className="px-2 py-2.5 text-right">Compté</th>
                <th className="px-2 py-2.5 text-right">Écart</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800">
              {reportRows.map((r) => (
                <tr key={r.id} className="hover:bg-slate-800/40">
                  <td className="px-4 py-2.5 text-slate-200">{r.storeCode}</td>
                  <td className="px-2 py-2.5 text-xs text-slate-400">{r.openedAt}</td>
                  <td className="px-2 py-2.5 text-xs text-slate-400">{r.closedAt}</td>
                  <td className="px-2 py-2.5 text-center tabular-nums text-slate-300">{r.tickets}</td>
                  <td className="px-2 py-2.5 text-right tabular-nums text-slate-300">{fmtMoney(r.expected)}</td>
                  <td className="px-2 py-2.5 text-right tabular-nums text-slate-200">{fmtMoney(r.counted)}</td>
                  <td className={`px-2 py-2.5 text-right font-semibold tabular-nums ${Math.abs(r.gap) > CASH_GAP_JUSTIFICATION_THRESHOLD ? "text-red-300" : "text-emerald-300"}`}>
                    {r.gap > 0 ? "+" : ""}{fmtMoney(r.gap)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
      <p className="pb-4 text-[10px] text-slate-600">
        Conformité fiscale (inaltérabilité) : aucun ticket n&apos;est modifiable après encaissement ; seule une note de retour horodatée est permise.
        Les données peuvent être exportées en CSV directement depuis les tableaux.
      </p>
    </div>
  );
}
