import { resolveTenant, guardRoles } from "@/lib/tenant";
import { UsersClient, type UserRow } from "@/components/UsersClient";

export const dynamic = "force-dynamic";

export default async function UsersPage() {
  const { tenant, session } = await resolveTenant();
  guardRoles(session.role, ["ADMIN", "SUPER_ADMIN"]);

  // Jamais de hash/salt vers le client
  const users: UserRow[] = tenant.users.map((u) => ({
    id: u.id,
    username: u.username,
    displayName: u.displayName,
    role: u.role,
    active: u.active,
    createdAt: u.createdAt,
  }));
  const currentUsername = session.username;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold text-white">Utilisateurs & rôles</h1>
        <p className="mt-0.5 text-sm text-slate-400">
          Comptes de {tenant.name} : création, rôles (RBAC), activation et mots de passe. Un compte désactivé
          perd l&apos;accès immédiatement (sa session est invalidée à la prochaine navigation).
        </p>
      </div>
      <UsersClient users={users} currentUsername={currentUsername} />
    </div>
  );
}
