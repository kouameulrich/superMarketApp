"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { saveProduct, type ProductInput } from "@/lib/actions";
import { fmtMoney, fmtNum } from "@/lib/format";
import { Badge } from "@/components/ui";

interface Row extends ProductInput {
  id: string;
  marginPct: number;
  totalStock: number;
  supplierName: string;
}

const EMPTY: ProductInput = {
  sku: "", barcode: "", name: "", category: "", brand: "",
  costPrice: 0, vatRate: 0.18, sellingPrice: 0, unit: "UNIT",
  minStockLevel: 10, supplierId: null, active: true,
};

export function ProductsClient({ products, suppliers }: { products: Row[]; suppliers: { id: string; name: string }[] }) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<ProductInput>(EMPTY);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const filtered = useMemo(() => {
    const q = query.toLowerCase();
    if (!q) return products;
    return products.filter((p) =>
      [p.name, p.sku, p.barcode, p.category, p.brand].join(" ").toLowerCase().includes(q)
    );
  }, [products, query]);

  const openCreate = () => {
    setForm(EMPTY);
    setEditingId(null);
    setError(null);
    setShowForm(true);
  };

  const openEdit = (p: Row) => {
    setForm({
      id: p.id, sku: p.sku, barcode: p.barcode, name: p.name, category: p.category, brand: p.brand,
      costPrice: p.costPrice, vatRate: p.vatRate, sellingPrice: p.sellingPrice, unit: p.unit,
      minStockLevel: p.minStockLevel, supplierId: p.supplierId, active: p.active,
    });
    setEditingId(p.id);
    setError(null);
    setShowForm(true);
  };

  const marginPreview =
    form.sellingPrice > 0
      ? ((form.sellingPrice / (1 + form.vatRate) - form.costPrice) / (form.sellingPrice / (1 + form.vatRate))) * 100
      : 0;

  const submit = async () => {
    const res = await saveProduct({ ...form, id: editingId ?? undefined });
    if (res.ok) {
      setShowForm(false);
      startTransition(() => router.refresh());
    } else {
      setError(res.error);
    }
  };

  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/60">
      <div className="flex flex-wrap items-center gap-3 border-b border-slate-800 p-4">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Rechercher (nom, SKU, code-barres, marque…)"
          className="w-full max-w-sm rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm outline-none focus:border-emerald-500"
        />
        <Badge tone="neutral">{filtered.length} / {products.length} articles</Badge>
        <button
          onClick={openCreate}
          className="ml-auto rounded-lg bg-emerald-500 px-3.5 py-2 text-sm font-semibold text-slate-950 transition hover:bg-emerald-400"
        >
          + Nouvel article
        </button>
      </div>

      <div className="max-h-[60vh] overflow-auto">
        <table className="w-full min-w-[980px] text-sm">
          <thead className="sticky top-0 bg-slate-900 text-left text-[11px] uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-4 py-2.5">Article</th>
              <th className="px-2 py-2.5">Rayon</th>
              <th className="px-2 py-2.5 text-right">Achat HT</th>
              <th className="px-2 py-2.5 text-right">TVA</th>
              <th className="px-2 py-2.5 text-right">Vente TTC</th>
              <th className="px-2 py-2.5 text-right">Marge</th>
              <th className="px-2 py-2.5 text-right">Seuil mini</th>
              <th className="px-2 py-2.5 text-right">Stock réseau</th>
              <th className="px-2 py-2.5">Statut</th>
              <th className="px-2 py-2.5" />
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800">
            {filtered.map((p) => (
              <tr key={p.id} className="hover:bg-slate-800/40">
                <td className="px-4 py-2.5">
                  <p className="font-medium text-slate-100">{p.name}</p>
                  <p className="text-[11px] text-slate-500">{p.sku} · EAN {p.barcode} · {p.brand}</p>
                </td>
                <td className="px-2 py-2.5 text-slate-300">{p.category}</td>
                <td className="px-2 py-2.5 text-right tabular-nums text-slate-300">{fmtMoney(p.costPrice)}</td>
                <td className="px-2 py-2.5 text-right tabular-nums text-slate-400">{fmtNum(p.vatRate * 100, 1)}%</td>
                <td className="px-2 py-2.5 text-right font-semibold tabular-nums text-emerald-300">{fmtMoney(p.sellingPrice)}</td>
                <td className={`px-2 py-2.5 text-right tabular-nums ${p.marginPct < 15 ? "text-red-300" : "text-violet-300"}`}>{fmtNum(p.marginPct, 1)}%</td>
                <td className="px-2 py-2.5 text-right tabular-nums text-slate-400">{fmtNum(p.minStockLevel)}{p.unit === "KG" ? " kg" : ""}</td>
                <td className="px-2 py-2.5 text-right tabular-nums text-slate-300">{fmtNum(p.totalStock)}</td>
                <td className="px-2 py-2.5">
                  <Badge tone={p.active ? "green" : "neutral"}>{p.active ? "Actif" : "Archivé"}</Badge>
                </td>
                <td className="px-2 py-2.5 text-right">
                  <button onClick={() => openEdit(p)} className="rounded border border-slate-700 px-2 py-1 text-xs text-slate-300 hover:border-emerald-500">Éditer</button>
                </td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr><td colSpan={10} className="p-6 text-center text-sm text-slate-500">Aucun article ne correspond.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {showForm && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm" onClick={() => setShowForm(false)}>
          <div onClick={(e) => e.stopPropagation()} className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-2xl border border-slate-700 bg-slate-900 p-6">
            <h3 className="text-lg font-semibold text-white">{editingId ? "Modifier la fiche produit" : "Nouvel article"}</h3>
            <div className="mt-4 grid grid-cols-2 gap-3">
              <Field label="Désignation" value={form.name} onChange={(v) => setForm({ ...form, name: v })} required />
              <Field label="Marque" value={form.brand} onChange={(v) => setForm({ ...form, brand: v })} />
              <Field label="SKU (référence unique)" value={form.sku} onChange={(v) => setForm({ ...form, sku: v })} required />
              <Field label="Code-barres (EAN)" value={form.barcode} onChange={(v) => setForm({ ...form, barcode: v })} required />
              <Field label="Catégorie / rayon" value={form.category} onChange={(v) => setForm({ ...form, category: v })} />
              <div>
                <label className="mb-1 block text-xs text-slate-400">Fournisseur</label>
                <select
                  value={form.supplierId ?? ""}
                  onChange={(e) => setForm({ ...form, supplierId: e.target.value || null })}
                  className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm outline-none focus:border-emerald-500"
                >
                  <option value="">—</option>
                  {suppliers.map((s) => (
                    <option key={s.id} value={s.id}>{s.name}</option>
                  ))}
                </select>
              </div>
              <NumField label="Prix d'achat HT (FCFA)" value={form.costPrice} onChange={(v) => setForm({ ...form, costPrice: v })} step={5} />
              <div>
                <label className="mb-1 block text-xs text-slate-400">Taux de TVA</label>
                <select
                  value={form.vatRate}
                  onChange={(e) => setForm({ ...form, vatRate: parseFloat(e.target.value) })}
                  className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm outline-none focus:border-emerald-500"
                >
                  <option value={0.18}>18 % (taux normal)</option>
                  <option value={0.05}>5 % (première nécessité)</option>
                  <option value={0}>0 % (exonéré)</option>
                </select>
              </div>
              <NumField label="Prix de vente TTC (FCFA)" value={form.sellingPrice} onChange={(v) => setForm({ ...form, sellingPrice: v })} step={5} />
              <NumField label="Seuil de réappro" value={form.minStockLevel} onChange={(v) => setForm({ ...form, minStockLevel: v })} step={1} />
              <div>
                <label className="mb-1 block text-xs text-slate-400">Unité de vente</label>
                <select
                  value={form.unit}
                  onChange={(e) => setForm({ ...form, unit: e.target.value as "UNIT" | "KG" })}
                  className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm outline-none focus:border-emerald-500"
                >
                  <option value="UNIT">À la pièce</option>
                  <option value="KG">Au kilo (balance)</option>
                </select>
              </div>
              <div className="flex items-end">
                <label className="flex items-center gap-2 text-sm text-slate-300">
                  <input type="checkbox" checked={form.active} onChange={(e) => setForm({ ...form, active: e.target.checked })} className="h-4 w-4 accent-emerald-500" />
                  Article actif
                </label>
              </div>
            </div>
            <p className="mt-3 rounded-lg bg-slate-950 px-3 py-2 text-xs text-slate-400">
              Marge prévisionnelle : <span className={`font-semibold ${marginPreview < 15 ? "text-red-300" : "text-emerald-300"}`}>{fmtNum(marginPreview, 1)} %</span>
              {" · "}Prix HT de vente : <span className="text-slate-200">{fmtMoney(form.sellingPrice / (1 + form.vatRate))}</span>
            </p>
            {error && <p className="mt-2 rounded-lg border border-red-800 bg-red-950 px-3 py-2 text-sm text-red-300">{error}</p>}
            <div className="mt-4 flex justify-end gap-2">
              <button onClick={() => setShowForm(false)} className="rounded-lg border border-slate-700 px-4 py-2 text-sm text-slate-300 hover:border-slate-500">Annuler</button>
              <button onClick={() => void submit()} disabled={pending} className="rounded-lg bg-emerald-500 px-4 py-2 text-sm font-semibold text-slate-950 hover:bg-emerald-400 disabled:opacity-50">
                Enregistrer
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Field({ label, value, onChange, required }: { label: string; value: string; onChange: (v: string) => void; required?: boolean }) {
  return (
    <div>
      <label className="mb-1 block text-xs text-slate-400">{label}{required ? " *" : ""}</label>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm outline-none focus:border-emerald-500"
      />
    </div>
  );
}

function NumField({ label, value, onChange, step }: { label: string; value: number; onChange: (v: number) => void; step?: number }) {
  return (
    <div>
      <label className="mb-1 block text-xs text-slate-400">{label}</label>
      <input
        type="number"
        step={step ?? 1}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value) || 0)}
        className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm tabular-nums outline-none focus:border-emerald-500"
      />
    </div>
  );
}
