# Architecture: SuperGestion

## Overview

```
src/
├── app/                      # Next.js App Router
│   ├── layout.tsx            # Racine : html/body + metadata
│   ├── login/page.tsx        # Connexion (hors shell) → LoginForm
│   ├── (app)/                # Groupe authentifié (layout = session + shell)
│   │   ├── layout.tsx        # Sidebar + topbar (tenant, user, rôle, logout)
│   │   ├── page.tsx          # Dashboard KPI (CA, ruptures, DLC, sessions X)
│   │   ├── pos/page.tsx      # POS (server) → PosClient (client, offline-first)
│   │   ├── products/page.tsx # Référentiel + ProductsClient (CRUD)
│   │   ├── stock/page.tsx    # Stock/DLC/journal + StockClient
│   │   ├── transfers/page.tsx    # Liste OT + TransferCreateClient
│   │   ├── transfers/[id]/page.tsx  # Détail OT + TransferWorkflowClient (stepper + réception PDA)
│   │   ├── suppliers/page.tsx    # Achats + PurchasesClient
│   │   └── reports/page.tsx  # X/Z + SessionCloser + analytics + exports CSV
│   ├── components/           # ui.tsx (Card, Badge, StatCard, Bars) + clients + CsvButton
│   └── lib/
│       ├── types.ts          # Modèle : Tenant(+users), Store, Product, Batch, StockMovement, TransferOrder(+items), Supplier, PurchaseOrder(+items), Sale(+items/payments), CashSession, AuditEntry
│       ├── session.ts        # Session HMAC signée (cookie httpOnly sg_session), rôles
│       ├── seed.ts           # Jeu de données déterministe + comptes de démo (defaultUsers)
│       ├── sqlStore.ts       # SQL Server (mssql) : dbo.sg_tenants, document JSON par tenant, upsert
│       ├── db.ts             # Persistance : SQL Server si MSSQL_CONNECTION_STRING, sinon JSON par tenant + single-flight + mutex d'écriture + migration douce users
│       ├── tenant.ts         # requireSession / resolveTenant (session → tenant, sinon /login)
│       ├── stock.ts          # stockOf (journal dérivé), transitOf, damageOf, suggestions Pull
│       ├── format.ts         # fmtMoney FCFA, seuil écart caisse, labels statuts & paiements
│       └── actions.ts        # "use server" : login/logout + toutes les mutations + audit trail (validateurs serveur)
```

## Key patterns

- **Auth par session signée** : `login(tenant, username, password)` vérifie sha256(salt:password) contre `Tenant.users`, pose un cookie httpOnly `sg_session` signé HMAC-SHA256 (secret `SG_SECRET`, TTL 12 h). `requireSession()`/`resolveTenant()` redirigent vers `/login` sans session ; `withTenant()` des actions dérive le tenant de la session — le cookie `sg_tenant` librement modifiable a été supprimé. Rôles : CASHIER/STOCK/LOGISTICS/ADMIN/SUPER_ADMIN ; retours POS sans PIN pour ADMIN/SUPER_ADMIN, sinon PIN démo 1234.
- **Multi-tenant « schema-per-tenant » simulé** (PRD §4.1) : `Database { tenants: Record<slug, Tenant> }` ; le tenant est résolu côté serveur depuis la session. Les comptes de démo sont recréés automatiquement si un fichier de données antérieur n'a pas de `users` (migration douce dans db.ts).
- **Exports CSV** : `CsvButton` (client) génère un CSV « ; » + BOM UTF-8 (Excel FR) — rapport Z, top ventes, modes de paiement.
- **Stock dérivé du journal** : `stockOf()` = somme signée des StockMovement (types IN/OUT/ajustement signé). Aucun compteur dupliqué ; invariants garantis (jamais négatif après seed ; delta absolu au μ€).
- **Server Actions + revalidation** : `withTenant()` résout la session, exécute, puis `revalidateAll()` (7 routes). Les payloads de vente (prix/TVA/marge/tickets) sont recalculés serveur — le client ne fait qu'envoyer productId/qty/mode de paiement.
- **Offline-first POS** : file `localStorage["sg_offline_sales_queue"]` (idempotence par UUID de vente — le serveur déduplique par id) + liste d'attente `sg_parked_carts`. Flush à l'événement `online` + manuel.
- **Écritures transactionnelles simulées** : `mutateTenant` sérialise read-modify-write avec tmp+rename atomique, fallback écriture directe.
- **Workflow OT machine à états** : SUBMIT/APPROVE/PREPARE/SHIP/RECEIVE/RESOLVE/CANCEL dans `updateTransferStatus` — écritures TRANSFER_OUT / TRANSIT_ENTRY / TRANSFER_IN / DAMAGE_TRANSIT / LOSS_TRANSIT générées par étape ; manquants = shipped−received−damaged.

## Gotchas

- `cookies()` dans layout → toutes pages dynamiques ; ajouter `export const dynamic = "force-dynamic"` sur chaque page.
- Après un déplacement de routes, `rm -rf .next` avant `bun typecheck` (types générés périmés → erreurs TS2307 fantômes).
- Ne pas modifier `.data/` pendant que le serveur tourne avec un cache chaud (redémarrer pour recharger).
- Le bandeau « mode retour » du POS attend le PIN démo 1234 sauf si le rôle de session est ADMIN/SUPER_ADMIN.
- Le stock de la graine est garanti non-négatif par une passe de rééquilibrage dans seed.ts.
- Comptes de démo (affichés sur /login) : horizon admin/nova2026, caisse/caisse2026, stock/stock2026, logistique/logi2026 ; ecomarche admin/eco2026.
