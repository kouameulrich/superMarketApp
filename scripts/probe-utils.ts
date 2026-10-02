/**
 * Utilitaires de sonde partagés (sql:check + tests hors-ligne) :
 * document de validation couvrant les 18 tables, comparaison normalisée
 * (champs optionnels null omis) et localisation des divergences.
 */
import type { Tenant } from "../src/lib/types";

export const PROBE_SLUG = "__sql_probe__";

/** Document tenant minimal couvrant toutes les tables relationnelles. */
export function buildProbeTenant(): Tenant {
  const createdAt = "2026-01-01T10:00:00.000Z";
  return {
    id: PROBE_SLUG,
    slug: PROBE_SLUG,
    name: "Probe",
    plan: "STARTER",
    createdAt,
    users: [{ id: `${PROBE_SLUG}-u1`, username: "probe", passwordHash: "h".repeat(64), salt: "s", displayName: "Sonde", role: "ADMIN", active: true, createdAt }],
    stores: [
      // Ordre document = ordre de tri (code ASC) : PR1 → PR2, pour que le
      // round-trip strict passe (l'ordre des magasins est purement cosmétique).
      { id: `${PROBE_SLUG}-s1`, code: "PR1", name: "Magasin sonde", isHub: false, address: "1 rue Test", city: "Testville" },
      { id: `${PROBE_SLUG}-s2`, code: "PR2", name: "Magasin sonde 2", isHub: false, address: "2 rue Test", city: "Testville" },
    ],
    suppliers: [{ id: `${PROBE_SLUG}-f1`, code: "F-PRB", name: "Fournisseur sonde", email: "probe@test.tld", phone: "000", leadTimeDays: 2, paymentTerms: "Comptant" }],
    products: [{
      id: `${PROBE_SLUG}-p1`, sku: "PRB-1", barcode: "0000000000000", name: "Article sonde", category: "Test", brand: "Probe",
      costPrice: 500, vatRate: 0.18, sellingPrice: 1000, unit: "UNIT", minStockLevel: 5, supplierId: `${PROBE_SLUG}-f1`, active: true, createdAt,
    }],
    batches: [{ id: `${PROBE_SLUG}-b1`, productId: `${PROBE_SLUG}-p1`, storeId: `${PROBE_SLUG}-s1`, batchNumber: "LOT-PRB", dlc: "2027-01-01", quantity: 10 }],
    stockMovements: [{ id: `${PROBE_SLUG}-m1`, storeId: `${PROBE_SLUG}-s1`, productId: `${PROBE_SLUG}-p1`, type: "SUPPLIER_IN", quantity: 10, reference: "PRB-1", note: "sonde", createdBy: "sql:check", createdAt }],
    transferOrders: [{
      id: `${PROBE_SLUG}-t1`, codeReference: "OT-PRB-1", sourceStoreId: `${PROBE_SLUG}-s1`, destinationStoreId: `${PROBE_SLUG}-s2`,
      status: "DRAFT", strategy: "PULL", requestedBy: "sql:check", shippedAt: null, receivedAt: null, createdAt,
      items: [{ id: `${PROBE_SLUG}-ti1`, productId: `${PROBE_SLUG}-p1`, batchNumber: "LOT-PRB", quantityRequested: 2, quantityShipped: 0, quantityReceived: 0, quantityDamaged: 0, discrepancyReason: null }],
    }],
    purchaseOrders: [{
      id: `${PROBE_SLUG}-po1`, code: "PO-PRB-1", supplierId: `${PROBE_SLUG}-f1`, storeId: `${PROBE_SLUG}-s1`,
      status: "DRAFT", blNumber: null, createdAt, expectedAt: createdAt,
      items: [{ id: `${PROBE_SLUG}-poi1`, productId: `${PROBE_SLUG}-p1`, quantityOrdered: 5, quantityReceived: 0, unitCost: 500 }],
    }],
    sales: [{
      id: `${PROBE_SLUG}-sa1`, ticketNumber: "T-PRB-000001", storeId: `${PROBE_SLUG}-s1`, cashier: "sql:check",
      items: [
        { id: `${PROBE_SLUG}-si1`, productId: `${PROBE_SLUG}-p1`, sku: "PRB-1", name: "Article sonde", quantity: 2, unitPrice: 1000, vatRate: 0.18, costPrice: 500, discount: 0 },
      ],
      payments: [{ id: `${PROBE_SLUG}-sp1`, method: "CASH", amount: 2000 }],
      total: 2000, totalVat: 305.08, totalHt: 1694.92, margin: 1000, change: 0, createdAt,
      syncedOffline: false, status: "COMPLETED",
    }],
    cashSessions: [{
      id: `${PROBE_SLUG}-cs1`, storeId: `${PROBE_SLUG}-s1`, openedAt: createdAt, closedAt: null,
      openingFloat: 100000, countedCash: null, status: "OPEN", closedBy: null, ticketNumbers: ["T-PRB-000001"],
    }],
    auditLog: [{ id: `${PROBE_SLUG}-a1`, action: "PROBE", entity: "test", entityId: PROBE_SLUG, userId: "sql:check", detail: "Sonde de validation relationnelle", createdAt }],
  };
}

/** Égalité profonde insensible à l'ordre des clés, nulls/undefined traités comme absents. */
export function deepEqualNormalized(a: unknown, b: unknown): boolean {
  const isEmpty = (v: unknown): boolean => v === null || v === undefined;
  if (isEmpty(a) && isEmpty(b)) return true;
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && (a as unknown[]).every((x, i) => deepEqualNormalized(x, (b as unknown[])[i]));
  }
  if (typeof a === "object" && typeof b === "object" && a !== null && b !== null) {
    const ea = Object.entries(a as Record<string, unknown>).filter(([, v]) => !isEmpty(v));
    const eb = Object.entries(b as Record<string, unknown>).filter(([, v]) => !isEmpty(v));
    if (ea.length !== eb.length) return false;
    const mb = new Map(eb);
    return ea.every(([k, v]) => mb.has(k) && deepEqualNormalized(v, mb.get(k)!));
  }
  return a === b || String(a) === String(b);
}

/** Chemin de la première divergence entre deux arbres (diagnostic) — mêmes règles que deepEqualNormalized. */
export function firstDiffPath(a: unknown, b: unknown, path = "$"): string {
  const isEmpty = (v: unknown): boolean => v === null || v === undefined;
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return `${path}.length (${a.length} vs ${b.length})`;
    for (let i = 0; i < a.length; i++) {
      const r = firstDiffPath(a[i], b[i], `${path}[${i}]`);
      if (r) return r;
    }
    return "";
  }
  if (typeof a === "object" && typeof b === "object" && !isEmpty(a) && !isEmpty(b)) {
    const ea = Object.entries(a as Record<string, unknown>).filter(([, v]) => !isEmpty(v));
    const eb = Object.entries(b as Record<string, unknown>).filter(([, v]) => !isEmpty(v));
    const mb = new Map(eb);
    for (const [k, v] of ea) {
      if (!mb.has(k)) return `${path}.${k} (présent vs absent)`;
      const r = firstDiffPath(v, mb.get(k)!, `${path}.${k}`);
      if (r) return r;
    }
    return "";
  }
  if (isEmpty(a) !== isEmpty(b)) return `${path} (${JSON.stringify(a) ?? "undefined"} vs ${JSON.stringify(b) ?? "undefined"})`;
  if (a === b || String(a) === String(b)) return "";
  if (typeof a === "object" && typeof b === "object") return "";
  return `${path} (${JSON.stringify(a)} vs ${JSON.stringify(b)})`;
}
