"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

type NavRole = "CASHIER" | "STOCK" | "LOGISTICS" | "ADMIN" | "SUPER_ADMIN";

const NAV: Array<{ section: string; items: Array<{ href: string; label: string; icon: string; roles?: NavRole[] }> }> = [
  {
    section: "Pilotage",
    items: [
      { href: "/", roles: ["LOGISTICS", "ADMIN", "SUPER_ADMIN"], label: "Tableau de bord", icon: "M3 12l9-9 9 9M5 10v10h14V10" },
      { href: "/stock-board", roles: ["STOCK", "LOGISTICS", "ADMIN", "SUPER_ADMIN"], label: "Tableau de bord Stock", icon: "M3 12l9-9 9 9M5 10v10h14V10" },
      { href: "/reports", roles: ["ADMIN", "SUPER_ADMIN"], label: "Rapports & Analytics", icon: "M4 20V10m6 10V4m6 16v-7" },
    ],
  },
  {
    section: "Caisse",
    items: [{ href: "/pos", roles: ["CASHIER", "LOGISTICS", "ADMIN", "SUPER_ADMIN"], label: "Point de vente (POS)", icon: "M3 9l2-5h14l2 5M4 9h16v11H4zM9 14h6" }],
  },
  {
    section: "Référentiel & Stock",
    items: [
      { href: "/products", roles: ["ADMIN", "SUPER_ADMIN"], label: "Articles", icon: "M4 7h16M4 12h16M4 17h10" },
      { href: "/stock", roles: ["STOCK", "LOGISTICS", "ADMIN", "SUPER_ADMIN"], label: "Stocks, DLC & mouvements", icon: "M20 7l-8-4-8 4v10l8 4 8-4V7zM12 12L4 7m8 5l8-5m-8 5v10" },
    ],
  },
  {
    section: "Logistique",
    items: [
      { href: "/transfers", roles: ["STOCK", "LOGISTICS", "ADMIN", "SUPER_ADMIN"], label: "Transferts inter-magasins", icon: "M4 7h11m0 0l-3-3m3 3l-3 3M20 17H9m0 0l3 3m-3-3l3-3" },
      { href: "/suppliers", roles: ["LOGISTICS", "ADMIN", "SUPER_ADMIN"], label: "Fournisseurs & Achats", icon: "M3 3h2l2 12h11l2-8H6M9 20a1 1 0 100-2 1 1 0 000 2zm8 0a1 1 0 100-2 1 1 0 000 2z" },
    ],
  },
  {
    section: "Administration",
    items: [{ href: "/users", roles: ["ADMIN", "SUPER_ADMIN"], label: "Utilisateurs & rôles", icon: "M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7" }],
  },
];

export function Sidebar({ role }: { role?: NavRole }) {
  const pathname = usePathname();
  const allowed = (r?: NavRole[]): boolean => !r || !role || r.includes(role);
  return (
    <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 flex-col border-r border-slate-800 bg-slate-950 lg:flex">
      <div className="flex items-center gap-2.5 px-5 py-4">
        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-gradient-to-br from-emerald-400 to-sky-500 font-black text-slate-900">
          SG
        </div>
        <div>
          <p className="text-sm font-bold text-slate-100">SuperGestion</p>
          <p className="text-[10px] uppercase tracking-widest text-slate-500">Retail SaaS v1.0</p>
        </div>
      </div>
      <nav className="flex-1 space-y-5 overflow-y-auto px-3 py-3">
        {NAV.map((group) => {
          const items = group.items.filter((item) => allowed(item.roles));
          if (!items.length) return null;
          return (
            <div key={group.section}>
              <p className="px-2 pb-1.5 text-[10px] font-semibold uppercase tracking-widest text-slate-600">{group.section}</p>
              <ul className="space-y-0.5">
                {items.map((item) => {
                  const active = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
                  return (
                    <li key={item.href}>
                      <Link
                        href={item.href}
                        className={`flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm transition-colors ${
                          active ? "bg-slate-800 font-medium text-white" : "text-slate-400 hover:bg-slate-900 hover:text-slate-200"
                        }`}
                      >
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" className="h-4 w-4 shrink-0">
                          <path d={item.icon} strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                        {item.label}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </div>
          );
        })}
      </nav>
      <div className="border-t border-slate-800 px-5 py-3 text-[10px] text-slate-600">
        Phase 2 — V1.0 · Multi-tenant · Offline-first
      </div>
    </aside>
  );
}
