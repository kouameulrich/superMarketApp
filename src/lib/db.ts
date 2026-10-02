import { promises as fs } from "fs";
import path from "path";
import { buildSeedDatabase, defaultUsers } from "./seed";
import * as sqlStore from "./sqlStore";
import type { Database, Tenant, UUID } from "./types";

/**
 * Persistance "schema-per-tenant" (PRD §4.1) :
 * - SQL Server (dbo.sg_tenants, document JSON par tenant) quand MSSQL_CONNECTION_STRING est défini ;
 * - sinon repli : un document JSON isolé par tenant sur disque (simulant le schéma PostgreSQL dédié).
 * Étanchéité garantie par la résolution du tenant côté serveur uniquement (jamais depuis le client).
 */
const DATA_DIR = process.env.SG_DATA_DIR ?? path.join(process.cwd(), ".data");
const DATA_FILE = path.join(DATA_DIR, "supergestion.json");

let cache: Database | null = null;
let loadPromise: Promise<Database> | null = null;
let queue: Promise<unknown> = Promise.resolve();

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

async function load(): Promise<Database> {
  if (cache) return cache;
  // single-flight : seuls le premier accès charge et sème les données
  loadPromise ??= (async () => {
    let db: Database;
    if (sqlStore.isSqlConfigured()) {
      await sqlStore.ensureSchema();
      const tenants = await sqlStore.loadAllTenants();
      if (Object.keys(tenants).length === 0) {
        db = buildSeedDatabase();
        for (const tenant of Object.values(db.tenants)) await sqlStore.saveTenant(tenant);
      } else {
        db = { tenants };
        if (await migrateUsers(db)) {
          for (const tenant of Object.values(db.tenants)) await sqlStore.saveTenant(tenant);
        }
      }
    } else {
      db = await loadFile();
      if (await migrateUsers(db)) await persistFile(db);
      if (!db.tenants || Object.keys(db.tenants).length === 0) {
        db = buildSeedDatabase();
        await persistFile(db);
      }
    }
    cache = db;
    return db;
  })();
  const result = await loadPromise;
  return result;
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

/** Sérialise les écritures pour éviter les écrasements concurrents. */
function serialized<T>(fn: () => Promise<T>): Promise<T> {
  const next = queue.then(fn, fn);
  queue = next.catch(() => undefined);
  return next;
}

export async function getTenant(slug: string): Promise<Tenant | null> {
  const db = await load();
  return db.tenants[slug] ?? null;
}

export async function listTenants(): Promise<Tenant[]> {
  const db = await load();
  return Object.values(db.tenants);
}

/** Lecture brute d'un tenant (résolution serveur uniquement). */
export async function readTenant<T>(slug: string, fn: (t: Tenant) => T): Promise<T | null> {
  const tenant = await getTenant(slug);
  return tenant ? fn(tenant) : null;
}

/** Mutation atomique d'un tenant : read-modify-write sérialisé puis persisté. */
export async function mutateTenant<T>(slug: string, fn: (t: Tenant) => T | Promise<T>): Promise<T> {
  return serialized(async () => {
    const db = await load();
    const tenant = db.tenants[slug];
    if (!tenant) throw new Error(`Tenant inconnu: ${slug}`);
    const result = await fn(tenant);
    if (sqlStore.isSqlConfigured()) {
      await sqlStore.saveTenant(tenant);
    } else {
      await persistFile(db);
    }
    return result;
  });
}

export function newId(): UUID {
  return globalThis.crypto.randomUUID();
}
