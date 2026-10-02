/**
 * Mini-moteur SQL en mémoire pour tester sqlSync hors-ligne (scripts de validation).
 * Applique fidèlement les formes de requêtes générées par sqlSync.ts :
 * INSERT multi-valeurs paramétré, UPDATE/DELETE par id+tenant, DELETE enfants
 * par parent, JOIN enfants par tenant, SELECT triés (émulation ORDER BY), upserts
 * « IF EXISTS … ELSE … », COUNT(*), @@VERSION.
 * Zone de test : usage uniquement hors production.
 */
import type { SqlParams, SqlRunner } from "../src/lib/sqlSync";

export type FakeRow = Record<string, unknown>;
export type FakeStore = Record<string, FakeRow[]>;

export interface FakeRunner {
  run: SqlRunner;
  store: FakeStore;
  countRows(table: string): number;
  setVersion(v: string): void;
}

const PARAM_RE = /@(\w+)/g;

export function createFakeRunner(store: FakeStore = {}): FakeRunner {
  let lastVersion = "Fake Microsoft SQL Server 2022 (17 fake rev)";

  const getAll = (table: string): FakeRow[] => (store[table] ??= []);

  function applyInsert(table: string, sql: string, params: SqlParams): void {
    const colsMatch = /\(([^()]*)\) VALUES/.exec(sql);
    const cols = colsMatch ? colsMatch[1].split(",").map((c) => c.trim()) : [];
    const body = sql.slice(sql.indexOf("VALUES") + 6);
    const tuples = body.match(/\(([^()]*)\)/g) ?? [];
    for (const tuple of tuples) {
      const row: FakeRow = {};
      const items = tuple.slice(1, -1).split(",").map((s) => s.trim());
      items.forEach((item, i) => {
        const col = cols[i];
        if (item === "NULL") row[col] = null;
        else {
          const pm = /^@(\w+)$/.exec(item);
          row[col] = pm ? params[pm[1]] : toNumberOr(item);
        }
      });
      getAll(table).push(row);
    }
  }

  const toNumberOr = (s: string): string | number =>
    /^-?\d+(\.\d+)?$/.test(s) ? Number(s) : s;

  function childTenantRows(childTable: string, parentTable: string, parentCol: string, slug: unknown): FakeRow[] {
    const parentIds = new Set(getAll(parentTable).filter((r) => r.tenant === slug).map((r) => String(r.id)));
    return getAll(childTable).filter((r) => parentIds.has(String(r[parentCol])));
  }

  function joinInfo(sql: string): { childTable: string; parentTable: string; parentCol: string } | null {
    const m = /(?:SELECT \w+\.\* FROM|DELETE \w+ FROM) dbo\.(\w+) \w+ JOIN dbo\.(\w+) \w+ ON \w+\.id = \w+\.(\w+) WHERE \w+\.tenant = @slug/.exec(sql);
    return m ? { childTable: m[1], parentTable: m[2], parentCol: m[3] } : null;
  }

  function applyOrder(rows: FakeRow[], order?: string): FakeRow[] {
    if (!order) return [...rows];
    const terms = order.split(",").map((t) => {
      const bits = t.trim().split(/\s+/);
      return { col: bits[0], desc: (bits[1] ?? "ASC").toUpperCase() === "DESC" };
    });
    return [...rows].sort((a, b) => {
      for (const { col, desc } of terms) {
        const va = a[col], vb = b[col];
        const cmp = typeof va === "number" && typeof vb === "number"
          ? va - vb
          : String(va ?? "").localeCompare(String(vb ?? ""));
        if (cmp !== 0) return desc ? -cmp : cmp;
      }
      return 0;
    });
  }

  const run: SqlRunner = async <T = FakeRow>(sql: string, params: SqlParams = {}): Promise<T[]> => {
    // Upesrts « IF EXISTS … ELSE INSERT » (sg_tenant, sg_tenants)
    const upsert = /IF EXISTS \(SELECT 1 FROM dbo\.(\w+) WHERE slug = @slug\)/.exec(sql);
    if (upsert) {
      const table = upsert[1];
      const rows = getAll(table);
      const slugV = String(params.slug);
      const existing = rows.find((r) => String(r.slug) === slugV);
      if (existing) for (const [k, v] of Object.entries(params)) existing[k] = v;
      else {
        const row: FakeRow = { ...params };
        if (!("updated_at" in row) && table === "sg_tenants") row.updated_at = new Date().toISOString();
        rows.push(row);
      }
      return [];
    }

    if (/SELECT @@VERSION/.test(sql)) return [{ v: lastVersion }] as T[];

    const countAll = /SELECT COUNT\(\*\) AS n FROM dbo\.(\w+)\s*$/.exec(sql);
    if (countAll) return [{ n: getAll(countAll[1]).length }] as T[];

    const countWhere = /SELECT COUNT\(\*\) AS n FROM dbo\.(\w+) WHERE slug = @slug/.exec(sql);
    if (countWhere) return [{ n: getAll(countWhere[1]).filter((r) => r.slug === params.slug).length }] as T[];

    const sysCount = /SELECT COUNT\(\*\) AS n FROM sys\.tables/.test(sql);
    if (sysCount) return [{ n: Object.keys(store).filter((t) => t.startsWith("sg_")).length + 1 }] as T[];

    // SELECT … WHERE slug = @slug (métadonnées sg_tenant) — jamais un DELETE
    const meta = /^SELECT[\s\S]* FROM dbo\.(\w+) WHERE slug = @slug/.exec(sql);
    if (meta) return getAll(meta[1]).filter((r) => String(r.slug) === String(params.slug)) as T[];

    // SELECT avec jointure enfant (lecture ou purge)
    const join = joinInfo(sql);
    if (join) {
      const orderClause = /ORDER BY (.+?)\s*$/.exec(sql)?.[1];
      if (/^DELETE/i.test(sql.trim())) {
        store[join.childTable] = getAll(join.childTable).filter((r) => {
          const parent = getAll(join.parentTable).find((p) => String(p.id) === String(r[join.parentCol]));
          return !(parent && parent.tenant === params.slug);
        });
        return [];
      }
      const rows = applyOrder(childTenantRows(join.childTable, join.parentTable, join.parentCol, params.slug), orderClause);
      return rows as T[];
    }

    // DELETE / SELECT plain par tenant
    const tenantCols = /WHERE tenant = @slug/.exec(sql);
    if (tenantCols) {
      const table = /(?:FROM|UPDATE)?\s*dbo\.(\w+)/.exec(sql)?.[1] ?? "";
      if (/^DELETE/i.test(sql.trim())) {
        store[table] = getAll(table).filter((r) => r.tenant !== params.slug);
        return [];
      }
      const orderClause = /ORDER BY (.+?)\s*$/.exec(sql)?.[1];
      return applyOrder(getAll(table).filter((r) => r.tenant === params.slug), orderClause) as T[];
    }

    // INSERT …
    const insert = /INSERT INTO dbo\.(\w+) /.exec(sql);
    if (insert) {
      applyInsert(insert[1], sql, params);
      return [];
    }

    // UPDATE … WHERE id = @wid AND tenant = @tslug
    const update = /UPDATE dbo\.(\w+) SET (.+) WHERE id = @wid AND tenant = @tslug/.exec(sql);
    if (update) {
      const row = getAll(update[1]).find((r) => String(r.id) === String(params.wid) && String(r.tenant) === String(params.tslug));
      if (row) {
        for (const part of update[2].split(",")) {
          const [col, val] = part.split("=").map((s) => s.trim());
          const pm = /^@(\w+)$/.exec(val);
          row[col] = val === "NULL" ? null : pm ? params[pm[1]] : toNumberOr(val);
        }
      }
      return [];
    }

    // DELETE FROM dbo.T WHERE id = @id AND tenant = @tslug
    const delRoot = /DELETE FROM dbo\.(\w+) WHERE id = @id AND tenant = @tslug/.exec(sql);
    if (delRoot) {
      store[delRoot[1]] = getAll(delRoot[1]).filter((r) => !(String(r.id) === String(params.id) && String(r.tenant) === String(params.tslug)));
      return [];
    }

    // DELETE FROM dbo.T WHERE <parentCol> = @pid
    const delChild = /DELETE FROM dbo\.(\w+) WHERE (\w+) = @pid/.exec(sql);
    if (delChild) {
      store[delChild[1]] = getAll(delChild[1]).filter((r) => !(String(r[delChild[2]]) === String(params.pid)));
      return [];
    }

    return [];
  };

  return {
    run,
    store,
    countRows: (table: string) => getAll(table).length,
    setVersion: (v: string) => {
      lastVersion = v;
    },
  };
}
