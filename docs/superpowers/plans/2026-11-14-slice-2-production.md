# AgriPilot Slice 2 — Production Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The production modules work end to end on real data: lots avicoles, pesées, ponte, incubation, cheptel porcin, reproduction, alimentation & eau — with headcounts, building occupation, zootechnical indicators, dashboard figures and production alerts all derived from recorded operations.

**Architecture:** One deep backend module, the **herd ledger**, owns every change of headcount (entry, birth, death, sale, transfer, cull) for poultry lots and pig groups; nothing else writes a count. A pure **indicators** module computes each KPI one way only. Production screens are `ModuleConfig`s on the slice-1 kit, extended once (Task 1) with detail pages, per-row locking and custom forms.

**Tech Stack:** unchanged from slice 1 (NestJS, Prisma 7, PostgreSQL; React 19, Vite, Tailwind 4, TanStack Query, Recharts). Money and quantities with decimals use Prisma `Decimal` in the database and plain numbers in the API.

**Spec:** `docs/superpowers/specs/2026-11-14-agripilot-design.md` (sections Herd ledger, Indicators, Alerts, Pigs, KPI formulas, Edit and delete). Reference UI: `docs/reference/screens/m_lots.png`, `m_ponte.png`, `m_porcs.png`, `m_reproduction.png`, `m_alimentation.png`, and `docs/reference/screens-text.txt`. Carry-over: `docs/superpowers/plans/2026-11-14-slice-1-carryover.md`.

## Global Constraints

- Everything in the slice-1 plan's Global Constraints still applies (French UI, FCFA, `/api` prefix, strict DTO validation, `farmId` on every farm-owned table, `X-Farm-Id`, tokens verbatim, routes `/m/:module`).
- Every controller route carries exactly one of `@Public`, `@RequirePermission`, `@AnyAuthenticated` (the route-walk test enforces it). Module keys: `lots`, `ponte`, `porcs`, `reproduction`, `alimentation`.
- Every farm-owned query filters by `ctx.farmIds`; another farm's record is 404. Writes under `X-Farm-Id: all` are refused by the guard.
- Every create/update/delete is `@Audited`; ledger writes and their audit row share one transaction (`AuditService.log(entry, tx)`).
- Every new farm-owned table has `@@index([farmId])` and an index on each foreign key.
- Headcounts and occupation are never stored as editable fields: they are sums over herd events.
- KPI formulas (exact): taux de mortalité = morts / effectif initial × 100; GMD = gain de poids / nombre de jours; indice de consommation = aliment consommé / gain de poids; taux de ponte = œufs produits / nombre de poules × 100; taux d'éclosion = poussins nés / œufs incubés × 100; taux de casse = œufs cassés / œufs collectés × 100. A ratio with a zero denominator is `null`, shown as `—`.
- Gestation length comes from setting `gestationDays` (default 114): mise bas prévue = date de saillie + gestationDays.
- Alert thresholds come from settings: `mortalityDailyPct` 0.5, `mortalityCumulPct` 3, `consumptionDeviationPct` 25, `farrowingWarningDays` 7.
- Dates of operations are calendar dates (`YYYY-MM-DD`, stored as `DATE`); an operation dated in the future is refused (400 `La date ne peut pas être dans le futur`), except planned dates (expected farrowing, planned hatch).
- Frontend: every data query through `useFarmQuery`; pages built from `ModuleConfig`; no new parallel list/header/pagination implementations.
- Percentages display with one decimal and no space before `%` (`3.6%`), as the reference.

## Review Focus

1. **Impossible headcounts** — recording more deaths, sales or transfers than a lot's live count, or deleting/editing an earlier entry so that a later moment would go negative: expect 400 `Effectif insuffisant` and no change. (Task 2.)
2. **Editing history** — changing or deleting a mortality, weighing or egg record recomputes every derived figure (vivants, mortalité, occupation, taux de ponte, dashboard) on the next read; a closed lot refuses new operations (409 `Ce lot est clôturé`). (Tasks 2, 3, 4.)
3. **Cross-farm references** — a building, lot, animal, feed product or boar id of another farm in a request body: expect 400, never a link across farms. (Tasks 2–6.)
4. **Reproduction order** — a mise bas dated before its saillie, a sevrage before the mise bas, nés vivants > nés totaux, sevrés > nés vivants, a saillie on a truie that is already gestante: expect 400 with a French message. (Task 5.)
5. **Duplicate daily records** — two egg-production records for the same lot and date, or two water records for the same lot/building and date: expect 409 `Un enregistrement existe déjà pour cette date`. (Tasks 4, 6.)

---

## File Structure

```
backend/src/
  herd/            # Breed, AnimalBatch, BatchEvent: the herd ledger + batches API + weighings
  eggs/            # EggProduction, Incubation, Hatching
  pigs/            # Animal (individual breeders), AnimalWeighing, cheptel list (animals + pig batches)
  breeding/        # Heat, BreedingRecord (saillie → gestation → mise bas → sevrage)
  feed/            # FeedProduct, FeedFormula(+items), FeedDistribution, WaterConsumption
  indicators/      # pure KPI functions + production alert rules
  dashboard/       # (modify) sections filled from the modules above
frontend/src/
  components/module/   # (modify) contract additions, detail route
  components/ErrorBoundary.tsx
  modules/{lots,ponte,porcs,reproduction,alimentation}.tsx
  pages/details/{LotDetail,AnimalDetail}.tsx
  e2e/production.spec.ts
```

---

### Task 1: Kit and carry-over foundations

**Files:**
- Create: `frontend/src/components/ErrorBoundary.tsx`, `frontend/src/pages/details/DetailLayout.tsx`
- Modify: `frontend/src/components/module/{types.ts,ModulePage.tsx,RecordDialog.tsx,useEndpointOptions.ts}`, `frontend/src/pages/ModuleRoute.tsx`, `frontend/src/App.tsx`, `frontend/src/pages/Dashboard.tsx`; `backend/src/admin/users/users.service.ts`
- Test: `frontend/src/components/module/ModulePage.test.tsx`, `frontend/src/components/ErrorBoundary.test.tsx`, `backend/test/users.e2e-spec.ts`

**Interfaces — additions to `ModuleConfig<T>` (all optional, plain data or component types):**
- `detail?: ComponentType<{ id: string }>` — when set, the row's first cell links to `/m/{slug}/{id}` and `ModuleRoute` renders `detail` for that route inside `<DetailLayout>`; unknown id → the 404 card.
- `canEdit?: (row: T) => boolean`, `canDelete?: (row: T) => boolean` — hide the built-in row action when false.
- `form?: ComponentType<{ row?: T; onSaved: () => void; onClose: () => void }>` — replaces the generated dialog for add/edit.
- `scope?: Record<string, string>` — fixed query params added to the list request and merged into every create payload (for lists embedded in a detail page).
- `tabs?: ({ key; label; config } | { key; label; element: ReactNode })[]`.
- `Field` gains `type: 'time'`, number `max`/`step`, and select `options.endpoint` gains `params?: Record<string,string>`; a select may declare `dependsOn?: string` (name of another field whose value is sent as the param of the same name and which resets this field when it changes).
- `<ModuleList config scope? />` exported from `components/module` for embedding a list (no page header) in a detail page.
- `<DetailLayout back={{to,label}} title subtitle? status? actions? stats? tabs />` — header with back link, stat tiles row, tab bar; same typography as `PageHeader`.
- `<ErrorBoundary fallback?>` — catches render and lazy-chunk errors, shows the standard error card with `Réessayer` (resets and retries); wraps the routed page in `App.tsx` and each lazy chart in `Dashboard.tsx`.
- Backend: `POST/PATCH /api/users` → 400 `Au moins une ferme est requise pour ce rôle` when `farmIds` is empty for a role outside `ALL_FARMS_ROLES`.

- [ ] **Step 1: Write failing tests** — ModulePage: a config with `detail` links the first cell to `/m/x/{id}`; `canEdit: () => false` hides `Modifier` while `canDelete: () => true` keeps `Supprimer`; a `form` component is rendered instead of the generated dialog and `onSaved` refetches; `scope: {batchId:'b1'}` appears in the list request and in the POST body; an `element` tab renders its node; a select with `dependsOn: 'siteId'` requests its options with `siteId=<value>` and clears when the site changes; a `time` field submits `HH:mm`. ErrorBoundary: a child that throws shows the error card; `Réessayer` re-renders the child. Backend: creating `RESP_AVICOLE` with `farmIds: []` → 400; `AUDITEUR` with `[]` → 201.
- [ ] **Step 2:** Run — FAIL. **Step 3:** Implement. **Step 4:** Run frontend unit + build + backend e2e — PASS.
- [ ] **Step 5:** Commit `feat: module kit detail pages, row locking, custom forms; error boundary`.

### Task 2: Herd ledger and batches

**Files:**
- Create: `backend/src/herd/{herd.module.ts,herd-ledger.service.ts,batches.controller.ts,batches.service.ts,breeds.controller.ts,weighings.controller.ts,dto/*.ts}`; migration
- Modify: `backend/prisma/schema.prisma`, `backend/src/admin/buildings/buildings.service.ts` (`occupationOf`, delete guard), `backend/src/app.module.ts`
- Test: `backend/src/herd/herd-ledger.spec.ts`, `backend/test/batches.e2e-spec.ts`

**Schema:**
- `Breed(organizationId, name, species AVICOLE|PORCIN)` unique `(organizationId, species, name)`.
- `AnimalBatch(farmId, code, species AVICOLE|PORCIN, type CHAIR|PONDEUSE|POUSSIN|REPRODUCTEUR|PORCELET|ENGRAISSEMENT, breedId?, buildingId, entryDate DATE, initialCount Int, supplierName?, purchasePrice Decimal?, responsibleId? → User, status EN_COURS|CLOTURE, closedAt?, motherAnimalId?, notes?)` unique `(farmId, code)`.
- `BatchEvent(farmId, batchId, date DATE, type ENTREE|NAISSANCE|MORTALITE|VENTE|TRANSFERT_SORTIE|TRANSFERT_ENTREE|REFORME, quantity Int > 0, cause?, note?, relatedBatchId?, sourceType?, sourceId?, createdById)`.
- `Weighing(farmId, batchId, date DATE, sampleSize Int, averageWeightG Int > 0, note?)`.

**Interfaces:**
- `HerdLedgerService`:
  - `record(tx, input: { farmId; batchId; date; type; quantity; cause?; note?; relatedBatchId?; sourceType?; sourceId?; userId }): Promise<BatchEvent>` — locks the batch row (`FOR UPDATE`), refuses on a closed batch (409), refuses when the running live count would be negative at any date ≥ the event's date (400 `Effectif insuffisant`).
  - `update(tx, eventId, patch)`, `remove(tx, eventId)` — same replay check.
  - `transfer(tx, { fromBatchId; toBuildingId; date; quantity; userId })` — moves the whole lot's housing when `quantity` equals its live count (updates `buildingId`), otherwise 400 `Transfert partiel non pris en charge : créez un nouveau lot` (partial splits are out of scope).
  - `liveCounts(batchIds: string[], at?: Date): Promise<Map<string, number>>` — initialCount + NAISSANCE + TRANSFERT_ENTREE − MORTALITE − VENTE − REFORME − TRANSFERT_SORTIE.
  - `deaths(batchIds): Promise<Map<string, number>>`; `occupationByBuilding(buildingIds): Promise<Map<string, number>>` — live count of `EN_COURS` batches housed there + individual animals housed there (animals arrive in Task 5; the method takes a second source through a small `OccupationSource` interface registered by modules, so `pigs` plugs in without `herd` importing it).
- REST (module `lots` for `species=AVICOLE`; pig batches are served by Task 5 through the same service):
  - `GET /api/batches?species=AVICOLE&status=&search=&type=` → `Page<BatchItem>` + `statusCounts`; `BatchItem = { id, code, type, breedId, breedName, buildingId, buildingName, entryDate, initialCount, deaths, alive, mortalityRate, averageWeightG (latest weighing), status, ageDays }`.
  - `POST /api/batches` (code optional: generated `LC-YYYY-NN` chair, `LP-` pondeuse, `LS-` poussin, `LR-` reproducteur, per farm and year), `GET/PATCH/DELETE /api/batches/:id` (DELETE → 409 `Ce lot a un historique ; clôturez-le plutôt` when it has any event, weighing or dependent record), `POST /api/batches/:id/close`, `POST /api/batches/:id/reopen`.
  - `GET/POST /api/batches/:id/events`, `PATCH/DELETE /api/batches/:id/events/:eventId` (types allowed by hand: MORTALITE, VENTE, REFORME, ENTREE, NAISSANCE; transfers through `POST /api/batches/:id/transfer`).
  - `GET/POST /api/batches/:id/weighings`, `PATCH/DELETE …/:weighingId`.
  - `GET/POST /api/breeds?species=`, `PATCH/DELETE /api/breeds/:id` (module `lots` read for all production roles; write for roles with `lots:create` or `porcs:create`).
- Buildings: `occupationOf` now delegates to `occupationByBuilding`; creating/moving a batch into a building whose capacity would be exceeded → 400 `Capacité du bâtiment dépassée (n / capacité)`; deleting a building with occupation > 0 or any batch history → 409 `Ce bâtiment est occupé ou a un historique`.
- Export columns for lots: `Code lot;Type;Souche;Bâtiment;Date d'entrée;Effectif initial;Mortalité cumulée;Poids moyen (g);Statut;Vivants;Mortalité`.

- [ ] **Step 1: Write failing unit tests** (`herd-ledger.spec.ts`, against the test database): initial 5000, deaths 100 + 80 → alive 4820, deaths 180; a death of 5000 on day 3 after 180 deaths on days 1–2 → 400; deleting the day-1 entry event of a lot that later sold more than its initial count → 400; an event on a closed lot → 409; two parallel `record` calls that together exceed the live count → exactly one succeeds; `occupationByBuilding` sums two lots and ignores a closed one.
- [ ] **Step 2: Write failing e2e tests** (`batches.e2e-spec.ts`): create `LC` lot (code generated `LC-2026-01`), list shows `alive`, `mortalityRate` (180/5000 → 3.6), `averageWeightG` from the latest weighing, `ageDays`; reference figures: initial 5000, deaths 180 → `alive 4820`, `mortalityRate 3.6`; future-dated event → 400; building of another farm in the body → 400; lot of another farm → 404; capacity exceeded → 400; building occupation in `GET /api/buildings` becomes 4820 and `occupationRate 96` for capacity 5000; delete building with a lot → 409; close then event → 409; `AGENT_ELEVAGE` can POST a mortality but not DELETE the lot; every write has an audit row; CSV header as specified.
- [ ] **Step 3:** Run — FAIL. **Step 4:** Implement. **Step 5:** Run all backend suites — PASS.
- [ ] **Step 6:** Commit `feat(backend): herd ledger, poultry batches, weighings, building occupation`.

### Task 3: Indicators

**Files:**
- Create: `backend/src/indicators/{indicators.ts,indicators.module.ts,indicators.service.ts}`
- Test: `backend/src/indicators/indicators.spec.ts`

**Interfaces (pure functions in `indicators.ts`, all returning `number | null`, rounded to 1 decimal unless stated):**
- `mortalityRate(deaths, initialCount)`, `dailyGain(weightStartG, weightEndG, days)` (g/day), `feedConversion(feedKg, gainKg)` (2 decimals), `layingRate(eggs, hens)`, `breakageRate(broken, collected)`, `hatchRate(chicks, eggsSet)`, `occupationRate(occupation, capacity)` (integer), `ratio(n, d)`.
- `IndicatorsService.batchPerformance(ctx, batchId): Promise<{ ageDays; alive; deaths; mortalityRate; firstWeightG; lastWeightG; dailyGainG; feedKg; feedConversion; feedCost }>` — `feedKg`/`feedCost` are 0 until Task 6 registers a feed source through a `FeedSource` interface (same plug-in approach as `OccupationSource`).

- [ ] **Step 1: Write failing tests:** `mortalityRate(180, 5000) === 3.6`; `mortalityRate(0, 0) === null`; `layingRate(2480, 2850) === 87`; `breakageRate(42, 2480) === 1.7`; `hatchRate(260, 300) === 86.7`; `dailyGain(620, 1450, 15) === 55.3`; `feedConversion(6200, 3500) === 1.77`; `occupationRate(4820, 5000) === 96`; every function returns `null` for a zero or negative denominator and never `NaN`/`Infinity`.
- [ ] **Step 2:** Run — FAIL. **Step 3:** Implement; replace the inline rate maths in Task 2's list with these functions. **Step 4:** Run — PASS.
- [ ] **Step 5:** Commit `feat(backend): indicators module`.

### Task 4: Ponte and incubation

**Files:**
- Create: `backend/src/eggs/{eggs.module.ts,egg-production.controller.ts,egg-production.service.ts,incubations.controller.ts,incubations.service.ts,dto/*.ts}`; migration
- Test: `backend/test/eggs.e2e-spec.ts`

**Schema:**
- `EggProduction(farmId, batchId, date DATE, collected Int ≥ 0, broken Int ≥ 0, downgraded Int ≥ 0, toIncubation Int ≥ 0, note?)` unique `(batchId, date)`; check `broken + downgraded + toIncubation ≤ collected`.
- `Incubation(farmId, code, sourceBatchId?, incubator?, startDate DATE, eggsSet Int > 0, candlingDate?, fertileEggs Int?, expectedHatchDate DATE (start + 21 days), status EN_COURS|ECLOSE|ECHEC, hatchDate?, chicksHatched Int?, chickBatchId?, note?)` unique `(farmId, code)`.

**Interfaces (module `ponte`):**
- `GET /api/egg-production?batchId=&from=&to=` → `Page<{ id, date, batchId, batchCode, collected, broken, downgraded, toIncubation, marketable (collected − broken − downgraded − toIncubation), breakageRate, layingRate (collected / hens alive that date) }>`; `POST`, `PATCH/DELETE /:id`. Only lots of type `PONDEUSE` or `REPRODUCTEUR` (else 400 `Ce lot ne produit pas d'œufs`).
- `GET/POST /api/incubations`, `GET/PATCH/DELETE /api/incubations/:id`, `POST /api/incubations/:id/candling { date, fertileEggs }` (≤ eggsSet), `POST /api/incubations/:id/hatch { date, chicksHatched, buildingId, breedId? }` — in one transaction: sets `ECLOSE`, creates a `POUSSIN` batch (`initialCount = chicksHatched`, code `LS-…`) through the batches service and links `chickBatchId`; `chicksHatched ≤ fertileEggs ?? eggsSet`; `POST /api/incubations/:id/fail { note }`. Item includes `fertilityRate`, `hatchRate`.
- Export columns: `Date;Lot;Œufs collectés;Œufs cassés;Mis en incubation;Taux de casse`.

- [ ] **Step 1: Write failing e2e tests:** record 2480 collected / 42 broken for a PONDEUSE lot with 2850 alive → `breakageRate 1.7`, `layingRate 87`, `marketable 2438`; second record same lot and date → 409 `Un enregistrement existe déjà pour cette date`; `broken > collected` → 400; a CHAIR lot → 400; a lot of another farm → 400; editing the record changes the list figures; incubation of 300 eggs: `expectedHatchDate` = start + 21 days; candling 280 fertile; hatch 260 → `hatchRate 86.7`, a `POUSSIN` batch with `initialCount 260` exists in the given building and counts in its occupation; hatch 290 (> fertile) → 400; hatching twice → 409; permissions (`VETERINAIRE` read-only → POST 403); audit rows.
- [ ] **Step 2:** Run — FAIL. **Step 3:** Implement. **Step 4:** Run — PASS.
- [ ] **Step 5:** Commit `feat(backend): egg production and incubation`.

### Task 5: Cheptel porcin and reproduction

**Files:**
- Create: `backend/src/pigs/{pigs.module.ts,animals.controller.ts,animals.service.ts,herd-list.controller.ts,dto/*.ts}`, `backend/src/breeding/{breeding.module.ts,breeding.controller.ts,breeding.service.ts,dto/*.ts}`; migration
- Test: `backend/test/pigs.e2e-spec.ts`, `backend/test/breeding.e2e-spec.ts`

**Schema:**
- `Animal(farmId, tag, category TRUIE|VERRAT|COCHETTE, breedId?, sex F|M, birthDate DATE?, sireId?, damId?, buildingId, status ACTIF|GESTANTE|ALLAITANTE|VENDU|MORT|REFORME, exitDate?, exitReason?, notes?)` unique `(farmId, tag)`.
- `AnimalWeighing(farmId, animalId, date DATE, weightKg Decimal(6,1) > 0)`.
- `Heat(farmId, animalId, date DATE, note?)`.
- `BreedingRecord(farmId, sowId, method SAILLIE|IA, boarId?, semenLabel?, serviceDate DATE, expectedFarrowingDate DATE, status GESTATION|MISE_BAS|SEVRAGE|ECHEC, farrowingDate?, bornTotal Int?, bornAlive Int?, stillborn Int?, litterBatchId?, weaningDate?, weanedCount Int?, failureDate?, note?)`.

**Interfaces:**
- Module `porcs`:
  - `GET /api/pig-herd?status=&search=&category=` → one list mixing individual animals and `species=PORCIN` batches, as the reference: `{ kind: 'ANIMAL'|'LOT', id, identifier (tag or code), category (Truie|Verrat|Cochette|Porcelets|Engraissement), breedName, buildingName, birthDate (animal) or entryDate (lot), weightKg (latest), headcount (1 or alive), status }` + `statusCounts`; total pigs = sum of `headcount` of active rows.
  - `POST/GET/PATCH/DELETE /api/animals[/:id]` (tag generated `TR-NNN` truie, `VR-NNN` verrat, `CO-NNN` cochette when omitted; delete → 409 when it has weighings, breeding or offspring; exit through `POST /api/animals/:id/exit { date, reason: VENDU|MORT|REFORME }`), `GET/POST /api/animals/:id/weighings`.
  - Pig batches (`PORCELET`, `ENGRAISSEMENT`, codes `PO-…`, `LOT-ENG-…`) use `POST /api/batches` with `species: PORCIN`; the batches controller checks `porcs:*` permissions for PORCIN and `lots:*` for AVICOLE.
  - `pigs` registers an `OccupationSource` (active animals per building).
- Module `reproduction`:
  - `GET /api/breeding?status=` → `Page<{ id, sowId, sowTag, sire (boar tag or 'IA ' + semenLabel), serviceDate, expectedFarrowingDate, bornTotal, bornAlive, weanedCount, status, daysToFarrowing }>` + `statusCounts`.
  - `POST /api/breeding { sowId, method, boarId?|semenLabel?, serviceDate }` → sets the sow `GESTANTE`; refused (409 `Cette truie est déjà gestante ou allaitante`) unless the sow is `ACTIF` female; boar must be an active male of the same farm.
  - `POST /api/breeding/:id/farrowing { date, bornTotal, bornAlive, stillborn, buildingId }` — `date ≥ serviceDate`; `bornAlive + stillborn ≤ bornTotal`; one transaction: status `MISE_BAS`, sow `ALLAITANTE`, creates a `PORCELET` batch (`initialCount = bornAlive`, `motherAnimalId = sow`) when `bornAlive > 0`.
  - `POST /api/breeding/:id/weaning { date, weanedCount }` — `date ≥ farrowingDate`; `weanedCount ≤` litter live count; status `SEVRAGE`, sow `ACTIF`; the difference between the litter's live count and `weanedCount` is recorded as a MORTALITE event dated the weaning day with cause `Écart au sevrage` only when positive.
  - `POST /api/breeding/:id/fail { date, note }` → `ECHEC`, sow `ACTIF`.
  - `GET/POST /api/animals/:id/heats`.
  - `GET /api/animals/:id/breeding-history` → the sow's records with per-litter figures and totals (portées, nés vivants moyens, sevrés moyens).
- Export columns — pigs: `Identifiant;Catégorie;Race;Bâtiment;Date de naissance;Poids (kg);Statut`; breeding: `Truie;Verrat / IA;Date saillie;Nés totaux;Nés vivants;Sevrés;Statut;Mise bas prévue`.

- [ ] **Step 1: Write failing e2e tests** (`pigs.e2e-spec.ts`): create truie `TR-014` (tag generated when omitted → `TR-001`), verrat, an `ENGRAISSEMENT` lot of 240; `GET /api/pig-herd` lists all three with `headcount` 1, 1, 240 and total 242; weighing sets `weightKg`; exit `VENDU` removes the animal from building occupation; building occupation counts animals + lot; animal of another farm → 404; `RESP_AVICOLE` → 403 on `/api/animals`; a PORCIN batch POST by `RESP_AVICOLE` → 403 and by `RESP_PORCIN` → 201.
- [ ] **Step 2: Write failing e2e tests** (`breeding.e2e-spec.ts`): saillie on 2026-07-05 → `expectedFarrowingDate 2026-10-27` (114 days), sow `GESTANTE`; changing setting `gestationDays` to 115 changes new records only; second saillie on the same sow → 409; a male as `sowId` → 400; boar of another farm → 400; farrowing before the saillie date → 400; `bornAlive 12, stillborn 2, bornTotal 13` → 400; valid farrowing 13/12/1 creates a `PORCELET` batch of 12 linked to the sow and sets `ALLAITANTE`; weaning 11 of 12 → `SEVRAGE`, sow `ACTIF`, litter alive 11; weaning 13 → 400; weaning before farrowing → 400; `fail` → sow `ACTIF`; `daysToFarrowing` negative when overdue; breeding history totals; audit rows.
- [ ] **Step 3:** Run — FAIL. **Step 4:** Implement. **Step 5:** Run — PASS.
- [ ] **Step 6:** Commit `feat(backend): pig herd and reproduction`.

### Task 6: Alimentation and water

**Files:**
- Create: `backend/src/feed/{feed.module.ts,feed-products.controller.ts,feed-formulas.controller.ts,feed-distributions.controller.ts,water.controller.ts,feed.service.ts,dto/*.ts}`; migration
- Test: `backend/test/feed.e2e-spec.ts`

**Schema:**
- `FeedProduct(organizationId, name, kind MATIERE_PREMIERE|ALIMENT_COMPLET, unit 'kg', unitCost Decimal(12,2) ≥ 0, active)` unique `(organizationId, name)`.
- `FeedFormula(organizationId, name, species, stage, active)` + `FeedFormulaItem(formulaId, feedProductId, percentage Decimal(5,2) > 0)` — items must sum to 100 (± 0.01).
- `FeedDistribution(farmId, date DATE, batchId?, buildingId?, feedProductId?, formulaId?, quantityKg Decimal(10,2) > 0, unitCost Decimal(12,2), cost Decimal(14,2), note?)` — exactly one of `batchId`/`buildingId`, exactly one of `feedProductId`/`formulaId`; `unitCost` is copied at entry time (product cost, or formula cost/kg) so later price changes do not rewrite history.
- `WaterConsumption(farmId, date DATE, batchId?, buildingId?, liters Decimal(10,2) > 0)` unique per `(batchId, date)` and `(buildingId, date)`.

**Interfaces (module `alimentation`):**
- `GET/POST/PATCH/DELETE /api/feed-products` (delete → 409 when used), `GET/POST/PATCH/DELETE /api/feed-formulas` (item `costPerKg` = Σ percentage × unitCost / 100, 2 decimals).
- `GET /api/feed-distributions?from=&to=&batchId=` → `Page<{ id, date, target (batch code or building name), targetKind, feedName, quantityKg, waterLiters (same target and date, or null), unitCost, cost }>`; `POST`, `PATCH/DELETE /:id`. The list is the reference's "Alimentation & eau" table: one row per distribution with the day's water for the same target.
- `GET/POST /api/water`, `PATCH/DELETE /api/water/:id`.
- `feed` registers a `FeedSource` with `IndicatorsService` (`feedKg`, `feedCost` per batch) so `batchPerformance` returns real `feedConversion`.
- Stock decrement is NOT done here: slice 3's stock ledger will subscribe to distributions. Leave one clearly named seam: `FeedService.afterDistributionChange(tx, before, after)` — a no-op hook method that slice 3 fills.
- Export columns: `Date;Lot / Bâtiment;Aliment;Aliment (kg);Eau (L);Coût`.

- [ ] **Step 1: Write failing e2e tests:** product `Croissance chair` at 340 FCFA/kg; distribution of 620 kg to a lot → `cost 210800`, `unitCost 340`; raising the product cost to 400 leaves that row's cost at 210800; formula 60 % maïs (200) + 40 % soja (450) → `costPerKg 300`; items summing to 95 → 400; both `batchId` and `buildingId` → 400; neither → 400; lot of another farm → 400; water 1250 L same lot and date appears as `waterLiters 1250` on the distribution row; second water record same lot/date → 409; `batchPerformance` for a lot with 6200 kg fed and weights 620 → 1450 g over 15 days with 4820 alive reports a non-null `feedConversion`; future date → 400; a closed lot → 409; permissions; audit rows; CSV header.
- [ ] **Step 2:** Run — FAIL. **Step 3:** Implement. **Step 4:** Run — PASS.
- [ ] **Step 5:** Commit `feat(backend): feed products, formulas, distributions and water`.

### Task 7: Dashboard figures and production alerts

**Files:**
- Create: `backend/src/indicators/alerts/{production-alerts.ts,alert.types.ts}`
- Modify: `backend/src/dashboard/dashboard.service.ts`, `dashboard.controller.ts`
- Test: `backend/test/dashboard.e2e-spec.ts`, `backend/src/indicators/alerts/production-alerts.spec.ts`

**Interfaces:**
- `DashboardService` sections filled (shape unchanged): `kpis.poultryAlive` (live count of EN_COURS AVICOLE lots), `activePoultryBatches`, `pigs` (active animals + live PORCIN lots), `eggsLastDay` and `layingRate` (latest day with egg records, all layer lots), `mortalityRate` (Σ deaths / Σ initial of EN_COURS AVICOLE lots), `eggSeries` (last 5 recorded days, summed over lots), `feedDistributedKg` / `waterConsumedL` (latest recorded day). Under `X-Farm-Id: all`, sums across `ctx.farmIds`.
- `AlertRule = (ctx, settings) => Promise<AlertItem[]>`; an `AlertsRegistry` in `indicators` to which modules add rules; `GET /api/alerts` and the dashboard `alerts` section read from it. `AlertItem = { key, title, detail, level: 'A_VOIR'|'URGENT', module }`.
- Rules in this slice: `Mortalité élevée {code}` — cumulative rate ≥ `mortalityCumulPct` → `A_VOIR`, detail `{rate}% sur {initial} sujets`; a day's deaths ≥ `mortalityDailyPct` of the live count within the last 2 days → `URGENT`; `Mise bas {tag}` — within `farrowingWarningDays` → `A_VOIR` `Prévue dans {n} j ({date})`, overdue → `URGENT` `Dépassée depuis {n} j ({date})`; `Consommation anormale {code}` — a day's feed or water deviating ≥ `consumptionDeviationPct` from the target's previous-7-day average (needs ≥ 3 prior days) → `A_VOIR`. `key` is stable (`mortality:{batchId}`, `farrowing:{recordId}`, `consumption:{targetId}:{date}`).

- [ ] **Step 1: Write failing tests:** with the reference data (lots 5000/180 deaths, 4000/100, 3000/150 pondeuses; pigs 245; eggs 2480 last day with 2850 hens; feed 1800 kg and water 4370 L on the last day) the dashboard returns `poultryAlive 11570`, `activePoultryBatches 3`, `pigs 245`, `eggsLastDay 2480`, `layingRate 87`, `mortalityRate 3.6` (430/12000), `feedDistributedKg 1800`, `waterConsumedL 4370`, 5 points in `eggSeries`; alerts contain `Mortalité élevée LC-…` with detail `3.6% sur 5000 sujets` and `Mise bas TR-…` `Dépassée depuis …` as `URGENT`; a lot at 2.5 % raises no cumulative alert; lowering `mortalityCumulPct` to 2 raises it; a feed day 40 % above the 7-day average raises `Consommation anormale`; farm B sees none of farm A's figures or alerts; `all` sums both farms.
- [ ] **Step 2:** Run — FAIL. **Step 3:** Implement. **Step 4:** Run all backend suites — PASS.
- [ ] **Step 5:** Commit `feat(backend): production figures on dashboard, production alerts`.

### Task 8: Lots avicoles screens

**Files:**
- Create: `frontend/src/modules/lots.tsx`, `frontend/src/pages/details/LotDetail.tsx`
- Modify: `frontend/src/modules/index.ts`
- Test: `frontend/src/modules/lots.test.tsx`

**Interfaces:**
- List as `m_lots.png`: columns `CODE LOT, TYPE, SOUCHE, BÂTIMENT, DATE D'ENTRÉE, EFFECTIF INITIAL, MORTALITÉ CUMULÉE, POIDS MOYEN (G), STATUT, VIVANTS, MORTALITÉ`; statuses `En cours` (warning) / `Clôturé` (success); mortality pill: < 3 % success, 3–6 % warning, > 6 % danger; tiles `Total enregistrements, En cours, Clôturé`; subtitle `Poulets de chair, pondeuses, poussins et reproducteurs.`; group `Production`. Form: code (optional), type, souche (select `/breeds?species=AVICOLE`), bâtiment (select `/buildings`, avicole first), date d'entrée, effectif initial, fournisseur, prix d'achat, responsable.
- `canEdit`/`canDelete`: false for `Clôturé` lots (delete also hidden when the lot has history — the API's 409 message is shown otherwise).
- Detail `/m/lots/:id` in `DetailLayout`: stat tiles `Vivants, Mortalité, Âge (jours), Poids moyen, GMD, Indice de consommation`; actions `Clôturer` / `Rouvrir` (permission `update`), `Transférer`; tabs `Mouvements` (events list with add: Mortalité, Vente, Réforme…), `Pesées` (list + a small weight curve, Recharts lazy), `Alimentation` and `Ponte` (embedded lists scoped by `batchId`, Ponte only for layer lots — they render empty-state until Tasks 9–10 register their configs).

- [ ] **Step 1: Write failing tests:** list renders the 11 headers and a row `LC-2026-14 … 4 820 … 3.6%` with the warning pill; a `Clôturé` row has no edit/delete; the first cell links to `/m/lots/{id}`; the detail page shows `4 820`, `3.6%`, the tabs, and adding a mortality POSTs `/batches/{id}/events` with `type: 'MORTALITE'`; an API 400 `Effectif insuffisant` shows in the dialog.
- [ ] **Step 2:** Run — FAIL. **Step 3:** Implement. **Step 4:** Run unit + build — PASS.
- [ ] **Step 5:** Commit `feat(frontend): lots avicoles list and detail`.

### Task 9: Ponte, cheptel porcin and reproduction screens

**Files:**
- Create: `frontend/src/modules/{ponte.tsx,porcs.tsx,reproduction.tsx}`, `frontend/src/pages/details/AnimalDetail.tsx`
- Test: `frontend/src/modules/production.test.tsx`

**Interfaces:**
- `ponte` as `m_ponte.png`: columns `DATE, LOT, ŒUFS COLLECTÉS, ŒUFS CASSÉS, MIS EN INCUBATION, TAUX DE CASSE` (pill: < 2 % success, 2–3 % warning, > 3 % danger); tile `Total enregistrements`; subtitle `Production d'œufs journalière, casse et incubation.`; tabs `Ponte | Incubation` (incubation list: code, couveuse, début, œufs incubés, fertiles, éclosion prévue, poussins, taux d'éclosion, statut; row actions `Mirage`, `Éclosion`, `Échec` as `RowAction`s opening small dialogs).
- `porcs` as `m_porcs.png`: columns `IDENTIFIANT, CATÉGORIE, RACE, BÂTIMENT, DATE DE NAISSANCE, POIDS (KG), STATUT`; statuses `Actif, Gestante, Allaitante, Vendu, Mort` (+ `Réformé`); tiles `Total, Actif, Gestante, Allaitante`; subtitle `Truies, verrats, porcelets, croissance et engraissement.`; `Ajouter` opens a choice `Animal individuel | Lot de porcs` (custom `form`); rows of kind `LOT` link to `/m/lots/:id`-style lot detail under `/m/porcs/lot/:id` reuse `LotDetail`; rows of kind `ANIMAL` link to `AnimalDetail` (tiles: poids, âge, statut; tabs `Pesées`, `Reproduction` (history + totals), `Chaleurs`; action `Sortie`).
- `reproduction` as `m_reproduction.png`: columns `TRUIE, VERRAT / IA, DATE SAILLIE, NÉS TOTAUX, NÉS VIVANTS, SEVRÉS, STATUT, MISE BAS PRÉVUE`; statuses `Gestation, Mise bas, Sevrage, Échec`; tiles `Total, Gestation, Mise bas, Sevrage`; subtitle `Saillies, gestations, mises bas et sevrages.`; form: truie (select active females), méthode, verrat (select active males) or semence, date; row actions by status: `Mise bas` (GESTATION), `Sevrage` (MISE_BAS), `Échec` (GESTATION); the expected date is shown red when overdue.

- [ ] **Step 1: Write failing tests:** each list renders its reference headers and one reference row (`2026-10-22 LP-2026-03 2 480 42 0 1.7%`; `TR-014 Truie Large White Maternité 2024-02-10 210 Gestante`; `TR-014 VR-002 2026-07-05 0 0 0 Gestation 2026-10-27`); the `Mise bas` action is offered only on `Gestation` rows and POSTs `/breeding/{id}/farrowing`; the pig `Ajouter` choice posts to `/animals` or `/batches` with `species: 'PORCIN'`; the incubation tab's `Éclosion` action POSTs `/incubations/{id}/hatch`.
- [ ] **Step 2:** Run — FAIL. **Step 3:** Implement. **Step 4:** Run — PASS.
- [ ] **Step 5:** Commit `feat(frontend): ponte, cheptel porcin, reproduction`.

### Task 10: Alimentation screen, end-to-end flow, visual comparison

**Files:**
- Create: `frontend/src/modules/alimentation.tsx`, `frontend/e2e/production.spec.ts`
- Modify: `frontend/e2e/visual.spec.ts`, `README.md` (état d'avancement)
- Test: `frontend/src/modules/alimentation.test.tsx`

**Interfaces:**
- `alimentation` as `m_alimentation.png`: columns `DATE, LOT / BÂTIMENT, ALIMENT, ALIMENT (KG), EAU (L), COÛT`; tile `Total enregistrements`; subtitle `Distributions d'aliment et consommation d'eau par lot.`; form: date, cible (lot or bâtiment), aliment (product or formula), quantité (kg), eau (L, optional — posts a water record for the same target/date); tabs `Distributions | Aliments | Formules` (formula form is a custom `form` with percentage lines and a live `Coût / kg`).
- E2E (`production.spec.ts`, own database as before): as a Directeur de ferme (2FA setup in the test) create a site and `Poulailler A` (5000); create lot of 5000; record 180 deaths → list shows `4 820` and `3.6%`; Bâtiments shows occupation `4 820` / `96%`; dashboard shows `4 820` volailles and the alert `Mortalité élevée`; record eggs for a pondeuse lot → Ponte row and dashboard `Œufs (dernier jour)`; saillie → Reproduction row with the expected date +114 days; mise bas creates a porcelet lot visible in Cheptel porcin; a distribution shows its cost; an Agent d'élevage can add a mortality but sees no delete; the audit journal lists the operations.
- Visual: capture `m_lots`, `m_ponte`, `m_porcs`, `m_reproduction`, `m_alimentation` (seeded through the API with the reference rows from `screens-text.txt`) into `docs/reference/built/`, compare with the reference captures by measured rects (header, tiles, table header, first row, pills) and fix visible differences; re-capture `home.png` against the real API with that data (no mocking) and compare with `docs/reference/screens/home.png`.

- [ ] **Step 1: Write failing tests** (unit + e2e as above). **Step 2:** Run — FAIL. **Step 3:** Implement. **Step 4:** Run every suite: backend unit + e2e, frontend unit + build, `npm run e2e` — PASS.
- [ ] **Step 5:** Commit `feat: alimentation screen, production end-to-end flow, captures` and push.

---

## Self-review notes

- Spec coverage: herd ledger (T2), indicators (T3), aviculture lots/chair/pondeuses/incubation (T2, T4, T8, T9), porcin individual + groups, reproduction with expected date and alerts (T5, T7, T9), alimentation, formulas, cost/kg, water, abnormal consumption (T6, T7, T10), building occupation (T2), dashboard derived figures (T7). Stock decrement on distribution, treatments and vaccination alerts are slice 3; sales decrementing lots is slice 4; heat calendar view, QR and reports are slice 5.
- Review Focus → tests: 1 (T2 unit + e2e), 2 (T2, T4), 3 (T2–T6 e2e), 4 (T5 e2e), 5 (T4, T6 e2e).
- Carry-over handled here: ErrorBoundary, ModuleConfig additions, backend farm-required rule (T1); building delete guard (T2); Decimal in audit already supported (slice-1 fix wave).
