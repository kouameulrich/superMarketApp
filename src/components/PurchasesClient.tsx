"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createPurchaseOrder, sendPurchaseOrder, receivePurchaseOrder, createSupplier } from "@/lib/actions";
import { fmtMoney, fmtQty } from "@/lib/format";
import { Badge, Card, CardHeader, POStatusBadge } from "@/components/ui";

interface POItem { id: string; productName: string; ordered: number; alreadyReceived: number; unitCost: number }
interface PO {
  id: string; code: string; supplierName: string; status: string; lines: number;
  orderedValue: number; receivedValue: number; blNumber: string | null;
  createdAt: string; expectedAt: string; items: POItem[];
}

export function PurchasesClient({
  pos,
  suppliers,
  allProducts,
  suggestions,
}: {
  pos: PO[];
  suppliers: { id: string; name: string }[];
  allProducts: { id: string; name: string; cost: number }[];
  suggestions: { productId: string; name: string; sku: string; qty: number; suggested: number }[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [openNew, setOpenNew] = useState(false);
  const [supplierId, setSupplierId] = useState(suppliers[0]?.id ?? "");
  const [lines, setLines] = useState<{ productId: string; quantity: number }[]>([]);
  const [productId, setProductId] = useState(allProducts[0]?.id ?? "");
  const [qty, setQty] = useState("24");

  const [receiving, setReceiving] = useState<PO | null>(null);
  const [bl, setBl] = useState("");
  const [recQty, setRecQty] = useState<Record<string, string>>({});

  const [openSupplier, setOpenSupplier] = useState(false);
  const [supForm, setSupForm] = useState({ code: "", name: "", email: "", phone: "", leadTimeDays: "3", paymentTerms: "30 jours" });

  const refresh = () => startTransition(() => router.refresh());

  const addLine = () => {
    const parsed = parseFloat(qty);
    if (!productId || !parsed) return;
    setLines((prev) => [...prev, { productId, quantity: parsed }]);
  };

  const submitPO = async () => {
    setError(null);
    const res = await createPurchaseOrder({ supplierId, items: lines });
    if (res.ok) {
      setLines([]);
      setOpenNew(false);
      refresh();
    } else setError(res.error);
  };

  const submitSupplier = async () => {
    setError(null);
    const res = await createSupplier({ ...supForm, leadTimeDays: parseInt(supForm.leadTimeDays) || 3 });
    if (res.ok) {
      setOpenSupplier(false);
      setSupForm({ code: "", name: "", email: "", phone: "", leadTimeDays: "3", paymentTerms: "30 jours" });
      refresh();
    } else setError(res.error);
  };

  const applySuggestion = () => {
    setLines(suggestions.slice(0, 6).map((s) => ({ productId: s.productId, quantity: s.suggested })));
  };

  const confirmReception = async () => {
    if (!receiving) return;
    const res = await receivePurchaseOrder(
      receiving.id,
      bl,
      Object.entries(recQty)
        .map(([itemId, q]) => ({ itemId, qty: parseFloat(q) || 0 }))
        .filter((r) => r.qty > 0),
    );
    if (res.ok) {
      setReceiving(null);
      setBl("");
      setRecQty({});
      refresh();
    } else setError(res.error);
  };

  return (
    <>
      <Card>
        <div className="flex flex-wrap items-center gap-2 border-b border-slate-800 p-3">
          <button onClick={() => setOpenNew((v) => !v)} className="rounded-lg bg-emerald-500 px-3.5 py-2 text-sm font-semibold text-slate-950 hover:bg-emerald-400">
            + Bons de commande
          </button>
          <button onClick={() => setOpenSupplier(true)} className="rounded-lg border border-slate-700 px-3 py-2 text-sm text-slate-300 hover:border-emerald-500">
            + Fournisseur
          </button>
        </div>

        {openNew && (
          <div className="space-y-3 border-t border-slate-800 p-4">
            {suggestions.length > 0 && (
              <div className="rounded-lg border border-amber-800 bg-amber-950/20 p-3">
                <p className="text-xs font-medium text-amber-300">Suggestions automatiques (stock hub sous le seuil)</p>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  {suggestions.map((s) => (
                    <span key={s.productId} className="rounded-lg bg-slate-900 px-2 py-1 text-[11px] text-slate-300">
                      {s.name} <span className="text-slate-500">({fmtQty(s.qty)} · seuil)</span> → {fmtQty(s.suggested)}
                    </span>
                  ))}
                  <button onClick={applySuggestion} className="rounded border border-amber-700 px-2 py-1 text-[11px] text-amber-200 hover:bg-amber-900">Garder ces 6 lignes</button>
                </div>
              </div>
            )}
            <div className="flex flex-wrap items-end gap-2">
              <div>
                <label className="mb-1 block text-[11px] text-slate-400">Fournisseur</label>
                <select value={supplierId} onChange={(e) => setSupplierId(e.target.value)} className="w-56 rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm">
                  {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-[11px] text-slate-400">Article</label>
                <select value={productId} onChange={(e) => setProductId(e.target.value)} className="w-64 rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm">
                  {allProducts.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              </div>
              <input value={qty} onChange={(e) => setQty(e.target.value)} type="number" className="w-24 rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm tabular-nums" />
              <button onClick={addLine} className="rounded-lg border border-slate-600 px-3 py-2 text-sm hover:border-emerald-500">+ Ligne</button>
            </div>
            {lines.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {lines.map((l, i) => {
                  const p = allProducts.find((x) => x.id === l.productId);
                  return (
                    <span key={i} className="flex items-center gap-2 rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-1 text-xs">
                      {p?.name} × {fmtQty(l.quantity)} <span className="text-slate-500">{fmtMoney((p?.cost ?? 0) * l.quantity)}</span>
                      <button onClick={() => setLines((prev) => prev.filter((_, j) => j !== i))} className="text-slate-500 hover:text-red-400">✕</button>
                    </span>
                  );
                })}
              </div>
            )}
            <button onClick={() => void submitPO()} disabled={pending || lines.length === 0} className="rounded-lg bg-emerald-500 px-4 py-2 text-sm font-semibold text-slate-950 hover:bg-emerald-400 disabled:opacity-50">
              Créer la commande (brouillon)
            </button>
          </div>
        )}
        {error && <p className="p-3 text-xs text-red-300">{error}</p>}

        <CardHeader title="Commandes d'achat" subtitle="Statuts : Brouillon → Envoyée → (Partiellement reçue) → Réceptionnée — rapprochement BC/BL à la réception" />
        <div className="max-h-[50vh] overflow-auto">
          <table className="w-full min-w-[880px] text-sm">
            <thead className="sticky top-0 bg-slate-900 text-left text-[11px] uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-2.5">Commande</th>
                <th className="px-2 py-2.5">Fournisseur</th>
                <th className="px-2 py-2.5 text-center">Lignes</th>
                <th className="px-2 py-2.5 text-right">Montant HT</th>
                <th className="px-2 py-2.5">BL</th>
                <th className="px-2 py-2.5">Attendu</th>
                <th className="px-2 py-2.5">Statut</th>
                <th className="px-2 py-2.5 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800">
              {pos.map((po) => (
                <tr key={po.id} className="hover:bg-slate-800/40">
                  <td className="px-4 py-2.5 font-mono text-xs text-slate-200">{po.code}</td>
                  <td className="px-2 py-2.5 text-slate-200">{po.supplierName}</td>
                  <td className="px-2 py-2.5 text-center tabular-nums text-slate-300">{po.lines}</td>
                  <td className="px-2 py-2.5 text-right tabular-nums text-slate-200">{fmtMoney(po.orderedValue)}</td>
                  <td className="px-2 py-2.5 font-mono text-xs text-slate-400">{po.blNumber ?? "—"}</td>
                  <td className="px-2 py-2.5 text-xs text-slate-400">{po.expectedAt}</td>
                  <td className="px-2 py-2.5"><POStatusBadge status={po.status} /></td>
                  <td className="px-2 py-2.5 text-right">
                    <div className="flex justify-end gap-1.5">
                      {po.status === "DRAFT" && (
                        <button
                          onClick={() => void (async () => { const r = await sendPurchaseOrder(po.id); setError(r.ok ? null : r.error); if (r.ok) refresh(); })()}
                          className="rounded border border-sky-700 px-2 py-1 text-[11px] text-sky-300 hover:bg-sky-950"
                        >
                          Envoyer
                        </button>
                      )}
                      {["SENT", "PARTIALLY_RECEIVED"].includes(po.status) && (
                        <button
                          onClick={() => {
                            setReceiving(po);
                            setBl(`${po.code}-BL-001`);
                            setRecQty(Object.fromEntries(po.items.map((i) => [i.id, String(Math.max(0, i.ordered - i.alreadyReceived))])));
                          }}
                          className="rounded border border-emerald-700 px-2 py-1 text-[11px] text-emerald-300 hover:bg-emerald-950"
                        >
                          Réceptionner
                        </button>
                      )}
                      {po.status === "PARTIALLY_RECEIVED" && <Badge tone="amber">{fmtMoney(po.receivedValue)} reçus</Badge>}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      {/* Modal réception */}
      {receiving && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/70 p-4" onClick={() => setReceiving(null)}>
          <div onClick={(e) => e.stopPropagation()} className="w-full max-w-xl rounded-2xl border border-slate-700 bg-slate-900 p-5">
            <h3 className="text-lg font-semibold text-white">Réception de marchandise — {receiving.code}</h3>
            <p className="mt-0.5 text-xs text-slate-400">Rapprochement BC/BL : saisissez le n° du bon de livraison et les quantités reçues (partielle possible).</p>
            <div className="mt-3 max-h-72 overflow-y-auto">
              <table className="w-full text-sm">
                <tbody className="divide-y divide-slate-800">
                  {receiving.items.map((i) => (
                    <tr key={i.id}>
                      <td className="py-2 pr-2">
                        <p className="text-slate-200">{i.productName}</p>
                        <p className="text-[11px] text-slate-500">Commandé {fmtQty(i.ordered)} · déjà reçu {fmtQty(i.alreadyReceived)} · {fmtMoney(i.unitCost)}/u HT</p>
                      </td>
                      <td className="w-28 text-right">
                        <input
                          value={recQty[i.id] ?? ""}
                          onChange={(e) => setRecQty((prev) => ({ ...prev, [i.id]: e.target.value }))}
                          type="number"
                          className="rounded border border-slate-700 bg-slate-950 px-2 py-1 text-right tabular-nums outline-none focus:border-emerald-500"
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="mt-3 flex gap-2">
              <input value={bl} onChange={(e) => setBl(e.target.value)} placeholder="N° bon de livraison (BL)" className="flex-1 rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm outline-none focus:border-emerald-500" />
              <button onClick={() => void confirmReception()} disabled={pending} className="rounded-lg bg-emerald-500 px-4 py-2 text-sm font-semibold text-slate-950 hover:bg-emerald-400 disabled:opacity-50">
                Valider la réception
              </button>
            </div>
            <p className="mt-2 text-[10px] text-slate-500">La réception génère les mouvements SUPPLIER_IN et crédite le stock du point de réception.</p>
          </div>
        </div>
      )}

      {/* Modal fournisseur */}
      {openSupplier && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/70 p-4" onClick={() => setOpenSupplier(false)}>
          <div onClick={(e) => e.stopPropagation()} className="w-96 rounded-2xl border border-slate-700 bg-slate-900 p-5">
            <h3 className="text-lg font-semibold text-white">Nouveau fournisseur</h3>
            <div className="mt-3 space-y-2.5">
              <input value={supForm.code} onChange={(e) => setSupForm({ ...supForm, code: e.target.value })} placeholder="Code (F-00x)" className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm" />
              <input value={supForm.name} onChange={(e) => setSupForm({ ...supForm, name: e.target.value })} placeholder="Raison sociale" className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm" />
              <input value={supForm.email} onChange={(e) => setSupForm({ ...supForm, email: e.target.value })} placeholder="E-mail" className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm" />
              <input value={supForm.phone} onChange={(e) => setSupForm({ ...supForm, phone: e.target.value })} placeholder="Téléphone" className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm" />
              <div className="flex gap-2">
                <input value={supForm.leadTimeDays} onChange={(e) => setSupForm({ ...supForm, leadTimeDays: e.target.value })} type="number" placeholder="Délai (j)" className="w-32 rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm" />
                <input value={supForm.paymentTerms} onChange={(e) => setSupForm({ ...supForm, paymentTerms: e.target.value })} placeholder="Règlement" className="flex-1 rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm" />
              </div>
            </div>
            <button onClick={() => void submitSupplier()} disabled={pending} className="mt-3 w-full rounded-lg bg-emerald-500 py-2.5 text-sm font-semibold text-slate-950 hover:bg-emerald-400 disabled:opacity-50">
              Enregistrer
            </button>
          </div>
        </div>
      )}
    </>
  );
}
