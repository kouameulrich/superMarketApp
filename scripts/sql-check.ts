/**
 * Vérification de la connexion SQL Server depuis le poste/le réseau de l'instance.
 * Usage : bun run sql:check  (ou : npx tsx scripts/sql-check.ts)
 * Requiert MSSQL_CONNECTION_STRING : variable d'environnement ou .env.local à la racine.
 *
 * Valide : connexion, table sg_tenants (métadonnées + miroir), round-trip
 * écriture/lecture, schéma relationnel complet (18 tables), et round-trip
 * applicatif complet (sync diff → reconstitution du document → purge).
 */
import { readFileSync } from "fs";
import * as sqlStore from "../src/lib/sqlStore";
import { loadTenantDoc, syncTenantDoc, deleteTenantRelational, type SqlRunner } from "../src/lib/sqlSync";
import type { Tenant } from "../src/lib/types";

const PROBE_SLUG = "__sql_probe__";

/** Charge MSSQL_CONNECTION_STRING depuis .env.local si la variable n'est pas déjà définie. */
function loadEnvFile(): void {
  const env = process.env.MSSQL_CONNECTION_STRING?.trim();
  if (env) return;
  try {
    const content = readFileSync(".env.local", "utf8");
    for (const line of content.split(/\r?\n/)) {
      const m = line.match(/^\s*MSSQL_CONNECTION_STRING\s*=\s*(.+?)\s*$/);
      if (m) {
        process.env.MSSQL_CONNECTION_STRING = m[1].replace(/^"(.*)"$/, "$1");
        return;
      }
    }
  } catch {
    // pas de .env.local : l'erreur claire est levée plus bas
  }
}

/** Document tenant minimal couvrant toutes les tables relationnelles. */
function buildProbeTenant(): Tenant {
  const createdAt = "2026-01-01T10:00:00.000Z";
  return {
    id: PROBE_SLUG,
    slug: PROBE_SLUG,
    name: "Probe",
    plan: "STARTER",
    createdAt,
    users: [{ id: `${PROBE_SLUG}-u1`, username: "probe", passwordHash: "h".repeat(64), salt: "s", displayName: "Sonde", role: "ADMIN", active: true, createdAt }],
    stores: [{ id: `${PROBE_SLUG}-s1`, code: "PRB", name: "Magasin sonde", isHub: false, address: "1 rue Test", city: "Testville" }],
    suppliers: [{ id: `${PROBE_SLUG}-f1`, code: "F-PRB", name: "Fournisseur sonde", email: "probe@test.tld", phone: "000", leadTimeDays: 2, paymentTerms: "Comptant" }],
    products: [{
      id: `${PROBE_SLUG}-p1`, sku: "PRB-1", barcode: "0000000000000", name: "Article sonde", category: "Test", brand: "Probe",
      costPrice: 500, vatRate: 0.18, sellingPrice: 1000, unit: "UNIT", minStockLevel: 5, supplierId: `${PROBE_SLUG}-f1`, active: true, createdAt,
    }],
    batches: [{ id: `${PROBE_SLUG}-b1`, productId: `${PROBE_SLUG}-p1`, storeId: `${PROBE_SLUG}-s1`, batchNumber: "LOT-PRB", dlc: "2027-01-01", quantity: 10 }],
    stockMovements: [{ id: `${PROBE_SLUG}-m1`, storeId: `${PROBE_SLUG}-s1`, productId: `${PROBE_SLUG}-p1`, type: "SUPPLIER_IN", quantity: 10, reference: "PRB-1", note: "sonde", createdBy: "sql:check", createdAt }],
    transferOrders: [{
      id: `${PROBE_SLUG}-t1`, codeReference: "OT-PRB-1", sourceStoreId: `${PROBE_SLUG}-s1`, destinationStoreId: `${PROBE_SLUG}-s1`,
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

/** Comparaison profonde en ignorant les clés à null (champs optionnels du document). */
function deepEqualNormalized(a: unknown, b: unknown): boolean {
  const strip = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(strip);
    if (v && typeof v === "object") {
      const out: Record<string, unknown> = {};
      for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
        if (val !== null && val !== undefined) out[k] = strip(val);
      }
      return out;
    }
    return v;
  };
  return JSON.stringify(strip(a)) === JSON.stringify(strip(b));
}

async function main() {
  loadEnvFile();
  if (!sqlStore.isSqlConfigured()) {
    console.error("✗ MSSQL_CONNECTION_STRING n'est pas défini (créez .env.local à la racine du projet, voir .env.local.example)");
    process.exit(1);
  }

  console.log("… Connexion à SQL Server");
  await sqlStore.ensureSchema();
  console.log("✓ Connexion OK — table dbo.sg_tenants prête");

  const pool = await sqlStore.getSqlPool();
  const run: SqlRunner = async <T>(sql: string, params?: Record<string, unknown>) => {
    const req = pool.request();
    for (const [k, v] of Object.entries(params ?? {})) req.input(k, v as never);
    const res = await req.query<T>(sql);
    return res.recordset as T[];
  };

  // ── 1. Métadonnées + miroir : round-trip sur sg_tenants
  const probe: Tenant = buildProbeTenant();
  await sqlStore.saveTenant(probe);
  const all = await sqlStore.loadAllTenants();
  if (!all[PROBE_SLUG]) throw new Error("Lecture du tenant sonde impossible après upsert");
  console.log(`✓ sg_tenants : écriture/lecture round-trip OK — ${Object.keys(all).length} tenant(s)`);

  // ── 2. Schéma relationnel présent ?
  const tbl = await run<{ n: number }>(`SELECT COUNT(*) AS n FROM sys.tables WHERE name LIKE 'sg[_]%'`);
  const tableCount = Number(tbl[0]?.n ?? 0);
  if (tableCount < 18) {
    console.warn(`⚠ ${tableCount}/18 tables relationnelles présentes — exécutez sql/schema.sql (la validation relationnelle est ignorée)`);
    await sqlStore.deleteTenant(PROBE_SLUG);
  } else {
    console.log(`✓ Schéma relationnel complet — ${tableCount} tables sg_*`);

    // ── 3. Round-trip applicatif : sync diff → reconstitution → comparaison
    await syncTenantDoc(run, PROBE_SLUG, null, probe);
    const rebuilt = await loadTenantDoc(run, PROBE_SLUG);
    if (!rebuilt) throw new Error("Reconstitution du tenant sonde impossible");
    if (!deepEqualNormalized(rebuilt, probe)) {
      const a = JSON.stringify(rebuilt), b = JSON.stringify(probe);
      throw new Error(`Document reconstitué différent (longueurs ${a.length} vs ${b.length})`);
    }
    console.log("✓ Round-trip relationnel OK — 18 tables écrites puis reconstituées à l'identique");

    // ── 4. Purge de la sonde relationnelle (la table reste vide pour le seed)
    await deleteTenantRelational(run, PROBE_SLUG);
    const left = await run<{ n: number }>(`SELECT COUNT(*) AS n FROM dbo.sg_tenant WHERE slug = @slug`, { slug: PROBE_SLUG });
    if (Number(left[0]?.n ?? 0) > 0) throw new Error("Échec du nettoyage de la sonde relationnelle");
    console.log("✓ Sonde relationnelle supprimée — état propre");
  }

  // ── 5. Nettoyage du miroir sg_tenants dans tous les cas
  await sqlStore.deleteTenant(PROBE_SLUG);

  const versionRes = await run<{ v: string }>(`SELECT @@VERSION AS v`);
  console.log("—", (versionRes[0]?.v.split("\n")[0] ?? "").slice(0, 120));
  console.log("✓ SQL Server opérationnel pour SuperGestion. Lancez l'app : le seed s'injecte automatiquement si les tables sont vides.");
  process.exit(0);
}

main().catch((e: unknown) => {
  console.error("✗ Échec SQL Server :", e instanceof Error ? e.message : e);
  process.exit(1);
});
