# AgriPilot Slice 3 — Santé, stocks, achats Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stocks update themselves from operations: a received purchase adds stock, a feed distribution or a treatment consumes it at weighted-average cost, an inventory corrects it — and health, biosecurity, suppliers and the purchase workflow work end to end with their alerts.

**Architecture:** One deep backend module, the **stock ledger**, owns every quantity: levels are sums of movements, each movement names its source, and no other module writes a quantity. Purchases, feed and health call the ledger inside their own transaction (as production calls the herd ledger). Screens are `ModuleConfig`s on the existing kit, extended once with a line-items field.

**Tech Stack:** unchanged (NestJS, Prisma 7 pinned, PostgreSQL; React 19, Vite, Tailwind 4, TanStack Query).

**Spec:** `docs/superpowers/specs/2026-11-14-agripilot-design.md` (Stock ledger, Documents — purchases, Alerts, Finance rules, Edit and delete, Roles). Reference UI: `docs/reference/screens/m_stocks.png`, `m_fournisseurs.png`, `m_achats.png`, `m_sante.png`, and `docs/reference/screens-text.txt`. Carry-over: `docs/superpowers/plans/2026-11-14-slice-2-carryover.md`.

## Global Constraints

- All Global Constraints of the slice 1 and slice 2 plans still apply (French UI and messages; `/api`; strict DTOs; `farmId` + indexes on farm-owned tables; `X-Farm-Id`; every route exactly one of `@Public` / `@RequirePermission` / `@AnyAuthenticated`; in-transaction audit; calendar dates `YYYY-MM-DD`, no future-dated operations; Decimals in DB, numbers in API; frontend queries through `useFarmQuery`, screens as `ModuleConfig`s, one form engine).
- Permission rules (in `backend/src/access/permissions.ts`): **master records** need `update` on the module whatever the verb; **daily entries** (create, edit, delete) need `create`. Module keys of this slice: `stocks`, `fournisseurs`, `achats`, `sante`.
- Stock quantities are never stored as editable fields: a level is the sum of that farm's movements for the item. A movement that would make a level negative at any point of its history is refused (400 `Stock insuffisant`).
- Valuation: weighted-average cost per (farm, item), recomputed on every entry: `newAvg = (qty × avg + inQty × inUnitCost) / (qty + inQty)`; exits are valued at the average current at their date; costs are `Decimal`, rounded to 2 decimals only at the edges.
- Stock item catalogue, suppliers and their product lists are organisation-scoped; quantities, movements, inventories, purchases, health records are farm-owned.
- Purchase statuses (exact): `DEMANDE → VALIDEE → COMMANDEE → RECUE → PAYEE`, plus `ANNULEE` from any state before `RECUE`. References: `DA-NNNN` at creation, `BC-NNNN` assigned when ordered; numbering per organisation.
- Level labels (exact, lower case as the reference): `ok`, `faible` (below seuil minimum), `critique` (below half of seuil minimum, or zero).
- Jours de stock = quantité disponible / consommation moyenne quotidienne des 30 derniers jours (exits of type consumption only); `—` when there was no consumption.
- Alert settings: `expiryWarningDays` 30 (existing), new `vaccinationWarningDays` 3, `biosecurityWarningDays` 0.
- Withdrawal time: a treatment with `withdrawalDays > 0` puts the lot or animal under `délai d'attente` until `endDate + withdrawalDays`; this slice records and shows it (sales blocking is slice 4).

## Review Focus

1. **Negative or drifting stock** — consuming more than the level; editing or deleting an earlier entry so a later exit would go negative; two concurrent exits on one item: expect 400 `Stock insuffisant`, exactly one winner, never a 500. (Task 2.)
2. **Reversal symmetry** — editing or deleting a distribution, a treatment, a reception or a validated inventory restores the exact quantities and the weighted-average cost as if it had never happened or had always had the new value. (Tasks 2, 3, 4, 5.)
3. **Purchase workflow shortcuts** — receiving a purchase that was never ordered, receiving twice, paying more than the amount, cancelling after reception, editing lines after validation: expect 409 with a French message; stock entries exist only for `RECUE`. (Task 4.)
4. **Expired or wrong product** — administering a product batch past its expiry date, a product of the wrong category (a feed as a vaccine), or more doses than the batch holds: expect 400. (Task 5.)
5. **Cross-farm and cross-species leakage** — an item level, movement, purchase or health record of another farm; a vet or poultry manager acting on the other species' lot through health or stock routes: 404 / 400 / 403 as the existing rules define. (Tasks 2–5.)

---

## File Structure

```
backend/src/
  stock/        # StockItem, StockBatch, StockMovement, FarmStockItem: the stock ledger, levels, inventories
  suppliers/    # Supplier (+ balance derived)
  purchases/    # Purchase, PurchaseItem, SupplierPayment: workflow, reception → stock
  health/       # HealthAct (vaccination/traitement/désinfection…), VaccinationPlan, Quarantine, HealthIncident, BiosecurityLog
  herd/         # (modify) OperationTargets (moved from feed), registries
  feed/         # (modify) product ↔ stock item link, hook filled
  indicators/   # (modify) alert rules of this slice, LotCostSource
frontend/src/
  components/module/   # (modify) editPermission/deletePermission, `lines` field type
  modules/{stocks,fournisseurs,achats,sante}.tsx
  pages/details/{StockItemDetail,PurchaseDetail}.tsx
  e2e/logistics.spec.ts
```

---

### Task 1: Carry-over foundations

**Files:**
- Modify: `frontend/src/components/module/{types.ts,ModulePage.tsx}`, daily-entry configs in `frontend/src/modules/`; `backend/src/herd/` (OperationTargets, registries), `backend/src/feed/feed-targets.ts` (becomes a thin use of OperationTargets), `backend/src/indicators/` (alert filtering, AlertSettings), `backend/src/admin/buildings/`, `backend/src/pigs/animals.service.ts`, `backend/src/eggs/`, `backend/package.json`, `backend/test/route-permissions.e2e-spec.ts`
- Test: the specs of each touched area; `frontend/e2e/production.spec.ts`

**Interfaces:**
- Frontend: `ModuleConfig.editPermission?: Action` (default `'update'`), `deletePermission?: Action` (default `'delete'`); daily-entry configs (batch events, batch and animal weighings, heats, egg production, feed distributions) set both to `'create'`.
- Backend:
  - `OperationTargets` in `src/herd/` : `resolve(tx, ctx, { batchId?, animalId?, buildingId? }, date, opts: { module: ModuleKey }): Promise<Target>` — exactly one id; farm-scoped; lot locked and open; date ≥ entry/birth; species read permission checked for lots and animals; returns `{ kind: 'LOT'|'ANIMAL'|'BATIMENT', id, farmId, label, species?, buildingId }`. Feed uses it; health will.
  - Consumption alerts: a lot-target alert is kept only if the role can read the lot's species module too (`AlertItem.modules: ModuleKey[]`, all must be readable).
  - `AlertSettings` becomes `Record<string, number>` read from all numeric settings with defaults.
  - Registries: one generic `SourceRegistry<T>` in `src/common/` used by occupation, batch history, batch performance, feed/lot cost and alerts; `onApplicationBootstrap` asserts the mandatory sources are registered.
  - `LotCostSource { costsFor(batchIds: string[], range?: { from?: Date; to?: Date }, tx?): Promise<Map<string, { category: string; amount: number; quantity?: number }[]>> }` replaces `FeedSource` (feed registers category `aliment`); `batchPerformance` reads it.
  - Building `type` cannot change while the building houses lots or animals (409 `Ce bâtiment est occupé : son type ne peut pas changer`); `reinstate` re-applies the species/building fit check.
  - `POST /feed-distributions` with `waterLiters` when the row would not be the first of its target/date → 400 (same message as PATCH).
  - Incubations register as a `BatchHistorySource`.
  - `BreedsController` added to the route-permission walk; `@prisma/adapter-pg` pinned exactly.

- [ ] **Step 1: Write failing tests** — frontend: a role with only `read, create` sees edit/delete icons on the mouvements list and none on the lots list; e2e as Agent d'élevage: add a mortality, edit it, see the rate recompute. Backend: RESP_AVICOLE gets no consumption alert for a pig lot; building type change while occupied → 409; reinstate into a now-wrong-species building → 400; POST distribution with water as second row → 400; moving a source lot's entry date after an incubation start → 400; the breeds routes are in the walk; boot fails when a mandatory source is missing (unit).
- [ ] **Step 2:** Run — FAIL. **Step 3:** Implement. **Step 4:** Run all suites (backend unit + e2e, frontend unit + build + e2e) — PASS.
- [ ] **Step 5:** Commit `feat: slice 2 carry-over — daily-entry edit rights in the UI, operation targets, source registries`.

### Task 2: Stock ledger, items, movements, inventories

**Files:**
- Create: `backend/src/stock/{stock.module.ts,stock-ledger.service.ts,valuation.ts,stock-items.controller.ts,stock-items.service.ts,stock-movements.controller.ts,inventories.controller.ts,inventories.service.ts,dto/*.ts}`; migration
- Test: `backend/src/stock/valuation.spec.ts`, `backend/test/stock-ledger.int-spec.ts`, `backend/test/stock.e2e-spec.ts`

**Schema:**
- `StockItem(organizationId, name, category ALIMENT|MEDICAMENT|VACCIN|MATERIEL|CONSOMMABLE, unit String, active)` unique `(organizationId, name)`.
- `FarmStockItem(farmId, stockItemId, minQty Decimal(12,2) ≥ 0, maxQty Decimal(12,2)?)` unique `(farmId, stockItemId)`.
- `StockBatch(farmId, stockItemId, lotNumber?, expiryDate DATE?, receivedDate DATE)` — one per reception line.
- `StockMovement(farmId, stockItemId, stockBatchId?, date DATE, type ENTREE|SORTIE|AJUSTEMENT|TRANSFERT_SORTIE|TRANSFERT_ENTREE, quantity Decimal(12,2) (signed: positive in, negative out), unitCost Decimal(12,2), reason ACHAT|CONSOMMATION|TRAITEMENT|INVENTAIRE|PERTE|AUTRE, sourceType?, sourceId?, note?, createdById)`; CHECK quantity ≠ 0.
- `InventorySession(farmId, date DATE, status BROUILLON|VALIDEE, note?, validatedById?, validatedAt?)` + `InventoryLine(sessionId, stockItemId, theoreticalQty, countedQty)`.

**Interfaces:**
- `valuation.ts` (pure): `replay(movements: { date; createdAt; quantity: Decimal; unitCost: Decimal; type }[]): { quantity: Decimal; averageCost: Decimal; timeline: … }` — throws `InsufficientStock` if the running quantity dips below zero; entries update the weighted average, exits use the running average.
- `StockLedgerService`:
  - `record(tx, input: { farmId; stockItemId; date; type; quantity; unitCost?; reason; stockBatchId?; sourceType?; sourceId?; note?; userId; audit? }): Promise<StockMovement & { unitCost: Decimal }>` — locks the `(farm, item)` row (`FarmStockItem`, created on demand, `FOR NO KEY UPDATE`), replays, refuses negative; for exits `unitCost` is set to the running average at that date; when no `stockBatchId` is given for an exit of a batch-tracked item, consumes the earliest-expiring non-expired batch first (FEFO), splitting into several movements if needed.
  - `reverseBySource(tx, sourceType, sourceId, audit?)` — deletes the source's movements and replays every later movement of the item (recomputing exit costs); refuses if a later exit would go negative.
  - `levels(farmIds, itemIds?): Promise<Map<key, { quantity; averageCost; value }>>`, `batchLevels(farmId, itemId)`.
  - `dailyConsumption(farmIds, itemIds, days = 30)`.
- REST (module `stocks`):
  - `GET /api/stock?category=&search=&level=` → `Page<{ id (stockItemId), name, category, unit, quantity, minQty, maxQty, level: 'ok'|'faible'|'critique', daysOfStock (integer|null), averageCost, value, nextExpiry }>` + `levelCounts`; master: `POST/PATCH/DELETE /api/stock-items` (delete → 409 when it has movements; deactivate instead), `PUT /api/stock/:itemId/thresholds { minQty, maxQty? }`.
  - `GET /api/stock/:itemId` (detail: levels, batches with expiry, last movements); `GET /api/stock/movements?itemId=&from=&to=&type=`.
  - Daily: `POST /api/stock/movements` for manual `ENTREE` (with unitCost, optional lot number / expiry → creates a StockBatch), `SORTIE` (reason PERTE|AUTRE|CONSOMMATION), `AJUSTEMENT` (signed); `PATCH/DELETE /api/stock/movements/:id` only for manual movements (`sourceType` null) — source-linked ones → 409 `Ce mouvement provient d'une autre opération ; corrigez l'opération d'origine`.
  - Transfers inside a farm are not needed (one stock per farm); `TRANSFERT_*` types are reserved, no route.
  - Inventories: `GET/POST /api/inventories`, `GET /api/inventories/:id`, `PUT /api/inventories/:id/lines` (draft only; `theoreticalQty` snapshotted when the line is saved), `POST /api/inventories/:id/validate` (master, `validate` action: writes one `AJUSTEMENT` per line with a difference, source `INVENTORY`, valued at the average cost), `DELETE` (draft only). A validated session is immutable.
- Export columns: `Article;Catégorie;Quantité;Unité;Seuil minimum;Niveau;Jours de stock`.

- [ ] **Step 1: Write failing unit tests** (`valuation.spec.ts`): entry 1000 @ 300 then 500 @ 360 → average 320, value 480 000; exit 600 → valued 192 000, remaining 900 @ 320; an exit of 1600 → `InsufficientStock`; deleting the first entry when later exits depend on it → throws; average unchanged by exits; an adjustment −50 valued at the average; zero quantity after exits then a new entry at 400 → average 400.
- [ ] **Step 2: Write failing int/e2e tests:** two parallel exits of 600 on a level of 1000 → one 201, one 400; reference rows give `Aliment ponte 900 kg, seuil 1500 → faible`, `Aliment engraissement porc 600 kg, seuil 1500 → critique`, `Aliment croissance chair 4200 / 2000 → ok`; `daysOfStock` = 6 for 4200 kg with 21 000 kg consumed in 30 days; FEFO picks the earliest-expiring batch and skips an expired one (expired stock stays counted in quantity but is not consumable → 400 `Lot périmé` when only expired stock remains); manual movement edit recomputes later exit costs; source-linked movement PATCH → 409; inventory: counted 880 vs theoretical 900 → on validation an `AJUSTEMENT` of −20, level 880, session immutable; validating twice → 409; farm B sees none of farm A's levels; MAGASINIER can post movements but not create items; AUDITEUR read-only; audit rows; CSV header.
- [ ] **Step 3:** Run — FAIL. **Step 4:** Implement. **Step 5:** Run all backend suites — PASS.
- [ ] **Step 6:** Commit `feat(backend): stock ledger, items, movements, inventories`.

### Task 3: Feed consumes stock

**Files:**
- Modify: `backend/src/feed/{feed.service.ts,feed-products.*,feed-distributions.service.ts}`, `backend/prisma/schema.prisma` (+ migration), `backend/src/indicators/`
- Test: `backend/test/feed-stock.e2e-spec.ts`

**Interfaces:**
- `FeedProduct.stockItemId?` (unique; a feed product may be linked to a stock item of category `ALIMENT`); `POST/PATCH /api/feed-products` accept `stockItemId`; `POST /api/feed-products/:id/create-stock-item` creates and links one.
- `FeedService.afterDistributionChange` (existing hook) now: for a product linked to a stock item, records a `SORTIE` (reason `CONSOMMATION`, source `FEED_DISTRIBUTION`/distribution id) of `quantityKg` and returns the ledger's `unitCost` so the distribution's `unitCost`/`cost` are the weighted-average stock cost; for a formula, one exit per ingredient (`quantityKg × percentage / 100`), and the distribution's unit cost is the weighted sum; unlinked products keep the catalogue price and move no stock. On update: `reverseBySource` then record again; on delete: `reverseBySource`.
- Insufficient stock → 400 `Stock insuffisant pour {article} (disponible {n} {unité})` and nothing is written.
- `LotCostSource` category `aliment` now reports these costs.

- [ ] **Step 1: Write failing tests:** stock 1000 kg @ 300 + 500 @ 360 (avg 320); a distribution of 620 kg → level 880, distribution `unitCost 320`, `cost 198400`; editing it to 520 kg → level 980, cost 166 400; deleting it → level 1500 and average back to 320; a later purchase at another price does not change the stored cost of the distribution; a formula 60/40 consumes both ingredients and fails entirely if one is short (nothing consumed); an unlinked product moves no stock and keeps its catalogue price; `batchPerformance.feedCost` equals the sum of the stock-valued costs; concurrent distributions on a short stock → one succeeds.
- [ ] **Step 2:** Run — FAIL. **Step 3:** Implement. **Step 4:** Run all backend suites — PASS.
- [ ] **Step 5:** Commit `feat(backend): feed distributions consume stock at weighted-average cost`.

### Task 4: Suppliers and purchases

**Files:**
- Create: `backend/src/suppliers/*`, `backend/src/purchases/{purchases.module.ts,purchases.controller.ts,purchases.service.ts,purchase-workflow.ts,dto/*.ts}`; migration
- Test: `backend/src/purchases/purchase-workflow.spec.ts`, `backend/test/purchases.e2e-spec.ts`

**Schema:**
- `Supplier(organizationId, name, products?, phone?, email?, address?, active)` unique `(organizationId, name)`.
- `Purchase(farmId, supplierId, reference, orderNumber?, date DATE, status, requestedById, validatedById?, validatedAt?, orderedAt?, receivedAt?, receivedDate DATE?, cancelledAt?, cancelReason?, note?)` unique `(organizationId-wide reference)`.
- `PurchaseItem(purchaseId, stockItemId, quantity Decimal(12,2) > 0, unitPrice Decimal(12,2) ≥ 0, receivedQuantity Decimal(12,2)?, lotNumber?, expiryDate DATE?)`.
- `SupplierPayment(farmId, purchaseId, date DATE, amount Decimal(14,2) > 0, method ESPECES|VIREMENT|MOBILE_MONEY|CHEQUE, reference?)`.

**Interfaces:**
- `purchase-workflow.ts` (pure): `canTransition(from, to): boolean`, `nextStatuses(status)`, `isEditable(status)` (lines editable only in `DEMANDE`).
- Module `fournisseurs` (master): `GET/POST/PATCH/DELETE /api/suppliers` (delete → 409 when used); list item `{ id, name, products, phone, email, balance }` where `balance` = Σ amounts of `RECUE`/`PAYEE` purchases − Σ payments (derived, per organisation; under a farm header: that farm's purchases).
- Module `achats`:
  - `GET /api/purchases?status=&supplierId=&search=` → `Page<{ id, date, reference (BC number once ordered, else DA), supplierName, article (first line's item name, `+n` when more), quantity (first line), status, amount, paid, remaining }>` + `statusCounts`; `GET /api/purchases/:id` (lines, payments, history).
  - `POST /api/purchases` (daily, `create`: a purchase request with ≥ 1 line), `PATCH` / `DELETE` (only in `DEMANDE`, by a role with `create`).
  - `POST /api/purchases/:id/validate` (`validate` action), `/order` (master; assigns `BC-NNNN`), `/receive { date, lines: [{ itemId, receivedQuantity, lotNumber?, expiryDate? }] }` (role with `update`; one transaction: status `RECUE`, one `StockBatch` + `ENTREE` movement per line at `unitPrice`, source `PURCHASE`), `/cancel { reason }` (before `RECUE`), `/payments` POST (amount ≤ remaining; when remaining reaches 0 status `PAYEE`), `DELETE /payments/:paymentId` (status back to `RECUE`).
  - A received purchase cannot be edited or deleted; correcting it = a stock `AJUSTEMENT` (spec). Reception quantities may differ from ordered ones; amount = Σ receivedQuantity × unitPrice once received, else Σ quantity × unitPrice.
- Export columns: `Date;Référence;Fournisseur;Article;Quantité;Statut;Montant` and suppliers `Nom;Produits fournis;Téléphone;Email;Solde`.

- [ ] **Step 1: Write failing unit tests** (workflow): every allowed transition true, every other false (receive from `DEMANDE`, order from `DEMANDE`, cancel from `RECUE`/`PAYEE`, anything from `ANNULEE`).
- [ ] **Step 2: Write failing e2e tests:** request `DA-0001` by MAGASINIER? (no — RESP_STOCK creates; MAGASINIER cannot create but can receive) → validate by DIRECTEUR_FERME (RESP_STOCK → 403) → order assigns `BC-0001` → receive 3000 kg at 310 → stock level +3000, weighted average updated, a batch with lot number and expiry → supplier balance 930 000 → payment 500 000 → remaining 430 000, status `RECUE` → payment 430 000 → `PAYEE`, balance 0; receiving twice → 409; receiving a `DEMANDE` → 409; payment above remaining → 400; cancel after reception → 409; editing lines after validation → 409; partial reception (2800 of 3000) → amount 868 000; deleting a payment reopens the balance; purchase of another farm → 404; supplier of another organisation in the body → 400; reference rows reproduce (`BC-0142 Commandée 930 000`, `DA-0089 Demande 1 120 000`); audit rows; CSV headers.
- [ ] **Step 3:** Run — FAIL. **Step 4:** Implement. **Step 5:** Run all backend suites — PASS.
- [ ] **Step 6:** Commit `feat(backend): suppliers and purchase workflow with stock reception`.

### Task 5: Santé and biosécurité

**Files:**
- Create: `backend/src/health/{health.module.ts,health-acts.controller.ts,health-acts.service.ts,vaccination-plans.controller.ts,biosecurity.controller.ts,quarantines.controller.ts,incidents.controller.ts,dto/*.ts}`; migration
- Test: `backend/test/health.e2e-spec.ts`

**Schema:**
- `HealthAct(farmId, date DATE, type VACCINATION|TRAITEMENT|DESINFECTION|DIAGNOSTIC, batchId?, animalId?, buildingId?, stockItemId?, stockBatchId?, productName?, dose?, quantity Decimal(12,2)?, durationDays Int?, withdrawalDays Int?, veterinarian?, symptoms?, diagnosis?, status PLANIFIE|REALISE|ANNULE, doneDate DATE?, planId?, note?, createdById)` — exactly one target; `EN_RETARD` is derived (planned and date < today), not stored.
- `VaccinationPlan(organizationId, name, species, type (lot type)?, items: VaccinationPlanItem(planId, ageDays Int ≥ 0, productName, stockItemId?, dose?))`.
- `Quarantine(farmId, batchId?|animalId?, startDate DATE, endDate DATE?, reason, status EN_COURS|LEVEE)`; `HealthIncident(farmId, date DATE, title, description?, severity FAIBLE|MOYENNE|GRAVE, batchId?, buildingId?, status OUVERT|CLOS)`; `BiosecurityLog(farmId, date DATE, type NETTOYAGE|DESINFECTION|PEDILUVE|VISITEUR, buildingId?, productName?, visitorName?, note?)`.

**Interfaces (module `sante`):**
- `GET /api/health-acts?status=&type=&batchId=&animalId=&from=&to=` → `Page<{ id, date, target (lot code / animal tag / building name), targetKind, type, productName, dose, veterinarian, status: 'PLANIFIE'|'REALISE'|'EN_RETARD'|'ANNULE', withdrawalUntil }>` + `statusCounts`; daily: `POST` (planned or done), `PATCH`, `DELETE`; `POST /api/health-acts/:id/complete { doneDate, quantity?, stockBatchId? }`, `/cancel`.
- A `REALISE` act with a `stockItemId` (category `MEDICAMENT` or `VACCIN`; another category → 400 `Ce produit n'est pas un produit vétérinaire`) and a `quantity` consumes stock through the ledger (reason `TRAITEMENT`, source `HEALTH_ACT`), from the given batch or FEFO; an expired batch → 400 `Lot périmé`; edit/delete/cancel reverses by source. Planned acts consume nothing.
- Targets through `OperationTargets` with module `sante`: VETERINAIRE (reads all production) may act on both species; RESP_AVICOLE only poultry lots; RESP_PORCIN only pigs; `DESINFECTION` targets a building.
- `withdrawalUntil` = doneDate + durationDays + withdrawalDays; `GET /api/batches/:id` and `/api/animals/:id` responses gain `withdrawalUntil` (latest among done treatments) via a registry herd owns.
- Vaccination plans (master): `GET/POST/PATCH/DELETE /api/vaccination-plans`; `POST /api/vaccination-plans/:id/apply { batchId }` creates one `PLANIFIE` vaccination per item dated `entryDate + ageDays` (skipping dates already past by more than the lot's age), linked by `planId`; applying twice to the same lot → 409.
- Quarantines, incidents, biosecurity logs: plain CRUD (daily rule), lists with filters; `POST /api/quarantines/:id/lift { date }`, `POST /api/incidents/:id/close`.
- Export columns: `Date;Lot / Animal;Type;Produit;Dose;Vétérinaire;Statut`.

- [ ] **Step 1: Write failing e2e tests:** a planned Gumboro vaccination dated in 2 days → `PLANIFIE`; dated yesterday → `EN_RETARD` in the list and in `statusCounts`; completing it with 2 flacons from a batch → `REALISE`, stock 12 → 10; completing with an expired batch → 400; a feed item as product → 400; more than available → 400 and nothing written; deleting the done act restores 12; a treatment 5 days + withdrawal 7 days done today → `withdrawalUntil` = today + 12 on the lot detail; a désinfection on a building needs no lot; RESP_AVICOLE on a pig lot → 403, VETERINAIRE → 201; a plan with items at day 1, 7, 14 applied to a lot entered 3 days ago creates acts at the right dates and marks none in the past as done; applying twice → 409; quarantine lift; incident close; farm isolation; reference rows reproduce (`2026-10-24 LC-2026-15 Vaccination Gumboro 1 goutte Dr Koffi Planifié…`); audit rows; CSV header.
- [ ] **Step 2:** Run — FAIL. **Step 3:** Implement. **Step 4:** Run all backend suites — PASS.
- [ ] **Step 5:** Commit `feat(backend): health acts, vaccination plans, biosecurity, quarantines`.

### Task 6: Alerts of this slice

**Files:**
- Create: `backend/src/indicators/alerts/{stock-alerts.ts,health-alerts.ts}` (+ their loaders)
- Modify: settings defaults; `backend/src/dashboard/`
- Test: unit specs for the rules; `backend/test/dashboard.e2e-spec.ts`

**Interfaces — rules (exact texts):**
- `Stock faible : {article}` → `A_VOIR`, detail `{qty} {unité} (seuil {min})`; `Stock critique : {article}` → `URGENT`, same detail; module `stocks`; key `stock:{farmId}:{itemId}`.
- `Produit bientôt périmé : {article}` → `A_VOIR`, detail `Lot {n°} — expire le {date}` within `expiryWarningDays`; `Produit périmé : {article}` → `URGENT` when past and quantity > 0; module `stocks`; key `expiry:{stockBatchId}`.
- `Vaccination à venir` → `A_VOIR`, detail `{cible} — {produit} ({date})` within `vaccinationWarningDays`; `Vaccination en retard` → `URGENT`, detail `{cible} — {produit}`; module `sante` (+ species module of the target); key `vaccination:{actId}`.
- `Désinfection en retard` → `A_VOIR`, detail `{bâtiment} — {produit}`; `Traitement en retard` likewise; key `health:{actId}`.
- Rule order after the production rules: stock, expiry, vaccination, other health. All evaluated over `ctx.farmIds`, batched (no per-item query loop).

- [ ] **Step 1: Write failing tests:** the reference alerts appear with exact texts (`Stock faible : Aliment ponte` / `900 kg (seuil 1500)`; `Stock critique : Aliment engraissement porc` / `600 kg (seuil 1500)`; `Vaccination en retard` / `LC-2026-15 — Gumboro`; `Désinfection en retard` / `Porcherie 2 — Virkon S`); boundaries (exactly at the seuil → no alert; just below → faible; exactly half → critique? below half → critique, exactly half → faible); expiry at exactly 30 days → alerts, 31 → silent; a role without `stocks` read sees no stock alerts; farm isolation; `all` = union.
- [ ] **Step 2:** Run — FAIL. **Step 3:** Implement. **Step 4:** Run all backend suites — PASS.
- [ ] **Step 5:** Commit `feat(backend): stock, expiry and health alerts`.

### Task 7: Kit `lines` field and Stocks screens

**Files:**
- Create: `frontend/src/components/module/LinesField.tsx`, `frontend/src/modules/stocks.tsx`, `frontend/src/pages/details/StockItemDetail.tsx`
- Modify: `frontend/src/components/module/{types.ts,ActionDialog.tsx}`, `frontend/src/modules/alimentation.tsx` (formula lines use `LinesField`; product form gains `Article de stock`)
- Test: `frontend/src/components/module/LinesField.test.tsx`, `frontend/src/modules/stocks.test.tsx`

**Interfaces:**
- `Field` type `'lines'`: `{ name; label; type: 'lines'; columns: Field[] (text/number/date/select only); minRows?: number; addLabel?: string; footer?: (rows) => ReactNode }` — value is an array of row objects; add/remove row; per-cell validation; changed-fields diff treats the array as one value (deep compare).
- `stocks` as `m_stocks.png`: columns `ARTICLE, CATÉGORIE, QUANTITÉ, UNITÉ, SEUIL MINIMUM, NIVEAU, JOURS DE STOCK`; level pill `ok` success / `faible` warning / `critique` danger (lower case as the reference); tile `Total enregistrements`; subtitle `Aliments, médicaments, matériel et consommables.`; group `Logistique`; tabs `Stocks | Mouvements | Inventaires`; `Ajouter` (master) creates an item with its thresholds; row actions `Entrée`, `Sortie`, `Ajustement` (daily, `ActionDialog`s); detail page (`/m/stocks/:id`): tiles quantité, valeur, coût moyen, jours de stock; tabs `Lots` (batches with expiry, pill when expired / soon) and `Mouvements`.
- `Inventaires` tab: sessions list; a session page with a `lines` grid (article, théorique, compté, écart) and `Valider` (confirmation; `validate` permission).

- [ ] **Step 1: Write failing tests:** LinesField adds/removes rows, validates cells, returns the array, and an unchanged array produces no diff; stocks list renders the 7 headers and the reference rows with pills (`Aliment ponte … faible 2`, `… critique 1`, `Vaccin Gumboro … ok —`); `Sortie` action posts a movement and shows `Stock insuffisant` from the API; MAGASINIER sees movement actions but no `Ajouter`; inventory validation asks for confirmation and posts `/validate`.
- [ ] **Step 2:** Run — FAIL. **Step 3:** Implement. **Step 4:** Run unit + build — PASS.
- [ ] **Step 5:** Commit `feat(frontend): line-items field, stocks, movements, inventories`.

### Task 8: Fournisseurs and Achats screens

**Files:**
- Create: `frontend/src/modules/{fournisseurs.tsx,achats.tsx}`, `frontend/src/pages/details/PurchaseDetail.tsx`
- Test: `frontend/src/modules/purchasing.test.tsx`

**Interfaces:**
- `fournisseurs` as `m_fournisseurs.png`: columns `NOM, PRODUITS FOURNIS, TÉLÉPHONE, EMAIL, SOLDE` (money); tile `Total enregistrements`; subtitle `Fiches fournisseurs, produits et soldes.`; group `Commercial`.
- `achats` as `m_achats.png`: columns `DATE, RÉFÉRENCE, FOURNISSEUR, ARTICLE, QUANTITÉ, STATUT, MONTANT`; statuses `Demande` (neutral), `Validée` (warning), `Commandée` (warning), `Reçue` (success), `Payée` (success), `Annulée` (danger); tiles `Total, Demande, Validée, Commandée`; subtitle `Demandes, validation, bons de commande et réception.`; create form: fournisseur, date, `lines` (article, quantité, prix unitaire) with a total footer; row actions by status and permission: `Valider`, `Commander`, `Réceptionner` (dialog with a `lines` grid prefilled from the order: quantité reçue, n° de lot, péremption), `Payer`, `Annuler`; edit/delete only in `Demande` (else disabled with `Enregistrement verrouillé`).
- Detail `/m/achats/:id`: header with reference, supplier, status pill, amount / payé / reste; tabs `Lignes`, `Paiements` (add/delete payment), `Historique` (dates of each step); a print layout `Bon de commande` (print CSS: farm legal block from settings, lines, total) with an `Imprimer` button once ordered.

- [ ] **Step 1: Write failing tests:** lists render the reference headers and rows (`2026-10-20 BC-0142 Agro Provende SA Aliment ponte 3 000 Commandée 930 000 FCFA`); `Valider` is offered only on `Demande` rows to a role with `validate`; reception dialog posts `/receive` with the lines; payment above the remaining shows the API message; a `Reçue` row has disabled edit/delete icons with the reason.
- [ ] **Step 2:** Run — FAIL. **Step 3:** Implement. **Step 4:** Run unit + build — PASS.
- [ ] **Step 5:** Commit `feat(frontend): fournisseurs, achats, purchase detail and bon de commande`.

### Task 9: Santé & biosécurité screens

**Files:**
- Create: `frontend/src/modules/sante.tsx`
- Modify: `frontend/src/pages/details/{LotDetail,AnimalDetail}.tsx` (tab `Santé`, withdrawal notice)
- Test: `frontend/src/modules/sante.test.tsx`

**Interfaces:**
- `sante` as `m_sante.png`: columns `DATE, LOT / ANIMAL, TYPE, PRODUIT, DOSE, VÉTÉRINAIRE, STATUT`; statuses `Planifié` (warning), `Réalisé` (success), `En retard` (danger), `Annulé` (neutral); tiles `Total, Planifié, Réalisé, En retard`; subtitle `Vaccinations, traitements, diagnostics et délais d'attente.`; group `Santé`; tabs `Interventions | Plans vaccinaux | Biosécurité | Quarantaines | Incidents`.
- Intervention form: type (segmented), cible (Lot | Animal | Bâtiment per type), date, produit (select of veterinary stock items, or free text), dose, quantité + lot de produit (when a stock item is chosen and the act is done), durée, délai d'attente, vétérinaire, symptômes / diagnostic (for Traitement / Diagnostic); row actions `Marquer réalisé` (dialog: date, quantité, lot de produit), `Annuler`.
- `Plans vaccinaux`: list + form with `lines` (âge en jours, produit, dose); row action `Appliquer à un lot`.
- `LotDetail` / `AnimalDetail`: a `Santé` tab (embedded list scoped to the target) and, when `withdrawalUntil` is in the future, a warning notice under the header `Délai d'attente jusqu'au {date}`.

- [ ] **Step 1: Write failing tests:** list renders the reference headers and rows with pills; `Marquer réalisé` is offered on `Planifié` and `En retard` rows only and posts `/complete`; the form shows product-batch and quantity only for a done act with a stock product; a lot under withdrawal shows the notice; RESP_AVICOLE sees no pig targets in the select.
- [ ] **Step 2:** Run — FAIL. **Step 3:** Implement. **Step 4:** Run unit + build — PASS.
- [ ] **Step 5:** Commit `feat(frontend): santé, plans vaccinaux, biosécurité`.

### Task 10: End-to-end flow, visual comparison, README

**Files:**
- Create: `frontend/e2e/logistics.spec.ts`
- Modify: `frontend/e2e/{visual.spec.ts,referenceData.ts}`, `README.md`

**Interfaces:**
- E2E flow through the UI (API seeding for set-up): Responsable stock creates a purchase request with two lines → Directeur validates and orders → Magasinier receives (lot number, expiry) → Stocks shows the new quantity and level → a distribution consumes stock and its cost is the weighted average → Stocks drops, Mouvements lists the exit → an inventory with a difference adjusts the level → Vétérinaire plans a vaccination, marks it done from a batch → stock of the vaccine drops; the lot shows its withdrawal notice after a treatment → dashboard alerts list `Stock faible`, `Vaccination en retard`; the Comptable can read purchases but sees no workflow buttons.
- Visual: seed the reference rows of `m_stocks`, `m_fournisseurs`, `m_achats`, `m_sante`; capture into `docs/reference/built/`; measured rects, headers, tiles, pill tones, icons as for the earlier screens; re-capture `home.png` (alerts now include stock and health).
- README « État d'avancement »: slice 3 done; slices 4–5 à venir.

- [ ] **Step 1: Write the tests.** **Step 2:** Run — FAIL where the flow is not wired. **Step 3:** Fix frontend wiring; report backend defects instead of fixing them. **Step 4:** Run every suite — PASS.
- [ ] **Step 5:** Commit `feat: logistics end-to-end flow, captures, README` and push.

---

## Self-review notes

- Spec coverage: stock ledger with batches, movements, min/max, days of stock, alerts, traceability (T2, T6, T7); inventories (T2, T7); purchases workflow demande → paiement with reception into stock and supplier balance (T4, T8); santé: fiches, symptômes/diagnostic, vaccins et calendrier, dosage/durée/lot/temps d'attente, expirations, biosécurité, quarantaines, incidents (T5, T6, T9); feed valued at weighted-average cost (T3). Purchases as dépenses and cost per lot in finance are slice 4 (they read `Purchase` and `LotCostSource`). QR on stock items and medicines is slice 5.
- Review Focus → tests: 1 (T2), 2 (T2–T5), 3 (T4), 4 (T5), 5 (T2–T5 e2e).
- Carry-over from slice 2 is Task 1.
