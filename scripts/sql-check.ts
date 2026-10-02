/**
 * Vérification de la connexion SQL Server depuis le poste/le réseau de l'instance.
 * Usage : bun run sql:check  (ou : npx tsx scripts/sql-check.ts) — rev 6
 * Requiert MSSQL_CONNECTION_STRING : variable d'environnement ou .env.local à la racine.
 *
 * Valide : connexion, table sg_tenants (métadonnées + miroir), round-trip
 * écriture/lecture, schéma relationnel complet (18 tables), et round-trip
 * applicatif complet (sync diff → reconstitution du document → purge),
 * exécuté en transaction pour ne jamais laisser d'état partiel.
 */
import { readFileSync } from "fs";
import * as sqlStore from "../src/lib/sqlStore";
import { deleteTenantRelational, loadTenantDoc, serializeRunner, syncTenantDoc, type SqlRunner } from "../src/lib/sqlSync";
import { buildProbeTenant, deepEqualNormalized, firstDiffPath, PROBE_SLUG } from "./probe-utils";

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

async function main() {
  loadEnvFile();
  if (!sqlStore.isSqlConfigured()) {
    console.error("✗ MSSQL_CONNECTION_STRING n'est pas défini (créez .env.local à la racine du projet, voir .env.local.example)");
    process.exit(1);
  }

  try {
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

    // Purge d'une éventuelle sonde résiduelle (échec d'une exécution antérieure)
    await deleteTenantRelational(run, PROBE_SLUG);
    await sqlStore.deleteTenant(PROBE_SLUG);

    // ── 1. Métadonnées + miroir : round-trip sur sg_tenants
    const probe = buildProbeTenant();
    await sqlStore.saveTenant(probe);
    const all = await sqlStore.loadAllTenants();
    if (!all[PROBE_SLUG]) throw new Error("Lecture du tenant sonde impossible après upsert");
    console.log(`✓ sg_tenants : écriture/lecture round-trip OK — ${Object.keys(all).length} tenant(s)`);

    // ── 2. Schéma relationnel présent ?
    const tbl = await run<{ n: number }>(`SELECT COUNT(*) AS n FROM sys.tables WHERE name LIKE 'sg[_]%'`);
    const tableCount = Number(tbl[0]?.n ?? 0);
    if (tableCount < 18) {
      console.warn(`⚠ ${tableCount}/18 tables relationnelles présentes — exécutez sql/schema.sql (la validation relationnelle est ignorée)`);
    } else {
      console.log(`✓ Schéma relationnel complet — ${tableCount} tables sg_*`);

      // ── 3. Round-trip applicatif EN TRANSACTION : sync diff → reconstitution → comparaison
      const txn = pool.transaction();
      await txn.begin();
      const rawRun: SqlRunner = async <T>(sql: string, params?: Record<string, unknown>) => {
        const req = txn.request();
        for (const [k, v] of Object.entries(params ?? {})) req.input(k, v as never);
        const res = await req.query<T>(sql);
        return res.recordset as T[];
      };
      const runTx = serializeRunner(rawRun);
      try {
        await syncTenantDoc(runTx, PROBE_SLUG, null, probe);
        const rebuilt = await loadTenantDoc(runTx, PROBE_SLUG);
        if (!rebuilt) throw new Error("Reconstitution du tenant sonde impossible");
        if (!deepEqualNormalized(rebuilt, probe)) {
          throw new Error(`Document reconstitué différent : ${firstDiffPath(rebuilt, probe, "$") || "(position inconnue)"}`);
        }
        await txn.commit();
        console.log("✓ Round-trip relationnel OK — 18 tables écrites puis reconstituées à l'identique");
      } catch (e) {
        await txn.rollback().catch(() => undefined);
        throw e;
      }
    }

    const versionRes = await run<{ v: string }>(`SELECT @@VERSION AS v`);
    console.log("—", (versionRes[0]?.v.split("\n")[0] ?? "").slice(0, 120));
    console.log("✓ SQL Server opérationnel pour SuperGestion. Lancez l'app : le seed s'injecte automatiquement si les tables sont vides.");
  } finally {
    // Quel que soit le résultat : aucune trace de sonde ne doit subsister
    try {
      const pool = await sqlStore.getSqlPool();
      const run: SqlRunner = async <T>(sql: string, params?: Record<string, unknown>) => {
        const req = pool.request();
        for (const [k, v] of Object.entries(params ?? {})) req.input(k, v as never);
        const res = await req.query<T>(sql);
        return res.recordset as T[];
      };
      await deleteTenantRelational(run, PROBE_SLUG);
      await sqlStore.deleteTenant(PROBE_SLUG);
    } catch {
      // la connexion était peut-être déjà rompue
    }
  }

  process.exit(0);
}

main().catch((e: unknown) => {
  console.error("✗ Échec SQL Server :", e instanceof Error ? e.message : e);
  process.exit(1);
});
