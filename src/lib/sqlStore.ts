import type { Tenant } from "./types";

/**
 * Persistance SQL Server (driver mssql/Tedious) — activée quand MSSQL_CONNECTION_STRING
 * est défini, sinon l'app retombe sur le store JSON local (db.ts).
 *
 * Modèle « schema-per-tenant » simulé (PRD §4.1) : un document JSON par tenant dans
 * dbo.sg_tenants, colonnes opérationnelles (name, plan) exposées pour l'exploitation.
 * Écritures = read-modify-write sérialisé côté process (db.ts) puis upsert du document.
 */

export function isSqlConfigured(): boolean {
  return Boolean(process.env.MSSQL_CONNECTION_STRING?.trim());
}

type SqlPool = import("mssql").ConnectionPool;
type SqlModule = typeof import("mssql");

let poolPromise: Promise<SqlPool> | null = null;

/** Accepte `mssql://user:pass@host:1433/db` ou une chaîne ADO `Server=…;Database=…;User Id=…;Password=…`. */
export function parseConnectionString(cs: string): import("mssql").config {
  if (/^(mssql|sqlserver):\/\//i.test(cs)) {
    return cs as unknown as import("mssql").config;
  }
  const kv: Record<string, string> = {};
  for (const part of cs.split(";")) {
    const idx = part.indexOf("=");
    if (idx > 0) kv[part.slice(0, idx).trim().toLowerCase()] = part.slice(idx + 1).trim();
  }
  const rawServer = kv["server"] ?? kv["data source"] ?? kv["addr"] ?? kv["address"] ?? "localhost";
  const [host, portPart] = rawServer.split(",");
  return {
    server: host,
    port: portPart ? Number(portPart) : 1433,
    database: kv["database"] ?? kv["initial catalog"] ?? "supergestion",
    user: kv["user id"] ?? kv["uid"] ?? kv["user"],
    password: kv["password"] ?? kv["pwd"],
    options: {
      encrypt: kv["encrypt"] !== "false",
      trustServerCertificate: kv["trustservercertificate"] !== "false",
    },
  };
}

async function getPool(): Promise<SqlPool> {
  poolPromise ??= (async () => {
    const mssql: SqlModule = await import("mssql");
    const cs = process.env.MSSQL_CONNECTION_STRING!.trim();
    const pool = new mssql.ConnectionPool(parseConnectionString(cs));
    await pool.connect();
    return pool;
  })();
  return poolPromise;
}

const SCHEMA_SQL = `
IF OBJECT_ID(N'dbo.sg_tenants', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.sg_tenants (
    slug NVARCHAR(64) NOT NULL CONSTRAINT PK_sg_tenants PRIMARY KEY,
    name NVARCHAR(200) NOT NULL,
    plan NVARCHAR(20) NOT NULL,
    data NVARCHAR(MAX) NOT NULL,
    updated_at DATETIME2 NOT NULL CONSTRAINT DF_sg_tenants_updated DEFAULT (SYSUTCDATETIME())
  );
END`;

export async function ensureSchema(): Promise<void> {
  const pool = await getPool();
  await pool.request().query(SCHEMA_SQL);
}

export async function loadAllTenants(): Promise<Record<string, Tenant>> {
  const pool = await getPool();
  const res = await pool.request().query<{ slug: string; data: string }>(
    "SELECT slug, data FROM dbo.sg_tenants",
  );
  const tenants: Record<string, Tenant> = {};
  for (const row of res.recordset) {
    tenants[row.slug] = JSON.parse(row.data) as Tenant;
  }
  return tenants;
}

export async function saveTenant(tenant: Tenant): Promise<void> {
  const pool = await getPool();
  const mssql: SqlModule = await import("mssql");
  await pool
    .request()
    .input("slug", mssql.NVarChar(64), tenant.slug)
    .input("name", mssql.NVarChar(200), tenant.name)
    .input("plan", mssql.NVarChar(20), tenant.plan)
    .input("data", mssql.NVarChar(mssql.MAX), JSON.stringify(tenant))
    .query(`
      IF EXISTS (SELECT 1 FROM dbo.sg_tenants WHERE slug = @slug)
        UPDATE dbo.sg_tenants SET name = @name, plan = @plan, data = @data, updated_at = SYSUTCDATETIME() WHERE slug = @slug
      ELSE
        INSERT INTO dbo.sg_tenants (slug, name, plan, data) VALUES (@slug, @name, @plan, @data)
    `);
}
