export const fmtMoney = (n: number): string =>
  `${new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 0 }).format(Math.round(n))} FCFA`;

/** Seuil d'écart de caisse au-delà duquel une justification est exigée (FCFA). */
export const CASH_GAP_JUSTIFICATION_THRESHOLD = 5000;

export const fmtNum = (n: number, digits = 0): string =>
  new Intl.NumberFormat("fr-FR", { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(n);

export const fmtQty = (n: number): string =>
  Number.isInteger(n) ? fmtNum(n) : fmtNum(n, 3).replace(/,?0+$/, "");

export const fmtDate = (iso: string): string =>
  new Date(iso).toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit", year: "numeric" });

export const fmtDateTime = (iso: string): string =>
  new Date(iso).toLocaleString("fr-FR", {
    day: "2-digit",
    month: "2-digit",
    year: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });

export const fmtTime = (iso: string): string =>
  new Date(iso).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });

export const dayKey = (iso: string): string => new Date(iso).toISOString().slice(0, 10);

export const daysBetween = (a: string, b: string): number =>
  Math.round((new Date(a).getTime() - new Date(b).getTime()) / 86400000);

export const pct = (n: number): string => `${fmtNum(n, 1)} %`;

export const TRANSFER_STATUS_LABEL: Record<string, string> = {
  DRAFT: "Brouillon",
  REQUESTED: "Demandé",
  APPROVED: "Validé",
  IN_PREPARATION: "En préparation",
  SHIPPED: "En transit",
  RECEIVED: "Clôturé",
  DISCREPANCY: "Écart constaté",
  CANCELLED: "Annulé",
};

export const PO_STATUS_LABEL: Record<string, string> = {
  DRAFT: "Brouillon",
  SENT: "Envoyée",
  PARTIALLY_RECEIVED: "Partiellement reçue",
  RECEIVED: "Réceptionnée",
  CANCELLED: "Annulée",
};

export const PAYMENT_LABEL: Record<string, string> = {
  CASH: "Espèces",
  CARD: "Carte bancaire",
  MOBILE_MONEY: "Mobile Money",
  VOUCHER: "Bon d'achat",
};

export const MOVEMENT_LABEL: Record<string, string> = {
  SUPPLIER_IN: "Réception fournisseur",
  SALE_POS: "Vente caisse",
  RETURN_IN: "Retour client",
  TRANSFER_OUT: "Transfert sortant",
  TRANSFER_IN: "Transfert entrant",
  TRANSIT_ENTRY: "Entrée en transit",
  LOSS_TRANSIT: "Perte en transit",
  DAMAGE_TRANSIT: "Casse en transit",
  INVENTORY_ADJUST: "Ajustement inventaire",
  LOSS_DAMAGE: "Casse / Perte",
};
