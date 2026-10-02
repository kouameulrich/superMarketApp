/**
 * Injecte le jeu de données de démonstration dans SQL Server (tenants manquants uniquement).
 * Usage : bun run db:seed   (requiert MSSQL_CONNECTION_STRING ou .env.local)
 */
import { readFileSync, existsSync } from "fs";
import { seedSqlDatabase } from "../src/lib/db";
import * as sqlStore from "../src/lib/sqlStore";
import type { SqlRunner } from "../src/lib/sqlSync";

const TABLES = [
  "sg_user", "sg_store", "sg_product", "sg_supplier", "sg_batch", "sg_stock_movement",
  "sg_transfer_order", "sg_transfer_item", "sg_purchase_order", "sg_purchase_order_item",
  "sg_sale", "sg_sale_item", "sg_sale_payment", "sg_cash_session", "sg_cash_session_ticket",
  "sg_audit_log", "sg_tenant", "sg_tenants",
];

function loadEnvFile(): void {
  if (process.env.MSSQL_CONNECTION_STRING?.trim()) return;
  if (existsSync(".env.local")) {
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
      // erreur signalée plus bas
    }
  }
}

async function main() {
  loadEnvFile();
  if (!sqlStore.isSqlConfigured()) {
    console.error("✗ MSSQL_CONNECTION_STRING n'est pas défini (créez .env.local à la racine du projet, voir .env.local.example)");
    process.exit(1);
  }

  console.log("… Injection du seed dans SQL Server");
  const reports = await seedSqlDatabase();
  if (!reports) {
    console.log("— Aucun tenant manquant : les données existantes de SQL Server sont conservées (rien n'a été modifié).");
  } else {
    for (const [slug, report] of Object.entries(reports)) {
      const detail = Object.entries(report.tables).sort().map(([t, n]) => `${t}:${n}`).join(", ");
      console.log(`✓ ${slug} — ${report.total} ligne(s) écrite(s)${detail ? " : " + detail : ""}`);
    }
  }

  const pool = await sqlStore.getSqlPool();
  const run: SqlRunner = async <T>(sql: string, params?: Record<string, unknown>) => {
    const req = pool.request();
    for (const [k, v] of Object.entries(params ?? {})) req.input(k, v as never);
    const res = await req.query<T>(sql);
    return res.recordset as T[];
  };
  const counts = await Promise.all(TABLES.map((t) => run<{ t: string; n: number }>(
    `SELECT '${t}' AS t, COUNT(*) AS n FROM dbo.${t}`,
  )));
  console.log("— Compteurs :");
  for (const { t, n } of counts.flat()) console.log(`    ${t.padEnd(24)} ${n} ligne(s)`);
  process.exit(0);
}

main().catch((e: unknown) => {
  console.error("✗ Échec du seed :", e instanceof Error ? e.message : e);
  process.exit(1);
});
