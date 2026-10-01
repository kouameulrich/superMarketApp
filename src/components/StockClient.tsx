"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { adjustStock, declareLoss, autoGeneratePullOrders, createTransferOrder } from "@/lib/actions";
import { fmtQty } from "@/lib/format";
import { Badge, Card, CardHeader } from "@/components/ui";

interface StoreOpt { id: string; code: string; name: string; isHub: boolean }
interface Row {
  productId: string; sku: string; name: string; category: string;
  unit: "UNIT" | "KG"; qty: number; transit: number; min: number;
  state: "OUT" | "CRITICAL" | "LOW" | "OK";
}
interface Movement { id: string; date: string; type: string; typeLabel: string; ref: string; note: string; productName: string; qty: number }
interface Batch { id: string; productName: string; batchNumber: string; dlc: string; days: number; quantity: number }

export function StockClient({
  stores, initialStoreId, rows, movements, batches, virtualRows, hubStock,
}: {
  stores: StoreOpt[]; initialStoreId: string; rows: Row[]; movements: Movement[];
  batches: Batch[]; virtualRows: { name: string; transit: number; avarie: number }[];
  hubStock: Record<string, number>;
}) {
  const router = useRouter();
  const [storeId, setStoreId] = useState(initialStoreId);
  const [view, setView] = useState<"niveaux" | "journal" | "dlc">("niveaux");
  const [modal, setModal] = useState<{ kind: "adjust" | "loss" | "ot"; productId: string; name: string } | null>(null);
  const [qty, setQty] = useState("1");
  const [note, setNote] = useState("");
  const [direction, setDirection] = useState("+");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [pushMsg, setToastLike] = useState<string | null>(null);

  const currentStore = stores.find((s) => s.id === storeId) ?? stores[0];

  const refresh = () => startTransition(() => router.refresh());

  const runAdjust = async () => {
    const parsed = direction === "+" ? parseFloat(qty) : -Math.abs(parseFloat(qty));
    const res = await adjustStock(storeId, modal!.productId, parsed, note);
    setError(res.ok ? null : res.error);
    if (res.ok) { setModal(null); refresh(); }
  };
  const runLoss = async () => {
    const res = await declareLoss(storeId, modal!.productId, Math.abs(parseFloat(qty)), note);
    setError(res.ok ? null : res.error);
    if (res.ok) { setModal(null); refresh(); }
  };
  const runPull = async () => {
    const res = await autoGeneratePullOrders(storeId);
    if (!res.ok) setError(res.error);
    else {
      setModal(null);
      setToastLike(res.count === 0 ? "Aucun produit sous le seuil avec du stock hub disponible." : `${res.count} ligne(s) ajoutée(s) à un OT automatique (flux tiré).`);
      refresh();
    }
  };

  return (
    <Card className="min-h-[70vh]">
      <div className="flex flex-wrap items-center gap-2 border-b border-slate-800 p-3">
        <select value={storeId} onChange={(e) => setStoreId(e.target.value)} className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm outline-none">
          {stores.map((s) => (
            <option key={s.id} value={s.id}>{s.isHub ? "★ " : ""}{s.name} ({s.code})</option>
          ))}
        </select>
        <div className="flex rounded-lg border border-slate-700">
          {(["niveaux", "journal", "dlc"] as const).map((v) => (
            <button key={v} onClick={() => setView(v)} className={`px-3 py-2 text-xs font-medium capitalize ${view === v ? "bg-slate-800 text-white" : "text-slate-400 hover:text-slate-200"}`}>
              {v === "niveaux" ? "Niveaux stock" : v === "journal" ? "Journal mouvements" : "Lots & DLC"}
            </button>
          ))}
        </div>
        <button
          onClick={() => { void runPull(); }}
          disabled={pending}
          className="ml-auto rounded-lg border border-emerald-700 bg-emerald-950 px-3 py-2 text-xs font-semibold text-emerald-300 hover:bg-emerald-900 disabled:opacity-50"
        >
          ⚡ Générer OT (flux tiré — seuils)
        </button>
      </div>

      {pushMsg && <p className="m-3 rounded-lg border border-sky-800 bg-sky-950 px-3 py-2 text-xs text-sky-200">{pushMsg}</p>}

      {view === "niveaux" && (
        <div className="max-h-[62vh] overflow-auto">
          <table className="w-full min-w-[820px] text-sm">
            <thead className="sticky top-0 bg-slate-900 text-left text-[11px] uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-2.5">Article</th>
                <th className="px-2 py-2.5 text-right">Disponible</th>
                <th className="px-2 py-2.5 text-right">En transit</th>
                <th className="px-2 py-2.5 text-right">Seuil mini</th>
                <th className="px-2 py-2.5 text-center">État</th>
                <th className="px-2 py-2.5 text-center">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800">
              {rows.map((r) => (
                <tr key={r.productId} className="hover:bg-slate-800/40">
                  <td className="px-4 py-2.5">
                    <p className="text-slate-100">{r.name}</p>
                    <p className="text-[11px] text-slate-500">{r.sku} · {r.category}</p>
                  </td>
                  <td className={`px-2 py-2.5 text-right font-semibold tabular-nums ${r.state === "OK" ? "text-emerald-300" : r.state === "LOW" ? "text-amber-300" : "text-red-300"}`}>
                    {fmtQty(r.qty)}{r.unit === "KG" ? " kg" : ""}
                  </td>
                  <td className="px-2 py-2.5 text-right tabular-nums text-sky-300">{r.transit > 0 ? fmtQty(r.transit) : "—"}</td>
                  <td className="px-2 py-2.5 text-right tabular-nums text-slate-400">{fmtQty(r.min)}</td>
                  <td className="px-2 py-2.5 text-center">
                    <Badge tone={r.state === "OUT" ? "red" : r.state === "CRITICAL" ? "red" : r.state === "LOW" ? "amber" : "green"}>
                      {r.state === "OUT" ? "Rupture" : r.state === "CRITICAL" ? "Critique" : r.state === "LOW" ? "Bas" : "OK"}
                    </Badge>
                  </td>
                  <td className="px-2 py-2.5">
                    <div className="flex justify-center gap-1.5">
                      <button onClick={() => { setModal({ kind: "adjust", productId: r.productId, name: r.name }); setQty("1"); }} className="rounded border border-slate-700 px-2 py-1 text-[11px] text-slate-300 hover:border-sky-500">Ajuster</button>
                      <button onClick={() => setModal({ kind: "loss", productId: r.productId, name: r.name })} className="rounded border border-slate-700 px-2 py-1 text-[11px] text-slate-300 hover:border-red-500">Casse</button>
                      <button
                        onClick={() => setModal({ kind: "ot", productId: r.productId, name: r.name })}
                        className="rounded border border-slate-700 px-2 py-1 text-[11px] text-slate-300 hover:border-amber-500"
                      >
                        OT ({fmtQty(Math.max(0, Math.ceil(hubStock[r.productId] ?? 0)))} hub)
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {view === "journal" && (
        <div className="max-h-[62vh] overflow-auto p-2">
          <table className="w-full text-sm">
            <tbody className="divide-y divide-slate-800">
              {movements.map((m) => (
                <tr key={m.id} className="hover:bg-slate-800/40">
                  <td className="w-32 px-3 py-2 text-xs text-slate-500">{m.date}</td>
                  <td className="px-2 py-2">
                    <p className="text-slate-200">{m.productName}</p>
                    <p className="text-[11px] text-slate-500">{m.typeLabel} · {m.ref}{m.note ? ` · ${m.note}` : ""}</p>
                  </td>
                  <td className={`w-24 px-3 py-2 text-right font-semibold tabular-nums ${["SUPPLIER_IN", "RETURN_IN", "TRANSFER_IN"].includes(m.type) ? "text-emerald-300" : m.type === "INVENTORY_ADJUST" ? (m.qty < 0 ? "text-red-300" : "text-emerald-300") : "text-red-300"}`}>
                    {m.type === "INVENTORY_ADJUST" && m.qty > 0 ? "+" : m.type === "INVENTORY_ADJUST" ? "" : ["SALE_POS", "TRANSFER_OUT", "LOSS_DAMAGE", "LOSS_TRANSIT", "DAMAGE_TRANSIT"].includes(m.type) ? "−" : "+"}
                    {fmtQty(Math.abs(m.qty))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {view === "dlc" && (
        <div className="max-h-[62vh] overflow-auto p-3">
          <div className="grid gap-2 md:grid-cols-2">
            {batches.map((b) => (
              <div key={b.id} className={`rounded-lg border p-3 ${b.days <= 0 ? "border-red-800 bg-red-950/40" : b.days <= 2 ? "border-red-900 bg-red-950/20" : b.days <= 5 ? "border-amber-800 bg-amber-950/20" : "border-slate-800 bg-slate-950/40"}`}>
                <div className="flex items-center justify-between">
                  <p className="text-sm font-medium text-slate-100">{b.productName}</p>
                  <Badge tone={b.days <= 2 ? "red" : b.days <= 5 ? "amber" : "green"}>{b.days <= 0 ? "Périmé" : `J-${b.days}`}</Badge>
                </div>
                <p className="mt-1 text-xs text-slate-400">Lot {b.batchNumber} · DLC {b.dlc} · Qté lot {fmtQty(b.quantity)}</p>
                {b.days <= 5 && (
                  <p className="mt-1.5 text-[11px] text-amber-300/80">
                    {b.days <= 0 ? "À retirer du rayon (casse garantissant que rien n'est vendu après DLC)." : "A actionner : marquage / promo flash / transfert vers magasin à forte rotation."}
                  </p>
                )}
              </div>
            ))}
            {batches.length === 0 && <p className="p-3 text-sm text-slate-500">Aucun lot tracé sur ce magasin.</p>}
          </div>
        </div>
      )}

      {virtualRows.length > 0 && view === "niveaux" && (
        <div className="border-t border-slate-800 p-3">
          <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500">Emplacements virtuels — {currentStore.code}</p>
          <div className="flex flex-wrap gap-2">
            {virtualRows.map((v) => (
              <span key={v.name} className="rounded-lg border border-sky-900 bg-sky-950/40 px-2.5 py-1 text-[11px] text-sky-200">
                In-Transit · {v.name} : {fmtQty(v.transit)}
              </span>
            ))}
            {virtualRows.filter((v) => v.avarie > 0).map((v) => (
              <span key={`av-${v.name}`} className="rounded-lg border border-red-900 bg-red-950/40 px-2.5 py-1 text-[11px] text-red-200">
                Avarie · {v.name} : {fmtQty(v.avarie)}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Modal ajustement / casse / OT mono-produit */}
      {modal && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/70 p-4" onClick={() => setModal(null)}>
          <div onClick={(e) => e.stopPropagation()} className="w-96 rounded-2xl border border-slate-700 bg-slate-900 p-5">
            {modal.kind === "adjust" && (
              <>
                <h3 className="font-semibold text-white">Ajustement inventaire — {modal.name}</h3>
                <div className="mt-3 flex gap-2">
                  <select value={direction} onChange={(e) => setDirection(e.target.value)} className="rounded-lg border border-slate-700 bg-slate-950 px-2 py-2 text-sm">
                    <option value="+">Ajout (+)</option>
                    <option value="-">Retrait (−)</option>
                  </select>
                  <input value={qty} onChange={(e) => setQty(e.target.value)} type="number" step="0.1" className="flex-1 rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm" />
                </div>
                <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Motif (inventaire tournant…)" className="mt-2 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm" />
                {error && <p className="mt-2 text-xs text-red-300">{error}</p>}
                <button onClick={() => void runAdjust()} disabled={pending} className="mt-3 w-full rounded-lg bg-sky-500 py-2.5 text-sm font-semibold text-slate-950 hover:bg-sky-400">Valider l&apos;ajustement</button>
              </>
            )}
            {modal.kind === "loss" && (
              <>
                <h3 className="font-semibold text-white">Déclarer une casse / perte — {modal.name}</h3>
                <input value={qty} onChange={(e) => setQty(e.target.value)} type="number" step="0.1" className="mt-3 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm" />
                <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Motif (DLC dépassée, choc, photo PDA…)" className="mt-2 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm" />
                {error && <p className="mt-2 text-xs text-red-300">{error}</p>}
                <button onClick={() => void runLoss()} disabled={pending} className="mt-3 w-full rounded-lg bg-red-500 py-2.5 text-sm font-semibold text-white hover:bg-red-400">Imputer à la zone casse</button>
              </>
            )}
            {modal.kind === "ot" && (
              <>
                <h3 className="font-semibold text-white">Créer un OT vers le hub</h3>
                <p className="mt-1 text-xs text-slate-400">Retour/réappro d&apos;un article unique vers le hub logistique.</p>
                <input value={qty} onChange={(e) => setQty(e.target.value)} type="number" step="1" className="mt-3 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm" />
                {error && <p className="mt-2 text-xs text-red-300">{error}</p>}
                <button
                  onClick={() => {
                    setError(null);
                    const parsed = parseFloat(qty);
                    if (!parsed || parsed <= 0) { setError("Quantité invalide"); return; }
                    const hub = stores.find((s) => s.isHub);
                    if (!hub) { setError("Aucun hub configuré"); return; }
                    void (async () => {
                      const res = await createTransferOrder(storeId, hub.id, "PULL", [{ productId: modal.productId, quantity: parsed }], false);
                      if (!res.ok) setError(res.error);
                      else { setModal(null); refresh(); }
                    })();
                  }}
                  disabled={pending}
                  className="mt-3 w-full rounded-lg bg-amber-500 py-2.5 text-sm font-semibold text-slate-950 hover:bg-amber-400"
                >
                  Créer l&apos;OT (statut Demandé)
                </button>
              </>
            )}
            <button onClick={() => setModal(null)} className="mt-2 w-full rounded-lg border border-slate-700 py-2 text-sm text-slate-300 hover:border-slate-500">Annuler</button>
          </div>
        </div>
      )}
    </Card>
  );
}
