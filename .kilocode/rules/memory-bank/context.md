# Active Context: SuperGestion

## Current State

**Status**: ✅ V1.0 démo déployée (commit cbf68a0 poussé)

Implémentation couvrant la Phase 1 (MVP POS offline) + Phase 2 (multi-tenant, transferts, achats) du PRD.

## Recently Completed

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

Ordre d'exécution : auth ✓ → exports CSV ✓ → PostgreSQL (bloqué : DB_URL/DB_TOKEN non provisionnés) → TVA ✓. Prochaines étapes : vraie base PostgreSQL (revenir à la recipe add-database dès credentials), tests automatisés persistants, puis V2.0 (PDA, IA réappro, fidélité, dynamic pricing).

## Session History

| Date | Changes |
|------|---------|
| 2026-10-02 (2) | Auth par session signée + rôles, exports CSV rapports, grille TVA FCFA 18/5/0 %, migration douce users sur données existantes |
| 2026-10-02 (1) | Migration de la devise EUR → FCFA sur toute l'app (formatage, seed, POS, caisse, rapports) |
| 2026-10-01 | Implémentation complète SuperGestion V1.0 d'après le PRD (POS offline-first, stocks/DLC, transferts, achats, analytics, multi-tenant) |
