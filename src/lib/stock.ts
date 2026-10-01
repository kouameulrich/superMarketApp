import type { Product, StockMovement, Tenant, TransferOrder, UUID } from "./types";

const IN_TYPES = new Set(["SUPPLIER_IN", "RETURN_IN", "TRANSFER_IN"]);
const OUT_TYPES = new Set(["SALE_POS", "TRANSFER_OUT", "LOSS_DAMAGE"]);

/** Niveau de stock disponible d'un produit dans un magasin (dérivé du journal). */
export function stockOf(t: Tenant, storeId: UUID, productId: UUID): number {
  let qty = 0;
  for (const m of t.stockMovements) {
    if (m.storeId !== storeId || m.productId !== productId) continue;
    if (IN_TYPES.has(m.type)) qty += m.quantity;
    else if (OUT_TYPES.has(m.type)) qty -= m.quantity;
    else if (m.type === "INVENTORY_ADJUST") qty += m.quantity; // signé : + ajout, − retrait
  }
  return Math.round(qty * 1000) / 1000;
}

/** Quantité en transit vers un magasin (entrée virtuelle In-Transit). */
export function transitOf(t: Tenant, destinationStoreId: UUID, productId: UUID): number {
  let qty = 0;
  for (const ot of t.transferOrders) {
    if (ot.status !== "SHIPPED" || ot.destinationStoreId !== destinationStoreId) continue;
    for (const it of ot.items) {
      if (it.productId !== productId) continue;
      qty += it.quantityShipped - it.quantityReceived - it.quantityDamaged;
    }
  }
  return Math.max(0, Math.round(qty * 1000) / 1000);
}

/** Zone virtuelle Avarie / Casse (stock immobilisé). */
export function damageOf(t: Tenant, storeId: UUID, productId: UUID): number {
  return t.stockMovements
    .filter((m) => m.storeId === storeId && m.productId === productId && m.type === "DAMAGE_TRANSIT")
    .reduce((acc, m) => acc + m.quantity, 0);
}

export type StockState = "OUT" | "CRITICAL" | "LOW" | "OK";

export function stockState(product: Product, qty: number): StockState {
  if (qty <= 0) return "OUT";
  if (qty <= product.minStockLevel * 0.25) return "CRITICAL";
  if (qty <= product.minStockLevel) return "LOW";
  return "OK";
}

/** DLC : jours restants avant péremption d'un lot. */
export function dlcDaysLeft(dlc: string, now = new Date()): number {
  const d = new Date(`${dlc}T00:00:00`);
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  return Math.round((d.getTime() - today.getTime()) / 86400000);
}

export interface StockRow {
  product: Product;
  qty: number;
  transit: number;
  state: StockState;
}

export function stockRowsForStore(t: Tenant, storeId: UUID): StockRow[] {
  return t.products
    .filter((p) => p.active)
    .map((product) => {
      const qty = stockOf(t, storeId, product.id);
      const transit = transitOf(t, storeId, product.id);
      return { product, qty, transit, state: stockState(product, qty) };
    })
    .sort((a, b) => {
      const order = { OUT: 0, CRITICAL: 1, LOW: 2, OK: 3 };
      return order[a.state] - order[b.state] || a.product.name.localeCompare(b.product.name);
    });
}

/** Produits sous le seuil mini -> candidats à un OT (flux tiré). */
export function replenishmentSuggestions(t: Tenant, storeId: UUID, hubId: UUID): {
  product: Product; qty: number; suggested: number;
}[] {
  return stockRowsForStore(t, storeId)
    .filter((r) => r.state === "OUT" || r.state === "CRITICAL" || r.state === "LOW")
    .filter((r) => stockOf(t, hubId, r.product.id) > r.product.minStockLevel)
    .map((r) => ({
      product: r.product,
      qty: r.qty,
      suggested: Math.max(r.product.minStockLevel * 2 - r.qty, r.product.minStockLevel),
    }));
}

/** Ventes par jour d'un produit (30 j) — base du prorata PUSH. */
export function salesWeight(t: Tenant, storeId: UUID, productId: UUID): number {
  const limit = Date.now() - 30 * 86400000;
  return t.sales
    .filter((s) => s.storeId === storeId && new Date(s.createdAt).getTime() >= limit)
    .flatMap((s) => s.items)
    .filter((it) => it.productId === productId)
    .reduce((acc, it) => acc + it.quantity, 0);
}

export function movementsFor(t: Tenant, opts: { storeId?: UUID; productId?: UUID; limit?: number }): StockMovement[] {
  let list = t.stockMovements;
  if (opts.storeId) list = list.filter((m) => m.storeId === opts.storeId);
  if (opts.productId) list = list.filter((m) => m.productId === opts.productId);
  return list.slice(0, opts.limit ?? 100);
}

export function transferTransitRows(t: Tenant): {
  ot: TransferOrder; pending: number;
}[] {
  return t.transferOrders
    .filter((o) => o.status === "SHIPPED")
    .map((ot) => ({
      ot,
      pending: ot.items.reduce((acc, it) => acc + it.quantityShipped - it.quantityReceived - it.quantityDamaged, 0),
    }));
}
