"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { login } from "@/lib/actions";

const DEMO_ACCOUNTS = [
  { tenant: "horizon", label: "NovaMarket", accounts: ["admin / nova2026", "caisse / caisse2026", "stock / stock2026", "logistique / logi2026"] },
  { tenant: "ecomarche", label: "EcoMarché", accounts: ["admin / eco2026", "caisse / eco-caisse2026", "stock / eco-stock2026"] },
];

export function LoginForm({ tenants }: { tenants: { slug: string; name: string }[] }) {
  const router = useRouter();
  const [tenant, setTenant] = useState(tenants[0]?.slug ?? "horizon");
  const [username, setUsername] = useState("admin");
  const [password, setPassword] = useState("nova2026");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const submit = () => {
    setError(null);
    startTransition(async () => {
      const res = await login(tenant, username.trim(), password);
      if (res.ok) {
        router.replace("/");
        router.refresh();
      } else {
        setError(res.error);
      }
    });
  };

  return (
    <div className="w-full max-w-md rounded-2xl border border-slate-800 bg-slate-900/80 p-8 shadow-2xl">
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-gradient-to-br from-emerald-400 to-sky-500 font-black text-slate-900">SG</div>
        <div>
          <h1 className="text-lg font-semibold text-white">SuperGestion</h1>
          <p className="text-xs text-slate-500">Connexion à votre enseigne</p>
        </div>
      </div>

      <div className="mt-6 space-y-4">
        <div>
          <label className="mb-1 block text-xs text-slate-400">Enseigne</label>
          <select
            value={tenant}
            onChange={(e) => setTenant(e.target.value)}
            className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2.5 text-sm outline-none focus:border-emerald-500"
          >
            {tenants.map((t) => (
              <option key={t.slug} value={t.slug}>{t.name}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="mb-1 block text-xs text-slate-400">Identifiant</label>
          <input
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && submit()}
            autoComplete="username"
            className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2.5 text-sm outline-none focus:border-emerald-500"
          />
        </div>
        <div>
          <label className="mb-1 block text-xs text-slate-400">Mot de passe</label>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && submit()}
            autoComplete="current-password"
            className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2.5 text-sm outline-none focus:border-emerald-500"
          />
        </div>
        {error && <p className="rounded-lg border border-red-800 bg-red-950 px-3 py-2 text-xs text-red-300">{error}</p>}
        <button
          onClick={submit}
          disabled={pending}
          className="w-full rounded-lg bg-emerald-500 py-2.5 text-sm font-bold text-slate-950 transition hover:bg-emerald-400 disabled:opacity-50"
        >
          {pending ? "Connexion…" : "Se connecter"}
        </button>
      </div>

      <div className="mt-6 rounded-lg border border-slate-800 bg-slate-950/60 p-3">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Comptes de démonstration</p>
        <div className="mt-2 space-y-2">
          {DEMO_ACCOUNTS.map((t) => (
            <div key={t.tenant}>
              <p className="text-[11px] text-slate-400">{t.label}</p>
              <p className="font-mono text-[11px] text-slate-500">{t.accounts.join(" · ")}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
