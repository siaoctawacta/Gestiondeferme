# AgriPilot — système de gestion de ferme avicole et porcine — design

Date: 2026-11-14 · Status: awaiting approval

## Intent and why

A poultry and pig farm currently runs on notebooks and isolated files. The owner
wants one web application where each field operation is entered once and then
feeds stocks, indicators, alerts, sales and finance automatically ("centre
numérique de pilotage", cahier des charges v1.0, 28 Sept 2026).

A frontend-only prototype already exists at https://fermeagricole.lovable.app
("AgriPilot"). It has the look the owner wants but no backend, no login and only
demo data held in the browser. This project rebuilds it as a real product:
separate frontend and backend, connected through a REST API, covering the web
scope of the whole cahier des charges.

Reference material in this repo:
- `docs/reference/screens/*.png` — full-page captures of all 19 reference screens
- `docs/reference/screens-text.txt` — their text content (labels, columns, demo data)
- `docs/reference/reference-styles.css` — the reference's compiled CSS (design tokens in `:root`)

## Goals

1. The UI reproduces the reference app 1:1: layout, colours, fonts, components,
   French labels, navigation groups and routes.
2. Every screen is backed by the API and PostgreSQL; nothing is mock data.
3. Web scope of the whole cahier: administration, aviculture (lots, chair,
   pondeuses, incubation), porcin (animals, reproduction), alimentation & eau,
   santé & biosécurité, stocks, achats, ventes, finance, personnel & tâches,
   équipements & maintenance, rapports, alertes, QR codes, journal d'audit.
4. Login with JWT + refresh token, the 12 cahier roles, and TOTP 2FA.
5. Multi-farm from day one: organisation → fermes → sites → bâtiments → zones,
   with a farm switcher.
6. Stocks and headcounts update automatically from recorded operations;
   indicators are computed from recorded data, never typed in.
7. Works on desktop, tablet and phone widths.

## Non-goals (deferred, per the cahier's own phasing)

- Native mobile app, offline mode and sync (Phase 3).
- AI features and IoT sensors (Phases 4–5).
- Email, SMS, WhatsApp and push notifications. Alerts are in-app only.
- Multiple languages and currencies. French and FCFA only; the currency label
  and thresholds are settings.
- Automated backup infrastructure. A documented `pg_dump` procedure is provided.

## Anti-goals

- A "digital notebook": screens where totals, stock levels or KPIs are typed by
  hand rather than derived.
- A UI that drifts from the reference: no redesign, no new visual language. New
  screens the reference lacks (login, users, farms, detail pages) use the same
  tokens and components.
- Users seeing or changing data outside their role or their farm.
- Impossible data being accepted (more deaths than live birds, selling more
  stock than exists, a mise bas before the saillie).

## Constraints

- Stack (owner's choice): backend NestJS + Prisma + PostgreSQL, REST, OpenAPI
  docs. Frontend (builder's call): React + Vite + TypeScript + Tailwind, a
  single-page app — everything sits behind login, so server rendering adds
  nothing.
- Repo layout: `backend/` and `frontend/` as independent npm projects, plus
  `docker-compose.yml` (postgres, api, web) and a root README.
- Fonts: Plus Jakarta Sans (headings, 600–800) and Manrope (body, 400–700).
- Design tokens copied from `reference-styles.css` `:root` (oklch palette,
  radius .875rem, ink sidebar, green primary, card shadow).
- Security per cahier §26: hashed passwords (argon2 or bcrypt), RBAC per action,
  input validation on every endpoint, rate limiting, brute-force lockout,
  security headers, audit of sensitive actions, least privilege.

## Approaches considered

- **A. Generic record engine** — one config-driven page and one generic CRUD
  endpoint over loosely typed rows, as the prototype does. Fastest, but business
  rules (stock decrement, headcount, mise bas date) have no home.
- **B. Hand-written per module** — bespoke page and controller for each of 25+
  screens. Rules have a home; screens drift and the code triples.
- **C. Shared screen kit + real domain modules (chosen)** — frontend keeps one
  config-driven list page so module screens stay identical to the reference;
  backend has a typed table and Nest module per domain with rules concentrated
  in a few deep modules. Chosen because it is the only one that satisfies both
  "1:1 UI" and "stocks/indicators derive from operations".

## Design

### Backend deep modules

Each hides a lot of behaviour behind a small interface; other modules call them
and never write their tables directly.

- **Access** — `can(user, permission, farmId)`. A static role → permissions map
  (`module:read|create|update|delete|validate`), a global guard reading a
  `@RequirePermission()` decorator, and farm scoping: every request carries the
  active farm (header `X-Farm-Id`); the guard rejects farms the user is not
  assigned to. Super Administrateur and Propriétaire see all farms of the
  organisation. Auditeur has `*:read` only.
- **Stock ledger** — `record(movement)` and `levelOf(item)`. Movements are
  ENTREE, SORTIE, TRANSFERT, AJUSTEMENT with a source reference (purchase
  receipt, feed distribution, treatment, sale, inventory session). Item quantity
  is always the sum of movements; a movement that would make it negative is
  refused. Product batches (lot number, expiry) are tracked per entry.
- **Herd ledger** — `record(event)` and `headcount(batchOrAnimal)`. Events are
  ENTREE, NAISSANCE, MORTALITE, VENTE, TRANSFERT, REFORME. A lot's live count is
  initial + births − deaths − sales ± transfers; building occupation is the sum
  of what is housed in it. Refuses events that would go below zero.
- **Documents** — numbered commercial documents with allowed status transitions.
  Sales: devis → facture → (bon de livraison) → paiements (comptant, partiel,
  crédit) → reçu; avoir cancels all or part of a facture. Purchases: demande
  d'achat → validée → commandée (bon de commande) → reçue (creates stock
  entries) → payée. Balances (créances clients, soldes fournisseurs) are derived
  from documents and payments. A facture line that sells animals or eggs records
  the matching herd or stock event.
- **Indicators** — pure functions over recorded data, one per cahier §35 KPI:
  taux de mortalité, GMD, indice de consommation, taux de ponte, taux
  d'éclosion, coût par animal, coût/kg, marge, jours de stock. Used by
  dashboard, lists, reports and alerts so a number is computed one way only.
- **Alerts** — `openAlerts(farm)` evaluates rules on demand: stock faible /
  critique, vaccination à venir / en retard, mise bas prévue / dépassée, produit
  proche de l'expiration, mortalité inhabituelle, consommation anormale,
  maintenance due / panne, tâche en retard, créance échue. Not stored; a user
  can acknowledge an alert (stored key + user + date) to hide it.
- **Audit** — a global interceptor writes user, date, farm, module, action,
  record id and changed values (before/after) for every create/update/delete,
  plus logins.

### Data model (Prisma, PostgreSQL)

All farm-owned tables carry `farmId`. Names follow the cahier §24.

- Admin: organization, farm, site, building, zone, user, user_farm, role (enum
  of 12), setting, login_log, audit_log, attachment, refresh_token.
- Avicole: breed, animal_batch (code, type chair/pondeuse/poussin/reproducteur,
  souche, building, entry date, initial count, supplier, purchase price,
  responsable, status), batch_event (herd ledger), weighing, egg_production
  (collected, cassés, déclassés, commercialisables), incubation (couveuse, eggs
  set, mirage/fertile, éclos), hatching.
- Porcin: animal (identifiant, catégorie, race, sexe, naissance, père, mère,
  building, status), animal_weighing, heat, breeding_record (saillie/IA),
  pregnancy, farrowing (nés totaux, vivants, mort-nés), weaning.
- Alimentation: feed_product (matière première / aliment complet), feed_formula
  + formula_item (per stade physiologique, cost/kg derived), feed_distribution,
  water_consumption.
- Santé: vaccine/medication (as stock items with category), vaccination_plan,
  health_record (symptômes, diagnostic, vétérinaire), treatment (dose, durée,
  product batch, temps d'attente), biosecurity_log (nettoyage, désinfection,
  pédiluve, visiteur), quarantine, health_incident.
- Stocks: stock_item (catégorie, unité, seuil min/max), stock_batch (lot,
  expiry), stock_movement, inventory_session + inventory_line.
- Achats: supplier, purchase (+ status history), purchase_item,
  supplier_payment.
- Ventes: customer (type), quote, sale/invoice, sale_item, delivery_note,
  payment, credit_note.
- Finance: expense, revenue, cost_center (activité avicole/porcin/général,
  category).
- Opérations: employee, attendance, task (responsable, date, heure, priorité,
  statut, preuve photo), equipment, maintenance (préventive/corrective, cost,
  supplier, next date).

### API

REST under `/api`, JSON, Swagger UI at `/api/docs`. Follows cahier §25:
`/auth/*` (login, 2fa, refresh, logout, password reset), `/farms`, `/sites`,
`/buildings`, `/zones`, `/users`, `/batches`, `/batches/:id/events|weighings`,
`/egg-production`, `/incubations`, `/animals`, `/animals/:id/weighings`,
`/breeding`, `/feed-*`, `/water`, `/health/*`, `/vaccinations`, `/treatments`,
`/stock`, `/stock/movements`, `/inventories`, `/suppliers`, `/purchases`,
`/customers`, `/quotes`, `/sales`, `/payments`, `/finance/*`, `/employees`,
`/attendance`, `/tasks`, `/equipment`, `/maintenance`, `/dashboard`,
`/alerts`, `/reports/:type`, `/audit`, `/attachments`, `/qr/:kind/:id`.
Lists accept `search`, `status`, `page`, `pageSize`, `sort`; any list also
serves `?format=csv|xlsx`.

### Authentication

Email + password → short-lived access JWT (in memory) + rotating refresh token
(httpOnly cookie, hashed in DB). Five failed logins lock the account for 15
minutes. TOTP 2FA: enrolment screen with QR and 8 one-time backup codes; login
becomes two steps when enabled. 2FA is mandatory for Super Administrateur,
Propriétaire, Directeur de ferme and Comptable, optional for others. Password
reset: an admin issues a one-time reset link (no email channel in this build).

### Frontend

- Shell identical to the reference: ink sidebar with the same groups and items,
  top bar with module search and alert bell, farm switcher and user card at the
  sidebar foot, collapsible drawer on mobile.
- `ModulePage` kit: header (group, title, subtitle, Exporter, Ajouter), stat
  tiles by status, search, status filter, table with status pills and row
  actions (QR, edit, delete), add/edit dialog generated from a field config.
  Each module is a config file plus, where needed, extra tabs or a detail page.
- Routes kept from the reference: `/`, `/alertes`, `/rapports`, `/m/:module`,
  `/audit`. Added: `/login`, `/m/:module/:id` detail pages (lot, animal, truie,
  facture, achat…), `/admin/fermes`, `/admin/utilisateurs`, `/admin/parametres`,
  `/compte` (2FA, password), and tabs inside existing pages for sub-features the
  reference has no screen for (incubation under Ponte, formules under
  Alimentation, inventaires under Stocks, devis/avoirs under Ventes, présences
  and employés under Tâches, maintenance under Équipements, biosécurité under
  Santé).
- Dashboard as in the reference: 4 KPI cards, production d'œufs chart,
  rentabilité du mois donut, farm photo tile with aliment/eau, recettes vs
  dépenses bars, alertes ouvertes, tâches à venir.
- Data layer: one typed API client (fetch wrapper with token refresh and active
  farm header) + TanStack Query. Charts with Recharts. Menu items and actions
  hidden when the role lacks the permission; the API enforces it regardless.
- Reports: quotidien, hebdomadaire, mensuel, annuel, sanitaire, zootechnique;
  CSV and Excel from the API, PDF through print layouts. Commercial documents
  (devis, facture, reçu, bon de livraison, avoir, bon de commande) have print
  layouts.
- QR: each lot, building, animal, stock item and medication has a QR that opens
  its detail page; a scan page uses the device camera.

### Testing

Backend: unit tests for the ledgers, indicators, alerts, document transitions
and access map; API integration tests against a real PostgreSQL test database
for each module's main scenarios and role restrictions. Frontend: component
tests for the ModulePage kit and API client; Playwright end-to-end for login,
one full flow per slice, and screenshot comparison of key pages against
`docs/reference/screens`.

### Delivery slices

Each ends with a running, tested app pushed to the branch.

1. Foundation: repo, database, auth + 2FA, roles, farms/sites/buildings/zones,
   users, audit, app shell, design system, dashboard (reads what exists).
2. Production: lots avicoles, pesées, ponte, incubation, cheptel porcin,
   reproduction, alimentation & eau.
3. Santé & biosécurité, stocks & inventaires, fournisseurs & achats.
4. Clients & ventes (devis → paiement), finance & rentabilité.
5. Personnel & tâches, équipements & maintenance, rapports, alertes, QR,
   exports, demo seed ("Ferme Kpalimé" data from the reference), docs.

## Rules settled after review

### Roles (cahier §6) — one role per user, valid on the farms the user is assigned to

| Role | Access |
|---|---|
| Super Administrateur | Everything: configuration, users, security, audit. |
| Propriétaire / Direction | Read everything, finance, reports, validations (achats, rapports). |
| Directeur de ferme | All operational modules of the farm; validates purchases. |
| Responsable avicole | Lots, ponte, incubation, alimentation and santé for poultry. |
| Responsable porcin | Animals, reproduction, croissance, alimentation and santé for pigs. |
| Vétérinaire | Santé: diagnostics, vaccinations, traitements, biosécurité; reads production. |
| Responsable stock | Stock entries, exits, inventories, thresholds, transfers; purchase requests. |
| Comptable | Dépenses, recettes, factures, paiements, financial reports. |
| Commercial | Clients, devis, ventes, facturation, payment follow-up. |
| Agent d'élevage | Field entry only: mortalité, pesées, alimentation, eau, ponte, tasks assigned to them. |
| Magasinier | Stock movements and purchase reception. |
| Auditeur | Read-only everywhere, reports and audit log; no modification. |

### KPI formulas (cahier §35)

- Taux de mortalité = morts / effectif initial × 100
- GMD = gain de poids / nombre de jours
- Indice de consommation = aliment consommé / gain de poids
- Taux de ponte = œufs produits / nombre de poules × 100
- Taux d'éclosion = poussins nés / œufs incubés × 100
- Coût par animal = coût total du lot / animaux vendus ou suivis
- Coût/kg = coût de production / kg produit
- Marge = revenus − coûts et charges
- Jours de stock = stock disponible / consommation moyenne quotidienne (30 derniers jours)
- Coût total = animaux + aliments + médicaments + vaccins + main-d'œuvre + eau + électricité + transport + autres charges

Alert thresholds are settings with defaults: mortalité inhabituelle = daily
deaths > 0.5 % of live count or cumulative > 3 %; consommation anormale = a
day's feed or water deviating > 25 % from the lot's 7-day average; stock
faible = below seuil minimum, critique = below half of it; expiry warning 30
days; mise bas warning 7 days before the expected date (saillie + 114 days).

### Pigs: individual and by group (cahier §10)

Breeders (truies, verrats) are individual `animal` rows with père/mère. Groups
(porcelets, engraissement) are `animal_batch` rows with `species = PORCIN` and a
headcount, sharing the herd ledger with poultry lots. A mise bas creates a
litter batch from nés vivants linked to the truie; sevrage records sevrés and
moves the litter into a post-sevrage/engraissement batch. Sales and deaths of
grouped pigs are herd events on the batch. The Cheptel porcin list shows both
kinds in one table, as the reference does.

### Finance (owner's decision)

- A facture counts as a recette at its date; payments only change the créance.
- A received purchase counts as a dépense in its category at reception; supplier
  payments only change the supplier balance.
- Salaries, energy, transport and other charges are entered by hand.
- Stock consumed by a lot (feed, medicines, vaccines) is valued at weighted
  average purchase cost and attributed to that lot, giving cost and margin per
  lot, building and activity. General charges stay under "Général" and are not
  spread over lots.
- No tax: documents show line totals and a grand total (owner's decision). The
  farm's name, address, NIF/RCCM print from settings.

### Tenancy

One organisation per deployment (no tenant onboarding). Shared across the
organisation: users, customers, suppliers, breeds, stock item catalogue, feed
products and formulas, settings. Per farm: sites, buildings, zones, lots,
animals, all operations, stock quantities and movements, documents, finance,
employees, tasks, equipment. Document numbers run per organisation. Stock and
herd transfers stay within one farm in this build. The farm switcher offers
"Toutes les fermes" (read-only, consolidated dashboard and reports) to Super
Administrateur, Propriétaire and Auditeur.

### Edit and delete

Row edit/delete icons stay as in the reference. Operational entries (mortalité,
pesée, distribution, ponte, traitement…) can be edited or deleted by the roles
that may create them; ledgers recompute and the change is audited. Documents
are editable only as drafts (devis, demande d'achat); once a facture is issued
or a purchase received they are locked and corrected through an avoir, a stock
AJUSTEMENT or a cancellation with a reason. A lot or animal with history cannot
be deleted, only closed.

## Builder's calls (not decided by the owner)

- React + Vite SPA rather than Next.js.
- App name "AgriPilot", French UI, FCFA.
- Attachments stored on the API server's disk (a mounted volume).
- Alerts computed on demand rather than stored.
- 2FA mandatory for the four sensitive roles listed above.
- Password reset by admin-issued link, since there is no email channel.
- Access JWT in memory + refresh token in an httpOnly cookie.
- The role → permission map is fixed in code (not editable in the UI) in this
  build; initial mapping follows cahier §6.
- The confidential cahier PDF is not committed to the repo.
- Everything under "Rules settled after review" except the two items marked
  as the owner's decision: one role per user, alert thresholds, pig group
  model, weighted-average costing, tenancy split, edit/delete rules.

## Left to the builder

Exact column lists for screens the reference lacks, pagination sizes, chart
details, numbering formats beyond the reference's (LC-/LP-, BC-, DA-, FA-),
seed content, file/folder structure inside each app.
