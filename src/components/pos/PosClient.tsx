"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createSale, createReturn, type SalePayload } from "@/lib/actions";
import { fmtMoney, fmtDateTime, fmtNum, PAYMENT_LABEL } from "@/lib/format";
import { newClientId } from "@/lib/id";

// ─── Types locaux ──────────────────────────────────────────────────────────

interface PosProduct {
  id: string;
  sku: string;
  barcode: string;
  name: string;
  category: string;
  brand: string;
  price: number;
  vatRate: number;
  unit: "UNIT" | "KG";
}
interface PosStore {
  id: string;
  code: string;
  name: string;
  isHub: boolean;
}
interface CartLine {
  productId: string;
  sku: string;
  name: string;
  unitPrice: number;
  vatRate: number;
  unit: "UNIT" | "KG";
  quantity: number;
  discount: number;
}
interface PaymentLine {
  method: "CASH" | "CARD" | "MOBILE_MONEY" | "VOUCHER";
  amount: number;
}
interface PendingSale {
  id: string;
  storeId: string;
  cashier: string;
  items: { productId: string; quantity: number; discount: number }[];
  payments: PaymentLine[];
  createdAt: string;
}
interface ParkedCart {
  id: string;
  items: CartLine[];
  createdAt: string;
}
interface Totals {
  total: number;
  totalVat: number;
  vatByRate: { rate: number; base: number; vat: number }[];
}

const CASHIERS = ["A. Dubois", "K. Benali", "M. Leroy", "S. Traoré"];
const QUEUE_KEY = "sg_offline_sales_queue";
const PARK_KEY = "sg_parked_carts";

// ─── Composant ─────────────────────────────────────────────────────────────

export function PosClient({
  tenantName,
  products,
  stores,
  stockMap,
  canApproveReturns = false,
}: {
  tenantName: string;
  products: PosProduct[];
  stores: PosStore[];
  stockMap: Record<string, Record<string, number>>;
  canApproveReturns?: boolean;
}) {
  const router = useRouter();
  const shops = stores.filter((s) => !s.isHub);
  const [storeId, setStoreId] = useState(shops[0]?.id ?? stores[0].id);
  const [cashier, setCashier] = useState(CASHIERS[0]);
  const [lines, setLines] = useState<CartLine[]>([]);
  const [search, setSearch] = useState("");
  const [payments, setPayments] = useState<PaymentLine[]>([]);
  const [payMethod, setPayMethod] = useState<PaymentLine["method"]>("CASH");
  const [payAmount, setPayAmount] = useState("");
  const [showPay, setShowPay] = useState(false);
  const [receipt, setReceipt] = useState<{ lines: CartLine[]; payments: PaymentLine[]; totals: Totals; ticket: string; synced: boolean; change: number } | null>(null);
  const [toast, setToast] = useState<{ kind: "ok" | "info" | "err"; text: string } | null>(null);
  const [online, setOnline] = useState(true);
  const [pendingCount, setPendingCount] = useState(0);
  const [parked, setParked] = useState<ParkedCart[]>([]);
  const [showParked, setShowParked] = useState(false);
  const [returnMode, setReturnMode] = useState(false);
  const [returnTicket, setReturnTicket] = useState("");
  const [returnPin, setReturnPin] = useState("");
  const [stocks, setStocks] = useState(stockMap);
  const [netCheck, setNetCheck] = useState<{ name: string; rows: { code: string; qty: number }[] } | null>(null);
  const [, startTransition] = useTransition();
  const searchRef = useRef<HTMLInputElement>(null);

  const currentStore = stores.find((s) => s.id === storeId) ?? stores[0];
  const storeStock = stocks[storeId] ?? {};

  // ── Reconnection / synchronisation de la file offline ────────────────────
  const flushQueue = useCallback(async () => {
    const queue: PendingSale[] = JSON.parse(localStorage.getItem(QUEUE_KEY) ?? "[]");
    const remaining: PendingSale[] = [];
    for (const sale of queue) {
      try {
        await createSale({ ...sale, offline: true });
      } catch {
        remaining.push(sale);
      }
    }
    localStorage.setItem(QUEUE_KEY, JSON.stringify(remaining));
    setPendingCount(remaining.length);
    if (queue.length > 0 && remaining.length === 0) {
      setToast({ kind: "ok", text: `${queue.length} vente(s) hors-ligne synchronisée(s)` });
      startTransition(() => router.refresh());
    }
  }, [router]);

  useEffect(() => {
    setOnline(navigator.onLine);
    const goOnline = () => {
      setOnline(true);
      void flushQueue();
    };
    const goOffline = () => setOnline(false);
    window.addEventListener("online", goOnline);
    window.addEventListener("offline", goOffline);
    const q: PendingSale[] = JSON.parse(localStorage.getItem(QUEUE_KEY) ?? "[]");
    setPendingCount(q.length);
    if (navigator.onLine && q.length > 0) void flushQueue();
    const parkedAll: Record<string, ParkedCart[]> = JSON.parse(localStorage.getItem(PARK_KEY) ?? "{}");
    setParked(parkedAll[storeId] ?? []);
    return () => {
      window.removeEventListener("online", goOnline);
      window.removeEventListener("offline", goOffline);
    };
  }, [flushQueue, storeId]);

  useEffect(() => {
    const parkedAll: Record<string, ParkedCart[]> = JSON.parse(localStorage.getItem(PARK_KEY) ?? "{}");
    setParked(parkedAll[storeId] ?? []);
  }, [storeId]);

  // ── Dérivés ──────────────────────────────────────────────────────────────
  const totals = useMemo<Totals>(() => {
    let total = 0;
    let totalVat = 0;
    const byRate = new Map<number, number>();
    for (const l of lines) {
      lineTotal(l);
    }
    function lineTotal(l: CartLine) {
      const lineTTC = round2(l.quantity * l.unitPrice - l.discount);
      total += lineTTC;
      totalVat += round2(lineTTC * (l.vatRate / (1 + l.vatRate)));
      byRate.set(l.vatRate, (byRate.get(l.vatRate) ?? 0) + lineTTC);
    }
    const vats = [...byRate.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([rate, ttc]) => ({
        rate,
        base: round2(ttc - round2(ttc * (rate / (1 + rate)))),
        vat: round2(ttc * (rate / (1 + rate))),
      }));
    return { total: round2(total), totalVat: round2(totalVat), vatByRate: vats };
  }, [lines]);

  const paid = round2(payments.reduce((a, p) => a + p.amount, 0));
  const remaining = round2(Math.max(0, totals.total - paid));
  const change = round2(Math.max(0, paid - totals.total));

  const catalogByTerm = useCallback(
    (term: string): PosProduct[] => {
      const q = term.trim().toLowerCase();
      if (!q) return [];
      return products
        .filter((p) => p.name.toLowerCase().includes(q) || p.sku.toLowerCase().includes(q) || p.barcode.includes(q) || p.brand.toLowerCase().includes(q) || p.category.toLowerCase().includes(q))
        .slice(0, 8);
    },
    [products],
  );
  const suggestions = useMemo(() => catalogByTerm(search), [catalogByTerm, search]);

  // ── Actions panier ───────────────────────────────────────────────────────
  const addProduct = useCallback(
    (p: PosProduct, qty = 1) => {
      setLines((prev) => {
        const idx = prev.findIndex((l) => l.productId === p.id && l.discount === 0);
        if (idx >= 0 && p.unit === "UNIT") {
          const copy = [...prev];
          copy[idx] = { ...copy[idx], quantity: +(copy[idx].quantity + qty).toFixed(3) };
          return copy;
        }
        return [...prev, { productId: p.id, sku: p.sku, name: p.name, unitPrice: p.price, vatRate: p.vatRate, unit: p.unit, quantity: qty, discount: 0 }];
      });
      setSearch("");
      searchRef.current?.focus();
    },
    [],
  );

  const onScanEnter = useCallback(() => {
    const q = search.trim();
    if (!q) return;
    const exact = products.find((p) => p.barcode === q || p.sku.toLowerCase() === q.toLowerCase());
    if (exact) return addProduct(exact);
    if (suggestions.length > 0) return addProduct(suggestions[0]);
    setToast({ kind: "err", text: `Article introuvable : « ${q} »` });
    setSearch("");
  }, [search, products, suggestions, addProduct]);

  const setQty = (productId: string, qty: number) =>
    setLines((prev) => prev.map((l) => (l.productId === productId ? { ...l, quantity: Math.max(0, qty) } : l)));

  const removeLine = (productId: string) => setLines((prev) => prev.filter((l) => l.productId !== productId));

  const parkCart = () => {
    if (!lines.length) return;
    const all: Record<string, ParkedCart[]> = JSON.parse(localStorage.getItem(PARK_KEY) ?? "{}");
    const list = all[storeId] ?? [];
    list.push({ id: newClientId(), items: lines, createdAt: new Date().toISOString() });
    all[storeId] = list;
    localStorage.setItem(PARK_KEY, JSON.stringify(all));
    setParked(list);
    setLines([]);
    setToast({ kind: "info", text: "Panier mis en attente (reprise possible)" });
  };

  const resumeCart = (p: ParkedCart) => {
    const all: Record<string, ParkedCart[]> = JSON.parse(localStorage.getItem(PARK_KEY) ?? "{}");
    all[storeId] = (all[storeId] ?? []).filter((x) => x.id !== p.id);
    localStorage.setItem(PARK_KEY, JSON.stringify(all));
    setParked(all[storeId] ?? []);
    setLines(p.items);
    setShowParked(false);
  };

  const goToPayment = () => {
    if (!lines.length) return;
    setPayments([]);
    setPayAmount(String(Math.round(totals.total)));
    setShowPay(true);
  };
  const addPayment = () => {
    const amt = parseFloat(payAmount.replace(",", "."));
    if (!amt || amt <= 0) return;
    if (remaining <= 0) return;
    setPayments((prev) => [...prev, { method: payMethod, amount: round2(amt) }]);
    setPayAmount("");
  };

  // ── Encaissement ─────────────────────────────────────────────────────────
  const typedAmount = payAmount ? parseFloat(payAmount.replace(",", ".")) || 0 : 0;
  const canEncaisser = totals.total > 0 && paid + 0.001 >= totals.total;
  // Valider accepte le montant saisi : ajout implicite au règlement (espèces = montant complet, change calculé ; autres modes = plafonné au restant)
  const canValidate = totals.total > 0 && (canEncaisser || (remaining > 0 && typedAmount >= remaining - 0.001));

  const encaisser = async () => {
    if (!canValidate) return;
    const implicit = remaining > 0 && typedAmount > 0 ? (payMethod === "CASH" ? round2(typedAmount) : round2(Math.min(typedAmount, remaining))) : 0;
    if (implicit > 0) setPayments((prev) => [...prev, { method: payMethod, amount: implicit }]);
    const effectivePayments = implicit > 0 ? [...payments, { method: payMethod, amount: implicit }] : payments;
    const paidNow = round2(effectivePayments.reduce((a, p) => a + p.amount, 0));
    if (totals.total <= 0 || paidNow + 0.001 < totals.total) return;
    const changeNow = round2(Math.max(0, paidNow - totals.total));
    const saleId = newClientId();
    const payload: SalePayload = {
      id: saleId,
      storeId,
      cashier,
      items: lines.map((l) => ({ productId: l.productId, quantity: l.quantity, discount: l.discount })),
      payments: effectivePayments.length ? effectivePayments : [{ method: "CARD", amount: totals.total }],
      offline: !online,
    };
    let finalTicket = `#${saleId.slice(0, 8).toUpperCase()}`;
    let synced = false;
    let serverReject: string | null = null;
    try {
      if (online) {
        const res = await createSale(payload);
        if (res.ok && res.ticketNumber) {
          finalTicket = res.ticketNumber;
          synced = true;
        } else if (!res.ok) {
          serverReject = res.error ?? "Vente refusée";
          throw new Error(serverReject);
        }
      }
    } catch {
      if (serverReject) {
        // rejet serveur avéré : ne pas mettre en file locale
        setToast({ kind: "err", text: serverReject });
        return;
      }
      const queue: PendingSale[] = JSON.parse(localStorage.getItem(QUEUE_KEY) ?? "[]");
      queue.push({
        id: saleId,
        storeId,
        cashier,
        items: payload.items.map((it) => ({ productId: it.productId, quantity: it.quantity, discount: it.discount ?? 0 })),
        payments: payload.payments,
        createdAt: new Date().toISOString(),
      });
      localStorage.setItem(QUEUE_KEY, JSON.stringify(queue));
      setPendingCount(queue.length);
      setToast({ kind: "info", text: "Hors-ligne : vente stockée localement, elle sera synchronisée" });
    }
    // Décrément optimiste du stock local
    setStocks((prev) => {
      const copy: Record<string, Record<string, number>> = { ...prev, [storeId]: { ...(prev[storeId] ?? {}) } };
      for (const l of lines) {
        if (copy[storeId] && copy[storeId][l.productId] !== undefined) {
          copy[storeId][l.productId] = round3(copy[storeId][l.productId] - l.quantity);
        }
      }
      return copy;
    });
    setReceipt({ lines, payments: payload.payments, totals, ticket: finalTicket, synced, change: changeNow });
      setLines([]);
      setPayments([]);
      setPayAmount("");
      setShowPay(false);
      setReturnMode(false);
      searchRef.current?.focus();
  };

  const doReturn = async () => {
    const res = await createReturn(returnTicket.trim(), storeId, returnPin);
    if (res.ok) {
      setToast({ kind: "ok", text: `Retour du ticket ${returnTicket} enregistré` });
      setReturnMode(false);
      setReturnTicket("");
      setReturnPin("");
      startTransition(() => router.refresh());
    } else {
      setToast({ kind: "err", text: res.error });
    }
  };

  const openNetworkCheck = (p: PosProduct) => {
    setNetCheck({
      name: p.name,
      rows: shops
        .filter((s) => s.id !== storeId)
        .map((s) => ({ code: s.code, qty: stocks[s.id]?.[p.id] ?? 0 }))
        .concat([{ code: "Hub", qty: stocks[stores.find((s) => s.isHub)?.id ?? ""]?.[p.id] ?? 0 }]),
    });
  };

  // ── Rendu ────────────────────────────────────────────────────────────────
  return (
    <div className="flex h-[calc(100vh-80px)] gap-4 overflow-hidden">
      {/* Colonne principale */}
      <div className="flex min-w-0 flex-1 flex-col gap-3">
        {/* Barre haut POS */}
        <div className="flex flex-wrap items-center gap-2.5 rounded-xl border border-slate-800 bg-slate-900/60 px-3 py-2.5">
          <span className="flex h-8 items-center rounded bg-emerald-500/10 px-2 text-xs font-bold text-emerald-300">CAISSE</span>
          <select
            value={storeId}
            onChange={(e) => setStoreId(e.target.value)}
            className="rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-2 text-sm text-slate-200 outline-none focus:border-emerald-500"
          >
            {shops.map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
          <select value={cashier} onChange={(e) => setCashier(e.target.value)} className="rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-2 text-sm text-slate-200 outline-none">
            {CASHIERS.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
          <span className={`flex items-center gap-1.5 rounded-lg border px-2.5 py-2 text-xs font-medium ${online ? "border-emerald-800 bg-emerald-950 text-emerald-300" : "border-red-800 bg-red-950 text-red-300"}`}>
            <span className={`h-1.5 w-1.5 rounded-full ${online ? "bg-emerald-400" : "bg-red-400"} animate-pulse`} />
            {online ? "En ligne" : "Hors ligne · caisse locale active"}
          </span>
          {pendingCount > 0 && (
            <button onClick={() => void flushQueue()} className="rounded-lg border border-amber-700 bg-amber-950 px-2.5 py-2 text-xs font-medium text-amber-300 hover:bg-amber-900">
              ⇅ {pendingCount} vente(s) à synchroniser
            </button>
          )}
          <div className="ml-auto flex gap-2">
            <button onClick={() => setReturnMode((v) => !v)} className={`rounded-lg border px-2.5 py-2 text-xs font-medium ${returnMode ? "border-red-700 bg-red-950 text-red-300" : "border-slate-700 bg-slate-950 text-slate-300 hover:border-slate-500"}`}>
              Mode retour
            </button>
          </div>
        </div>

        {returnMode ? (
          <div className="rounded-xl border border-red-900 bg-red-950/30 p-4">
            <p className="text-sm font-semibold text-red-300">Traitement d&apos;un retour {canApproveReturns ? "(compte administrateur)" : "(autorisation administrateur requise)"}</p>
            <p className="mt-1 text-xs text-red-200/70">
              {canApproveReturns
                ? "N° du ticket d'origine — autorisé par votre rôle administrateur. Le stock est re-crédité via un mouvement RETURN_IN."
                : "N° du ticket d'origine + PIN administrateur (démo : 1234). Le stock est re-crédité via un mouvement RETURN_IN."}
            </p>
            <div className="mt-3 flex gap-2">
              <input value={returnTicket} onChange={(e) => setReturnTicket(e.target.value)} placeholder="Ex : T-M001-000102" className="w-56 rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm outline-none focus:border-red-500" />
              {!canApproveReturns && <input value={returnPin} onChange={(e) => setReturnPin(e.target.value)} placeholder="PIN admin" type="password" className="w-32 rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm outline-none focus:border-red-500" />}
              <button onClick={() => void doReturn()} className="rounded-lg bg-red-500 px-4 py-2 text-sm font-semibold text-white hover:bg-red-400">Valider le retour</button>
            </div>
          </div>
        ) : null}

        {/* Scan / recherche */}
        <div className="relative">
          <input
            ref={searchRef}
            autoFocus
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && onScanEnter()}
            placeholder="⌁ Scanner (EAN-13/8, QR) ou rechercher un article — Enter pour ajouter"
            className="w-full rounded-xl border border-slate-700 bg-slate-950 px-4 py-3.5 pr-28 text-base outline-none transition focus:border-emerald-500"
          />
          <button
            onClick={() => addProduct(products[Math.floor(Math.random() * products.length)])}
            className="absolute right-2 top-1/2 -translate-y-1/2 rounded-lg border border-slate-600 bg-slate-900 px-3 py-1.5 text-xs text-slate-300 hover:border-emerald-500 hover:text-emerald-300"
          >
            Simuler scan
          </button>
          {suggestions.length > 0 && search && (
            <div className="absolute z-10 mt-1 w-full overflow-hidden rounded-xl border border-slate-700 bg-slate-900 shadow-xl">
              {suggestions.map((p) => {
                const st = storeStock[p.id] ?? 0;
                return (
                  <button key={p.id} onClick={() => addProduct(p)} className="flex w-full items-center justify-between px-4 py-2.5 text-left text-sm hover:bg-slate-800">
                    <span>
                      <span className="text-slate-200">{p.name}</span>
                      <span className="ml-2 text-xs text-slate-500">{p.sku} · {p.barcode}</span>
                    </span>
                    <span className="flex items-center gap-2">
                      {st <= 0 && (
                        <button
                          onClick={(e) => { e.stopPropagation(); openNetworkCheck(p); }}
                          className="rounded border border-sky-700 bg-sky-950 px-1.5 py-0.5 text-[10px] text-sky-300 hover:bg-sky-900"
                        >
                          Dispo réseau
                        </button>
                      )}
                      <span className={`text-xs tabular-nums ${st <= 0 ? "text-red-400" : "text-slate-500"}`}>
                        {st > 0 ? `stock ${fmtNum(st, p.unit === "KG" ? 2 : 0)}${p.unit === "KG" ? " kg" : ""}` : "rupture"}
                      </span>
                      <span className="font-semibold text-emerald-300">{fmtMoney(p.price)}</span>
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Panier */}
        <div className="flex min-h-0 flex-1 flex-col rounded-xl border border-slate-800 bg-slate-900/40">
          <div className="flex items-center justify-between border-b border-slate-800 px-4 py-2.5 text-sm">
            <p className="font-semibold text-slate-200">Panier — {currentStore.name}</p>
            <div className="flex gap-2">
              <button onClick={() => setShowParked((v) => !v)} className="rounded-lg border border-slate-700 px-2.5 py-1.5 text-xs text-slate-300 hover:border-amber-500">
                ⏸ En attente ({parked.length})
              </button>
              <button onClick={parkCart} disabled={!lines.length} className="rounded-lg border border-slate-700 px-2.5 py-1.5 text-xs text-slate-300 disabled:opacity-40 hover:border-amber-500">
                Mettre en attente
              </button>
              <button onClick={() => setLines([])} disabled={!lines.length} className="rounded-lg border border-slate-700 px-2.5 py-1.5 text-xs text-red-300 disabled:opacity-40 hover:border-red-500">
                Vider
              </button>
            </div>
          </div>
          {showParked && (
            <div className="border-b border-slate-800 bg-slate-950/60 p-2">
              {parked.length === 0 && <p className="p-2 text-xs text-slate-500">Aucun panier en attente sur ce magasin.</p>}
              {parked.map((p) => (
                <div key={p.id} className="flex items-center justify-between rounded-lg px-2 py-1.5 text-xs hover:bg-slate-800">
                  <span className="text-slate-300">
                    {fmtDateTime(p.createdAt)} · {p.items.length} article(s) · {fmtMoney(p.items.reduce((a, l) => a + l.quantity * l.unitPrice, 0))}
                  </span>
                  <button onClick={() => resumeCart(p)} className="rounded border border-emerald-700 px-2 py-0.5 text-[11px] text-emerald-300 hover:bg-emerald-950">Reprendre</button>
                </div>
              ))}
            </div>
          )}
          <div className="min-h-0 flex-1 overflow-y-auto">
            {lines.length === 0 ? (
              <div className="flex h-full flex-col items-center justify-center text-center text-slate-500">
                <p className="text-lg">Panier vide</p>
                <p className="mt-1 max-w-sm text-xs">Scannez un code-barres, tapez une référence (Enter = ajout) ou cliquez « Simuler scan ». Les ventes fonctionnent même hors-ligne.</p>
              </div>
            ) : (
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-slate-900 text-left text-[11px] uppercase tracking-wide text-slate-500">
                  <tr>
                    <th className="px-4 py-2 font-medium">Article</th>
                    <th className="px-2 py-2 font-medium">Qté</th>
                    <th className="px-2 py-2 text-right font-medium">P.U. TTC</th>
                    <th className="px-2 py-2 text-right font-medium">Total</th>
                    <th className="w-10" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800">
                  {lines.map((l) => {
                    const st = storeStock[l.productId] ?? 0;
                    return (
                      <tr key={l.productId + String(l.discount)}>
                        <td className="px-4 py-2">
                          <p className="text-slate-200">{l.name}</p>
                          <p className="text-[11px] text-slate-500">
                            {l.sku} · {fmtMoney(l.unitPrice)} {l.unit === "KG" && "/ kg"} · TVA {fmtNum(l.vatRate * 100, 1)}%
                          </p>
                        </td>
                        <td className="px-2 py-2">
                          <div className="flex items-center gap-1">
                            <button onClick={() => setQty(l.productId, round3(l.quantity - (l.unit === "UNIT" ? 1 : 0.1)))} className="h-7 w-7 rounded bg-slate-800 text-slate-300 hover:bg-slate-700">−</button>
                            <input
                              value={l.quantity}
                              onChange={(e) => setQty(l.productId, parseFloat(e.target.value.replace(",", ".")) || 0)}
                              type="number"
                              step={l.unit === "UNIT" ? 1 : 0.1}
                              className="w-16 rounded border border-slate-700 bg-slate-950 px-1.5 py-1 text-center tabular-nums text-slate-100 outline-none focus:border-emerald-500"
                            />
                            <button onClick={() => setQty(l.productId, round3(l.quantity + (l.unit === "UNIT" ? 1 : 0.1)))} className="h-7 w-7 rounded bg-slate-800 text-slate-300 hover:bg-slate-700">+</button>
                          </div>
                          {st < l.quantity && (
                            <p className="mt-1 text-[10px] text-amber-400">
                              Stock insuffisant ({fmtNum(st)}) ·{" "}
                              <button onClick={() => { const p = products.find((x) => x.id === l.productId); if (p) openNetworkCheck(p); }} className="underline hover:text-sky-300">
                                vérifier le réseau
                              </button>
                            </p>
                          )}
                        </td>
                        <td className="px-2 py-2 text-right tabular-nums text-slate-300">{fmtMoney(l.unitPrice)}</td>
                        <td className="px-2 py-2 text-right font-semibold tabular-nums text-emerald-300">{fmtMoney(l.quantity * l.unitPrice - l.discount)}</td>
                        <td className="px-1">
                          <button onClick={() => removeLine(l.productId)} className="text-slate-500 hover:text-red-400">✕</button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </div>

      {/* Colonne paiement */}
      <div className="flex w-72 shrink-0 flex-col gap-3 lg:w-80">
        <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
          <p className="text-[11px] uppercase tracking-widest text-slate-500">Total panier</p>
          <p className="mt-1 text-4xl font-bold tabular-nums text-emerald-300">{fmtMoney(totals.total)}</p>
          <dl className="mt-3 space-y-1 border-t border-slate-800 pt-3 text-xs text-slate-400">
            {totals.vatByRate.map((v) => (
              <div key={v.rate} className="flex justify-between">
                <dt>TVA {fmtNum(v.rate * 100, 1)}% (base {fmtMoney(v.base)})</dt>
                <dd className="tabular-nums">{fmtMoney(v.vat)}</dd>
              </div>
            ))}
            <div className="flex justify-between font-medium text-slate-300">
              <dt>{fmtMoney(totals.total - totals.totalVat)} HT</dt>
              <dd className="tabular-nums">{lines.length} ligne(s)</dd>
            </div>
          </dl>
          <button
            onClick={goToPayment}
            disabled={!lines.length}
            className="mt-3 w-full rounded-lg bg-emerald-500 py-3 text-base font-bold text-slate-950 transition hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-40"
          >
            Encaisser
          </button>
        </div>

        <div className="flex-1 rounded-xl border border-slate-800 bg-slate-900/40 p-4 text-xs text-slate-500">
          <p className="mb-2 font-semibold text-slate-300">Matériel & raccourcis</p>
          <ul className="space-y-1.5">
            <li>• Lecteur 1D/2D USB/Bluetooth : scan direct dans le champ recherche.</li>
            <li>• Paiements : Espèces, CB, Mobile Money, Bon d&apos;achat + fractionné.</li>
            <li>• Ticket thermique ESC/POS : bouton Imprimer du ticket.</li>
            <li>• Retours autorisés par rôle administrateur ou PIN (mode retour).</li>
          </ul>
        </div>
      </div>

      {/* Modal paiement */}
      {showPay && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm">
          <div className="w-full max-w-lg rounded-2xl border border-slate-700 bg-slate-900 p-5 shadow-2xl">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-xs uppercase tracking-widest text-slate-500">Encaissement</p>
                <p className="text-2xl font-bold tabular-nums text-white">{fmtMoney(totals.total)}</p>
                <p className="text-xs text-slate-400">Reste à régler : {fmtMoney(remaining)} · Réglé : {fmtMoney(paid)} · Monnaie à rendre : <span className="font-semibold text-amber-300">{fmtMoney(change)}</span></p>
              </div>
              <button onClick={() => setShowPay(false)} className="text-slate-500 hover:text-white">✕</button>
            </div>

            <div className="mt-4 flex gap-2">
              {(["CASH", "CARD", "MOBILE_MONEY", "VOUCHER"] as const).map((m) => (
                <button
                  key={m}
                  onClick={() => setPayMethod(m)}
                  className={`flex-1 rounded-lg border px-2 py-2 text-xs font-medium transition ${payMethod === m ? "border-emerald-500 bg-emerald-950 text-emerald-300" : "border-slate-700 bg-slate-950 text-slate-300 hover:border-slate-500"}`}
                >
                  {PAYMENT_LABEL[m]}
                </button>
              ))}
            </div>

            <div className="mt-3 flex gap-2">
              <input
                value={payAmount}
                onChange={(e) => setPayAmount(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && addPayment()}
                inputMode="decimal"
                placeholder="Montant"
                className="flex-1 rounded-lg border border-slate-700 bg-slate-950 px-3 py-2.5 text-base tabular-nums outline-none focus:border-emerald-500"
              />
              <button onClick={addPayment} className="rounded-lg border border-slate-600 bg-slate-800 px-4 text-sm text-slate-200 hover:border-emerald-500">
                Ajouter règlement
              </button>
            </div>
            {payMethod === "CASH" && remaining > 0 && (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {[remaining, 500, 1000, 2000, 5000, 10000].map((v, i) => (
                  <button key={i} onClick={() => setPayAmount(String(Math.round(v)))} className="rounded-md border border-slate-700 bg-slate-950 px-2.5 py-1 text-xs tabular-nums text-slate-300 hover:border-emerald-500 hover:text-emerald-300">
                    {i === 0 ? `Exact ${fmtMoney(v)}` : `${fmtNum(v)} FCFA`}
                  </button>
                ))}
              </div>
            )}

            {payments.length > 0 && (
              <div className="mt-3 space-y-1 rounded-lg border border-slate-800 bg-slate-950/60 p-2.5">
                {payments.map((p, i) => (
                  <div key={i} className="flex items-center justify-between text-xs">
                    <span className="text-slate-300">{PAYMENT_LABEL[p.method]}</span>
                    <span className="flex items-center gap-2 tabular-nums text-slate-200">
                      {fmtMoney(p.amount)}
                      <button onClick={() => setPayments((prev) => prev.filter((_, j) => j !== i))} className="text-slate-500 hover:text-red-400">✕</button>
                    </span>
                  </div>
                ))}
              </div>
            )}

            <button
              onClick={() => void encaisser()}
              disabled={!canValidate}
              className="mt-4 w-full rounded-lg bg-emerald-500 py-3 text-base font-bold text-slate-950 transition hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-40"
            >
              Valider {canEncaisser ? `— rendre ${fmtMoney(change)}` : canValidate ? (payMethod === "CASH" && typedAmount > totals.total ? `— rendre ${fmtMoney(typedAmount - totals.total)}` : "— régler le solde") : `— manque ${fmtMoney(remaining)}`}
            </button>
            <p className="mt-2 text-center text-[10px] text-slate-500">
              Cure inaltérable : chaque ticket est horodaté et journalisé (conformité fiscale PRD §6).
            </p>
          </div>
        </div>
      )}

      {/* Modal ticket */}
      {receipt && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm">
          <div className="w-full max-w-md">
            <div id="printable-ticket" className="mx-auto max-h-[70vh] overflow-y-auto rounded-xl bg-white p-5 text-slate-900">
              <p className="text-center text-base font-bold">{tenantName}</p>
              <p className="text-center text-[11px] text-slate-600">{currentStore.name} · {currentStore.code}</p>
              <p className="mt-2 text-center text-xs">
                Ticket <b>{receipt.ticket}</b>
                {!receipt.synced && <span className="ml-1 text-amber-600">(local — en attente de sync)</span>}
              </p>
              <p className="text-center text-[10px] text-slate-500">
                {new Date().toLocaleString("fr-FR")} · Caisse : {cashier}
              </p>
              <div className="my-2 border-y border-dashed border-slate-300 py-2 text-[11px]">
                {receipt.lines.map((l, i) => (
                  <div key={i} className="flex justify-between">
                    <span>{fmtNum(l.quantity, l.unit === "KG" ? 2 : 0).padEnd(2)} × {l.name.slice(0, 24)}</span>
                    <span>{fmtMoney(l.quantity * l.unitPrice).slice(0, 12)}</span>
                  </div>
                ))}
              </div>
              <div className="text-[11px]">
                {receipt.totals.vatByRate.map((v) => (
                  <div key={v.rate} className="flex justify-between text-slate-600">
                    <span>TVA {fmtNum(v.rate * 100, 1)}%</span>
                    <span>{fmtMoney(v.vat)}</span>
                  </div>
                ))}
                <div className="flex justify-between border-t border-slate-300 pt-1 text-sm font-bold">
                  <span>TOTAL TTC</span>
                  <span>{fmtMoney(receipt.totals.total)}</span>
                </div>
                {receipt.payments.map((p, i) => (
                  <div key={i} className="flex justify-between text-slate-700">
                    <span>{PAYMENT_LABEL[p.method]}</span>
                    <span>{fmtMoney(p.amount)}</span>
                  </div>
                ))}
                {receipt.change > 0 && (
                  <div className="flex justify-between font-bold">
                    <span>Monnaie rendue</span>
                    <span>{fmtMoney(receipt.change)}</span>
                  </div>
                )}
              </div>
              <p className="mt-3 text-center text-[9px] text-slate-500">Merci de votre visite — SuperGestion POS v1.0<br />Déjà réglé = article vendu. Gardez ce ticket pour tout échange.</p>
            </div>
            <div className="mt-3 flex flex-wrap justify-center gap-2">
              <button onClick={() => window.print()} className="rounded-lg bg-slate-800 px-4 py-2 text-sm text-slate-200 hover:bg-slate-700">Imprimer (ESC/POS)</button>
              <a href={`mailto:?subject=Votre ticket ${receipt.ticket}&body=Ticket ${receipt.ticket} — ${fmtMoney(receipt.totals.total)} TTC`} className="rounded-lg border border-slate-600 px-4 py-2 text-sm text-slate-300 hover:border-slate-400">Envoyer par e-mail</a>
              <button
                onClick={() => {
                  setReceipt(null);
                  startTransition(() => router.refresh());
                }}
                className="rounded-lg bg-emerald-500 px-4 py-2 text-sm font-semibold text-slate-950 hover:bg-emerald-400"
              >
                Nouvelle vente
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal dispo réseau */}
      {netCheck && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/70 p-4" onClick={() => setNetCheck(null)}>
          <div onClick={(e) => e.stopPropagation()} className="w-80 rounded-2xl border border-slate-700 bg-slate-900 p-5">
            <p className="font-semibold text-white">Disponibilité réseau</p>
            <p className="mt-1 text-sm text-slate-400">{netCheck.name}</p>
            <div className="mt-3 space-y-1.5 text-sm">
              {netCheck.rows.map((r) => (
                <div key={r.code} className="flex justify-between rounded-lg bg-slate-950 px-3 py-2">
                  <span className="text-slate-300">{r.code}</span>
                  <span className={`tabular-nums font-semibold ${r.qty > 0 ? "text-emerald-300" : "text-red-400"}`}>{r.qty > 0 ? `${fmtNum(r.qty)} u.` : "rupture"}</span>
                </div>
              ))}
            </div>
            <button onClick={() => setNetCheck(null)} className="mt-3 w-full rounded-lg bg-slate-800 py-2 text-sm text-slate-200 hover:bg-slate-700">Fermer</button>
          </div>
        </div>
      )}

      {/* Toast */}
      {toast && (
        <div className={`fixed bottom-5 right-5 z-50 rounded-lg border px-4 py-2.5 text-sm shadow-xl ${toast.kind === "ok" ? "border-emerald-700 bg-emerald-950 text-emerald-200" : toast.kind === "err" ? "border-red-700 bg-red-950 text-red-200" : "border-amber-700 bg-amber-950 text-amber-200"}`}>
          {toast.text}
          <button onClick={() => setToast(null)} className="ml-3 opacity-60 hover:opacity-100">✕</button>
        </div>
      )}
    </div>
  );
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}
