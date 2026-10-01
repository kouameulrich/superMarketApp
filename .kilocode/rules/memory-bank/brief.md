# Project Brief: SuperGestion

## Purpose

SuperGestion est une plateforme SaaS **multi-tenant** pour la grande distribution (PRD fourni par l'utilisateur, en français) : caisse POS, gestion des stocks et DLC, chaîne logistique inter-magasins (hub, transferts, In-Transit), achats fournisseurs, analytics et clôtures de caisse.

## Objectifs stratégiques (PRD §1.2)

- Réduire de 25 % la perte liée aux périmés/surstock
- POS réactif (< 200 ms par scan)
- Automatisation du réappro ([Pull] seuils) et [Push] prorata ventes
- Étanchéité totale des données entre tenants

## Personas (PRD §2)

Caissier·ère (POS), Gestionnaire de stock (PDA), Responsable achats/logistique, Administrateur enseigne, Super Admin plateforme.

## Phases

1. **MVP** — POS de base, référentiel articles, clôture Z, mode offline : ✅ fait
2. **V1.0** — Multi-tenancy, transferts inter-magasins (OT/In-Transit), fournisseurs/réceptions : ✅ fait (démo)
3. **V2.0** — PDA mobile, préparation réappro IA, fidélité, dynamic pricing : à venir

## Constraints

- Next.js 16 + React 19 + Tailwind 4, TypeScript strict
- Package manager **Bun** ; nunca `next dev` manuellement (le sandbox s'en charge)
- Persistance : store JSON par tenant (`.data/supergestion.json`, gitignored) simulant le schéma-per-tenant PostgreSQL (les credentials `DB_URL`/`DB_TOKEN` de la recipe « add-database » ne sont pas provisionnés dans cet environnement)
- Langue de l'UI : français ; devise EUR
