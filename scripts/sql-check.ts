/**
 * Vérification de la connexion SQL Server depuis le poste/le réseau de l'instance.
 * Usage : bun run sql:check
 * Requiert MSSQL_CONNECTION_STRING (voir .env.local).
 */
import * as sqlStore from "../src/lib/sqlStore";
import type { Tenant } from "../src/lib/types";

const PROBE_SLUG = "__sql_probe__";

async function main() {
  if (!sqlStore.isSqlConfigured()) {
    console.error("✗ MSSQL_CONNECTION_STRING n'est pas défini (créez .env.local, voir .env.local.example)");
    process.exit(1);
  }

  console.log("… Connexion à SQL Server");
  await sqlStore.ensureSchema();
  console.log("✓ Connexion OK — schéma dbo.sg_tenants prêt");

  const probe: Tenant = {
    id: PROBE_SLUG,
    slug: PROBE_SLUG,
    name: "Probe",
    plan: "STARTER",
    createdAt: new Date().toISOString(),
    users: [],
    stores: [],
    products: [],
    batches: [],
    stockMovements: [],
    transferOrders: [],
    suppliers: [],
    purchaseOrders: [],
    sales: [],
    cashSessions: [],
    auditLog: [],
  };
  await sqlStore.saveTenant(probe);
  const all = await sqlStore.loadAllTenants();
  if (!all[PROBE_SLUG]) throw new Error("Lecture du tenant sonde impossible après upsert");
  console.log(`✓ Écriture/lecture round-trip OK — ${Object.keys(all).length} tenant(s) dans dbo.sg_tenants`);

  // Nettoyage de la sonde : la table ne doit pas rester non-vide, sinon le seed de
  // démonstration ne s'injecterait pas au démarrage de l'app.
  await sqlStore.deleteTenant(PROBE_SLUG);
  const after = await sqlStore.loadAllTenants();
  if (after[PROBE_SLUG]) throw new Error("Échec du nettoyage de la sonde");
  console.log(`✓ Sonde supprimée — état propre (${Object.keys(after).length} tenant(s) applicatif(s))`);

  const pool = await (async () => {
    const mssql = await import("mssql");
    const p = new mssql.ConnectionPool(sqlStore.parseConnectionString(process.env.MSSQL_CONNECTION_STRING!.trim()));
    await p.connect();
    return p;
  })();
  const versionRes = await pool.request().query<{ v: string }>("SELECT @@VERSION AS v");
  console.log("—", (versionRes.recordset[0].v.split("\n")[0] ?? "").slice(0, 120));
  console.log("✓ SQL Server opérationnel pour SuperGestion. Lancez l'app : le seed s'injecte automatiquement si la table est vide.");
  process.exit(0);
}

main().catch((e: unknown) => {
  console.error("✗ Échec SQL Server :", e instanceof Error ? e.message : e);
  process.exit(1);
});
