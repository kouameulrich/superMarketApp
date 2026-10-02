import Link from "next/link";
import { resolveTenant } from "@/lib/tenant";

export const dynamic = "force-dynamic";

export default async function AccessDeniedPage() {
  const { tenant, session } = await resolveTenant();
  return (
    <div className="flex min-h-[60vh] items-center justify-center">
      <div className="max-w-md rounded-2xl border border-amber-800 bg-amber-950/30 p-8 text-center">
        <p className="text-4xl">🔒</p>
        <h1 className="mt-3 text-lg font-semibold text-amber-200">Accès refusé</h1>
        <p className="mt-2 text-sm text-slate-300">
          Votre rôle ({session.displayName}) ne permet pas d&apos;ouvrir cette section de {tenant.name}.
          Demandez à un administrateur s&apos;il doit ajuster vos droits.
        </p>
        <Link href="/pos" className="mt-5 inline-block rounded-lg bg-emerald-500 px-5 py-2.5 text-sm font-bold text-slate-950 hover:bg-emerald-400">
          Aller au point de vente
        </Link>
      </div>
    </div>
  );
}
