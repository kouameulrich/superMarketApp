import { redirect } from "next/navigation";
import { getTenant } from "./db";
import { getSession } from "./session";
import type { Session } from "./session";
import type { Tenant } from "./types";

/**
 * Résolution du tenant (PRD §4.1) : dérivée de la session signée (cookie httpOnly),
 * jamais du client. Toute page/mutation passe par ici — sans session → /login.
 */
export async function requireSession(): Promise<Session> {
  const session = await getSession();
  if (!session) redirect("/login");
  return session;
}

export interface TenantContext {
  tenant: Tenant;
  session: Session;
}

export async function resolveTenant(): Promise<TenantContext> {
  const session = await requireSession();
  const tenant = await getTenant(session.tenant);
  if (!tenant) redirect("/login");
  return { tenant, session };
}
