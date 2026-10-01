import { resolveTenant } from "@/lib/tenant";
import { stockOf } from "@/lib/stock";
import { fmtMoney, fmtNum } from "@/lib/format";
import { Badge, Card, CardHeader } from "@/components/ui";
import { ProductsClient } from "@/components/ProductsClient";

export const dynamic = "force-dynamic";

export default async function ProductsPage() {
  const { tenant } = await resolveTenant();

  const rows = tenant.products.map((p) => ({
    ...p,
    marginPct: p.sellingPrice > 0 ? ((p.sellingPrice / (1 + p.vatRate) - p.costPrice) / (p.sellingPrice / (1 + p.vatRate))) * 100 : 0,
    totalStock: tenant.stores.reduce((a, s) => a + stockOf(tenant, s.id, p.id), 0),
    supplierName: tenant.suppliers.find((s) => s.id === p.supplierId)?.name ?? "—",
  }));

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold text-white">Référentiel articles</h1>
        <p className="mt-0.5 text-sm text-slate-400">
          {tenant.products.length} références · codes-barres EAN-13/8 · grille tarifaire, marge et seuil de réapprovisionnement.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Card className="p-4"><p className="text-xs text-slate-400">Références actives</p><p className="mt-1 text-2xl font-semibold text-sky-300">{tenant.products.filter((p) => p.active).length}</p></Card>
        <Card className="p-4"><p className="text-xs text-slate-400">Marge moyenne</p><p className="mt-1 text-2xl font-semibold text-violet-300">{fmtNum(rows.reduce((a, r) => a + r.marginPct, 0) / Math.max(1, rows.length), 1)} %</p></Card>
        <Card className="p-4"><p className="text-xs text-slate-400">Vendus au kilo</p><p className="mt-1 text-2xl font-semibold text-emerald-300">{tenant.products.filter((p) => p.unit === "KG").length}</p></Card>
        <Card className="p-4"><p className="text-xs text-slate-400">Familles (rayons)</p><p className="mt-1 text-2xl font-semibold text-amber-300">{new Set(tenant.products.map((p) => p.category)).size}</p></Card>
      </div>

      <ProductsClient
        products={rows.map((r) => ({
          id: r.id, sku: r.sku, barcode: r.barcode, name: r.name, category: r.category, brand: r.brand,
          costPrice: r.costPrice, vatRate: r.vatRate, sellingPrice: r.sellingPrice, unit: r.unit,
          minStockLevel: r.minStockLevel, supplierId: r.supplierId, active: r.active,
          marginPct: r.marginPct, totalStock: r.totalStock, supplierName: r.supplierName,
        }))}
        suppliers={tenant.suppliers.map((s) => ({ id: s.id, name: s.name }))}
      />

      <Card>
        <CardHeader title="Grille TVA et fiscalité" subtitle="Règles appliquées aux tickets de caisse (PRD §3.1, §6)" />
        <div className="flex flex-wrap gap-2 p-4 text-xs">
          <Badge tone="blue">5,5 % — produits alimentaires</Badge>
          <Badge tone="violet">20 % — hygiène, droguerie, alcools</Badge>
          <Badge tone="neutral">Inaltérabilité des données de caisse garantie par journal horodaté</Badge>
        </div>
      </Card>
    </div>
  );
}
