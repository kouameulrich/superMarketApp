# Technical Context: SuperGestion

## Technology Stack

| Technology   | Version | Purpose                                  |
| ------------ | ------- | ---------------------------------------- |
| Next.js      | 16.1.3  | React framework, App Router, Turbopack   |
| React        | 19.2.x  | UI                                       |
| TypeScript   | 5.9.x   | strict                                   |
| Tailwind CSS | 4.1.x   | CSS-first config (postcss)               |
| Bun          | -       | package manager                          |
| node:crypto  | -       | sessions HMAC-SHA256 + hash mots de passe |
| —            | —       | Persistance : JSON store custom (`src/lib/db.ts`) |

⚠ La recipe « add-database » (Drizzle + @kilocode/app-builder-db) exige `DB_URL`/`DB_TOKEN` — non provisionnés dans cet environnement : le package GitHub ne s'installe pas non plus (ZlibError). La persistance actuelle est un store JSON par tenant (`.data/supergestion.json`), modèle calqué sur le DDL du PRD §5. Migration Drizzle redevient pertinente si les credentials sont fournis.

## Commands

```bash
bun run build      # next build (⚠ `bun build` tout seul appelle le bundler Bun)
bun typecheck      # tsc --noEmit
bun lint           # eslint
git add -A && git commit && git push   # migrations/deploiement gérés par le sandbox
```

## File Structure (clé)

```
src/lib/{types,seed,db,session,tenant,stock,format,actions}.ts
src/app/login/                 # page de connexion (hors shell authentifié)
src/app/(app)/{page,pos,products,stock,transfers,suppliers,reports}/...
src/components/ (ui.tsx, Sidebar, LoginForm, CsvButton, PosClient, ProductsClient, StockClient, TransferCreateClient, TransferWorkflowClient, PurchasesClient, SessionCloser)
.data/supergestion.json       # persisté à chaud (gitignored, re-seedé si absent)
```

## Technical Constraints

- UI/UX en français, devise FCFA (grille TVA 18/5/0 % zone UEMOA), format fr-FR partout via `Intl`.
- Toutes les pages : `export const dynamic = "force-dynamic"` (layout consomme `cookies()`).
- écrivures serveur uniquement via Server Actions (`src/lib/actions.ts`) ; validation + recalcul des totaux côté serveur.
- Auth : session signée HMAC (`sg_session`, secret `SG_SECRET` à définir en prod), tenant+rôle dérivés de la session, jamais du client. Retours POS : bypass PIN pour ADMIN/SUPER_ADMIN, sinon PIN démo `1234`.
- Données antérieures à l'auth : migration douce au chargement (users de démo injectés si absents).
- Après toute modification : `bun typecheck && bun lint && bun run build` avant commit/push.
