"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";

export function TenantSwitcher({ tenants, current }: { tenants: { slug: string; name: string; plan: string }[]; current: string }) {
  const [pending, start] = useTransition();
  const router = useRouter();
  return (
    <label className="flex items-center gap-2 text-xs text-slate-400">
      <span className="hidden sm:inline">Tenant</span>
      <select
        value={current}
        disabled={pending}
        onChange={(e) =>
          start(() => {
            document.cookie = `sg_tenant=${e.target.value}; path=/; max-age=31536000`;
            router.refresh();
          })
        }
        className="rounded-md border border-slate-700 bg-slate-900 px-2 py-1.5 text-xs text-slate-200 outline-none focus:border-emerald-500"
      >
        {tenants.map((t) => (
          <option key={t.slug} value={t.slug}>
            {t.name} · {t.plan.toLowerCase()}
          </option>
        ))}
      </select>
    </label>
  );
}
