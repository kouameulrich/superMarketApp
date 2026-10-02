import { promises as fs } from "fs";
import path from "path";
import { buildSeedDatabase, defaultUsers } from "./seed";
import * as sqlStore from "./sqlStore";
import { loadTenantDoc, syncTenantDoc, type SqlRunner } from "./sqlSync";
import type { Database, Tenant, UUID } from "./types";

/**
 * Persistance "schema-per-tenant" (PRD §4.1), deux modes :
 *
 * - **SQL Server** (quand MSSQL_CONNECTION_STRING est défini) : le document
 *   `Tenant` est reconstitué à la lecture depuis les 17 tables relationnelles
 *   (sql/schema.sql) et chaque mutation est commitée en une transaction via un
 *   diff snapshot-avant/snapshot-après (sqlSync.ts) ;
 * - **JSON local** (repli) : un document par tenant sur disque, read-modify-write
 *   sérialisé avec écriture atomique tmp+rename.
 *
 * L'étanchéité entre tenants reste garantie par la résolution côté serveur
 * (session signée), jamais par le client.
 */
const DATA_DIR = process.env.SG_DATA_DIR ?? path.join(process.cwd(), ".data");
const DATA_FILE = path.join(DATA_DIR, "supergestion.json");

export interface TenantMeta {
  slug: string;
  name: string;
  plan: string;
}

let fileCache: Database | null = null;
let loadPromise: Promise<Database> | null = null;
let queue: Promise<unknown> = Promise.resolve();
let sqlSeedPromise: Promise<void> | null = null;

/* ── Mode JSON local ──────────────────────────────────────────────────────── */

async function loadFile(): Promise<Database> {
  try {
    return JSON.parse(await fs.readFile(DATA_FILE, "utf8")) as Database;
  } catch {
    return buildSeedDatabase();
  }
}

/** Migration douce : données antérieures à l'authentification → comptes de démo. */
async function migrateUsers(db: Database): Promise<boolean> {
  let migrated = false;
  for (const tenant of Object.values(db.tenants)) {
    if (!tenant.users?.length) {
      tenant.users = defaultUsers(tenant.slug);
      migrated = true;
    }
  }
  return migrated;
}

async function loadFileDb(): Promise<Database> {
  if (fileCache) return fileCache;
  loadPromise ??= (async () => {
    let db = await loadFile();
    if (await migrateUsers(db)) await persistFile(db);
    if (!db.tenants || Object.keys(db.tenants).length === 0) {
      db = buildSeedDatabase();
      await persistFile(db);
    }
    fileCache = db;
    return db;
  })();
  return loadPromise;
}

async function persistFile(db: Database): Promise<void> {
  await fs.mkdir(DATA_DIR, { recursive: true });
  const json = JSON.stringify(db);
  try {
    const tmp = `${DATA_FILE}.tmp`;
    await fs.writeFile(tmp, json, "utf8");
    await fs.rename(tmp, DATA_FILE);
  } catch {
    // repli : écriture directe en dernier recours
    await fs.writeFile(DATA_FILE, json, "utf8");
  }
}

/* ── Mode SQL Server ─────────────────────────────────────────────────────── */

const sqlMode = (): boolean => sqlStore.isSqlConfigured();

/** Exécuteur non-transactionnel (lectures). */
async function sqlRunner(): Promise<SqlRunner> {
  const pool = await sqlStore.getSqlPool();
  return async <T>(sql: string, params?: Record<string, unknown>) => {
    const req = pool.request();
    for (const [k, v] of Object.entries(params ?? {})) req.input(k, v as never);
    const res = await req.query<T>(sql);
    return res.recordset as T[];
  };
}

/** Transaction : exécuteur lié + commit/rollback. */
async function withSqlTxn<T>(fn: (run: SqlRunner) => Promise<T>): Promise<T> {
  const pool = await sqlStore.getSqlPool();
  const txn = pool.transaction();
  await txn.begin();
  const run: SqlRunner = async <T>(sql: string, params?: Record<string, unknown>) => {
    const req = txn.request();
    for (const [k, v] of Object.entries(params ?? {})) req.input(k, v as never);
    const res = await req.query<T>(sql);
    return res.recordset as T[];
  };
  try {
    const out = await fn(run);
    await txn.commit();
    return out;
  } catch (e) {
    try {
      await txn.rollback();
    } catch {
      // rollback déjà effectué
    }
    throw e;
  }
}

/** Injection du seed au premier démarrage (tables relationnelles vides). */
async function ensureSqlSeeded(): Promise<void> {
  sqlSeedPromise ??= (async () => {
    await sqlStore.ensureSchema();
    const run = await sqlRunner();
    const rows = await run<{ n: number }>(`SELECT COUNT(*) AS n FROM dbo.sg_tenant`);
    if (Number(rows[0]?.n ?? 0) > 0) return;
    const seed = buildSeedDatabase();
    for (const tenant of Object.values(seed.tenants)) {
      try {
        await withSqlTxn((run) => syncTenantDoc(run, tenant.slug, null, tenant));
      } catch (e) {
        // course entre instances : le seed a déjà été injecté ailleurs
        const msg = e instanceof Error ? e.message : String(e);
        if (!/2627|2628|UX_sg_tenant_slug|Violation/i.test(msg)) throw e;
      }
    }
  })();
  return sqlSeedPromise;
}

/* ── API commune ─────────────────────────────────────────────────────────── */

/** Sérialise les écritures pour éviter les écrasements concurrents. */
function serialized<T>(fn: () => Promise<T>): Promise<T> {
  const next = queue.then(fn, fn);
  queue = next.catch(() => undefined);
  return next;
}

export async function getTenant(slug: string): Promise<Tenant | null> {
  if (sqlMode()) {
    await ensureSqlSeeded();
    const run = await sqlRunner();
    return loadTenantDoc(run, slug);
  }
  const db = await loadFileDb();
  return db.tenants[slug] ?? null;
}

/** Métadonnées d'enseignes (écran de connexion). */
export async function listTenants(): Promise<TenantMeta[]> {
  if (sqlMode()) {
    await ensureSqlSeeded();
    const run = await sqlRunner();
    const rows = await run<{ slug: string; name: string; plan_type: string }>(
      `SELECT slug, name, plan_type FROM dbo.sg_tenant ORDER BY name`,
    );
    return rows.map((r) => ({ slug: r.slug, name: r.name, plan: r.plan_type }));
  }
  const db = await loadFileDb();
  return Object.values(db.tenants).map((t) => ({ slug: t.slug, name: t.name, plan: t.plan }));
}

/** Lecture brute d'un tenant (résolution serveur uniquement). */
export async function readTenant<T>(slug: string, fn: (t: Tenant) => T): Promise<T | null> {
  const tenant = await getTenant(slug);
  return tenant ? fn(tenant) : null;
}

/**
 * Mutation atomique d'un tenant : snapshot de l'agrégat → mutation applicative
 * → synchronisation relationnelle en une transaction (mode SQL), ou
 * read-modify-write sérialisé sur le document (mode JSON).
 */
export async function mutateTenant<T>(slug: string, fn: (t: Tenant) => T | Promise<T>): Promise<T> {
  return serialized(async () => {
    if (sqlMode()) {
      await ensureSqlSeeded();
      return withSqlTxn(async (run) => {
        const before = await loadTenantDoc(run, slug);
        if (!before) throw new Error(`Tenant inconnu: ${slug}`);
        const after: Tenant = structuredClone(before);
        const result = await fn(after);
        await syncTenantDoc(run, slug, before, after);
        return result;
      });
    }
    const db = await loadFileDb();
    const tenant = db.tenants[slug];
    if (!tenant) throw new Error(`Tenant inconnu: ${slug}`);
    const result = await fn(tenant);
    await persistFile(db);
    return result;
  });
}

export function newId(): UUID {
  return globalThis.crypto.randomUUID();
}
