import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";
import { Sidebar } from "@/components/Sidebar";
import { TenantSwitcher } from "@/components/TenantSwitcher";
import { resolveTenant } from "@/lib/tenant";

export const metadata: Metadata = {
  title: "SuperGestion — Pilotage retail",
  description:
    "Plateforme SaaS multi-tenant pour la grande distribution : POS, stocks, transferts inter-magasins, achats et analytics.",
};

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const { tenant, tenants } = await resolveTenant();
  return (
    <html lang="fr">
      <body className="bg-slate-950 text-slate-200 antialiased">
        <Sidebar />
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
              <TenantSwitcher tenants={tenants} current={tenant.slug} />
              <div className="flex items-center gap-2 rounded-md border border-slate-700 bg-slate-900 px-2.5 py-1.5 text-xs text-slate-300">
                <span className="h-2 w-2 rounded-full bg-emerald-400" />
                Admin · enseigne
              </div>
            </div>
          </header>
          <main className="min-h-[calc(100vh-49px)] px-4 py-6 lg:px-8">{children}</main>
        </div>
      </body>
    </html>
  );
}
