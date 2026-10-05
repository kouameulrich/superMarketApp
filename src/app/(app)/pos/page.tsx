import { resolveTenant, guardRoles } from "@/lib/tenant";
import { stockOf } from "@/lib/stock";
import { PosClient } from "@/components/pos/PosClient";

export const dynamic = "force-dynamic";

export default async function PosPage() {
  const { tenant, session } = await resolveTenant();
  // Le gestionnaire de stock n'a pas accès à la caisse
  guardRoles(session.role, ["CASHIER", "ADMIN", "SUPER_ADMIN"]);
  const canApproveReturns = ["ADMIN", "SUPER_ADMIN"].includes(session.role);

  const products = tenant.products
    .filter((p) => p.active)
    .map((p) => ({
      id: p.id,
      sku: p.sku,
      barcode: p.barcode,
      name: p.name,
      category: p.category,
      brand: p.brand,
      price: p.sellingPrice,
      vatRate: p.vatRate,
      unit: p.unit,
    }));

  const stockMap: Record<string, Record<string, number>> = {};
  for (const store of tenant.stores) {
    stockMap[store.id] = {};
    for (const p of tenant.products) stockMap[store.id][p.id] = stockOf(tenant, store.id, p.id);
  }

  return (
    <PosClient
      tenantName={tenant.name}
      products={products}
      stores={tenant.stores.map((s) => ({ id: s.id, code: s.code, name: s.name, isHub: s.isHub }))}
      stockMap={stockMap}
      canApproveReturns={canApproveReturns}
    />
  );
}
