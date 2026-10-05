# Technical Context: SuperGestion

## Technology Stack

| Technology   | Version | Purpose                                  |
| ------------ | ------- | ---------------------------------------- |
| Next.js      | 16.1.3  | React framework, App Router, Turbopack   |
| React        | 19.2.x  | UI                                       |
| TypeScript   | 5.9.x   | strict                                   |
| Tailwind CSS | 4.1.x   | CSS-first config (postcss)               |
| Bun          | -       | package manager                          |
| mssql 12.x   | -       | SQL Server (Tedious) — persistance principale si configurée |
| node:crypto  | -       | sessions HMAC-SHA256 + hash mots de passe |
| —            | —       | Repli : store JSON par tenant (`src/lib/db.ts`) |

⚠ Persistance **SQL Server** activée quand `MSSQL_CONNECTION_STRING` est défini (document JSON par tenant dans `dbo.sg_tenants`, upsert read-modify-write). Repli automatique sur le store JSON local (`.data/supergestion.json`) sinon. Chaîne acceptée : ADO (`Server=…;Database=…;User Id=…;Password=…`) ou URL `mssql://user:pass@host:1433/db`. **Instance nommée supportée** : `Server=LI-ERP-004\SQL22I3` → `options.instanceName`, résolution du port via SQL Browser (UDP 1434) — sinon port fixe `Server=hôte,port`. Instance cible utilisateur : `LI-ERP-004\SQL22I3` (SQL Server 2022, hors sandbox). Validation live : `bun run sql:check` (scripts/sql-check.ts) depuis le réseau de l'instance ; `.env.local.example` contient les gabarits. Types : `@types/mssql`.

## Commands

```bash
bun run build      # next build (⚠ `bun build` tout seul appelle le bundler Bun)
bun typecheck      # tsc --noEmit
bun lint           # eslint
git add -A && git commit && git push   # migrations/deploiement gérés par le sandbox
```

## File Structure (clé)

```
src/lib/{types,seed,db,session,tenant,stock,format,sqlStore,sqlSync,actions}.ts
sql/{schema.sql,drop-tables.sql}   # DDL SQL Server (18 tables, idempotent) + reset
scripts/sql-check.ts               # validation live : connexion, sg_tenants, round-trip relationnel
scripts/test-sqlsync.ts            # tests hors-ligne couche de sync (bun run test:sqlsync)
src/app/login/                     # page de connexion (hors shell authentifié)
src/app/(app)/{page,pos,products,stock,transfers,suppliers,reports}/...
src/components/ (ui.tsx, Sidebar, LoginForm, CsvButton, PosClient, ProductsClient, StockClient, TransferCreateClient, TransferWorkflowClient, PurchasesClient, SessionCloser)
.data/supergestion.json            # repli JSON (gitignored) quand SQL non configuré
```

## Technical Constraints

- UI/UX en français, devise FCFA, fiscalité **législation ivoirienne** : TVA 18 % (taux normal, CGI CI art. 375) / 0 % exonéré (art. 377 tableau A — produits de 1ʳᵉ nécessité non transformés, produits agricoles locaux, lait, pain) — à la vente TTC la TVA extraite = TTC × t / (1 + t) ; pas de taux réduit général en CI (le 9 % ne concerne que les services financiers) ; le droit d'accise sur alcools/tabacs est hors périmètre. Format fr-FR partout via `Intl`.
- Toutes les pages : `export const dynamic = "force-dynamic"` (layout consomme `cookies()`).
- écrivures serveur uniquement via Server Actions (`src/lib/actions.ts`) ; validation + recalcul des totaux côté serveur.
- Auth : session signée HMAC (`sg_session`, secret `SG_SECRET` à définir en prod), tenant+rôle dérivés de la session, jamais du client. Retours POS : bypass PIN pour ADMIN/SUPER_ADMIN, sinon PIN démo `1234`.
- Données antérieures à l'auth : migration douce au chargement (users de démo injectés si absents).
- Après toute modification : `bun typecheck && bun lint && bun run build` avant commit/push.
