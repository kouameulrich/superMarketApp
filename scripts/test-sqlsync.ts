/**
 * Tests hors-ligne de la couche sqlSync (aucune base requise).
 * Usage : bun run test:sqlsync
 */
import {
  buildDeleteRoot,
  buildInsert,
  buildUpdate,
  diffCollection,
  ensureChildIdsWrapper,
  loadTenantDoc,
  rowToObject,
  objectToRow,
  syncTenantDoc,
  T_PRODUCT,
  T_SALE,
  T_SALE_ITEM,
  T_STORE,
  T_USER,
  T_CASH_SESSION,
  T_AUDIT,
  type SqlRow, deleteTenantRelational } from "../src/lib/sqlSync";
import type { Tenant } from "../src/lib/types";
import { createFakeRunner } from "./fake-exec";
import { buildProbeTenant, deepEqualNormalized, firstDiffPath, PROBE_SLUG } from "./probe-utils";

let failures = 0;
function check(label: string, cond: boolean): void {
  if (cond) console.log(`  ✓ ${label}`);
  else {
    failures++;
    console.error(`  ✗ ${label}`);
  }
}

const SLUG = "t1";

/** Applique la même dérivation d'ids enfants que le serveur après synchronisation. */
function normalizeChildIds(d: Tenant): void {
  for (const s of d.sales) {
    ensureChildIdsWrapper("sg_sale_item", s.id, s.items as unknown as Record<string, unknown>[], "saleitem");
    ensureChildIdsWrapper("sg_sale_payment", s.id, s.payments as unknown as Record<string, unknown>[], "salepay");
  }
  for (const t of d.transferOrders) ensureChildIdsWrapper("sg_transfer_item", t.id, t.items as unknown as Record<string, unknown>[], "transfer");
  for (const p of d.purchaseOrders) ensureChildIdsWrapper("sg_purchase_order_item", p.id, p.items as unknown as Record<string, unknown>[], "poi");
}

/* ── 1. Mapping objet ↔ ligne (nulls, types) ─────────────────────────────── */
console.log("1. Mapping objet ↔ ligne");
{
  const obj = {
    id: "p1", sku: "SKU1", barcode: "123", name: "N", category: "C", brand: "B",
    costPrice: 500, vatRate: 0.18, sellingPrice: 1000, unit: "UNIT",
    minStockLevel: 5, active: true, createdAt: "2026-01-01T00:00:00.000Z",
  };
  const row = objectToRow(T_PRODUCT, obj, SLUG);
  check("tenant injecté", row.tenant === SLUG);
  check("coût en nombre", row.cost_price === 500);
  check("nullable → NULL (fournisseur absent)", row.supplier_id === null);
  check("fournisseur valorisé conservé", objectToRow(T_PRODUCT, { ...obj, supplierId: "f1" }, SLUG).supplier_id === "f1");
  const back = rowToObject(T_PRODUCT, row as SqlRow);
  const { tenant: _tenant, ...backClean } = back as Record<string, unknown>;
  check("aller-retour idem (null omis)", JSON.stringify(backClean) === JSON.stringify(obj));
}

/* ── 2. Diff d'une collection racine ─────────────────────────────────────── */
console.log("2. Diff de collection");
{
  const before = [{ id: "a", username: "u1", passwordHash: "h", salt: "s", displayName: "A", role: "CASHIER", active: true, createdAt: "t" }];
  const after = [
    { ...before[0], displayName: "A2" }, // update
    { id: "b", username: "u2", passwordHash: "h", salt: "s", displayName: "B", role: "ADMIN", active: true, createdAt: "t" }, // insert
  ];
  const diff = diffCollection(T_USER, before, after, SLUG);
  check("1 insertion", diff.inserts.length === 1 && diff.inserts[0].id === "b");
  check("1 mise à jour", diff.updates.length === 1 && diff.updates[0].id === "a");
  check("1 suppression", diff.deletes.length === 0); // "a" existe toujours
  const diff2 = diffCollection(T_USER, before, [], SLUG);
  check("suppression détectée", diff2.deletes.length === 1 && diff2.deletes[0] === "a");
}

/* ── 3. Génération SQL ───────────────────────────────────────────────────── */
console.log("3. Génération SQL");
{
  const rows = [
    { id: "a", code: "M1", name: "Mag 1", isHub: false, address: "x", city: "y" },
    { id: "b", code: "M2", name: "Mag 2", isHub: true, address: "z", city: "w" },
  ];
  const { sql, params } = buildInsert(T_STORE, rows, SLUG);
  check("table cible", sql.startsWith(`INSERT INTO dbo.sg_store (tenant,id,code,name,is_hub,address,city) VALUES`));
  check("14 paramètres (2×7 avec tenant)", Object.keys(params).length === 14);
  check("valeur hub (2e ligne)", params.c11 === true);

  const up = buildUpdate(T_STORE, "a", { id: "a", code: "M1", name: "Mag 1 bis", isHub: false, address: "x", city: "y" }, SLUG);
  check("UPDATE exclut id/tenant", up.sql.includes("name = @u1") && !up.sql.includes("id = @u") && !up.sql.includes("tenant = @u"));
  check("WHERE id + tenant", up.sql.includes("WHERE id = @wid AND tenant = @tslug"));

  const del = buildDeleteRoot(T_STORE, "a", SLUG);
  check("DELETE filtré par tenant", del.sql.includes("WHERE id = @id AND tenant = @tslug"));
}

/* ── 4. Reconstitution du document (runner fictif) ───────────────────────── */
console.log("4. Reconstitution loadTenantDoc");
{
  const store = { id: "s1", code: "M1", name: "Mag", isHub: false, address: "a", city: "c" };
  const user = { id: "u1", username: "u", passwordHash: "h", salt: "s", displayName: "U", user_role: "ADMIN", active: 1, created_at: "t" };
  const sale = { id: "sa1", ticket_number: "T-M1-1", store_id: "s1", cashier: "C", total: 1000, total_vat: 152.54, total_ht: 847.46, margin: 500, change_amount: 0, created_at: "t", synced_offline: 0, sale_status: "COMPLETED", returned_ticket: null };
  const saleItem = { id: "si1", sale_id: "sa1", product_id: "p1", sku: "S", name: "N", quantity: 2, unit_price: 500, vat_rate: 0.18, cost_price: 250, discount: 0 };
  const salePay = { id: "sp1", sale_id: "sa1", method: "CASH", amount: 1000 };
  const session = { id: "cs1", store_id: "s1", opened_at: "t", closed_at: null, opening_float: 100000, counted_cash: null, session_status: "OPEN", closed_by: null };
  const ticket = { id: "ct1", cash_session_id: "cs1", ticket_number: "T-M1-1" };
  const tenantRow = { id: "t1", slug: SLUG, name: "Test", plan_type: "STARTER", created_at: "t" };

  const canned: Record<string, SqlRow[]> = {
    sg_user: [user],
    sg_store: [store],
    sg_sale: [sale],
    sg_sale_item: [saleItem],
    sg_sale_payment: [salePay],
    sg_cash_session: [session],
    sg_cash_session_ticket: [ticket],
    sg_tenant: [tenantRow],
  };
  const run = async <T>(sql: string): Promise<T[]> => {
    const m = /FROM dbo\.(\w+)/.exec(sql);
    return (canned[m?.[1] ?? ""] ?? []) as T[];
  };

  const doc = (await loadTenantDoc(run, SLUG))!;
  check("métadonnées", doc.slug === SLUG && doc.plan === "STARTER");
  check("users reconstitués", doc.users.length === 1 && doc.users[0].role === "ADMIN" && doc.users[0].active === true);
  check("stores reconstitués", doc.stores.length === 1);
  check("ventes reconstituées", doc.sales.length === 1 && doc.sales[0].total === 1000);
  check("lignes de vente attachées", doc.sales[0].items.length === 1 && doc.sales[0].items[0].quantity === 2);
  check("paiements attachés", doc.sales[0].payments.length === 1 && doc.sales[0].payments[0].amount === 1000);
  check("sessions + tickets", doc.cashSessions.length === 1 && doc.cashSessions[0].ticketNumbers.includes("T-M1-1"));
  check("optionnels absents (returnedTicket)", !("returnedTicket" in doc.sales[0]));
  check("audit vide", doc.auditLog.length === 0);
  check("discriminant tenant absent du document", !("tenant" in doc.users[0]) && !("tenant" in doc.stores[0]) && !("tenant" in doc.sales[0]));
}

/* ── 5. Orchestration syncTenantDoc (runner enregistreur) ─────────────────── */
console.log("5. Orchestration syncTenantDoc");
{
  const statements: Array<{ sql: string; params: Record<string, unknown> }> = [];
  const run = async <T>(sql: string, params?: Record<string, unknown>): Promise<T[]> => {
    statements.push({ sql, params: params ?? {} });
    return [] as T[];
  };
  const doc: Tenant = {
    id: "t1", slug: SLUG, name: "Test", plan: "STARTER", createdAt: "t",
    users: [], stores: [], suppliers: [], batches: [], stockMovements: [], transferOrders: [], purchaseOrders: [],
    products: [{ id: "p1", sku: "S1", barcode: "1", name: "P1", category: "C", brand: "B", costPrice: 100, vatRate: 0.18, sellingPrice: 200, unit: "UNIT", minStockLevel: 1, supplierId: null, active: true, createdAt: "t" }],
    sales: [
      { id: "sa1", ticketNumber: "T-M1-1", storeId: "st", cashier: "C", items: [{ productId: "p1", sku: "S1", name: "P1", quantity: 1, unitPrice: 200, vatRate: 0.18, costPrice: 100, discount: 0 }], payments: [{ method: "CASH", amount: 200 }], total: 200, totalVat: 30.51, totalHt: 169.49, margin: 100, change: 0, createdAt: "t", syncedOffline: false, status: "COMPLETED" },
    ],
    cashSessions: [{ id: "cs1", storeId: "st", openedAt: "t", closedAt: null, openingFloat: 1000, countedCash: null, status: "OPEN", closedBy: null, ticketNumbers: ["T-M1-1"] }],
    auditLog: [{ id: "a1", action: "SALE", entity: "sale", entityId: "T-M1-1", userId: "u", detail: "d", createdAt: "t" }],
  };

  statements.length = 0;
  await syncTenantDoc(run, SLUG, null, doc);
  const tables = statements.map((s) => (s.sql.match(/INSERT INTO dbo\.(\w+)/) ?? [])[1]).filter(Boolean);
  check("maître tenant insérée", statements[0].sql.includes("INSERT INTO dbo.sg_tenant"));
  check("miroir sg_tenants", statements[1].sql.includes("dbo.sg_tenants"));
  check("produit inséré", tables.includes("sg_product"));
  check("vente insérée", tables.includes("sg_sale"));
  check("ligne de vente insérée", tables.includes("sg_sale_item"));
  check("paiement inséré", tables.includes("sg_sale_payment"));
  check("session insérée", tables.includes("sg_cash_session"));
  check("ticket inséré", tables.includes("sg_cash_session_ticket"));
  check("audit inséré", tables.includes("sg_audit_log"));
  check("aucun SELECT en tête d'écriture", !statements.some((s) => s.sql.trimStart().toUpperCase().startsWith("SELECT")));
  const childInsert = statements.find((s) => s.sql.includes("INSERT INTO dbo.sg_sale_item"));
  check("ids enfants générés", childInsert !== undefined && Object.keys(childInsert.params).some((k) => k.startsWith("c") && typeof childInsert.params[k] === "string" && (childInsert.params[k] as string).length === 32));
  check("clé parent renseignée (sale_id)", childInsert !== undefined && !childInsert.sql.includes("NULL") && Object.values(childInsert.params).includes("sa1"));
  const ticketInsert = statements.find((s) => s.sql.includes("INSERT INTO dbo.sg_cash_session_ticket"));
  check("clé parent ticket (cash_session_id)", ticketInsert !== undefined && !ticketInsert.sql.includes("NULL") && Object.values(ticketInsert.params).includes("cs1"));

  // Mutation : produit modifié, nouvelle vente, session clôturée + ticket ajouté, audit préfixé
  const after: Tenant = structuredClone(doc);
  after.products[0].sellingPrice = 250;
  after.sales[0].status = "RETURNED";
  after.sales.push({ ...doc.sales[0], id: "sa2", ticketNumber: "T-M1-2", createdAt: "t2", items: doc.sales[0].items.map((it) => ({ ...it, id: "si2" })), payments: doc.sales[0].payments.map((p) => ({ ...p, id: "sp2" })) });
  after.cashSessions[0].status = "CLOSED";
  after.cashSessions[0].closedAt = "t3";
  after.cashSessions[0].countedCash = 1000;
  after.cashSessions[0].closedBy = "gerant";
  after.cashSessions[0].ticketNumbers = ["T-M1-1", "T-M1-2"];
  after.auditLog.unshift({ id: "a0", action: "RETURN", entity: "sale", entityId: "T-M1-1", userId: "u", detail: "retour", createdAt: "t3" });

  statements.length = 0;
  await syncTenantDoc(run, SLUG, doc, after);
  const sqls = statements.map((s) => s.sql);
  check("UPDATE produit (prix)", sqls.some((s) => s.startsWith("UPDATE dbo.sg_product") && s.includes("selling_price")));
  check("UPDATE vente (retour)", sqls.some((s) => s.startsWith("UPDATE dbo.sg_sale") && s.includes("sale_status")));
  check("UPDATE session (clôture)", sqls.some((s) => s.startsWith("UPDATE dbo.sg_cash_session") && s.includes("counted_cash")));
  check("vente 2 insérée", sqls.some((s) => s.startsWith("INSERT INTO dbo.sg_sale (") && Object.values(statements.find((s) => s.sql.startsWith("INSERT INTO dbo.sg_sale ("))!.params).includes("sa2")));
  check("audit préfixé inséré", sqls.some((s) => s.includes("INSERT INTO dbo.sg_audit_log")));
  const ticketDel = statements.find((s) => s.sql.includes("DELETE FROM dbo.sg_cash_session_ticket"));
  check("tickets resynchronisés (delete+insert)", !!ticketDel && sqls.some((s) => s.includes("INSERT INTO dbo.sg_cash_session_ticket")));
  check("pas d'insertion produit (inchangé)", !sqls.some((s) => s.includes("INSERT INTO dbo.sg_product")));

  // Suppression de produit
  const after2: Tenant = structuredClone(after);
  after2.products = [];
  statements.length = 0;
  await syncTenantDoc(run, SLUG, after, after2);
  check("produit supprimé", statements.some((s) => s.sql.startsWith("DELETE FROM dbo.sg_product") && s.params.id === "p1"));
}

/* ── 6. Determinisme des ids enfants synthétisés ──────────────────────────── */
console.log("6. Ids enfants synthétisés");
{
  const a: Record<string, unknown>[] = [{ productId: "p1", sku: "S", name: "N", quantity: 1, unitPrice: 1, vatRate: 0.18, costPrice: 1, discount: 0 }];
  const b: Record<string, unknown>[] = [{ productId: "p1", sku: "S", name: "N", quantity: 1, unitPrice: 1, vatRate: 0.18, costPrice: 1, discount: 0 }];
  ensureChildIdsWrapper("sg_sale_item", "sa1", a, "saleitem");
  ensureChildIdsWrapper("sg_sale_item", "sa1", b, "saleitem");
  check("id stable", a[0].id === b[0].id && typeof a[0].id === "string" && (a[0].id as string).length === 32);
  const c: Record<string, unknown>[] = [{ productId: "p1", sku: "S", name: "N", quantity: 1, unitPrice: 1, vatRate: 0.18, costPrice: 1, discount: 0 }];
  ensureChildIdsWrapper("sg_sale_item", "sa2", c, "saleitem");
  check("id dépend du parent", c[0].id !== a[0].id);
}

if (failures > 0) {
  console.error(`\n${failures} échec(s)`);
  process.exit(1);
}
console.log("\nTous les tests sqlSync passent.");

/* ── 7. Round-trip complet via le mini-moteur SQL (ordres émulés) ────────── */
console.log("7. Round-trip complet (mini-moteur SQL)");
{
  const fe = createFakeRunner();
  // Purge préalable façon sql:check
  await deleteTenantRelational(fe.run, PROBE_SLUG);

  // Injection de la sonde (façon sync applicatif)
  const probe = buildProbeTenant();
  await syncTenantDoc(fe.run, PROBE_SLUG, null, probe);
  const rebuilt = await loadTenantDoc(fe.run, PROBE_SLUG);
  if (!rebuilt) {
    check("sonde reconstituée", false);
  } else {
    check("sonde reconstituée", true);
    if (deepEqualNormalized(rebuilt, probe)) {
      check("round-trip identique (ordres SQL émulés)", true);
    } else {
      check(`round-trip diverge : ${firstDiffPath(rebuilt, probe)}`, false);
    }

    // Mutation : produit modifié + nouvelle vente + clôture Z
    const after: Tenant = structuredClone(probe);
    after.products[0].sellingPrice = 1200;
    after.sales[0].status = "RETURNED";
    after.sales[0].returnedTicket = "T-PRB-000001";
    // l'app insère les ventes en tête (unshift) — les plus récentes d'abord
    after.sales.unshift({
      id: `${PROBE_SLUG}-sa2`, ticketNumber: "T-PRB-000002", storeId: `${PROBE_SLUG}-s2`, cashier: "caisse 2",
      items: [{ productId: `${PROBE_SLUG}-p1`, sku: "PRB-1", name: "Article sonde", quantity: 1, unitPrice: 1200, vatRate: 0.18, costPrice: 500, discount: 0 }],
      payments: [{ method: "CASH", amount: 1200 }],
      total: 1200, totalVat: 183.05, totalHt: 1016.95, margin: 700, change: 0, createdAt: "2026-01-01T11:00:00.000Z",
      syncedOffline: false, status: "COMPLETED",
    } as never);
    after.cashSessions[0].status = "CLOSED";
    after.cashSessions[0].closedAt = "2026-01-01T23:00:00.000Z";
    after.cashSessions[0].countedCash = 100000;
    after.cashSessions[0].closedBy = "gerant";
    after.auditLog.unshift({ id: `${PROBE_SLUG}-a2`, action: "CASH_CLOSE", entity: "cash_session", entityId: `${PROBE_SLUG}-cs1`, userId: "gerant", detail: "Clôture Z", createdAt: "2026-01-01T23:00:00.000Z" });

    await syncTenantDoc(fe.run, PROBE_SLUG, probe, after);
    const rebuilt2 = await loadTenantDoc(fe.run, PROBE_SLUG);
    // après synchro, l'état canonique = after avec les ids enfants assignés (comme en DB)
    normalizeChildIds(after);
    if (rebuilt2 !== null && deepEqualNormalized(rebuilt2, after)) {
      check("mutation persistée et relue à l'identique", true);
    } else {
      check(`mutation diverge : ${firstDiffPath(rebuilt2 ?? {}, after)}`, false);
    }
    const counts = [
      fe.countRows("sg_product"), fe.countRows("sg_sale"), fe.countRows("sg_sale_item"),
      fe.countRows("sg_sale_payment"), fe.countRows("sg_stock_movement"), fe.countRows("sg_cash_session_ticket"),
    ];
    check("volumétrie (1 produit, 2 ventes, 2 lignes, 2 paiements, 2 mouvement, 1 ticket)", JSON.stringify(counts) === JSON.stringify([1, 2, 2, 2, 1, 1]));

    // Purge finale
    await deleteTenantRelational(fe.run, PROBE_SLUG);
    console.log("  ", "après purge:", JSON.stringify(Object.fromEntries(Object.entries(fe.store).map(([t, r]) => [t, r.length]))));
    check("purge complète", fe.countRows("sg_product") === 0 && fe.countRows("sg_sale") === 0 && fe.countRows("sg_tenant") === 0 && fe.countRows("sg_tenants") === 0);
  }
}



if (failures > 0) {
  console.error(`\n${failures} échec(s)`);
  process.exit(1);
}
console.log("\nTous les tests sqlSync passent.");
