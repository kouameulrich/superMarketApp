import { redirect } from "next/navigation";
import { getTenant, liveUser } from "./db";
import { getSession } from "./session";
import { warnDefaultSecretOnce, type Session } from "./session";
import type { UserRole } from "./types";
import type { Tenant } from "./types";

/**
 * Résolution du tenant (PRD §4.1) : dérivée de la session signée (cookie httpOnly),
 * jamais du client. Toute page/mutation passe par ici — sans session → /login.
 * Le RÔLE est relu en base à chaque résolution : désactivation ou changement de
 * rôle sont effectifs immédiatement (le cookie n'est qu'une identité).
 */
export async function requireSession(): Promise<Session> {
  warnDefaultSecretOnce();
  const cookie = await getSession();
  if (!cookie) redirect("/login");
  const live = await liveUser(cookie);
  if (!live) redirect("/login"); // compte désactivé ou supprimé
  return { ...cookie, role: live.role as UserRole, displayName: live.displayName };
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

/** Garde de page : si le rôle n'est pas autorisé → /acces-refuse. */
export function guardRoles(role: UserRole, allowed: UserRole[]): void {
  if (!allowed.includes(role)) redirect("/acces-refuse");
}
