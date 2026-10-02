// ─── Domain types — SuperGestion ────────────────────────────────────────────
// Modelled on the PRD §5 DDL (PostgreSQL per-tenant schema), flattened here
// into a per-tenant document store that mimics schema isolation.

export type UUID = string;

export interface Tenant {
  id: string;
  slug: string; // subdomain: horizon.supergestion.com
  name: string;
  plan: "STARTER" | "BUSINESS" | "ENTERPRISE";
  createdAt: string;
  users: User[];
  stores: Store[];
  products: Product[];
  batches: Batch[];
  stockMovements: StockMovement[];
  transferOrders: TransferOrder[];
  suppliers: Supplier[];
  purchaseOrders: PurchaseOrder[];
  sales: Sale[];
  cashSessions: CashSession[];
  auditLog: AuditEntry[];
}

export type UserRole = "CASHIER" | "STOCK" | "LOGISTICS" | "ADMIN" | "SUPER_ADMIN";

export interface User {
  id: UUID;
  username: string;
  passwordHash: string; // sha256(salt:password)
  salt: string;
  displayName: string;
  role: UserRole;
  active: boolean;
  createdAt: string;
}

export interface Store {
  id: UUID;
  code: string;
  name: string;
  isHub: boolean;
  address: string;
  city: string;
}

export type ProductUnit = "UNIT" | "KG";

export interface Product {
  id: UUID;
  sku: string;
  barcode: string;
  name: string;
  category: string;
  brand: string;
  costPrice: number; // HT
  vatRate: number; // 0.18 | 0.05 | 0 (grille zone FCFA)
  sellingPrice: number; // TTC
  unit: ProductUnit;
  minStockLevel: number;
  supplierId: UUID | null;
  active: boolean;
  createdAt: string;
}

/** Lot / DLC tracking (traçabilité) */
export interface Batch {
  id: UUID;
  productId: UUID;
  storeId: UUID;
  batchNumber: string;
  dlc: string; // ISO date
  quantity: number;
}

export type MovementType =
  | "SUPPLIER_IN"
  | "SALE_POS"
  | "RETURN_IN"
  | "TRANSFER_OUT"
  | "TRANSFER_IN"
  | "TRANSIT_ENTRY"
  | "LOSS_TRANSIT"
  | "DAMAGE_TRANSIT"
  | "INVENTORY_ADJUST"
  | "LOSS_DAMAGE";

export interface StockMovement {
  id: UUID;
  storeId: UUID;
  productId: UUID;
  type: MovementType;
  quantity: number; // positive; direction derived from type
  reference: string; // ticket / OT / PO code
  note?: string;
  createdBy: string;
  createdAt: string;
}

export type TransferStatus =
  | "DRAFT"
  | "REQUESTED"
  | "APPROVED"
  | "IN_PREPARATION"
  | "SHIPPED"
  | "RECEIVED"
  | "DISCREPANCY"
  | "CANCELLED";

export type TransferStrategy = "PULL" | "PUSH";

export interface TransferItem {
  id: UUID;
  productId: UUID;
  batchNumber: string | null;
  quantityRequested: number;
  quantityShipped: number;
  quantityReceived: number; // conformes
  quantityDamaged: number; // casse en transit -> zone avarie
  discrepancyReason: string | null;
}

export interface TransferOrder {
  id: UUID;
  codeReference: string;
  sourceStoreId: UUID;
  destinationStoreId: UUID;
  status: TransferStatus;
  strategy: TransferStrategy;
  items: TransferItem[];
  requestedBy: string;
  shippedAt: string | null;
  receivedAt: string | null;
  createdAt: string;
}

export interface Supplier {
  id: UUID;
  code: string;
  name: string;
  email: string;
  phone: string;
  leadTimeDays: number;
  paymentTerms: string;
}

export type POStatus = "DRAFT" | "SENT" | "PARTIALLY_RECEIVED" | "RECEIVED" | "CANCELLED";

export interface PurchaseOrderItem {
  id: UUID;
  productId: UUID;
  quantityOrdered: number;
  quantityReceived: number;
  unitCost: number; // HT
}

export interface PurchaseOrder {
  id: UUID;
  code: string;
  supplierId: UUID;
  storeId: UUID; // store / hub de réception
  status: POStatus;
  items: PurchaseOrderItem[];
  blNumber: string | null; // bon de livraison (rapprochement BC/BL)
  createdAt: string;
  expectedAt: string;
}

export type PaymentMethod = "CASH" | "CARD" | "MOBILE_MONEY" | "VOUCHER";

export interface SaleItem {
  id?: UUID;
  productId: UUID;
  sku: string;
  name: string;
  quantity: number;
  unitPrice: number; // TTC
  vatRate: number;
  costPrice: number; // HT unitaire (marge)
  discount: number; // TTC
}

export interface SalePayment {
  id?: UUID;
  method: PaymentMethod;
  amount: number;
}

export interface Sale {
  id: UUID;
  ticketNumber: string;
  storeId: UUID;
  cashier: string;
  items: SaleItem[];
  payments: SalePayment[];
  total: number; // TTC
  totalVat: number;
  totalHt: number;
  margin: number;
  change: number; // monnaie rendue
  createdAt: string;
  syncedOffline: boolean;
  status: "COMPLETED" | "RETURNED";
  returnedTicket?: string; // pour un retour: ticket d'origine
}

export interface CashSession {
  id: UUID;
  storeId: UUID;
  openedAt: string;
  closedAt: string | null;
  openingFloat: number;
  countedCash: number | null;
  status: "OPEN" | "CLOSED";
  closedBy: string | null;
  ticketNumbers: string[];
}

export interface AuditEntry {
  id: UUID;
  action: string;
  entity: string;
  entityId: string;
  userId: string;
  detail: string;
  createdAt: string;
}

export interface Database {
  tenants: Record<string, Tenant>;
}
