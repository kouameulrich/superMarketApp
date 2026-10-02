import Link from "next/link";
import { Sidebar } from "@/components/Sidebar";
import { logout } from "@/lib/actions";
import { resolveTenant } from "@/lib/tenant";
import { ROLE_LABEL } from "@/lib/session";
import type { ReactNode } from "react";

export default async function AppLayout({ children }: { children: ReactNode }) {
  const { tenant, session } = await resolveTenant();
  return (
    <>
      <Sidebar role={session.role} />
      <div className="lg:pl-64">
        <header className="sticky top-0 z-20 flex items-center justify-between gap-4 border-b border-slate-800 bg-slate-950/90 px-4 py-2.5 backdrop-blur lg:px-8">
          <div className="flex items-center gap-3 overflow-x-auto text-xs text-slate-500 lg:hidden">
            <Link href="/" className="font-bold text-slate-200">SG</Link>
            <Link href="/pos" className="px-2">POS</Link>
            <Link href="/stock" className="px-2">Stock</Link>
            <Link href="/transfers" className="px-2">Transferts</Link>
            <Link href="/reports" className="px-2">Rapports</Link>
          </div>
          <p className="hidden text-sm text-slate-400 lg:block">
            <span className="font-semibold text-slate-200">{tenant.name}</span>
            <span className="mx-2 text-slate-600">·</span>
            multi-sites · {tenant.stores.length} établissement(s)
          </p>
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2 rounded-md border border-slate-700 bg-slate-900 px-2.5 py-1.5 text-xs text-slate-300">
              <span className="h-2 w-2 rounded-full bg-emerald-400" />
              <span className="font-semibold text-slate-200">{session.displayName}</span>
              <span className="text-slate-500">·</span>
              {ROLE_LABEL[session.role]}
            </div>
            <form action={logout}>
              <button type="submit" className="rounded-md border border-slate-700 bg-slate-900 px-2.5 py-1.5 text-xs text-slate-400 hover:border-red-700 hover:text-red-300">
                Déconnexion
              </button>
            </form>
          </div>
        </header>
        <main className="min-h-[calc(100vh-49px)] px-4 py-6 lg:px-8">{children}</main>
      </div>
    </>
  );
}
