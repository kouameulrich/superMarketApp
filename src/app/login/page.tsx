import { listTenants } from "@/lib/db";
import { LoginForm } from "@/components/LoginForm";

export const dynamic = "force-dynamic";

export default async function LoginPage() {
  const tenants = (await listTenants()).map((t) => ({ slug: t.slug, name: t.name }));
  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-950 p-4">
      <LoginForm tenants={tenants} />
    </div>
  );
}
