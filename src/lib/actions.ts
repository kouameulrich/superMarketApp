"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { createHash } from "crypto";
import { getTenant, newId, mutateTenant } from "./db";
import { requireSession } from "./tenant";
import { getSession, SESSION_COOKIE, sessionCookieOptions, encodeSession } from "./session";
import type { Session } from "./session";
import { hashPassword } from "./seed";
import { replenishmentSuggestions, salesWeight } from "./stock";
import type {
  AuditEntry,
  PaymentMethod,
  Product,
  PurchaseOrder,
  Sale,
  SaleItem,
  StockMovement,
  TransferOrder,
  User,
  UserRole,
} from "./types";

const ADMIN_PIN = "1234"; // démo : second facteur pour les retours des caissier·ères

type Result = { ok: true } | { ok: false, error: string };

function fail(error: string): Result {
  return { ok: false, error };
}

function revalidateAll() {
  for (const p of ["/", "/pos", "/products", "/stock", "/transfers", "/suppliers", "/reports"]) {
    revalidatePath(p);
  }
}

const ROLES = {
  any: undefined as UserRole[] | undefined,
  pos: ["CASHIER", "LOGISTICS", "ADMIN", "SUPER_ADMIN"] as UserRole[],
  stock: ["STOCK", "LOGISTICS", "ADMIN", "SUPER_ADMIN"] as UserRole[],
  logistics: ["LOGISTICS", "ADMIN", "SUPER_ADMIN"] as UserRole[],
  admin: ["ADMIN", "SUPER_ADMIN"] as UserRole[],
};

async function withTenant<T>(roles: UserRole[] | undefined, fn: (slug: string, session: Session) => Promise<T>): Promise<T> {
  const session = await requireSession();
  if (roles?.length && !roles.includes(session.role)) {
    return fail("Accès refusé : rôle requis") as unknown as T;
  }
  const result = await fn(session.tenant, session);
  revalidateAll();
  return result;
}

// ─── Authentification ───────────────────────────────────────────────────────

export async function login(tenantSlug: string, username: string, password: string): Promise<Result> {
  const t = await getTenant(tenantSlug);
  if (!t) return fail("Enseigne inconnue");
  const user = t.users?.find((u) => u.username === username && u.active);
  if (!user || hashPassword(password, user.salt) !== user.passwordHash) {
    return fail("Identifiants incorrects");
  }
  const store = await cookies();
  store.set(
    SESSION_COOKIE,
    encodeSession({ tenant: t.slug, username: user.username, displayName: user.displayName, role: user.role }),
    sessionCookieOptions,
  );
  // Atterrissage selon le rôle : les caissier·ères vont au POS, les autres au tableau de bord
  redirect(user.role === "CASHIER" ? "/pos" : user.role === "STOCK" ? "/stock-board" : "/");
}

export async function logout(): Promise<void> {
  const store = await cookies();
  store.delete(SESSION_COOKIE);
}

function auditOf(action: string, entity: string, entityId: string, userId: string, detail: string): AuditEntry {
  return { id: newId(), action, entity, entityId, userId, detail, createdAt: new Date().toISOString() };
}

// ─── Ventes (POS) ───────────────────────────────────────────────────────────

export interface SalePayloadItem {
  productId: string;
  quantity: number;
  discount?: number;
}
export interface SalePayload {
  id: string; // idempotence (file offline)
  storeId: string;
  cashier: string;
  items: SalePayloadItem[];
  payments: { method: PaymentMethod; amount: number }[];
  offline?: boolean;
}

export async function createSale(payload: SalePayload): Promise<Result & { ticketNumber?: string }> {
  return withTenant(ROLES.pos, (slug) =>
    mutateTenant(slug, (t): Result & { ticketNumber?: string } => {
      if (t.sales.some((s) => s.id === payload.id)) {
        const existing = t.sales.find((s) => s.id === payload.id)!;
        return { ok: true, ticketNumber: existing.ticketNumber } as Result & { ticketNumber?: string };
      }
      const store = t.stores.find((s) => s.id === payload.storeId);
      if (!store) return fail("Magasin inconnu");
      if (!payload.items.length) return fail("Panier vide");

      const items: SaleItem[] = [];
      for (const it of payload.items) {
        const p = t.products.find((x) => x.id === it.productId);
        if (!p) return fail(`Article inconnu: ${it.productId}`);
        items.push({
          id: newId(),
          productId: p.id,
          sku: p.sku,
          name: p.name,
          quantity: it.quantity,
          unitPrice: p.sellingPrice,
          vatRate: p.vatRate,
          costPrice: p.costPrice,
          discount: it.discount ?? 0,
        });
      }
      const total = Math.round(items.reduce((a, i) => a + i.quantity * i.unitPrice - i.discount, 0) * 100) / 100;
      const paid = payload.payments.reduce((a, p) => a + p.amount, 0);
      if (paid + 0.001 < total) return fail("Montant réglé insuffisant");
      const totalVat =
        Math.round(
          items.reduce(
            (a, i) => a + (i.quantity * i.unitPrice - i.discount) * (i.vatRate / (1 + i.vatRate)),
            0,
          ) * 100,
        ) / 100;
      const totalHt = total - totalVat;
      const margin =
        Math.round(
          (totalHt - items.reduce((a, i) => a + i.quantity * i.costPrice, 0)) * 100,
        ) / 100;
      const seq = t.sales.filter((s) => s.storeId === payload.storeId).length + 1;
      const ticketNumber = `T-${store.code}-${String(1000 + seq).padStart(6, "0")}`;
      const now = new Date().toISOString();

      const sale: Sale = {
        id: payload.id,
        ticketNumber,
        storeId: payload.storeId,
        cashier: payload.cashier,
        items,
        payments: payload.payments.map((p) => ({ ...p, id: newId() })),
        total,
        totalVat,
        totalHt,
        margin,
        change: Math.max(0, Math.round((paid - total) * 100) / 100),
        createdAt: now,
        syncedOffline: payload.offline ?? false,
        status: "COMPLETED",
      };

      const movements: StockMovement[] = items.map((i) => ({
        id: newId(),
        storeId: payload.storeId,
        productId: i.productId,
        type: "SALE_POS",
        quantity: i.quantity,
        reference: ticketNumber,
        createdBy: payload.cashier,
        createdAt: now,
      }));

      // Rattachement à la session de caisse ouverte (ouverture auto si besoin)
      let session = t.cashSessions.find((c) => c.storeId === payload.storeId && c.status === "OPEN");
      if (!session) {
        session = {
          id: newId(),
          storeId: payload.storeId,
          openedAt: now,
          closedAt: null,
          openingFloat: 100000,
          countedCash: null,
          status: "OPEN",
          closedBy: null,
          ticketNumbers: [],
        };
        t.cashSessions.push(session);
      }
      session.ticketNumbers.push(ticketNumber);

      t.sales.unshift(sale);
      t.stockMovements.unshift(...movements);
      t.auditLog.unshift(
        auditOf("SALE", "sale", ticketNumber, payload.cashier, `Ticket ${ticketNumber} — ${items.length} article(s)${payload.offline ? " (mode offline)" : ""}`),
      );
      return { ok: true, ticketNumber };
    }),
  );
}

export async function createReturn(origTicket: string, storeId: string, pin: string): Promise<Result> {
  const session = await getSession();
  const adminBypass = !!session && ["ADMIN", "SUPER_ADMIN"].includes(session.role);
  if (!adminBypass && pin !== ADMIN_PIN) return fail("PIN administrateur incorrect");
  return withTenant(ROLES.pos, async (slug) =>
    mutateTenant(slug, (t) => {
      const orig = t.sales.find((s) => s.ticketNumber === origTicket && s.storeId === storeId && s.status === "COMPLETED");
      if (!orig) return fail("Ticket introuvable ou déjà remboursé");
      const now = new Date().toISOString();
      const total = orig.total;
      const returnSale: Sale = {
        id: newId(),
        ticketNumber: `${origTicket}-R`,
        storeId,
        cashier: orig.cashier,
        items: orig.items,
        payments: orig.payments,
        total,
        totalVat: orig.totalVat,
        totalHt: orig.totalHt,
        margin: 0,
        change: 0,
        createdAt: now,
        syncedOffline: false,
        status: "RETURNED",
        returnedTicket: origTicket,
      };
      orig.status = "RETURNED";
      t.sales.unshift(returnSale);
      t.stockMovements.unshift(
        ...orig.items.map((i) => ({
          id: newId(),
          storeId,
          productId: i.productId,
          type: "RETURN_IN" as const,
          quantity: i.quantity,
          reference: returnSale.ticketNumber,
          createdBy: "Service client",
          createdAt: now,
        })),
      );
      t.auditLog.unshift(
        auditOf("RETURN_VALIDATE", "sale", origTicket, session?.username ?? "pos", `Retour autorisé du ticket ${origTicket}${adminBypass ? " (administrateur)" : " (PIN administrateur)"}`),
      );
      return { ok: true };
    }),
  );
}

// ─── Clôtures de caisse ─────────────────────────────────────────────────────

export async function closeCashSession(storeId: string, countedCash: number): Promise<Result> {
  return withTenant(ROLES.pos, async (slug) =>
    mutateTenant(slug, (t) => {
      const session = t.cashSessions.find((c) => c.storeId === storeId && c.status === "OPEN");
      if (!session) return fail("Aucune session ouverte pour ce magasin");
      session.status = "CLOSED";
      session.closedAt = new Date().toISOString();
      session.countedCash = countedCash;
      session.closedBy = "Gérant (clôture Z)";
      t.auditLog.unshift(auditOf("CASH_CLOSE", "cash_session", session.id, "store.manager", `Clôture Z — caisse ${storeId.slice(0, 8)}`));
      return { ok: true };
    }),
  );
}

// ─── Produits ───────────────────────────────────────────────────────────────

export interface ProductInput {
  id?: string;
  sku: string;
  barcode: string;
  name: string;
  category: string;
  brand: string;
  costPrice: number;
  vatRate: number;
  sellingPrice: number;
  unit: "UNIT" | "KG";
  minStockLevel: number;
  supplierId: string | null;
  active: boolean;
}

export async function saveProduct(input: ProductInput): Promise<Result> {
  return withTenant(ROLES.admin, async (slug) =>
    mutateTenant(slug, (t) => {
      if (input.id) {
        const p = t.products.find((x) => x.id === input.id);
        if (!p) return fail("Produit introuvable");
        if (t.products.some((x) => x.sku === input.sku && x.id !== input.id)) return fail("SKU déjà utilisé");
        if (t.products.some((x) => x.barcode === input.barcode && x.id !== input.id)) return fail("Code-barres déjà utilisé");
        Object.assign(p, { ...input, id: p.id });
        t.auditLog.unshift(auditOf("PRODUCT_UPDATE", "product", p.sku, "admin", `Fiche produit modifiée : ${p.name}`));
      } else {
        if (t.products.some((x) => x.sku === input.sku)) return fail("SKU déjà utilisé");
        if (t.products.some((x) => x.barcode === input.barcode)) return fail("Code-barres déjà utilisé");
        const p: Product = {
          id: newId(),
          ...input,
          createdAt: new Date().toISOString(),
        };
        t.products.push(p);
        t.auditLog.unshift(auditOf("PRODUCT_CREATE", "product", p.sku, "admin", `Nouvel article référencé : ${p.name}`));
      }
      return { ok: true };
    }),
  );
}

// ─── Stock : ajustements & pertes ───────────────────────────────────────────

export async function adjustStock(storeId: string, productId: string, delta: number, note: string): Promise<Result> {
  return withTenant(ROLES.stock, async (slug) =>
    mutateTenant(slug, (t) => {
      const p = t.products.find((x) => x.id === productId);
      if (!p) return fail("Produit introuvable");
      if (delta === 0) return fail("Quantité nulle");
      const now = new Date().toISOString();
      t.stockMovements.unshift({
        id: newId(),
        storeId,
        productId,
        type: "INVENTORY_ADJUST",
        quantity: delta,
        reference: `INV-${now.slice(0, 10)}`,
        note: note || "Ajustement manuel",
        createdBy: "Gestionnaire stock",
        createdAt: now,
      });
      t.auditLog.unshift(auditOf("STOCK_ADJUST", "product", p.sku, "stock.manager", `Ajustement ${delta > 0 ? "+" : ""}${delta} — ${p.name}`));
      return { ok: true };
    }),
  );
}

export async function declareLoss(storeId: string, productId: string, qty: number, note: string): Promise<Result> {
  return withTenant(ROLES.stock, async (slug) =>
    mutateTenant(slug, (t) => {
      const p = t.products.find((x) => x.id === productId);
      if (!p) return fail("Produit introuvable");
      const now = new Date().toISOString();
      t.stockMovements.unshift({
        id: newId(),
        storeId,
        productId,
        type: "LOSS_DAMAGE",
        quantity: qty,
        reference: "Zone casse",
        note: note || "Casse / perte déclarée",
        createdBy: "Gestionnaire stock",
        createdAt: now,
      });
      t.auditLog.unshift(auditOf("LOSS_DECLARE", "product", p.sku, "stock.manager", `Casse déclarée : ${qty} × ${p.name}`));
      return { ok: true };
    }),
  );
}

// ─── Transferts inter-magasins ──────────────────────────────────────────────

export async function createTransferOrder(
  sourceStoreId: string,
  destinationStoreId: string,
  strategy: "PULL" | "PUSH",
  items: { productId: string; quantity: number }[],
  asDraft: boolean,
): Promise<Result> {
  return withTenant(ROLES.stock, async (slug) =>
    mutateTenant(slug, (t) => {
      if (sourceStoreId === destinationStoreId) return fail("Source et destination doivent différer");
      const cleaned = items.filter((i) => i.quantity > 0);
      if (cleaned.length === 0) return fail("Aucune ligne valide");
      const seq = t.transferOrders.length + 1;
      const ot: TransferOrder = {
        id: newId(),
        codeReference: `OT-2026-${String(seq).padStart(4, "0")}`,
        sourceStoreId,
        destinationStoreId,
        status: asDraft ? "DRAFT" : "REQUESTED",
        strategy,
        items: cleaned.map((i) => ({
          id: newId(),
          productId: i.productId,
          batchNumber: null,
          quantityRequested: i.quantity,
          quantityShipped: 0,
          quantityReceived: 0,
          quantityDamaged: 0,
          discrepancyReason: null,
        })),
        requestedBy: strategy === "PULL" ? "Système (seuil critique)" : "Répartition centrale",
        shippedAt: null,
        receivedAt: null,
        createdAt: new Date().toISOString(),
      };
      t.transferOrders.unshift(ot);
      t.auditLog.unshift(auditOf("TRANSFER_CREATE", "transfer_order", ot.codeReference, "stock.manager", `OT créé (${strategy}) : ${ot.items.length} ligne(s)`));
      return { ok: true };
    }),
  );
}

/** Flux tiré : génère les OTs automatiquement pour les produits sous le seuil. */
export async function autoGeneratePullOrders(storeId: string): Promise<Result & { count?: number }> {
  return withTenant(ROLES.stock, async (slug) => {
    const t0 = await getTenant(slug);
    if (!t0) return fail("Tenant introuvable");
    const hub = t0.stores.find((s) => s.isHub);
    if (!hub) return fail("Aucun hub configuré");
    const suggestions = replenishmentSuggestions(t0, storeId, hub.id);
    if (suggestions.length === 0) return { ok: true, count: 0 };
    const items = suggestions.map((s) => ({ productId: s.product.id, quantity: Math.ceil(s.suggested) }));
    const res = await createTransferOrder(hub.id, storeId, "PULL", items, false);
    return res.ok ? { ok: true, count: items.length } : res;
  });
}

export interface ReceivePayload {
  itemId: string;
  quantityReceived: number;
  quantityDamaged: number;
  discrepancyReason?: string;
}

export async function updateTransferStatus(
  otId: string,
  action: "SUBMIT" | "APPROVE" | "PREPARE" | "SHIP" | "RECEIVE" | "RESOLVE" | "CANCEL",
  payload?: { receive?: ReceivePayload[]; note?: string },
): Promise<Result> {
  return withTenant(ROLES.stock, async (slug) =>
    mutateTenant(slug, (t) => {
      const ot = t.transferOrders.find((o) => o.id === otId);
      if (!ot) return fail("OT introuvable");
      const now = new Date().toISOString();
      const srcName = t.stores.find((s) => s.id === ot.sourceStoreId)?.code ?? "?";
      const dstName = t.stores.find((s) => s.id === ot.destinationStoreId)?.code ?? "?";

      switch (action) {
        case "SUBMIT":
          if (ot.status !== "DRAFT") return fail("Statut incompatible");
          ot.status = "REQUESTED";
          break;
        case "APPROVE":
          if (ot.status !== "REQUESTED") return fail("Statut invalide");
          ot.status = "APPROVED";
          t.auditLog.unshift(auditOf("TRANSFER_VALIDATE", "transfer_order", ot.codeReference, "hub.manager", `Validation de disponibilité par ${srcName}`));
          break;
        case "PREPARE":
          if (ot.status !== "APPROVED") return fail("Statut invalide");
          ot.status = "IN_PREPARATION";
          break;
        case "SHIP": {
          if (ot.status !== "IN_PREPARATION") return fail("Statut invalide");
          for (const it of ot.items) {
            it.quantityShipped = it.quantityRequested;
            t.stockMovements.unshift(
              { id: newId(), storeId: ot.sourceStoreId, productId: it.productId, type: "TRANSFER_OUT", quantity: it.quantityShipped, reference: ot.codeReference, createdBy: srcName, createdAt: now },
              { id: newId(), storeId: ot.destinationStoreId, productId: it.productId, type: "TRANSIT_ENTRY", quantity: it.quantityShipped, reference: ot.codeReference, createdBy: srcName, createdAt: now },
            );
          }
          ot.status = "SHIPPED";
          ot.shippedAt = now;
          break;
        }
        case "RECEIVE": {
          if (ot.status !== "SHIPPED") return fail("Statut invalide");
          for (const rp of payload?.receive ?? []) {
            const it = ot.items.find((x) => x.id === rp.itemId);
            if (!it) continue;
            it.quantityReceived = rp.quantityDamaged + rp.quantityReceived >= it.quantityShipped ? it.quantityShipped - rp.quantityDamaged : rp.quantityReceived;
            it.quantityDamaged = rp.quantityDamaged;
            it.discrepancyReason = rp.discrepancyReason ?? null;
            const missing = it.quantityShipped - it.quantityReceived - it.quantityDamaged;
            if (it.quantityReceived > 0) {
              t.stockMovements.unshift({ id: newId(), storeId: ot.destinationStoreId, productId: it.productId, type: "TRANSFER_IN", quantity: it.quantityReceived, reference: ot.codeReference, createdBy: "PDA Réception", createdAt: now });
            }
            if (it.quantityDamaged > 0) {
              t.stockMovements.unshift(
                { id: newId(), storeId: ot.destinationStoreId, productId: it.productId, type: "DAMAGE_TRANSIT", quantity: it.quantityDamaged, reference: ot.codeReference, note: "Casse en transit (photo PDA)", createdBy: "PDA Réception", createdAt: now },
              );
            }
            if (missing > 0) {
              t.stockMovements.unshift({ id: newId(), storeId: ot.destinationStoreId, productId: it.productId, type: "LOSS_TRANSIT", quantity: missing, reference: ot.codeReference, note: "Manquant imputé au transit", createdBy: "PDA Réception", createdAt: now });
            }
          }
          const hasDiscrepancy = ot.items.some(
            (it) => it.quantityShipped - it.quantityReceived - it.quantityDamaged > 0 || it.quantityDamaged > 0,
          );
          ot.status = hasDiscrepancy ? "DISCREPANCY" : "RECEIVED";
          ot.receivedAt = now;
          t.auditLog.unshift(auditOf("TRANSFER_RECEIVE", "transfer_order", ot.codeReference, "PDA Réception", `Réception contrôlée ${dstName}${hasDiscrepancy ? " — écart constaté" : ""}`));
          break;
        }
        case "RESOLVE":
          if (ot.status !== "DISCREPANCY") return fail("Statut invalide");
          ot.status = "RECEIVED";
          t.auditLog.unshift(auditOf("TRANSFER_RESOLVE", "transfer_order", ot.codeReference, "hub.manager", "Écarts imputés au compte d'ajustement — OT clôturé"));
          break;
        case "CANCEL":
          if (["SHIPPED", "RECEIVED"].includes(ot.status)) return fail("OT déjà expédié");
          ot.status = "CANCELLED";
          t.auditLog.unshift(auditOf("TRANSFER_CANCEL", "transfer_order", ot.codeReference, "stock.manager", payload?.note || "Annulation OT"));
          break;
      }
      return { ok: true };
    }),
  );
}

/** Flux poussé : répartir le surstock du hub au prorata des ventes (30 j). */
export async function pushDistribute(productId: string, totalQty: number): Promise<Result> {
  return withTenant(ROLES.stock, async (slug) =>
    mutateTenant(slug, (t) => {
      const hub = t.stores.find((s) => s.isHub);
      if (!hub) return fail("Aucun hub configuré");
      const shops = t.stores.filter((s) => !s.isHub);
      if (shops.length === 0) return fail("Aucun magasin");
      const weights = shops.map((s) => ({ store: s, w: Math.max(salesWeight(t, s.id, productId), 1) }));
      const total = weights.reduce((a, w) => a + w.w, 0);
      let seq = t.transferOrders.length;
      const now = new Date().toISOString();
      const created: TransferOrder[] = [];
      weights.forEach((w) => {
        const qty = Math.max(1, Math.round((w.w / total) * totalQty));
        seq += 1;
        const ot: TransferOrder = {
          id: newId(),
          codeReference: `OT-2026-${String(seq).padStart(4, "0")}`,
          sourceStoreId: hub.id,
          destinationStoreId: w.store.id,
          status: "SHIPPED",
          strategy: "PUSH",
          items: [{ id: newId(), productId, batchNumber: null, quantityRequested: qty, quantityShipped: qty, quantityReceived: 0, quantityDamaged: 0, discrepancyReason: null }],
          requestedBy: "Répartition centrale (Push)",
          shippedAt: now,
          receivedAt: null,
          createdAt: now,
        };
        created.push(ot);
        t.stockMovements.unshift(
          { id: newId(), storeId: hub.id, productId, type: "TRANSFER_OUT", quantity: qty, reference: ot.codeReference, createdBy: "Hub", createdAt: now },
          { id: newId(), storeId: w.store.id, productId, type: "TRANSIT_ENTRY", quantity: qty, reference: ot.codeReference, createdBy: "Hub", createdAt: now },
        );
      });
      t.transferOrders.unshift(...created);
      t.auditLog.unshift(auditOf("TRANSFER_PUSH", "product", productId, "logistics", `Répartition PUSH de ${totalQty} unités vers ${shops.length} magasin(s)`));
      return { ok: true };
    }),
  );
}

// ─── Fournisseurs & achats ──────────────────────────────────────────────────

export async function createSupplier(input: {
  code: string; name: string; email: string; phone: string; leadTimeDays: number; paymentTerms: string;
}): Promise<Result> {
  return withTenant(ROLES.logistics, async (slug) =>
    mutateTenant(slug, (t) => {
      if (t.suppliers.some((s) => s.code === input.code)) return fail("Code fournisseur déjà utilisé");
      t.suppliers.push({ id: newId(), ...input });
      return { ok: true };
    }),
  );
}

export async function createPurchaseOrder(input: {
  supplierId: string;
  items: { productId: string; quantity: number }[];
}): Promise<Result> {
  return withTenant(ROLES.logistics, async (slug) =>
    mutateTenant(slug, (t) => {
      const supplier = t.suppliers.find((s) => s.id === input.supplierId);
      if (!supplier) return fail("Fournisseur introuvable");
      const hub = t.stores.find((s) => s.isHub) ?? t.stores[0];
      const seq = t.purchaseOrders.length + 1;
      const po: PurchaseOrder = {
        id: newId(),
        code: `PO-2026-${String(seq).padStart(4, "0")}`,
        supplierId: input.supplierId,
        storeId: hub.id,
        status: "DRAFT",
        items: input.items
          .filter((i) => i.quantity > 0)
          .map((i) => {
            const p = t.products.find((x) => x.id === i.productId)!;
            return { id: newId(), productId: i.productId, quantityOrdered: i.quantity, quantityReceived: 0, unitCost: p.costPrice };
          }),
        blNumber: null,
        createdAt: new Date().toISOString(),
        expectedAt: new Date(Date.now() + supplier.leadTimeDays * 86400000).toISOString(),
      };
      if (po.items.length === 0) return fail("Aucune ligne");
      t.purchaseOrders.unshift(po);
      return { ok: true };
    }),
  );
}

export async function sendPurchaseOrder(poId: string): Promise<Result> {
  return withTenant(ROLES.logistics, async (slug) =>
    mutateTenant(slug, (t) => {
      const po = t.purchaseOrders.find((p) => p.id === poId);
      if (!po || po.status !== "DRAFT") return fail("Commande introuvable ou déjà envoyée");
      po.status = "SENT";
      return { ok: true };
    }),
  );
}

export async function receivePurchaseOrder(
  poId: string,
  blNumber: string,
  receipts: { itemId: string; qty: number }[],
): Promise<Result> {
  return withTenant(ROLES.logistics, async (slug) =>
    mutateTenant(slug, (t) => {
      const po = t.purchaseOrders.find((p) => p.id === poId);
      if (!po || !["SENT", "PARTIALLY_RECEIVED"].includes(po.status)) return fail("Commande non réceptionnable");
      if (!blNumber.trim()) return fail("N° de BL requis (rapprochement BC/BL)");
      const now = new Date().toISOString();
      po.blNumber = blNumber;
      for (const r of receipts) {
        const it = po.items.find((x) => x.id === r.itemId);
        if (!it || r.qty <= 0) continue;
        it.quantityReceived += r.qty;
        t.stockMovements.unshift({
          id: newId(),
          storeId: po.storeId,
          productId: it.productId,
          type: "SUPPLIER_IN",
          quantity: r.qty,
          reference: blNumber,
          note: `Réception ${po.code}`,
          createdBy: "Réception",
          createdAt: now,
        });
      }
      po.status = po.items.every((i) => i.quantityReceived >= i.quantityOrdered) ? "RECEIVED" : "PARTIALLY_RECEIVED";
      t.auditLog.unshift(auditOf("PO_RECEIVE", "purchase_order", po.code, "reception", `Rapprochement ${po.code} / ${blNumber}`));
      return { ok: true };
    }),
  );
}

// ─── Utilisateurs (RBAC) ────────────────────────────────────────────────────

const USERNAME_RE = /^[a-z0-9][a-z0-9._-]{2,29}$/;
const USER_ROLE_VALUES: UserRole[] = ["CASHIER", "STOCK", "LOGISTICS", "ADMIN", "SUPER_ADMIN"];
const PASSWORD_MIN = 8;

function validatePassword(pw: string): string | null {
  if (!pw || pw.length < PASSWORD_MIN) return `Le mot de passe doit contenir au moins ${PASSWORD_MIN} caractères`;
  return null;
}

function countActiveAdmins(users: User[]): number {
  return users.filter((u) => u.role === "ADMIN" && u.active).length;
}

export interface UserInput {
  id?: string;
  username: string;
  displayName: string;
  role: UserRole;
  password?: string; // requis à la création ; optionnel à la modification (inchangé si vide)
}

/** Crée ou modifie un compte utilisateur du tenant (réservé aux administrateurs). */
export async function saveUser(input: UserInput): Promise<Result> {
  return withTenant(ROLES.admin, async (slug, session) =>
    mutateTenant(slug, (t) => {
      const username = input.username.trim().toLowerCase();
      const displayName = input.displayName.trim();
      if (!USERNAME_RE.test(username)) return fail("Identifiant invalide : 3 à 30 caractères (minuscules, chiffres, . _ -)");
      if (!displayName) return fail("Nom affiché requis");
      if (!USER_ROLE_VALUES.includes(input.role)) return fail("Rôle inconnu");

      if (input.id) {
        const user = t.users.find((u) => u.id === input.id);
        if (!user) return fail("Utilisateur introuvable");
        if (user.username === session.username && input.role !== user.role) {
          return fail("Impossible de modifier son propre rôle (à faire par un autre administrateur)");
        }
        if (user.role === "ADMIN" && input.role !== "ADMIN" && user.active && countActiveAdmins(t.users) <= 1) {
          return fail("Impossible de retirer le dernier administrateur actif");
        }
        if (t.users.some((u) => u.username === username && u.id !== input.id)) return fail("Identifiant déjà utilisé");
        if (input.password) {
          const pwErr = validatePassword(input.password);
          if (pwErr) return fail(pwErr);
          user.salt = createHash("sha256").update(`${username}:${Math.floor(Math.random() * 1e15)}`).digest("hex").slice(0, 16);
          user.passwordHash = hashPassword(input.password, user.salt);
        }
        user.role = input.role;
        user.displayName = displayName;
        t.auditLog.unshift(auditOf("USER_UPDATE", "user", username, session.username, `Fiche utilisateur modifiée : ${displayName} (${input.role})`));
      } else {
        if (t.users.some((u) => u.username === username)) return fail("Identifiant déjà utilisé");
        const pwErr = validatePassword(input.password ?? "");
        if (pwErr) return fail(pwErr);
        const salt = createHash("sha256").update(`${username}:${Math.floor(Math.random() * 1e15)}`).digest("hex").slice(0, 16);
        const user: User = {
          id: newId(),
          username,
          passwordHash: hashPassword(input.password!, salt),
          salt,
          displayName,
          role: input.role,
          active: true,
          createdAt: new Date().toISOString(),
        };
        t.users.push(user);
        t.auditLog.unshift(auditOf("USER_CREATE", "user", username, session.username, `Nouvel utilisateur : ${displayName} (${input.role})`));
      }
      return { ok: true };
    }),
  );
}

/** Active / désactive un compte (réservé aux administrateurs). */
export async function setUserActive(id: string, active: boolean): Promise<Result> {
  return withTenant(ROLES.admin, async (slug, session) =>
    mutateTenant(slug, (t) => {
      const user = t.users.find((u) => u.id === id);
      if (!user) return fail("Utilisateur introuvable");
      if (user.username === session.username && !active) return fail("Impossible de désactiver son propre compte");
      if (!active && user.role === "ADMIN" && countActiveAdmins(t.users) <= 1) {
        return fail("Impossible de désactiver le dernier administrateur actif");
      }
      user.active = active;
      t.auditLog.unshift(
        auditOf(active ? "USER_ACTIVATE" : "USER_DEACTIVATE", "user", user.username, session.username, `Compte ${active ? "réactivé" : "désactivé"} : ${user.displayName}`),
      );
      return { ok: true };
    }),
  );
}

/** Change son propre mot de passe (origine : écran Utilisateurs, section Mon profil). */
export async function changeOwnPassword(currentPassword: string, newPassword: string): Promise<Result> {
  return withTenant(ROLES.any, async (slug, session) =>
    mutateTenant(slug, (t) => {
      const user = t.users.find((u) => u.username === session.username);
      if (!user) return fail("Utilisateur introuvable");
      if (hashPassword(currentPassword, user.salt) !== user.passwordHash) return fail("Mot de passe actuel incorrect");
      const pwErr = validatePassword(newPassword);
      if (pwErr) return fail(pwErr);
      user.salt = createHash("sha256").update(`${user.username}:${Math.floor(Math.random() * 1e15)}`).digest("hex").slice(0, 16);
      user.passwordHash = hashPassword(newPassword, user.salt);
      t.auditLog.unshift(auditOf("SELF_PASSWORD", "user", user.username, session.username, "Changement de mot de passe personnel"));
      return { ok: true };
    }),
  );
}
