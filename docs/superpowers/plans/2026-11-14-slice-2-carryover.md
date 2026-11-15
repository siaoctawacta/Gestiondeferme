# Slice 2 — carry-over for later slices

Items found during slice 2 reviews and deliberately left for later. Slice 3 starts with the first section.

## First task of slice 3
- Frontend kit: `ModuleConfig.editPermission` / `deletePermission` (default `update` / `delete`; daily-entry lists set `create`) so an Agent d'élevage sees the edit/delete icons the API now allows on daily entries; e2e as that role correcting a mortality.
- Consumption alerts must respect the species split: a lot-target alert needs read permission on the lot's species module as well as `alimentation`.
- Include `BreedsController` in the route-permission walk test.
- A building's `type` must not change while it houses lots or animals; `reinstate` must re-apply the species/building fit check.
- `POST /feed-distributions` with `waterLiters` on a non-first row of a target/date must not overwrite the day's water.
- Incubations register as a `BatchHistorySource` (moving a source lot's entry date after an incubation start is refused).
- Pin `@prisma/adapter-pg` to the exact version (the client relies on the `relationJoins` preview feature).
- Move `FeedTargets` into herd as a generic `OperationTargets` (lot, animal or building) — health and treatments need it.
- Unify the four registries (occupation, batch performance, feed, alerts) into one multi-source pattern with a boot-time assertion.
- Generalise `FeedSource` to `LotCostSource.costsFor(batchIds, range)`; feed cost becomes weighted-average purchase cost once the stock ledger exists (hook `FeedService.afterDistributionChange`).
- `AlertSettings` as an open map so new rules (expiry days, stock thresholds) can add keys.

## Owner decisions still open
- Dashboard "Aliment distribué / Eau consommée": latest recorded day (current) vs another period.
- Lists ordered newest first (current) vs the prototype's insertion order.
- A lot cannot be closed while animals remain (current) vs recording a réforme automatically at close.
- Mortality alerts ignore unweaned litters (current).
- Farm time zone for "today" (server UTC now; exact for Togo).

## Deferred minor findings (from task and final reviews)
- Task 1: minor (deferred): dependsOn naming a missing field gives no warning; real-browser retry of a failed chunk import unverified (may need cache-busting); lazyRetry keeps renewers
- Task 8: minor (deferred): cannot clear supplier/price/responsable on edit; status pill duplicates STATUSES; TransferDialog own form shell; test gaps (Ponte/Alimentation tabs, curve hidden, edit/delete payloads); custom loading skeleton
- Task 2: minor (deferred): transfer leaves no housing history (building deletable after transfer out) → revisit when housing history is needed; redundant double lock/lookups; TDD order not followed by implementer (mutation-checked)
- Task 8: minor (deferred): no tests for building sort / mortality rounding; `export * from './lotsShared'` in lots.tsx unused; option sort has no secondary key
- Task 3: minor (deferred): double batch load per GET /batches/:id; PerformanceMetrics typed as object (type it in herd); boot check that performance provider is registered; doc comment that callers of batchPerformance must check species permission
- Task 3: minor (deferred): no zero-numerator assertions for 5 rates; feedConversion uses current alive for whole period; service spec mocks ignore where/orderBy
- Task 2: minor (deferred): no PATCH-vs-transfer race test; occupationOf TOCTOU in toItems/remove (covered by P2003)
- Task 9: minor (deferred): allPages duplicates useEndpointOptions paging; create-or-patch wrapper repeated 4×; status labels defined twice; BreedingTab hand-written table; RowAction union type; ActionDialog ignores `only`; no gating tests for row actions; no RED run
- Task 4: minor (deferred): no concurrent double-hatch test; no "today accepted" test; future-date check uses server UTC day (clients east of UTC just after midnight — product decision: use farm time zone setting later); hatch date not checked vs candling date; fertilityRate local helper → move to indicators; incubations have no export
- Task 9: minor (deferred): AnimalEditForm trims before comparing (spurious PATCH on trailing whitespace); initial baseline shifts on background refetch; formatPct(1e21) exponent form; no positive control in gating tests
- Task 5: minor (deferred): litter batch editable via PATCH /batches (can drift from bornAlive); animal PATCH birthDate not checked vs heats/service; pig-herd list paginates in memory; no exit-vs-farrowing race test
- Task 6: minor (deferred): water upsert findFirst+create race → 409; double load in update/remove; products/formulas `format` ignored; permissions tests sample only
- Task 5: parked — that finding — Ruling: unreachable. PATCH is refused unless the record is in GESTATION (breeding.service.ts:417), the partial unique index allows one open record per sow, and a new saillie must be after the previous cycle, so the editable record is always the sow's latest; on create no later record can exist. Controller verified line 417. Cost if wrong: an edit of an older record returns a 400 — but such edits are refused with 409 first by design.
- Task 5: minor (deferred): boar-lock race untested; race test recreates DB inside a loop
- Task 6: minor (deferred): non-first distribution POST/PATCH with waterLiters returns waterLiters null (document in API docs); DB-constraint test doesn't check which constraint fired; no product→formula switch test
- Task 7: minor (deferred): ~32 queries per dashboard request (kpis and alerts both load lots/liveCounts) — trim later; rounded detail prints `5%`
- Task 7: minor (deferred): one liveCounts call per distinct latest day under `all`; threshold × whole not float-exact for thresholds like 0.1/2.3 (use integer basis points if it ever matters)
- Task 10: minor (deferred): no e2e for formulas / distribution edit; audit e2e assertion loose; Agent permission check UI-only; formula total shows 100% for 99.95–100.04; failed products query in FormulaForm shows no error; lot rows on Cheptel porcin have no edit/delete icons (edited from detail page)
- Parked minors (frontend): embedded-list icons on closed lot hidden not disabled; multiselect diff order-sensitive; defaultValue function evaluated per render; pre-existing lots.tsx→LotDetail→registry order dependence.
