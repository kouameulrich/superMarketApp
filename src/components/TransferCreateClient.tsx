"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createTransferOrder, pushDistribute } from "@/lib/actions";
import { fmtQty } from "@/lib/format";
import { Badge, Card } from "@/components/ui";

interface StoreOpt { id: string; code: string; name: string; isHub: boolean }

export function TransferCreateClient({
  stores,
  products,
}: {
  stores: StoreOpt[];
  products: { id: string; name: string; sku: string }[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [sourceId, setSourceId] = useState(stores.find((s) => s.isHub)?.id ?? stores[0].id);
  const [destId, setDestId] = useState(stores.find((s) => !s.isHub)?.id ?? stores[1]?.id ?? stores[0].id);
  const [productId, setProductId] = useState(products[0]?.id ?? "");
  const [qty, setQty] = useState("10");
  const [lines, setLines] = useState<{ productId: string; quantity: number }[]>([]);
  const [asDraft, setAsDraft] = useState(false);

  const [pushProduct, setPushProduct] = useState(products[0]?.id ?? "");
  const [pushQty, setPushQty] = useState("60");
  const [pushMsg, setPushMsg] = useState<string | null>(null);

  const addLine = async () => {
    const parsed = parseFloat(qty);
    if (!parsed || parsed <= 0 || !productId) return;
    setLines((prev) => [...prev, { productId, quantity: parsed }]);
    setQty("10");
  };

  const submit = async () => {
    setError(null);
    const res = await createTransferOrder(sourceId, destId, "PULL", lines, asDraft);
    if (res.ok) {
      setLines([]);
      setOpen(false);
      startTransition(() => router.refresh());
    } else setError(res.error);
  };

  const runPush = async () => {
    setError(null);
    const res = await pushDistribute(pushProduct, parseFloat(pushQty) || 0);
    if (res.ok) {
      setPushMsg("Arrivage hub réparti entre les magasins au prorata des ventes 30 j — OTs expédiés (en transit).");
      startTransition(() => router.refresh());
    } else setError(res.error);
  };

  return (
    <Card>
      <div className="flex flex-wrap items-center gap-2 border-b border-slate-800 p-3">
        <button onClick={() => setOpen((v) => !v)} className="rounded-lg bg-emerald-500 px-3.5 py-2 text-sm font-semibold text-slate-950 hover:bg-emerald-400">
          + Nouvel OT manuel
        </button>
        <span className="text-xs text-slate-500">— ou —</span>
        <div className="flex items-center gap-2">
          <Badge tone="violet">PUSH</Badge>
          <select value={pushProduct} onChange={(e) => setPushProduct(e.target.value)} className="rounded-lg border border-slate-700 bg-slate-950 px-2 py-1.5 text-xs">
            {products.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
          <input value={pushQty} onChange={(e) => setPushQty(e.target.value)} type="number" className="w-20 rounded-lg border border-slate-700 bg-slate-950 px-2 py-1.5 text-xs tabular-nums" />
          <button onClick={() => void runPush()} disabled={pending} className="rounded-lg border border-violet-700 bg-violet-950 px-3 py-1.5 text-xs font-semibold text-violet-300 hover:bg-violet-900 disabled:opacity-50">
            Répartir l&apos;arrivage hub
          </button>
        </div>
      </div>
      {pushMsg && <p className="p-3 text-xs text-violet-200">{pushMsg}</p>}
      {error && <p className="p-3 text-xs text-red-300">{error}</p>}

      {open && (
        <div className="space-y-3 border-t border-slate-800 p-4">
          <div className="flex flex-wrap gap-3">
            <div>
              <label className="mb-1 block text-[11px] text-slate-400">Source (expéditeur)</label>
              <select value={sourceId} onChange={(e) => setSourceId(e.target.value)} className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm">
                {stores.map((s) => <option key={s.id} value={s.id}>{s.isHub ? "★ " : ""}{s.name}</option>)}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-[11px] text-slate-400">Destination (destinataire)</label>
              <select value={destId} onChange={(e) => setDestId(e.target.value)} className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm">
                {stores.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </div>
            <div className="flex items-end gap-2">
              <div>
                <label className="mb-1 block text-[11px] text-slate-400">Article</label>
                <select value={productId} onChange={(e) => setProductId(e.target.value)} className="w-64 rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm">
                  {products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              </div>
              <input value={qty} onChange={(e) => setQty(e.target.value)} type="number" className="w-24 rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm tabular-nums" />
              <button onClick={() => void addLine()} className="rounded-lg border border-slate-600 px-3 py-2 text-sm text-slate-200 hover:border-emerald-500">+ Ligne</button>
            </div>
          </div>
          {lines.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {lines.map((l, i) => {
                const p = products.find((x) => x.id === l.productId);
                return (
                  <span key={i} className="flex items-center gap-2 rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-1 text-xs text-slate-300">
                    {p?.name} × {fmtQty(l.quantity)}
                    <button onClick={() => setLines((prev) => prev.filter((_, j) => j !== i))} className="text-slate-500 hover:text-red-400">✕</button>
                  </span>
                );
              })}
            </div>
          )}
          <div className="flex items-center justify-between">
            <label className="flex items-center gap-2 text-xs text-slate-400">
              <input type="checkbox" checked={asDraft} onChange={(e) => setAsDraft(e.target.checked)} className="h-4 w-4 accent-emerald-500" />
              Enregistrer en BROUILLON (sinon statut DEMANDÉ)
            </label>
            <div className="flex gap-2">
              <button onClick={() => void submit()} disabled={pending || lines.length === 0} className="rounded-lg bg-emerald-500 px-4 py-2 text-sm font-semibold text-slate-950 hover:bg-emerald-400 disabled:opacity-50">
                Créer l&apos;OT
              </button>
            </div>
          </div>
        </div>
      )}
    </Card>
  );
}
