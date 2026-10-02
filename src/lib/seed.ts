import type {
  Batch,
  CashSession,
  Database,
  MovementType,
  Product,
  PurchaseOrder,
  Sale,
  SaleItem,
  SalePayment,
  StockMovement,
  Store,
  Supplier,
  Tenant,
  TransferItem,
  TransferOrder,
  UUID,
  User,
  UserRole,
} from "./types";
import { createHash } from "crypto";

// Deterministic RNG so the demo dataset is stable across rebuilds.
function mulberry32(seed: number) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const rnd = mulberry32(42);
const pick = <T,>(arr: T[]): T => arr[Math.floor(rnd() * arr.length)];
const between = (min: number, max: number) => min + rnd() * (max - min);
const intBetween = (min: number, max: number) => Math.floor(between(min, max + 1));
const uid = (): UUID => globalThis.crypto.randomUUID();

const NOW = new Date();

// Parité fixe EUR → FCFA, arrondie au multiple de 5 FCFA (plus petite pièce).
const EUR_TO_FCFA = 655.957;
const fcfa = (eur: number): number => Math.round((eur * EUR_TO_FCFA) / 5) * 5;
const OPENING_FLOAT_FCFA = 100000;
const daysAgo = (d: number, h = 10, m = 0): string => {
  const dt = new Date(NOW);
  dt.setDate(dt.getDate() - d);
  dt.setHours(h, m, intBetween(0, 59), 0);
  return dt.toISOString();
};
const daysAhead = (d: number): string => {
  const dt = new Date(NOW);
  dt.setDate(dt.getDate() + d);
  return dt.toISOString().slice(0, 10);
};

interface ProductSeed {
  sku: string;
  barcode: string;
  name: string;
  category: string;
  brand: string;
  cost: number;
  vat: number;
  price: number;
  unit?: "UNIT" | "KG";
  min: number;
  dlc?: boolean; // produit traçable par lot/DLC
}

const PRODUCTS: ProductSeed[] = [
  // Épicerie
  { sku: "EPI-0001", barcode: "3017620422003", name: "Nutella 750g", category: "Épicerie sucrée", brand: "Ferrero", cost: 2.85, vat: 0.18, price: 4.95, min: 12, dlc: true },
  { sku: "EPI-0002", barcode: "7622210951965", name: "Biscuits Prince 300g", category: "Épicerie sucrée", brand: "Mondelez", cost: 1.4, vat: 0.18, price: 2.79, min: 15 },
  { sku: "EPI-0003", barcode: "3175681146014", name: "Riz Basmati 1kg", category: "Épicerie salée", brand: "Uncle Ben's", cost: 2.1, vat: 0.05, price: 3.95, min: 10 },
  { sku: "EPI-0003", barcode: "3560070976478", name: "Pâtes Penne 500g", category: "Épicerie salée", brand: "Barilla", cost: 0.82, vat: 0.05, price: 1.65, min: 24 },
  { sku: "EPI-0005", barcode: "3057640257773", name: "Huile d'olive 1L", category: "Épicerie salée", brand: "Puget", cost: 5.4, vat: 0.18, price: 8.9, min: 8 },
  { sku: "EPI-0006", barcode: "5449000000996", name: "Coca-Cola 1.5L", category: "Boissons", brand: "Coca-Cola", cost: 0.95, vat: 0.18, price: 2.15, min: 36 },
  { sku: "EPI-0007", barcode: "3052910008210", name: "Eau minérale 6x1.5L", category: "Boissons", brand: "Evian", cost: 1.85, vat: 0.05, price: 3.45, min: 20 },
  { sku: "EPI-0008", barcode: "3268840001008", name: "Café moulu 250g", category: "Épicerie salée", brand: "Carte Noire", cost: 3.1, vat: 0.18, price: 5.49, min: 10 },
  // Frais (DLC)
  { sku: "FRA-0001", barcode: "3245390096265", name: "Lait demi-écrémé 1L", category: "Crèmerie", brand: "Lactel", cost: 0.78, vat: 0.05, price: 1.25, min: 40, dlc: true },
  { sku: "FRA-0002", barcode: "3263020001001", name: "Beurre doux 250g", category: "Crèmerie", brand: "Président", cost: 1.95, vat: 0.05, price: 3.15, min: 16, dlc: true },
  { sku: "FRA-0003", barcode: "3270160502000", name: "Yaourts nature x16", category: "Crèmerie", brand: "Danone", cost: 2.2, vat: 0.05, price: 3.85, min: 18, dlc: true },
  { sku: "FRA-0004", barcode: "3182620000041", name: "Emmental râpé 200g", category: "Crèmerie", brand: "Entremont", cost: 1.6, vat: 0.05, price: 2.95, min: 14, dlc: true },
  { sku: "FRA-0005", barcode: "3760020505218", name: "Poulet fermier 1.2kg", category: "Boucherie", brand: "Label Rouge", cost: 7.2, vat: 0.05, price: 11.9, min: 8, dlc: true },
  { sku: "FRA-0006", barcode: "3274560000027", name: "Steak haché 5% x4", category: "Boucherie", brand: "Socopa", cost: 5.1, vat: 0.05, price: 8.5, min: 12, dlc: true },
  { sku: "FRA-0007", barcode: "3265410003003", name: "Jambon blanc 4 tr.", category: "Charcuterie", brand: "Herta", cost: 1.75, vat: 0.05, price: 3.2, min: 20, dlc: true },
  { sku: "FRA-0008", barcode: "3254560001005", name: "Baguette tradition", category: "Boulangerie", brand: "Maison", cost: 0.6, vat: 0, price: 1.2, min: 30, dlc: true },
  // Fruits & légumes (au kilo)
  { sku: "FRV-0001", barcode: "2000000000015", name: "Bananes", category: "Fruits & Légumes", brand: "Import Côte d'Ivoire", cost: 1.1, vat: 0, price: 2.29, unit: "KG", min: 25, dlc: true },
  { sku: "FRV-0002", barcode: "2000000000022", name: "Tomates grappe", category: "Fruits & Légumes", brand: "Local", cost: 1.6, vat: 0, price: 3.49, unit: "KG", min: 20, dlc: true },
  { sku: "FRV-0003", barcode: "2000000000039", name: "Pommes Gala", category: "Fruits & Légumes", brand: "Verger de France", cost: 1.05, vat: 0, price: 2.49, unit: "KG", min: 25 },
  { sku: "FRV-0004", barcode: "2000000000046", name: "Carottes", category: "Fruits & Légumes", brand: "Local", cost: 0.7, vat: 0, price: 1.65, unit: "KG", min: 20 },
  // Hygiène / Droguerie
  { sku: "HYG-0001", barcode: "3600542525107", name: "Lessive liquide 2L", category: "Hygiène", brand: "Ariel", cost: 6.2, vat: 0.18, price: 11.9, min: 10 },
  { sku: "HYG-0002", barcode: "3574661550102", name: "Dentifrice 75ml", category: "Hygiène", brand: "Signal", cost: 1.5, vat: 0.18, price: 2.99, min: 16 },
  { sku: "HYG-0003", barcode: "4015400000018", name: "Savon liquide 300ml", category: "Hygiène", brand: "Dove", cost: 1.9, vat: 0.18, price: 3.79, min: 12 },
  { sku: "HYG-0004", barcode: "3560221001001", name: "Papier toilette x12", category: "Droguerie", brand: "Lotus", cost: 4.1, vat: 0.18, price: 7.95, min: 14 },
  // Boissons alcoolisées
  { sku: "BOI-0001", barcode: "3290110001007", name: "Vin rouge Bordeaux 75cl", category: "Alcools", brand: "Château Meyney", cost: 4.8, vat: 0.18, price: 9.5, min: 12 },
  { sku: "BOI-0002", barcode: "3576731100014", name: "Bière blonde 6x33cl", category: "Alcools", brand: "Kronenbourg", cost: 3.4, vat: 0.18, price: 6.4, min: 18 },
];

const SUPPLIERS: Supplier[] = [
  { id: uid(), code: "F-001", name: "Distrib'Ouest", email: "contact@distrib-ouest.fr", phone: "+33 2 40 12 34 56", leadTimeDays: 2, paymentTerms: "30 jours" },
  { id: uid(), code: "F-002", name: "FreshLog", email: "commandes@freshlog.eu", phone: "+33 4 78 55 21 09", leadTimeDays: 1, paymentTerms: "15 jours" },
  { id: uid(), code: "F-003", name: "Boissons & Co", email: "ventes@boissonsetco.fr", phone: "+33 1 45 67 89 00", leadTimeDays: 3, paymentTerms: "45 jours" },
  { id: uid(), code: "F-004", name: "Primeur Import", email: "import@primeur-import.com", phone: "+33 5 61 22 33 44", leadTimeDays: 3, paymentTerms: "Comptant" },
];

const hashPassword = (password: string, salt: string): string =>
  createHash("sha256").update(`${salt}:${password}`).digest("hex");

export { hashPassword };

/** Comptes de démo par tenant (identifiants affichés sur l'écran de connexion). */
export function defaultUsers(slug: string): User[] {
  const defs: { username: string; password: string; displayName: string; role: UserRole }[] =
    slug === "ecomarche"
      ? [
          { username: "admin", password: "eco2026", displayName: "Gérant EcoMarché", role: "ADMIN" },
          { username: "caisse", password: "eco-caisse2026", displayName: "Caissier EcoMarché", role: "CASHIER" },
          { username: "stock", password: "eco-stock2026", displayName: "Stock EcoMarché", role: "STOCK" },
        ]
      : [
          { username: "admin", password: "nova2026", displayName: "A. Dubois (direction)", role: "ADMIN" },
          { username: "caisse", password: "caisse2026", displayName: "K. Benali (caisse)", role: "CASHIER" },
          { username: "stock", password: "stock2026", displayName: "M. Leroy (stock)", role: "STOCK" },
          { username: "logistique", password: "logi2026", displayName: "S. Traoré (logistique)", role: "LOGISTICS" },
        ];
  return defs.map((d) => {
    const salt = createHash("sha256").update(`${slug}:${d.username}`).digest("hex").slice(0, 16);
    return {
      id: uid(),
      username: d.username,
      passwordHash: hashPassword(d.password, salt),
      salt,
      displayName: d.displayName,
      role: d.role,
      active: true,
    };
  });
}

function buildStores(): Store[] {
  return [
    { id: uid(), code: "HUB-01", name: "Hub Logistique Nord", isHub: true, address: "ZI Nord, 12 rue des Docks", city: "Lille" },
    { id: uid(), code: "M-001", name: "NovaMarket Centre", isHub: false, address: "45 rue Nationale", city: "Lille" },
    { id: uid(), code: "M-002", name: "NovaMarket Gare", isHub: false, address: "8 place de la Gare", city: "Lille" },
    { id: uid(), code: "M-003", name: "NovaMarket Sud", isHub: false, address: "230 av. de Dunkerque", city: "Lambersart" },
  ];
}

function buildProducts(): Product[] {
  return PRODUCTS.map((p, i) => ({
    id: uid(),
    sku: `${p.sku.slice(0, 3)}-${String(i + 1).padStart(4, "0")}`,
    barcode: p.barcode,
    name: p.name,
    category: p.category,
    brand: p.brand,
    costPrice: fcfa(p.cost),
    vatRate: p.vat,
    sellingPrice: fcfa(p.price),
    unit: p.unit ?? "UNIT",
    minStockLevel: p.min,
    supplierId: SUPPLIERS[0].id,
    active: true,
    createdAt: daysAgo(60),
  }));
}

function buildSalesAndMovements(
  stores: Store[],
  products: Product[],
): { sales: Sale[]; movements: StockMovement[] } {
  const sales: Sale[] = [];
  const movements: StockMovement[] = [];
  const seqByStore: Record<string, number> = {};
  const cashiers = ["A. Dubois", "K. Benali", "M. Leroy", "S. Traoré"];

  for (const store of stores.filter((s) => !s.isHub)) {
    seqByStore[store.id] = 100 + intBetween(0, 400);
    for (let d = 13; d >= 0; d--) {
      const nSales = d === 0 ? intBetween(6, 12) : intBetween(10, 18);
      for (let i = 0; i < nSales; i++) {
        const hour = pick([9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 18, 19]);
        const createdAt = daysAgo(d, hour, intBetween(0, 59));
        const nItems = intBetween(1, 6);
        const items: SaleItem[] = [];
        const used = new Set<string>();
        for (let j = 0; j < nItems; j++) {
          const product = pick(products);
          if (used.has(product.id)) continue;
          used.add(product.id);
          const qty = product.unit === "KG" ? Math.round(between(2, 9) * 10) / 10 : intBetween(1, 3);
          items.push({
            productId: product.id,
            sku: product.sku,
            name: product.name,
            quantity: qty,
            unitPrice: product.sellingPrice,
            vatRate: product.vatRate,
            costPrice: product.costPrice,
            discount: 0,
          });
        }
        if (items.length === 0) continue;
        const total = items.reduce((s, it) => s + it.quantity * it.unitPrice, 0);
        const totalVat = items.reduce(
          (s, it) => s + (it.quantity * it.unitPrice - (it.quantity * it.unitPrice) / (1 + it.vatRate)),
          0,
        );
        const totalHt = total - totalVat;
        const margin = totalHt - items.reduce((s, it) => s + it.quantity * it.costPrice, 0);
        seqByStore[store.id] += 1;
        const ticketNumber = `T-${store.code}-${String(seqByStore[store.id]).padStart(6, "0")}`;
        const offline = rnd() < 0.08;
        const method = pick(["CASH", "CARD", "CARD", "CARD", "MOBILE_MONEY", "VOUCHER"] as const) as SalePayment["method"];
        const payments: SalePayment[] = [{ method, amount: total }];
        if (method === "CASH") payments[0].amount = Math.ceil(total / 5) * 5;
        sales.push({
          id: uid(),
          ticketNumber,
          storeId: store.id,
          cashier: pick(cashiers),
          items,
          payments,
          total,
          totalVat,
          totalHt,
          margin,
          change: method === "CASH" ? payments[0].amount - total : 0,
          createdAt,
          syncedOffline: offline,
          status: "COMPLETED",
        });
        for (const it of items) {
          movements.push({
            id: uid(),
            storeId: store.id,
            productId: it.productId,
            type: "SALE_POS",
            quantity: it.quantity,
            reference: ticketNumber,
            createdBy: "POS",
            createdAt,
          });
        }
      }
    }
  }

  // Deux retours sur tickets récents
  const recent = sales.filter((s) => s.items.length > 1).slice(-20);
  for (const orig of recent.slice(0, 2)) {
    const returnedItem = orig.items[0];
    const total = returnedItem.quantity * returnedItem.unitPrice;
    const returnSale: Sale = {
      id: uid(),
      ticketNumber: `${orig.ticketNumber}-R`,
      storeId: orig.storeId,
      cashier: "A. Dubois",
      items: [returnedItem],
      payments: [{ method: orig.payments[0].method, amount: total }],
      total,
      totalVat: total - total / (1 + returnedItem.vatRate),
      totalHt: total / (1 + returnedItem.vatRate),
      margin: 0,
      change: 0,
      createdAt: daysAgo(0, 9, 15),
      syncedOffline: false,
      status: "RETURNED",
      returnedTicket: orig.ticketNumber,
    };
    sales.push(returnSale);
    movements.push({
      id: uid(),
      storeId: orig.storeId,
      productId: returnedItem.productId,
      type: "RETURN_IN",
      quantity: returnedItem.quantity,
      reference: returnSale.ticketNumber,
      createdBy: "A. Dubois",
      createdAt: returnSale.createdAt,
    });
  }

  return { sales, movements };
}

function buildTransfers(
  stores: Store[],
  products: Product[],
): { transferOrders: TransferOrder[]; movements: StockMovement[] } {
  const hub = stores.find((s) => s.isHub)!;
  const dests = stores.filter((s) => !s.isHub);
  const transferOrders: TransferOrder[] = [];
  const movements: StockMovement[] = [];
  const mkItems = (n: number): TransferItem[] =>
    Array.from({ length: n }, () => {
      const p = pick(products);
      return {
        id: uid(),
        productId: p.id,
        batchNumber: null,
        quantityRequested: intBetween(6, 30),
        quantityShipped: 0,
        quantityReceived: 0,
        quantityDamaged: 0,
        discrepancyReason: null,
      };
    });

  // OT demandé (M-002 -> hub) : flux tiré
  transferOrders.push({
    id: uid(),
    codeReference: "OT-2026-0041",
    sourceStoreId: hub.id,
    destinationStoreId: dests[0].id,
    status: "REQUESTED",
    strategy: "PULL",
    items: mkItems(4),
    requestedBy: "Système (seuil critique)",
    shippedAt: null,
    receivedAt: null,
    createdAt: daysAgo(1, 8),
  });

  // OT en transit (hub -> M-001)
  const shipped: TransferOrder = {
    id: uid(),
    codeReference: "OT-2026-0038",
    sourceStoreId: hub.id,
    destinationStoreId: dests[1].id,
    status: "SHIPPED",
    strategy: "PULL",
    items: mkItems(5),
    requestedBy: "K. Benali",
    shippedAt: daysAgo(0, 7, 30),
    receivedAt: null,
    createdAt: daysAgo(1, 16),
  };
  for (const it of shipped.items) {
    it.quantityShipped = it.quantityRequested;
  }
  transferOrders.push(shipped);
  for (const it of shipped.items) {
    movements.push({
      id: uid(),
      storeId: shipped.sourceStoreId,
      productId: it.productId,
      type: "TRANSFER_OUT",
      quantity: it.quantityShipped,
      reference: shipped.codeReference,
      createdBy: "Hub Logistique",
      createdAt: shipped.shippedAt!,
    });
    movements.push({
      id: uid(),
      storeId: shipped.destinationStoreId,
      productId: it.productId,
      type: "TRANSIT_ENTRY",
      quantity: it.quantityShipped,
      reference: shipped.codeReference,
      createdBy: "Hub Logistique",
      createdAt: shipped.shippedAt!,
    });
  }

  // OT réceptionné (hub -> M-003)
  const received: TransferOrder = {
    id: uid(),
    codeReference: "OT-2026-0035",
    sourceStoreId: hub.id,
    destinationStoreId: dests[2].id,
    status: "RECEIVED",
    strategy: "PUSH",
    items: mkItems(4),
    requestedBy: "Répartition centrale",
    shippedAt: daysAgo(3, 8, 0),
    receivedAt: daysAgo(3, 14, 20),
    createdAt: daysAgo(4, 9),
  };
  for (const it of received.items) {
    it.quantityShipped = it.quantityRequested;
    it.quantityReceived = it.quantityRequested;
  }
  transferOrders.push(received);
  for (const it of received.items) {
    const at = received.shippedAt!;
    const recvAt = received.receivedAt!;
    movements.push({
      id: uid(), storeId: received.sourceStoreId, productId: it.productId, type: "TRANSFER_OUT",
      quantity: it.quantityShipped, reference: received.codeReference, createdBy: "Hub Logistique", createdAt: at,
    });
    movements.push({
      id: uid(), storeId: received.destinationStoreId, productId: it.productId, type: "TRANSIT_ENTRY",
      quantity: it.quantityShipped, reference: received.codeReference, createdBy: "Hub Logistique", createdAt: at,
    });
    movements.push({
      id: uid(), storeId: received.destinationStoreId, productId: it.productId, type: "TRANSFER_IN",
      quantity: it.quantityReceived, reference: received.codeReference, createdBy: "PDA Réception", createdAt: recvAt,
    });
  }

  // OT avec écart constaté (hub -> M-001)
  const discrepancy: TransferOrder = {
    id: uid(),
    codeReference: "OT-2026-0032",
    sourceStoreId: hub.id,
    destinationStoreId: dests[0].id,
    status: "DISCREPANCY",
    strategy: "PULL",
    items: mkItems(3),
    requestedBy: "M. Leroy",
    shippedAt: daysAgo(5, 8, 45),
    receivedAt: daysAgo(4, 10, 10),
    createdAt: daysAgo(6, 11),
  };
  discrepancy.items.forEach((it, idx) => {
    it.quantityShipped = it.quantityRequested;
    if (idx === 0) {
      it.quantityReceived = it.quantityShipped - 2;
      it.discrepancyReason = "2 colis manquants au déchargement";
    } else {
      it.quantityReceived = it.quantityShipped;
    }
  });
  transferOrders.push(discrepancy);
  for (const [idx, it] of discrepancy.items.entries()) {
    movements.push({
      id: uid(), storeId: discrepancy.sourceStoreId, productId: it.productId, type: "TRANSFER_OUT",
      quantity: it.quantityShipped, reference: discrepancy.codeReference, createdBy: "Hub Logistique", createdAt: discrepancy.shippedAt!,
    });
    movements.push({
      id: uid(), storeId: discrepancy.destinationStoreId, productId: it.productId, type: "TRANSIT_ENTRY",
      quantity: it.quantityShipped, reference: discrepancy.codeReference, createdBy: "Hub Logistique", createdAt: discrepancy.shippedAt!,
    });
    if (it.quantityReceived > 0) {
      movements.push({
        id: uid(), storeId: discrepancy.destinationStoreId, productId: it.productId, type: "TRANSFER_IN",
        quantity: it.quantityReceived, reference: discrepancy.codeReference, createdBy: "PDA Réception", createdAt: discrepancy.receivedAt!,
      });
    }
    if (idx === 0) {
      movements.push({
        id: uid(), storeId: discrepancy.destinationStoreId, productId: it.productId, type: "LOSS_TRANSIT",
        quantity: 2, reference: discrepancy.codeReference, note: it.discrepancyReason!,
        createdBy: "PDA Réception", createdAt: discrepancy.receivedAt!,
      });
    }
  }

  // OT brouillon (M-001 -> hub : retour d'invendus)
  const draft: TransferOrder = {
    id: uid(),
    codeReference: "OT-2026-0042",
    sourceStoreId: dests[0].id,
    destinationStoreId: hub.id,
    status: "DRAFT",
    strategy: "PULL",
    items: mkItems(2),
    requestedBy: "M. Leroy",
    shippedAt: null,
    receivedAt: null,
    createdAt: daysAgo(0, 8, 5),
  };
  transferOrders.push(draft);

  return { transferOrders, movements };
}

function buildPurchaseOrders(
  stores: Store[],
  products: Product[],
  suppliers: Supplier[],
): { purchaseOrders: PurchaseOrder[]; movements: StockMovement[] } {
  const hub = stores.find((s) => s.isHub)!;
  const mk = (
    code: string,
    supplier: Supplier,
    status: PurchaseOrder["status"],
    n: number,
    bl: string | null,
    expectedInDays: number,
    createdDaysAgo: number,
  ): PurchaseOrder => ({
    id: uid(),
    code,
    supplierId: supplier.id,
    storeId: hub.id,
    status,
    blNumber: bl,
    items: Array.from({ length: intBetween(3, 6) }, () => {
      const p = pick(products);
      return {
        id: uid(),
        productId: p.id,
        quantityOrdered: intBetween(20, 90),
        quantityReceived: 0,
        unitCost: Math.round(p.costPrice),
      };
    }),
    createdAt: daysAgo(createdDaysAgo),
    expectedAt: daysAhead(expectedInDays),
  });

  const received = mk("PO-2026-0102", suppliers[0], "RECEIVED", 5, "BL-2026-88121", 0, 6);
  for (const it of received.items) it.quantityReceived = it.quantityOrdered;
  const partial = mk("PO-2026-0115", suppliers[1], "PARTIALLY_RECEIVED", 4, "BL-2026-88207", 0, 3);
  partial.items.forEach((it, i) => (it.quantityReceived = i < 2 ? it.quantityOrdered : 0));

  const movements: StockMovement[] = [];
  for (const po of [received, partial]) {
    for (const it of po.items) {
      if (it.quantityReceived > 0) {
        movements.push({
          id: uid(),
          storeId: po.storeId,
          productId: it.productId,
          type: "SUPPLIER_IN",
          quantity: it.quantityReceived,
          reference: po.blNumber ?? po.code,
          createdBy: "Réception Hub",
          createdAt: daysAgo(2, 8, 30),
        });
      }
    }
  }

  return {
    purchaseOrders: [
      received,
      partial,
      mk("PO-2026-0121", suppliers[1], "SENT", 3, null, 1, 1),
      mk("PO-2026-0122", suppliers[2], "DRAFT", 5, null, 4, 0),
      mk("PO-2026-0123", suppliers[3], "SENT", 2, null, 2, 1),
    ],
    movements,
  };
}

function buildBatches(stores: Store[], products: Product[], dlcProducts: Product[]): Batch[] {
  const batches: Batch[] = [];
  for (const store of stores) {
    for (const p of dlcProducts) {
      const nLots = intBetween(1, 2);
      for (let i = 0; i < nLots; i++) {
        // Variété de DLC : certains proches, un dépassé
        const offset = i === 0 ? intBetween(1, 4) : intBetween(6, 20);
        const expired = p.sku.endsWith("0001") && store.code === "M-002" && i === 1;
        batches.push({
          id: uid(),
          productId: p.id,
          storeId: store.id,
          batchNumber: `L${daysAgo(intBetween(10, 40)).slice(0, 10).replaceAll("-", "")}-${p.sku.slice(0, 3)}`,
          dlc: expired ? daysAgo(1).slice(0, 10) : daysAhead(offset).slice(0, 10),
          quantity: intBetween(3, 18),
        });
      }
    }
  }
  return batches;
}

function buildCashSessions(stores: Store[], sales: Sale[]): CashSession[] {
  const sessions: CashSession[] = [];
  const stores_ = stores.filter((s) => !s.isHub);
  for (const store of stores_) {
    for (let d = 7; d >= 1; d--) {
      const daySales = sales.filter((s) => s.storeId === store.id && s.createdAt.slice(0, 10) === daysAgo(d).slice(0, 10));
      if (daySales.length === 0) continue;
      const cashSales = daySales.filter((s) => s.payments[0]?.method === "CASH");
      const expected = cashSales.reduce((s, x) => s + x.total, 0);
      sessions.push({
        id: uid(),
        storeId: store.id,
        openedAt: daysAgo(d, 8, 30),
        closedAt: daysAgo(d, 20, 15),
        openingFloat: OPENING_FLOAT_FCFA,
        countedCash: Math.round(OPENING_FLOAT_FCFA + expected + between(-4000, 4000)),
        status: "CLOSED",
        closedBy: "Clôture Z automatique",
        ticketNumbers: daySales.map((s) => s.ticketNumber),
      });
    }
  }
  // Session ouverte aujourd'hui sur M-001
  const m001 = stores_.find((s) => s.code === "M-001")!;
  const todaySales = sales.filter((s) => s.storeId === m001.id && s.createdAt.slice(0, 10) === NOW.toISOString().slice(0, 10));
  sessions.push({
    id: uid(),
    storeId: m001.id,
    openedAt: daysAgo(0, 8, 30),
    closedAt: null,
    openingFloat: OPENING_FLOAT_FCFA,
    countedCash: null,
    status: "OPEN",
    closedBy: null,
    ticketNumbers: todaySales.map((s) => s.ticketNumber),
  });
  return sessions;
}

function soldRecent(sales: Sale[], storeId: string, productId: string, days: number): number {
  const limit = new Date(NOW);
  limit.setDate(limit.getDate() - days);
  return sales
    .filter((s) => s.storeId === storeId && new Date(s.createdAt) >= limit)
    .flatMap((s) => s.items)
    .filter((it) => it.productId === productId)
    .reduce((acc, it) => acc + it.quantity, 0);
}

function buildInitialSupply(stores: Store[], products: Product[], sales: Sale[]): StockMovement[] {
  const movements: StockMovement[] = [];
  for (const store of stores) {
    for (const p of products) {
      // Stock de départ : couvre les ventes des 14 derniers jours + une réserve au-dessus du seuil mini.
      const initialQty = Math.ceil(p.minStockLevel * between(1.1, 2.4)) + soldRecent(sales, store.id, p.id, 14);
      movements.push({
        id: uid(),
        storeId: store.id,
        productId: p.id,
        type: "SUPPLIER_IN",
        quantity: initialQty,
        reference: "Stock initial",
        createdBy: "Initialisation",
        createdAt: daysAgo(14, 7, 0),
      });
    }
  }
  return movements;
}

function buildAudit(entries: { action: string; entity: string; entityId: string; userId: string; detail: string; createdAt: string }[]) {
  return entries.map((e) => ({ id: uid(), ...e }));
}

function seedHorizon(): Tenant {
  const stores = buildStores();
  const products = buildProducts();
  const { sales, movements } = buildSalesAndMovements(stores, products);
  const { transferOrders, movements: mv1 } = buildTransfers(stores, products);
  const { purchaseOrders, movements: mv2 } = buildPurchaseOrders(stores, products, SUPPLIERS);
  movements.push(...mv1, ...mv2);

  // Approvisionnement initial (hub + magasins)
  movements.push(...buildInitialSupply(stores, products, sales));

  // Rééquilibrage : toute paire (magasin, produit) en négatif reçoit un complément d'appro
  const stockOfPair = (storeId: string, productId: string): number =>
    movements
      .filter((m) => m.storeId === storeId && m.productId === productId)
      .reduce((acc, m) => {
        if (["SUPPLIER_IN", "RETURN_IN", "TRANSFER_IN"].includes(m.type)) return acc + m.quantity;
        if (["SALE_POS", "TRANSFER_OUT", "LOSS_DAMAGE"].includes(m.type)) return acc - m.quantity;
        if (m.type === "INVENTORY_ADJUST") return acc + m.quantity;
        return acc; // écarts transit imputés hors stock disponible
      }, 0);
  for (const store of stores) {
    for (const p of products) {
      const current = stockOfPair(store.id, p.id);
      if (current < 0) {
        movements.push({
          id: uid(),
          storeId: store.id,
          productId: p.id,
          type: "SUPPLIER_IN",
          quantity: Math.ceil(-current + p.minStockLevel * 0.5),
          reference: "Complément de stock",
          createdBy: "Initialisation",
          createdAt: daysAgo(14, 6, 0),
        });
      }
    }
  }

  // Quelques pertes / ajustements inventaire
  for (let i = 0; i < 6; i++) {
    const store = pick(stores);
    const p = pick(products);
    movements.push({
      id: uid(),
      storeId: store.id,
      productId: p.id,
      type: i % 3 === 0 ? "INVENTORY_ADJUST" : "LOSS_DAMAGE",
      quantity: i % 3 === 0 ? -intBetween(1, 4) : intBetween(1, 4), // ajustement signé (négatif = retrait)
      reference: i % 3 === 0 ? `INV-${daysAgo(intBetween(2, 10)).slice(0, 10)}` : "Zone casse",
      note: i % 3 === 0 ? "Écart inventaire tournant" : "Produit endommagé (rayon)",
      createdBy: "Gestionnaire stock",
      createdAt: daysAgo(intBetween(1, 12), 11, 0),
    });
  }

  const dlcProducts = products.filter((p) => PRODUCTS.find((s) => s.name === p.name)?.dlc);
  const batches = buildBatches(stores, products, dlcProducts);

  return {
    id: "tenant_horizon",
    slug: "horizon",
    name: "NovaMarket",
    plan: "ENTERPRISE",
    createdAt: daysAgo(400),
    users: defaultUsers("horizon"),
    stores,
    products,
    batches,
    stockMovements: movements.sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    transferOrders,
    suppliers: SUPPLIERS,
    purchaseOrders,
    sales: sales.sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    cashSessions: buildCashSessions(stores, sales),
    auditLog: buildAudit([
      { action: "PROVISION_TENANT", entity: "tenant", entityId: "tenant_horizon", userId: "platform.admin", detail: "Provisionnement du schéma tenant_horizon", createdAt: daysAgo(400) },
      { action: "TRANSFER_VALIDATE", entity: "transfer_order", entityId: "OT-2026-0038", userId: "hub.manager", detail: "Validation & préparation OT-2026-0038", createdAt: daysAgo(1, 9) },
      { action: "RETURN_VALIDATE", entity: "sale", entityId: sales[0]?.ticketNumber ?? "T-M001-000100", userId: "store.manager", detail: "Retour autorisé (PIN administrateur)", createdAt: daysAgo(0, 9, 20) },
      { action: "STOCK_ADJUST", entity: "product", entityId: products[0].sku, userId: "stock.manager", detail: "Ajustement inventaire tournant rayon 4", createdAt: daysAgo(2, 11) },
    ]),
  };
}

function seedEco(): Tenant {
  const t = seedHorizon();
  const stores = t.stores.slice(0, 2); // hub + 1 magasin
  const storeIds = new Set(stores.map((s) => s.id));
  return {
    ...t,
    id: "tenant_ecomarche",
    slug: "ecomarche",
    name: "EcoMarché",
    plan: "BUSINESS",
    createdAt: daysAgo(150),
    users: defaultUsers("ecomarche"),
    stores,
    transferOrders: t.transferOrders.filter((o) => storeIds.has(o.sourceStoreId) && storeIds.has(o.destinationStoreId)),
    purchaseOrders: t.purchaseOrders.filter((o) => storeIds.has(o.storeId)),
    sales: t.sales.filter((s) => storeIds.has(s.storeId)),
    cashSessions: t.cashSessions.filter((c) => storeIds.has(c.storeId)),
    batches: t.batches.filter((b) => storeIds.has(b.storeId)),
    stockMovements: t.stockMovements.filter((m) => storeIds.has(m.storeId)),
  };
}

export function buildSeedDatabase(): Database {
  const horizon = seedHorizon();
  const ecomarche = seedEco();
  return { tenants: { [horizon.slug]: horizon, [ecomarche.slug]: ecomarche } };
}

export type { MovementType };
