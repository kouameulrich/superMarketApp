# Architecture: SuperGestion

## Overview

```
src/
├── app/                      # Next.js App Router (toutes pages force-dynamic)
│   ├── layout.tsx            # Shell : Sidebar + topbar + TenantSwitcher (résout le tenant)
│   ├── page.tsx              # Dashboard KPI (CA, ruptures, DLC, sessions X)
│   ├── pos/page.tsx          # POS (server) → PosClient (client, offline-first)
│   ├── products/page.tsx     # Référentiel + ProductsClient (CRUD)
│   ├── stock/page.tsx        # Stock/DLC/journal + StockClient
│   ├── transfers/page.tsx    # Liste OT + TransferCreateClient
│   ├── transfers/[id]/page.tsx  # Détail OT + TransferWorkflowClient (stepper + réception PDA)
│   ├── suppliers/page.tsx    # Achats + PurchasesClient
│   └── reports/page.tsx      # X/Z + SessionCloser + analytics
├── components/               # ui.tsx (Card, Badge, StatCard, Bars, badges d'état) + clients
└── lib/
    ├── types.ts              # Modèle : Tenant, Store, Product, Batch, StockMovement, TransferOrder(+items), Supplier, PurchaseOrder(+items), Sale(+items/payments), CashSession, AuditEntry
    ├── seed.ts               # Jeu de données déterministe (mulberry32) incl. rééquilibrage anti-négatif
    ├── db.ts                 # Persistance JSON par tenant + single-flight load + mutex d'écriture
    ├── tenant.ts             # Résolution tenant (cookie sg_tenant, défaut "horizon")
    ├── stock.ts              # stockOf (journal dérivé), transitOf, damageOf, suggestions Pull
    ├── format.ts             # fmtMoney/fr-FR, labels statuts & modes de paiement
    └── actions.ts            # "use server" : toutes les mutations + audit trail (validateurs serveur)
```

## Key patterns

- **Multi-tenant « schema-per-tenant » simulé** (PRD §4.1) : `Database { tenants: Record<slug, Tenant> }` ; le tenant est résolu côté serveur (`resolveTenant()` via cookies), jamais transmis par le client. Le switcher écrit `sg_tenant` + router.refresh.
- **Stock dérivé du journal** : `stockOf()` = somme signée des StockMovement (types IN/OUT/ajustement signé). Aucun compteur dupliqué ; invariants garantis (jamais négatif après seed ; delta absolu au μ€).
- **Server Actions + revalidation** : `withTenant()` résout le tenant, exécute, puis `revalidateAll()` (7 routes). Les payloads de vente (prix/TVA/marge/tickets) sont recalculés serveur — le client ne fait qu'envoyer productId/qty/mode de paiement.
- **Offline-first POS** : file `localStorage["sg_offline_sales_queue"]` (idempotence par UUID de vente — le serveur déduplique par id) + liste d'attente `sg_parked_carts`. Flush à l'événement `online` + manuel.
- **Écritures transactionnelles simulées** : `mutateTenant` sérialise read-modify-write avec tmp+rename atomique, fallback écriture directe.
- **Workflow OT machine à états** : SUBMIT/APPROVE/PREPARE/SHIP/RECEIVE/RESOLVE/CANCEL dans `updateTransferStatus` — écritures TRANSFER_OUT / TRANSIT_ENTRY / TRANSFER_IN / DAMAGE_TRANSIT / LOSS_TRANSIT générées par étape ; manquants = shipped−received−damaged.

## Gotchas

- `cookies()` dans layout → toutes pages dynamiques ; ajouter `export const dynamic = "force-dynamic"` sur chaque page.
- Ne pas modifier `.data/` pendant que le serveur tourne avec un cache chaud (redémarrer pour recharger).
- Le bandeau « mode retour » attend le PIN démo 1234.
- Le stock de la graine est garanti non-négatif par une passe de rééquilibrage dans seed.ts.
