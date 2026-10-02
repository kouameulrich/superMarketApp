import { createHash } from "crypto";
import type {
  AuditEntry,
  Batch,
  CashSession,
  Product,
  PurchaseOrder,
  Sale,
  StockMovement,
  Supplier,
  Tenant,
  TransferOrder,
  User,
} from "./types";

/**
 * Couche de synchronisation SQL Server relationnelle (sql/schema.sql).
 *
 * Lecture : reconstitution du document `Tenant` à partir des 17 tables
 * (SELECT par table, assemblage parents/enfants).
 * Écriture : diff de l'agrégat (snapshot avant / après mutation) → une
 * transaction SQL unique (INSERT nouveaux, UPDATE modifiés, DELETE supprimés,
 * remplacement des collections enfants des parents modifiés).
 *
 * `SqlRunner` abstrait le driver (mssql en production, exécuteur fictif pour
 * les tests) : exécute une requête paramétrée et renvoie les lignes.
 */

export type SqlParams = Record<string, unknown>;
export type SqlRow = Record<string, unknown>;
export type SqlRunner = <T = SqlRow>(sql: string, params?: SqlParams) => Promise<T[]>;

const stableId = (seed: string): string => createHash("sha256").update(seed).digest("hex").slice(0, 32);

// ── Définition des tables (objets du document ↔ colonnes SQL) ──────────────

type ColKind = "s" | "n" | "b"; // chaîne (ISO inclus), nombre, booléen
interface ColDef {
  key: string; // propriété de l'objet document
  col: string; // colonne SQL
  kind: ColKind;
  nullable?: boolean; // null possible → omission à la lecture, NULL à l'écriture
}
interface TableDef {
  table: string;
  cols: ColDef[];
  orderBy: string;
  parentCol?: string; // colonne de rattachement au parent (collections enfants)
}

export const T_TENANT: TableDef = {
  table: "sg_tenant",
  orderBy: "slug",
  cols: [
    { key: "id", col: "id", kind: "s" },
    { key: "slug", col: "slug", kind: "s" },
    { key: "name", col: "name", kind: "s" },
    { key: "plan", col: "plan_type", kind: "s" },
    { key: "createdAt", col: "created_at", kind: "s" },
  ],
};
export const T_USER: TableDef = {
  table: "sg_user",
  orderBy: "username",
  cols: [
    { key: "tenant", col: "tenant", kind: "s" },
    { key: "id", col: "id", kind: "s" },
    { key: "username", col: "username", kind: "s" },
    { key: "passwordHash", col: "password_hash", kind: "s" },
    { key: "salt", col: "salt", kind: "s" },
    { key: "displayName", col: "display_name", kind: "s" },
    { key: "role", col: "user_role", kind: "s" },
    { key: "active", col: "active", kind: "b" },
    { key: "createdAt", col: "created_at", kind: "s" },
  ],
};
export const T_STORE: TableDef = {
  table: "sg_store",
  orderBy: "code",
  cols: [
    { key: "tenant", col: "tenant", kind: "s" },
    { key: "id", col: "id", kind: "s" },
    { key: "code", col: "code", kind: "s" },
    { key: "name", col: "name", kind: "s" },
    { key: "isHub", col: "is_hub", kind: "b" },
    { key: "address", col: "address", kind: "s" },
    { key: "city", col: "city", kind: "s" },
  ],
};
export const T_PRODUCT: TableDef = {
  table: "sg_product",
  orderBy: "sku",
  cols: [
    { key: "tenant", col: "tenant", kind: "s" },
    { key: "id", col: "id", kind: "s" },
    { key: "sku", col: "sku", kind: "s" },
    { key: "barcode", col: "barcode", kind: "s" },
    { key: "name", col: "name", kind: "s" },
    { key: "category", col: "category", kind: "s" },
    { key: "brand", col: "brand", kind: "s" },
    { key: "costPrice", col: "cost_price", kind: "n" },
    { key: "vatRate", col: "vat_rate", kind: "n" },
    { key: "sellingPrice", col: "selling_price", kind: "n" },
    { key: "unit", col: "unit", kind: "s" },
    { key: "minStockLevel", col: "min_stock_level", kind: "n" },
    { key: "supplierId", col: "supplier_id", kind: "s", nullable: true },
    { key: "active", col: "active", kind: "b" },
    { key: "createdAt", col: "created_at", kind: "s" },
  ],
};
export const T_SUPPLIER: TableDef = {
  table: "sg_supplier",
  orderBy: "code",
  cols: [
    { key: "tenant", col: "tenant", kind: "s" },
    { key: "id", col: "id", kind: "s" },
    { key: "code", col: "code", kind: "s" },
    { key: "name", col: "name", kind: "s" },
    { key: "email", col: "email", kind: "s" },
    { key: "phone", col: "phone", kind: "s" },
    { key: "leadTimeDays", col: "lead_time_days", kind: "n" },
    { key: "paymentTerms", col: "payment_terms", kind: "s" },
  ],
};
export const T_BATCH: TableDef = {
  table: "sg_batch",
  orderBy: "dlc, batch_number",
  cols: [
    { key: "tenant", col: "tenant", kind: "s" },
    { key: "id", col: "id", kind: "s" },
    { key: "productId", col: "product_id", kind: "s" },
    { key: "storeId", col: "store_id", kind: "s" },
    { key: "batchNumber", col: "batch_number", kind: "s" },
    { key: "dlc", col: "dlc", kind: "s" },
    { key: "quantity", col: "quantity", kind: "n" },
  ],
};
export const T_MOVEMENT: TableDef = {
  table: "sg_stock_movement",
  orderBy: "created_at DESC, id DESC",
  cols: [
    { key: "tenant", col: "tenant", kind: "s" },
    { key: "id", col: "id", kind: "s" },
    { key: "storeId", col: "store_id", kind: "s" },
    { key: "productId", col: "product_id", kind: "s" },
    { key: "type", col: "movement_type", kind: "s" },
    { key: "quantity", col: "quantity", kind: "n" },
    { key: "reference", col: "reference", kind: "s" },
    { key: "note", col: "note", kind: "s", nullable: true },
    { key: "createdBy", col: "created_by", kind: "s" },
    { key: "createdAt", col: "created_at", kind: "s" },
  ],
};
export const T_TRANSFER: TableDef = {
  table: "sg_transfer_order",
  orderBy: "created_at DESC, id DESC",
  cols: [
    { key: "tenant", col: "tenant", kind: "s" },
    { key: "id", col: "id", kind: "s" },
    { key: "codeReference", col: "code_reference", kind: "s" },
    { key: "sourceStoreId", col: "source_store_id", kind: "s" },
    { key: "destinationStoreId", col: "destination_store_id", kind: "s" },
    { key: "status", col: "status", kind: "s" },
    { key: "strategy", col: "strategy", kind: "s" },
    { key: "requestedBy", col: "requested_by", kind: "s" },
    { key: "shippedAt", col: "shipped_at", kind: "s", nullable: true },
    { key: "receivedAt", col: "received_at", kind: "s", nullable: true },
    { key: "createdAt", col: "created_at", kind: "s" },
  ],
};
export const T_TRANSFER_ITEM: TableDef = {
  table: "sg_transfer_item",
  orderBy: "id",
  parentCol: "transfer_order_id",
  cols: [
    { key: "id", col: "id", kind: "s" },
    { key: "transferOrderId", col: "transfer_order_id", kind: "s" },
    { key: "productId", col: "product_id", kind: "s" },
    { key: "batchNumber", col: "batch_number", kind: "s", nullable: true },
    { key: "quantityRequested", col: "quantity_requested", kind: "n" },
    { key: "quantityShipped", col: "quantity_shipped", kind: "n" },
    { key: "quantityReceived", col: "quantity_received", kind: "n" },
    { key: "quantityDamaged", col: "quantity_damaged", kind: "n" },
    { key: "discrepancyReason", col: "discrepancy_reason", kind: "s", nullable: true },
  ],
};
export const T_PO: TableDef = {
  table: "sg_purchase_order",
  orderBy: "created_at DESC, id DESC",
  cols: [
    { key: "tenant", col: "tenant", kind: "s" },
    { key: "id", col: "id", kind: "s" },
    { key: "code", col: "code", kind: "s" },
    { key: "supplierId", col: "supplier_id", kind: "s" },
    { key: "storeId", col: "store_id", kind: "s" },
    { key: "status", col: "status", kind: "s" },
    { key: "blNumber", col: "bl_number", kind: "s", nullable: true },
    { key: "createdAt", col: "created_at", kind: "s" },
    { key: "expectedAt", col: "expected_at", kind: "s" },
  ],
};
export const T_PO_ITEM: TableDef = {
  table: "sg_purchase_order_item",
  orderBy: "id",
  parentCol: "purchase_order_id",
  cols: [
    { key: "id", col: "id", kind: "s" },
    { key: "purchaseOrderId", col: "purchase_order_id", kind: "s" },
    { key: "productId", col: "product_id", kind: "s" },
    { key: "quantityOrdered", col: "quantity_ordered", kind: "n" },
    { key: "quantityReceived", col: "quantity_received", kind: "n" },
    { key: "unitCost", col: "unit_cost", kind: "n" },
  ],
};
export const T_SALE: TableDef = {
  table: "sg_sale",
  orderBy: "created_at DESC, id DESC",
  cols: [
    { key: "tenant", col: "tenant", kind: "s" },
    { key: "id", col: "id", kind: "s" },
    { key: "ticketNumber", col: "ticket_number", kind: "s" },
    { key: "storeId", col: "store_id", kind: "s" },
    { key: "cashier", col: "cashier", kind: "s" },
    { key: "total", col: "total", kind: "n" },
    { key: "totalVat", col: "total_vat", kind: "n" },
    { key: "totalHt", col: "total_ht", kind: "n" },
    { key: "margin", col: "margin", kind: "n" },
    { key: "change", col: "change_amount", kind: "n" },
    { key: "createdAt", col: "created_at", kind: "s" },
    { key: "syncedOffline", col: "synced_offline", kind: "b" },
    { key: "status", col: "sale_status", kind: "s" },
    { key: "returnedTicket", col: "returned_ticket", kind: "s", nullable: true },
  ],
};
export const T_SALE_ITEM: TableDef = {
  table: "sg_sale_item",
  orderBy: "id",
  parentCol: "sale_id",
  cols: [
    { key: "id", col: "id", kind: "s" },
    { key: "saleId", col: "sale_id", kind: "s" },
    { key: "productId", col: "product_id", kind: "s" },
    { key: "sku", col: "sku", kind: "s" },
    { key: "name", col: "name", kind: "s" },
    { key: "quantity", col: "quantity", kind: "n" },
    { key: "unitPrice", col: "unit_price", kind: "n" },
    { key: "vatRate", col: "vat_rate", kind: "n" },
    { key: "costPrice", col: "cost_price", kind: "n" },
    { key: "discount", col: "discount", kind: "n" },
  ],
};
export const T_SALE_PAYMENT: TableDef = {
  table: "sg_sale_payment",
  orderBy: "id",
  parentCol: "sale_id",
  cols: [
    { key: "id", col: "id", kind: "s" },
    { key: "saleId", col: "sale_id", kind: "s" },
    { key: "method", col: "method", kind: "s" },
    { key: "amount", col: "amount", kind: "n" },
  ],
};
export const T_CASH_SESSION: TableDef = {
  table: "sg_cash_session",
  orderBy: "opened_at DESC",
  cols: [
    { key: "tenant", col: "tenant", kind: "s" },
    { key: "id", col: "id", kind: "s" },
    { key: "storeId", col: "store_id", kind: "s" },
    { key: "openedAt", col: "opened_at", kind: "s" },
    { key: "closedAt", col: "closed_at", kind: "s", nullable: true },
    { key: "openingFloat", col: "opening_float", kind: "n" },
    { key: "countedCash", col: "counted_cash", kind: "n", nullable: true },
    { key: "status", col: "session_status", kind: "s" },
    { key: "closedBy", col: "closed_by", kind: "s", nullable: true },
  ],
};
export const T_TICKET: TableDef = {
  table: "sg_cash_session_ticket",
  orderBy: "id",
  parentCol: "cash_session_id",
  cols: [
    { key: "id", col: "id", kind: "s" },
    { key: "cashSessionId", col: "cash_session_id", kind: "s" },
    { key: "ticketNumber", col: "ticket_number", kind: "s" },
  ],
};
export const T_AUDIT: TableDef = {
  table: "sg_audit_log",
  orderBy: "created_at DESC, id DESC",
  cols: [
    { key: "tenant", col: "tenant", kind: "s" },
    { key: "id", col: "id", kind: "s" },
    { key: "action", col: "action", kind: "s" },
    { key: "entity", col: "entity", kind: "s" },
    { key: "entityId", col: "entity_id", kind: "s" },
    { key: "userId", col: "user_id", kind: "s" },
    { key: "detail", col: "detail", kind: "s" },
    { key: "createdAt", col: "created_at", kind: "s" },
  ],
};

// ── Conversion objet ↔ ligne ───────────────────────────────────────────────

export function rowToObject(def: TableDef, row: SqlRow): Record<string, unknown> {
  const obj: Record<string, unknown> = {};
  for (const c of def.cols) {
    const raw = row[c.col];
    if (raw === null || raw === undefined) {
      if (c.nullable) continue; // champ optionnel du document : omis
      obj[c.key] = c.kind === "b" ? false : c.kind === "n" ? 0 : "";
      continue;
    }
    obj[c.key] = c.kind === "n" ? Number(raw) : c.kind === "b" ? Boolean(raw) : String(raw);
  }
  return obj;
}

export function objectToRow(def: TableDef, obj: Record<string, unknown>, slug: string): Record<string, unknown> {
  const row: Record<string, unknown> = {};
  for (const c of def.cols) {
    if (c.col === "tenant") {
      row[c.col] = slug;
      continue;
    }
    const v = obj[c.key];
    if (v === undefined || v === null) {
      if (c.nullable) row[c.col] = null;
      else row[c.col] = c.kind === "b" ? false : c.kind === "n" ? 0 : "";
      continue;
    }
    row[c.col] = v;
  }
  return row;
}

/** Normalise une valeur pour comparaison (types document). */
function normalizeCol(kind: ColKind, v: unknown): unknown {
  if (v === undefined || v === null) return null;
  return kind === "n" ? Number(v) : kind === "b" ? Boolean(v) : String(v);
}

function rowSignature(def: TableDef, obj: Record<string, unknown>, slug: string | null): string {
  const payload = def.cols.map((c) => {
    const v = c.key === "tenant" ? slug : normalizeCol(c.kind, obj[c.key]);
    return `${c.col}:${JSON.stringify(v ?? null)}`;
  });
  return payload.join("|");
}

// ── Diff d'une collection racine (clé = id) ────────────────────────────────

export interface CollectionDiff {
  inserts: Record<string, unknown>[];
  updates: { id: string; row: Record<string, unknown> }[];
  deletes: string[];
}

export function diffCollection(
  def: TableDef,
  before: Record<string, unknown>[],
  after: Record<string, unknown>[],
  slug: string,
): CollectionDiff {
  const beforeById = new Map(before.map((r) => [String(r.id), r]));
  const afterById = new Map(after.map((r) => [String(r.id), r]));
  const diff: CollectionDiff = { inserts: [], updates: [], deletes: [] };
  for (const [id, row] of afterById) {
    if (!beforeById.has(id)) {
      diff.inserts.push(row);
    } else if (rowSignature(def, row, slug) !== rowSignature(def, beforeById.get(id)!, slug)) {
      diff.updates.push({ id, row });
    }
  }
  for (const id of beforeById.keys()) {
    if (!afterById.has(id)) diff.deletes.push(id);
  }
  return diff;
}

// ── Génération SQL ─────────────────────────────────────────────────────────

const CHUNK = 25;

export function buildInsert(def: TableDef, rows: Record<string, unknown>[], slug: string): { sql: string; params: SqlParams } {
  const cols = def.cols.map((c) => c.col);
  const params: SqlParams = {};
  let i = 0;
  const chunks: string[] = [];
  for (const row of rows) {
    const values = def.cols.map((c) => {
      const v = c.col === "tenant" ? slug : normalizeCol(c.kind, row[c.key]);
      if (v === null) return "NULL";
      const name = `c${i++}`;
      params[name] = v;
      return `@${name}`;
    });
    chunks.push(`(${values.join(",")})`);
  }
  const sql = `INSERT INTO dbo.${def.table} (${cols.join(",")}) VALUES ${chunks.join(",")}`;
  return { sql, params };
}

export function buildUpdate(def: TableDef, id: string, row: Record<string, unknown>, slug: string): { sql: string; params: SqlParams } {
  const params: SqlParams = { wid: id, tslug: slug };
  let i = 0;
  const sets: string[] = [];
  for (const c of def.cols) {
    if (c.col === "id" || c.col === "tenant") continue;
    const v = normalizeCol(c.kind, row[c.key]);
    if (v === null && !c.nullable) continue;
    const name = `u${i++}`;
    params[name] = v;
    sets.push(`${c.col} = ${v === null ? "NULL" : `@${name}`}`);
  }
  const sql = `UPDATE dbo.${def.table} SET ${sets.join(",")} WHERE id = @wid AND tenant = @tslug`;
  return { sql, params };
}

export function buildDeleteRoot(def: TableDef, id: string, slug: string): { sql: string; params: SqlParams } {
  return { sql: `DELETE FROM dbo.${def.table} WHERE id = @id AND tenant = @tslug`, params: { id, tslug: slug } };
}

// ── Lecture : reconstitution du document tenant ────────────────────────────

function mapRows<T>(def: TableDef, rows: SqlRow[]): T[] {
  return rows.map((r) => rowToObject(def, r) as unknown as T);
}

function selectWhereTenant(def: TableDef, slug: string, extraOrder?: string): { sql: string; params: SqlParams } {
  const order = extraOrder ?? def.orderBy;
  return { sql: `SELECT * FROM dbo.${def.table} WHERE tenant = @slug ORDER BY ${order}`, params: { slug } };
}

export async function loadTenantDoc(run: SqlRunner, slug: string): Promise<Tenant | null> {
  const metaRows = await run<SqlRow>(`SELECT id, slug, name, plan_type, created_at FROM dbo.sg_tenant WHERE slug = @slug`, { slug });
  if (!metaRows.length) return null;
  const meta = metaRows[0];

  const sel = async <T>(def: TableDef, extraOrder?: string): Promise<T[]> => {
    const { sql, params } = selectWhereTenant(def, slug, extraOrder);
    return run<T>(sql, params);
  };

  const [users, stores, suppliers, products, batches, movements, transfers, transferItems, pos, poItems, sales, saleItems, salePayments, sessions, tickets, audit] =
    await Promise.all([
      sel<SqlRow>(T_USER),
      sel<SqlRow>(T_STORE),
      sel<SqlRow>(T_SUPPLIER),
      sel<SqlRow>(T_PRODUCT),
      sel<SqlRow>(T_BATCH),
      sel<SqlRow>(T_MOVEMENT),
      sel<SqlRow>(T_TRANSFER),
      run<SqlRow>(
        `SELECT ti.* FROM dbo.sg_transfer_item ti JOIN dbo.sg_transfer_order t ON t.id = ti.transfer_order_id WHERE t.tenant = @slug ORDER BY ti.id`,
        { slug },
      ),
      sel<SqlRow>(T_PO),
      run<SqlRow>(`SELECT pi.* FROM dbo.sg_purchase_order_item pi JOIN dbo.sg_purchase_order p ON p.id = pi.purchase_order_id WHERE p.tenant = @slug ORDER BY pi.id`, { slug }),
      sel<SqlRow>(T_SALE),
      run<SqlRow>(`SELECT si.* FROM dbo.sg_sale_item si JOIN dbo.sg_sale s ON s.id = si.sale_id WHERE s.tenant = @slug ORDER BY si.id`, { slug }),
      run<SqlRow>(`SELECT sp.* FROM dbo.sg_sale_payment sp JOIN dbo.sg_sale s ON s.id = sp.sale_id WHERE s.tenant = @slug ORDER BY sp.id`, { slug }),
      sel<SqlRow>(T_CASH_SESSION),
      run<SqlRow>(`SELECT ct.* FROM dbo.sg_cash_session_ticket ct JOIN dbo.sg_cash_session c ON c.id = ct.cash_session_id WHERE c.tenant = @slug ORDER BY ct.id`, { slug }),
      sel<SqlRow>(T_AUDIT),
    ]);

  const tenant: Tenant = {
    id: String(meta.id),
    slug: String(meta.slug),
    name: String(meta.name),
    plan: String(meta.plan_type) as Tenant["plan"],
    createdAt: String(meta.created_at),
    users: mapRows<User>(T_USER, users),
    stores: mapRows<never>(T_STORE, stores) as unknown as Tenant["stores"],
    products: mapRows<Product>(T_PRODUCT, products),
    batches: mapRows<Batch>(T_BATCH, batches),
    stockMovements: mapRows<StockMovement>(T_MOVEMENT, movements),
    transferOrders: mapRows<TransferOrder>(T_TRANSFER, transfers),
    suppliers: mapRows<Supplier>(T_SUPPLIER, suppliers),
    purchaseOrders: mapRows<PurchaseOrder>(T_PO, pos),
    sales: mapRows<Sale>(T_SALE, sales),
    cashSessions: mapRows<CashSession>(T_CASH_SESSION, sessions),
    auditLog: mapRows<AuditEntry>(T_AUDIT, audit),
  };

  // Rattachement des collections enfants
  const transferItemObjs = mapRows<never>(T_TRANSFER_ITEM, transferItems) as unknown as Array<Record<string, unknown>>;
  const byTransfer = groupBy(transferItemObjs, (it) => String(it.transferOrderId));
  for (const t of tenant.transferOrders) {
    t.items = (byTransfer.get(t.id) ?? []).map((it) => strip(it)) as unknown as TransferOrder["items"];
  }

  const poItemObjs = mapRows<never>(T_PO_ITEM, poItems) as unknown as Array<Record<string, unknown>>;
  const byPo = groupBy(poItemObjs, (it) => String(it.purchaseOrderId));
  for (const p of tenant.purchaseOrders) {
    p.items = (byPo.get(p.id) ?? []).map((it) => strip(it)) as unknown as PurchaseOrder["items"];
  }

  const saleItemObjs = mapRows<never>(T_SALE_ITEM, saleItems) as unknown as Array<Record<string, unknown>>;
  const bySale = groupBy(saleItemObjs, (it) => String(it.saleId));
  const salePaymentObjs = mapRows<never>(T_SALE_PAYMENT, salePayments) as unknown as Array<Record<string, unknown>>;
  const byPayment = groupBy(salePaymentObjs, (it) => String(it.saleId));
  for (const s of tenant.sales) {
    s.items = (bySale.get(s.id) ?? []).map((it) => strip(it)) as unknown as Sale["items"];
    s.payments = (byPayment.get(s.id) ?? []).map((it) => strip(it)) as unknown as Sale["payments"];
  }

  const ticketRows = mapRows<never>(T_TICKET, tickets) as unknown as Array<Record<string, unknown>>;
  const bySession = groupBy(ticketRows, (it) => String(it.cashSessionId));
  for (const c of tenant.cashSessions) {
    c.ticketNumbers = (bySession.get(c.id) ?? []).map((it) => String(it.ticketNumber));
  }

  return tenant;
}

function groupBy<T extends Record<string, unknown>>(rows: T[], key: (r: T) => string): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const r of rows) {
    const k = key(r);
    const arr = map.get(k);
    if (arr) arr.push(r);
    else map.set(k, [r]);
  }
  return map;
}

/** Retire le marqueur interne tenant des lignes enfants avant assemblage. */
function strip(row: Record<string, unknown>): Record<string, unknown> {
  const { tenant: _tenant, ...rest } = row;
  return rest;
}

// ── Écriture : synchronisation de l'agrégat (snapshot avant / après) ───────

interface RootCollection<TK extends keyof Tenant> {
  def: TableDef;
  get: (t: Tenant) => TK extends never ? never : unknown[];
}

const ROOT_COLLECTIONS: Array<{ def: TableDef; get: (t: Tenant) => Array<Record<string, unknown>> }> = [
  { def: T_USER, get: (t) => t.users as unknown as Array<Record<string, unknown>> },
  { def: T_STORE, get: (t) => t.stores as unknown as Array<Record<string, unknown>> },
  { def: T_SUPPLIER, get: (t) => t.suppliers as unknown as Array<Record<string, unknown>> },
  { def: T_PRODUCT, get: (t) => t.products as unknown as Array<Record<string, unknown>> },
  { def: T_BATCH, get: (t) => t.batches as unknown as Array<Record<string, unknown>> },
  { def: T_MOVEMENT, get: (t) => t.stockMovements as unknown as Array<Record<string, unknown>> },
  { def: T_TRANSFER, get: (t) => t.transferOrders as unknown as Array<Record<string, unknown>> },
  { def: T_PO, get: (t) => t.purchaseOrders as unknown as Array<Record<string, unknown>> },
  { def: T_SALE, get: (t) => t.sales as unknown as Array<Record<string, unknown>> },
  { def: T_CASH_SESSION, get: (t) => t.cashSessions as unknown as Array<Record<string, unknown>> },
  { def: T_AUDIT, get: (t) => t.auditLog as unknown as Array<Record<string, unknown>> },
];

interface ChildCollection {
  def: TableDef; // avec parentCol
  parentId: (t: Tenant) => Array<{ id: string; children: Record<string, unknown>[] }>;
}

async function execDiff(run: SqlRunner, def: TableDef, diff: CollectionDiff, slug: string): Promise<number> {
  let count = 0;
  for (const id of diff.deletes) {
    const { sql, params } = buildDeleteRoot(def, id, slug);
    await run(sql, params);
    count++;
  }
  if (diff.inserts.length > 0) {
    const { sql, params } = buildInsert(def, diff.inserts, slug);
    await run(sql, params);
    count += diff.inserts.length;
  }
  for (const u of diff.updates) {
    const { sql, params } = buildUpdate(def, u.id, u.row, slug);
    await run(sql, params);
    count++;
  }
  return count;
}

/** Complète les ids manquants des lignes enfants (dérivation déterministe). */
function ensureChildIds(def: TableDef, parentId: string, children: Record<string, unknown>[], hashSeed: string): void {
  children.forEach((child, index) => {
    if (child.id === undefined || child.id === null || child.id === "") {
      child.id = stableId(`${def.table}:${hashSeed}:${parentId}:${index}`);
    }
  });
}

/** Variante publique pour les tests. */
export function ensureChildIdsWrapper(table: string, parentId: string, children: Record<string, unknown>[], hashSeed: string): void {
  const def = [T_TRANSFER_ITEM, T_PO_ITEM, T_SALE_ITEM, T_SALE_PAYMENT].find((d) => d.table === table);
  if (!def) throw new Error(`Table enfant inconnue: ${table}`);
  ensureChildIds(def, parentId, children, hashSeed);
}

export interface SyncReport {
  tables: Record<string, number>;
  total: number;
}

/** Synchronise l'agrégat tenant : avant → après (exécutable dans une transaction). */
export async function syncTenantDoc(
  run: SqlRunner,
  slug: string,
  before: Tenant | null,
  after: Tenant,
): Promise<SyncReport> {
  const report: SyncReport = { tables: {}, total: 0 };
  const bump = (table: string, n: number) => {
    if (n > 0) {
      report.tables[table] = (report.tables[table] ?? 0) + n;
      report.total += n;
    }
  };

  // 1. Table maître tenant (upsert)
  await run(
    `IF EXISTS (SELECT 1 FROM dbo.sg_tenant WHERE slug = @slug)
       UPDATE dbo.sg_tenant SET name = @name, plan_type = @plan_type, created_at = @created_at WHERE slug = @slug
     ELSE
       INSERT INTO dbo.sg_tenant (id, slug, name, plan_type, created_at) VALUES (@id, @slug, @name, @plan_type, @created_at)`,
    { id: after.id, slug: after.slug, name: after.name, plan_type: after.plan, created_at: after.createdAt },
  );

  // 2. Miroir de métadonnées + document (sg_tenants)
  await run(
    `IF EXISTS (SELECT 1 FROM dbo.sg_tenants WHERE slug = @slug)
       UPDATE dbo.sg_tenants SET name = @name, plan_type = @plan_type, payload = @payload, updated_at = SYSUTCDATETIME() WHERE slug = @slug
     ELSE
       INSERT INTO dbo.sg_tenants (slug, name, plan_type, payload) VALUES (@slug, @name, @plan_type, @payload)`,
    { slug: after.slug, name: after.name, plan_type: after.plan, payload: JSON.stringify(after) },
  );

  // 3. Collections racines (diff par id)
  for (const coll of ROOT_COLLECTIONS) {
    const beforeRows = before ? coll.get(before) : [];
    const afterRows = coll.get(after);
    const diff = diffCollection(coll.def, beforeRows, afterRows, slug);
    bump(coll.def.table, await execDiff(run, coll.def, diff, slug));
  }

  // 4. Collections enfants (remplacement par parent modifié ou nouveau)
  const childSpecs: Array<{
    def: TableDef;
    beforeParents: Map<string, Record<string, unknown>[]>;
    afterParents: Array<{ id: string; children: Record<string, unknown>[] }>;
    hashSeed: string;
  }> = [
    {
      def: T_TRANSFER_ITEM,
      beforeParents: groupBy(before?.transferOrders.flatMap((t) => t.items.map((it) => ({ ...it, transferOrderId: t.id }))) ?? [], (it) => String(it.transferOrderId)),
      afterParents: after.transferOrders.map((t) => ({ id: t.id, children: t.items.map((it) => ({ ...it, transferOrderId: t.id })) })),
      hashSeed: "transfer",
    },
    {
      def: T_PO_ITEM,
      beforeParents: groupBy(before?.purchaseOrders.flatMap((p) => p.items.map((it) => ({ ...it, purchaseOrderId: p.id }))) ?? [], (it) => String(it.purchaseOrderId)),
      afterParents: after.purchaseOrders.map((p) => ({ id: p.id, children: p.items.map((it) => ({ ...it, purchaseOrderId: p.id })) })),
      hashSeed: "po",
    },
    {
      def: T_SALE_ITEM,
      beforeParents: groupBy(before?.sales.flatMap((s) => s.items.map((it) => ({ ...it, saleId: s.id }))) ?? [], (it) => String(it.saleId)),
      afterParents: after.sales.map((s) => ({ id: s.id, children: s.items.map((it) => ({ ...it, saleId: s.id })) })),
      hashSeed: "saleitem",
    },
    {
      def: T_SALE_PAYMENT,
      beforeParents: groupBy(before?.sales.flatMap((s) => s.payments.map((it) => ({ ...it, saleId: s.id }))) ?? [], (it) => String(it.saleId)),
      afterParents: after.sales.map((s) => ({ id: s.id, children: s.payments.map((it) => ({ ...it, saleId: s.id })) })),
      hashSeed: "salepay",
    },
  ];

  for (const spec of childSpecs) {
    for (const parent of spec.afterParents) {
      ensureChildIds(spec.def, parent.id, parent.children, spec.hashSeed);
      const beforeChildren = spec.beforeParents.get(parent.id) ?? [];
      ensureChildIds(spec.def, parent.id, beforeChildren, spec.hashSeed);
      const afterSig = JSON.stringify(parent.children.map((c) => rowSignature(spec.def, c, slug)));
      const beforeSig = JSON.stringify(beforeChildren.map((c) => rowSignature(spec.def, c, slug)));
      if (afterSig === beforeSig) continue;
      await run(`DELETE FROM dbo.${spec.def.table} WHERE ${spec.def.parentCol} = @pid`, { pid: parent.id });
      if (parent.children.length > 0) {
        const rows = parent.children.map((c) => objectToRow(spec.def, c, slug));
        const { sql, params } = buildInsert(spec.def, rows, slug);
        await run(sql, params);
        bump(spec.def.table, rows.length);
      } else {
        bump(spec.def.table, 0);
      }
      // le DELETE compte comme une écriture si des enfants existaient
      if (beforeChildren.length > 0 && parent.children.length === 0) bump(spec.def.table, beforeChildren.length);
    }
  }

  // 5. Tickets de caisse (collection de primitives, clé = ticket_number)
  for (const session of after.cashSessions) {
    const beforeTickets = new Set(before?.cashSessions.find((c) => c.id === session.id)?.ticketNumbers ?? []);
    const afterTickets = new Set(session.ticketNumbers);
    const changed =
      beforeTickets.size !== afterTickets.size ||
      [...afterTickets].some((t) => !beforeTickets.has(t));
    if (!changed) continue;
    await run(`DELETE FROM dbo.${T_TICKET.table} WHERE ${T_TICKET.parentCol} = @pid`, { pid: session.id });
    if (session.ticketNumbers.length > 0) {
      const rows = session.ticketNumbers.map((ticket) =>
        objectToRow(T_TICKET, { id: stableId(`${session.id}|${ticket}`), cashSessionId: session.id, ticketNumber: ticket }, slug),
      );
      const { sql, params } = buildInsert(T_TICKET, rows, slug);
      await run(sql, params);
      bump(T_TICKET.table, rows.length);
    }
  }

  return report;
}

/** Purge d'un tenant (ordre anti-FK) — utilisé par les scripts de validation. */
export async function deleteTenantRelational(run: SqlRunner, slug: string): Promise<void> {
  await run(`DELETE FROM dbo.sg_audit_log WHERE tenant = @slug`, { slug });
  await run(`DELETE ct FROM dbo.sg_cash_session_ticket ct JOIN dbo.sg_cash_session c ON c.id = ct.cash_session_id WHERE c.tenant = @slug`, { slug });
  await run(`DELETE FROM dbo.sg_cash_session WHERE tenant = @slug`, { slug });
  await run(`DELETE sp FROM dbo.sg_sale_payment sp JOIN dbo.sg_sale s ON s.id = sp.sale_id WHERE s.tenant = @slug`, { slug });
  await run(`DELETE si FROM dbo.sg_sale_item si JOIN dbo.sg_sale s ON s.id = si.sale_id WHERE s.tenant = @slug`, { slug });
  await run(`DELETE FROM dbo.sg_sale WHERE tenant = @slug`, { slug });
  await run(`DELETE pi FROM dbo.sg_purchase_order_item pi JOIN dbo.sg_purchase_order p ON p.id = pi.purchase_order_id WHERE p.tenant = @slug`, { slug });
  await run(`DELETE FROM dbo.sg_purchase_order WHERE tenant = @slug`, { slug });
  await run(`DELETE ti FROM dbo.sg_transfer_item ti JOIN dbo.sg_transfer_order t ON t.id = ti.transfer_order_id WHERE t.tenant = @slug`, { slug });
  await run(`DELETE FROM dbo.sg_transfer_order WHERE tenant = @slug`, { slug });
  await run(`DELETE FROM dbo.sg_stock_movement WHERE tenant = @slug`, { slug });
  await run(`DELETE FROM dbo.sg_batch WHERE tenant = @slug`, { slug });
  await run(`DELETE FROM dbo.sg_product WHERE tenant = @slug`, { slug });
  await run(`DELETE FROM dbo.sg_supplier WHERE tenant = @slug`, { slug });
  await run(`DELETE FROM dbo.sg_store WHERE tenant = @slug`, { slug });
  await run(`DELETE FROM dbo.sg_user WHERE tenant = @slug`, { slug });
  await run(`DELETE FROM dbo.sg_tenant WHERE slug = @slug`, { slug });
  await run(`DELETE FROM dbo.sg_tenants WHERE slug = @slug`, { slug });
}

/** Sonde de débogage (scripts). */
export function selectWhereTenantDebug(table: string, slug: string): { sql: string; params: Record<string, unknown> } {
  const defs: Record<string, TableDef> = { sg_user: T_USER, sg_store: T_STORE, sg_sale: T_SALE };
  const def = defs[table];
  if (!def) return { sql: 'def inconnu: ' + table, params: {} };
  const q = selectWhereTenant(def, slug);
  return { sql: q.sql, params: q.params };
}
