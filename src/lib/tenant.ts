import { cookies } from "next/headers";
import { getTenant, listTenants } from "./db";
import type { Tenant } from "./types";

export const TENANT_COOKIE = "sg_tenant";
export const DEFAULT_TENANT = "horizon";

export interface TenantContext {
  tenant: Tenant;
  tenants: { slug: string; name: string; plan: string }[];
}

/**
 * Résolution du tenant (PRD §4.1) : sous-domaine simulé via cookie applicatif,
 * scoping strict côté serveur. Aucune donnée n'est lue sans tenant résolu.
 */
export async function resolveTenant(): Promise<TenantContext> {
  const store = await cookies();
  const slug = store.get(TENANT_COOKIE)?.value ?? DEFAULT_TENANT;
  const tenant = (await getTenant(slug)) ?? (await getTenant(DEFAULT_TENANT));
  const all = await listTenants();
  return {
    tenant: tenant!,
    tenants: all.map((t) => ({ slug: t.slug, name: t.name, plan: t.plan })),
  };
}
