import { promises as fs } from "fs";
import path from "path";
import { buildSeedDatabase } from "./seed";
import type { Database, Tenant, UUID } from "./types";

/**
 * Persistance "schema-per-tenant" simulée : un document JSON isolé par tenant,
 * à la manière d'un schéma PostgreSQL dédié (PRD §4.1). Étanchéité garantie par
 * la résolution du tenant côté serveur uniquement (jamais depuis le client).
 */
const DATA_DIR = process.env.SG_DATA_DIR ?? path.join(process.cwd(), ".data");
const DATA_FILE = path.join(DATA_DIR, "supergestion.json");

let cache: Database | null = null;
let loadPromise: Promise<Database> | null = null;
let queue: Promise<unknown> = Promise.resolve();

async function load(): Promise<Database> {
  if (cache) return cache;
  // single-flight : seuls le premier accès charge et sème les données
  loadPromise ??= (async () => {
    let db: Database;
    try {
      db = JSON.parse(await fs.readFile(DATA_FILE, "utf8")) as Database;
    } catch {
      db = buildSeedDatabase();
      await persist(db);
    }
    cache = db;
    return db;
  })();
  const result = await loadPromise;
  return result;
}

async function persist(db: Database): Promise<void> {
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
    await persist(db);
    return result;
  });
}

export function newId(): UUID {
  return globalThis.crypto.randomUUID();
}
