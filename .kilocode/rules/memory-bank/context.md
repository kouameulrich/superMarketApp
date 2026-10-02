# Active Context: SuperGestion

## Current State

**Status**: ✅ V1.0 démo déployée (commit cbf68a0 poussé)

Implémentation couvrant la Phase 1 (MVP POS offline) + Phase 2 (multi-tenant, transferts, achats) du PRD.

## Recently Completed

- [x] Migration applicative vers les tables relationnelles SQL Server (2026-10-02) : `sqlSync.ts` (load reconstitué sur 16 requêtes, sync par diff snapshot avant/après en une transaction, collections enfants remplacées par parent modifié, ids enfants déterministes, purge anti-FK) ; `db.ts` bi-mode (SQL relationnel / JSON local), `listTenants()` renvoie des métadonnées ; DDL retravaillé (PK/FK NVARCHAR(64) pour ids non-UUID, dates en NVARCHAR ISO, colonnes renommées : movement_type, sale_status, session_status, change_amount) ; `SaleItem`/`SalePayment` gagnent un `id` optionnel (assigné à la création) ; `sql:check` étendu (round-trip relationnel réel en transaction, sonde à 2 magasins, purge garantie) ; tests hors-ligne `bun run test:sqlsync` (≈50 vérifications vertes) avec mini-moteur SQL en mémoire (`scripts/fake-exec.ts`, émulation ORDER BY/jointures/diff) — trois bugs de round-trip attrapés et corrigés hors-ligne (ordre des magasins, discriminant tenant dans le document, clés parent des enfants)
- [x] Persistance SQL Server (2026-10-02) : driver mssql, `dbo.sg_tenants` (document JSON par tenant, colonnes name/plan_type/payload/updated_at), activation par `MSSQL_CONNECTION_STRING` (ADO ou URL mssql://), support des instances nommées (`Server=hôte\instance` → SQL Browser) et port fixe, seed auto si table vide + migration douce users, repli automatique sur le store JSON local ; script de validation `bun run sql:check` (cleanup de sa sonde pour laisser le seed s'injecter) + `.env.local.example` — **validé live par l'utilisateur** sur instance `LI-ERP-004\DEVPERSO` (SQL 2022 RTM, port fixe 14331, login sa) depuis son poste
- [x] DDL relationnel cible (2026-10-02) : `sql/schema.sql` SQL Server idempotent, 18 tables calquées sur types.ts (sg_tenant, sg_user, sg_store, sg_product, sg_supplier, sg_batch, sg_stock_movement, sg_transfer_order/-item, sg_purchase_order/-item, sg_sale/-item/-payment, sg_cash_session(+tickets), sg_audit_log + sg_tenants), colonne discriminante `tenant`, FK ON DELETE CASCADE sur les lignes enfants, CHECKs de statuts/rôles/paiements, index métier — validé par sqlglot (46 lots, 0 erreur). Les tables sont créées mais non alimentées tant que la couche applicative écrit encore dans sg_tenants (migration relationnelle à faire ensuite). ⚠ Leçon : éviter les mots réservés T-SQL en nom de colonne (`plan` → `plan_type`, `data` → `payload` dans sg_tenants, corrigé après Msg 156 à l'exécution)
- [x] Authentification & tenant sécurisés (2026-10-02) : comptes utilisateurs par tenant (sha256 salted), /login (choix enseigne + identifiants de démo affichés), session HMAC signée httpOnly 12 h, tenant+rôle dérivés de la session (cookie sg_tenant supprimé), route group (app) protégé, logout, retours POS par rôle (PIN requis seulement pour les non-admins)
- [x] Exports CSV (2026-10-02) : rapport Z, top ventes, modes de paiement (CsvButton, séparateur « ; » + BOM UTF-8 pour Excel FR)
- [x] Harmonisation TVA zone FCFA (2026-10-02) : grille 18 % normal / 5 % première nécessité / 0 % exonéré (seed, formule produit, page produits)
- [x] Migration monétaire EUR → FCFA (XOF) : `fmtMoney` affiche en FCFA sans décimales (format.ts), données seed converties à la parité fixe 1 € = 655,957 FCFA arrondie au multiple de 5 (prix/coefficients produits), fond de caisse 100 000 FCFA, coupures POS 500/1 000/2 000/5 000/10 000 FCFA, seuil d'écart de caisse 5 000 FCFA (constante partagée `CASH_GAP_JUSTIFICATION_THRESHOLD`), champs prix produit en pas de 5 FCFA
- [x] Modèle de données complet calqué sur le DDL PRD §5 (types.ts)
- [x] Persistance par tenant (db.ts) simulant schema-per-tenant PostgreSQL, avec single-flight load + écriture atomique
- [x] Jeu de données déterministe riche (seed.ts) : 2 tenants, 26 articles, ~576 ventes, 5 OT (tous statuts), 5 PO, lots DLC, sessions caisse ; rééquilibrage anti-stock-négatif
- [x] Server Actions (actions.ts) : ventes idempotentes, retours (PIN admin), clôtures Z, produits CRUD, ajustements/casse, workflow OT complet, PUSH prorata, fournisseurs/PO/réception BC-BL ; audit trail partout
- [x] Dashboard KPI + graphique CA 14 j + alertes ruptures/DLC + sessions ouvertes
- [x] POS complet : scan, panier, kilo, paniers en attente, 4 modes de paiement + fractionné + monnaie, ticket imprimable + e-mail, mode offline avec file de sync (localStorage) + "dispo réseau"
- [x] Stock : niveaux/états, journal mouvements, lots & DLC avec alertes J-x, emplacements virtuels In-Transit/Avarie, génération OT flux tiré
- [x] Transferts : stepper workflow (DRAFT→…→RECEIVED/ECART), réception PDA (conformes + casse + motifs), bordereau QR simulé
- [x] Fournisseurs : annuaire, suggestions auto, PO brouillon→envoi→réception partielle/finale avec rapprochement BC/BL
- [x] Rapports : X/Z avec écarts, CA par magasin, top ventes 30 j, heures de pointe, modes de paiement
- [x] Validations : typecheck/lint/build verts ; self-test E2E exécuté puis retiré (vente, idempotence, refus paiement insuffisant, retour PIN, workflow OT complet avec écarts, clôture Z)

## Current Focus

SQL Server : migration relationnelle codée et testée hors-ligne (39 vérifications) — **restant côté utilisateur** : réexécuter `sql/drop-tables.sql` puis `sql/schema.sql` (DDL retravaillé), `bun run sql:check` (valide désormais le round-trip relationnel), démarrer l'app et vérifier l'injection du seed + un cycle vente/clôture. Outil ajouté : bun run db:seed (injection autonome + compteurs). Ensuite : tests automatisés persistants, V2.0 (PDA, IA réappro, fidélité, dynamic pricing).

## Session History

| Date | Changes |
|------|---------|
| 2026-10-02 (5) | Migration couche applicative → tables relationnelles (sqlSync diff/transaction), DDL NVARCHAR(64)+dates ISO, tests test:sqlsync, sql:check relationnel |
| 2026-10-02 (4) | Validation live SQL Server par l'utilisateur (LI-ERP-004\DEVPERSO, port 14331, SQL 2022) ; sql:check autonome (lecture .env.local, cleanup sonde) |
| 2026-10-02 (3) | Persistance SQL Server (mssql, dbo.sg_tenants) avec repli JSON local, instance nommée LI-ERP-004\SQL22I3, sql:check + .env.local.example |
| 2026-10-02 (2) | Auth par session signée + rôles, exports CSV rapports, grille TVA FCFA 18/5/0 %, migration douce users sur données existantes |
| 2026-10-02 (1) | Migration de la devise EUR → FCFA sur toute l'app (formatage, seed, POS, caisse, rapports) |
| 2026-10-01 | Implémentation complète SuperGestion V1.0 d'après le PRD (POS offline-first, stocks/DLC, transferts, achats, analytics, multi-tenant) |
