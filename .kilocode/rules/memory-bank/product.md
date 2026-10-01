# Product: SuperGestion

## User flows couverts

### Caissier (POS — /pos)
1. Sélection magasin + caissier ; indicateur connexion (en ligne / hors ligne).
2. Scan (champ auto-capté par lecteur USB/Bluetooth, Enter) ou recherche ; bouton « Simuler scan ».
3. Panier : quantités (±, saisie), articles au kilo (pas 0,1), stock insuffisant → lien « dispo réseau » (quantités par magasin du tenant).
4. Mise en attente / reprise de paniers (localStorage, par magasin).
5. Encaissement modal : 4 modes (Espèces, CB, Mobile Money, Bon d'achat), règlements fractionnés, montants rapides, monnaie calculée.
6. Ticket : impression ESC/POS-like (CSS print `#printable-ticket`), envoi e-mail (mailto), idempotence si hors ligne (`offline: !online`), file de synchronisation automatique à la reconnexion.
7. Mode retour : n° ticket + PIN admin « 1234 » (démo) → RETURN_IN + audit.

### Gestionnaire stock (/stock)
Niveaux par magasin (états OK/Bas/Critique/Rupture), ajustements (+/−), casse/perte, journal des mouvements, lots & DLC avec alertes J-x, emplacements virtuels In-Transit/Avarie, génération d'OT automatique « flux tiré ».

### Responsable logistique (/transfers)
Création OT (manuel/Brush PULL/PUSH), stepper workflow DRAFT→…→RECEIVED, réception PDA avec saisie conforme + casse + motif, imputation des écarts, bordereau QR simulé.

### Achats (/suppliers)
Annuaire, suggestions automatiques (hub sous seuil), PO DRAFT→SENT→(PARTIAL)→RECEIVED, réception avec rapprochement BC/BL, mouvements SUPPLIER_IN auto.

### Admin (/ , /reports)
KPI temps réel, CA 14 j, alertes ruptures & DLC, rapports X (session ouverte) et Z (écarts comptage), top ventes 30 j, heures de pointe, modes de paiement.

## UX goals

- Thème sombre professionel, densité d'information élevée mais hiérarchisée (cards, badges d'état partout)
- POS prioritaire : gros chiffres, zéro navigation, tout au clavier
- Traçabilité : chaque écriture affichée avec référence de document

## Jeu de données de démo

2 tenants (NovaMarket « horizon » 4 sites ; EcoMarché « ecomarche » 2 sites), 26 produits (2 au kilo), ~576 ventes/14 j, 5 OT (un par statut), 5 PO, lots DLC (certains périmés), sessions de caisse closes + une ouverte.
