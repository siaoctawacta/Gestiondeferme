# Slice 3 — carry-over for later slices

Items found during slice 3 reviews and deliberately left for later. Slice 4 starts with the first section.

## First task of slice 4
- Finance reads purchases as expenses: `Purchase` / `SupplierPayment` need no rewrite, but snapshot the expense category at reception (`stockItem.category` is mutable).
- One definition of a purchase's amount: today TypeScript `linesAmount` and the SQL in `SuppliersService.balances` agree; finance must reuse one, not add a third.
- Health consumption is not yet a `LotCostSource`: lot cost misses medicines and vaccines. Read it from the stock ledger movements (source `HEALTH_ACT`), as feed now does through `FeedService.currentCosts`.
- Sales must decrement lots through the herd ledger and respect the withdrawal period (`withdrawalUntil`, inclusive) — block or warn per the owner's decision.
- Payments are only possible from `RECUE`: advance payments to suppliers are impossible today.
- `GET /feed-distributions?sort=cost` sorts by the cost stored at entry, not the current ledger-based cost shown.
- Kit: `readOnly` taking a reason string (disabled icons unless `whenReadOnly` lets them through) would remove `noCreate` and the `left` parameters and make the animal tabs consistent; extract `ActionDialog`'s dependent-value bookkeeping into a `useDependentValues` hook with its own tests.
- Quarantines, incidents, biosecurity logs and vaccination plans have no CSV/XLSX export and no `statusCounts` (slice 5 exports).

## Owner decisions still open
- Agent d'élevage holds full daily rights on Santé (record, cancel or delete any act incl. a vet's, lift a quarantine, close an incident); the cahier limits the role to field entry. Kept as is.
- Comptable can only read purchases; who records supplier payments (today Directeur de ferme and Propriétaire).
- A validated inventory closes the past of its article on its farm (no earlier movement, feed distribution, health act or reception can be added, edited or deleted; only an entry's price can be corrected). Too strict?
- A feed product that already had distributions before slice 3 cannot be linked to a stock article (alternative: allow the link, only later distributions consume stock).
- Reception date must not be before the purchase request's date (not the day the BC number was issued).
- Received quantity cannot exceed the ordered quantity; a surplus is a separate stock entry.
- Supplier balance counts received purchases only (the prototype shows a balance for an ordered one).
- Applying a vaccination plan creates every step, past ones show « En retard ».
- Withdrawal period counts any done act that declares one (vaccinations included); a lot-level treatment does not reach individually tracked animals.
- DESINFECTION acts cannot consume a disinfectant from stock (only MEDICAMENT / VACCIN articles are consumable by acts).
- `withdrawalUntil` on lot/animal detail is visible to roles without Santé read (e.g. Commercial).
- Earlier open decisions remain: dashboard feed/water period, list order, closing a lot with live animals, mortality alerts on unweaned litters, farm time zone.

## Rulings made during slice 3 (the owner may revisit)
- Ruling: start slice 3 without a separate plan sign-off (standing instruction) — cost if wrong: plan adjustments mid-slice.
- Ruling: the distribution's stored unitCost for a formula = Σ(ingredient exit cost)/quantityKg — single number on the row — fine |
- Ruling: RESP_STOCK creates requests (achats read,create,update); MAGASINIER (achats read,update) receives; DIRECTEUR_FERME validates/orders |
- Ruling: quantity < min → faible; quantity < min/2 or quantity = 0 → critique; exactly min → ok; exactly min/2 → faible |
- Ruling: fold frontend test fixes (e2e assertion that can never see icon buttons; closed-lot test passing trivially) into round 1.
- Ruling: RESP_STOCK gets `validate` on `stocks` (design role table); MAGASINIER does not.
- Ruling: stock level with min <= 0 is `ok`; with min > 0, quantity 0 is `critique`.
- Ruling: split exits keep one row per lot piece sharing an `operationId`; PATCH/DELETE act on the whole operation; POST returns the array of pieces.
- Ruling: expired lots refused for CONSOMMATION/TRAITEMENT only; other exits take expired lots first.
- Ruling (achats permissions, binding for T4 backend and T8 UI): request create/edit/delete in DEMANDE = create; validate, order, cancel, pay, delete payment = validate; receive = update. COMPTABLE paying is an open owner question for slice 4 (finance).
- Ruling: no `À faire` state — only the API-derived EN_RETARD status.
- Ruling: withdrawal is inclusive of `withdrawalUntil` (binding for T5 too).
- Ruling: vaccination plans are organisation master data (farmScoped false); plan steps may carry stockItemId. Kit: `onValues` removed in favour of a declarative dependent select (path template + mapper, clears on parent change).
- Ruling: create-stock-item needs master on BOTH alimentation and stocks.
- Ruling: a formula with distributions cannot change its items (409 "créez une nouvelle formule").
- Ruling: formula shares allocated by largest remainder so Σ shares = quantityKg.
- Ruling: received quantity must be ≤ ordered quantity (400); a surplus is entered as a separate stock entry.
- Ruling: reception date ≥ the purchase's own date (accepted).
- Ruling: a received purchase whose amount is 0 becomes PAYEE at reception.
- Ruling: planned acts on a closed lot / exited animal can be cancelled and deleted, and closing a lot / exiting an animal is not blocked by them; they are excluded from EN_RETARD (shown PLANIFIE→ treated as cancelled-able).
- Ruling: plan apply creates every step, past ones show EN_RETARD (accepted).
- Ruling: withdrawal counts any done act with withdrawalDays (accepted). For T10: complete dialog sends '' for stockItemId/quantity?; HealthActRow lacks doneDate; plan list is a Page.
- Ruling: alerts and the health list's EN_RETARD never disagree (no tolerance).
- Ruling: under `all` with several farms, stock/expiry alert details end with the farm name.
- Ruling: supplier balance counts received purchases only (reference 850 000 not reproduced — accepted); generated PDF not committed.
- Ruling (final wave): a validated inventory closes the past for its (farm, article): any write/edit/delete positioned before the latest validated count is refused (409); same-day writes after the count are allowed.
- Ruling (final wave, supersedes T3 "frozen cost"): the ledger is the single truth for the stock-valued part of a feed distribution's cost — lists, detail, export and LotCostSource read it from the ledger movements; the stored cost keeps only the catalogue-priced (unlinked) part semantics as a snapshot.
- Ruling: empty lots are kept (no orphan-batch deletion); quantity-0 lots without movements are hidden from lists.
- Ruling: FarmStockItem caches quantity/averageCost, maintained in commit(); reads and alerts use the cache.
- Ruling: biosecurityWarningDays removed everywhere. AGENT_ELEVAGE sante rights kept — owner question.
- Ruling: a cost-only correction (unitCost) of an entry dated before a validated count is allowed (a count fixes quantities, not values).
- Ruling: a death/decrease on a weaned litter that would leave fewer live animals at the weaning date than weanedCount is refused.

## Deferred minor findings (from task and final reviews)
- Task 1: complete. Deferred minors: displaced doc comment above ANIMAL_LEFT in porcsShared.tsx; no direct unit test of ModuleList noCreate; stale "Self-review" note in task-1-report.
- Task 8: complete. Deferred minors (final fix wave): sheet total not re-rounded after summing; supplier edit test uses toMatchObject (weak "only changed fields"); no create-path test for supplier `active`.
- Task 9: fix round 1/5 re-review: 12/14 addressed; open: (A) stale stockBatchId on hidden-field paths, (B) plan stock cell fires /stock-items without stocks read. Fix round 2/5 dispatched. Deferred minor: animal Santé tab hides icons (readOnly) while sibling tabs show disabled icons.
- Task 9: fix round 2/5 re-review: A and B addressed; 1 new important (latent): 3-level dependsOn chain resurrects a stale value. Fix round 3/5 dispatched (kit only). Deferred minors: revert-parent loses stored dependent; 'Valeur conservée' hides the product name.
- Task 9: complete. Deferred minors (final fix wave): required `lines` select column with optionsPermission not downgraded without permission; kit tests for has-permission-still-required and stored value kept; animal Santé tab hides icons vs sibling tabs disabled; revert-parent loses stored dependent; 'Valeur conservée' hides product name. For T10: complete call sends stockItemId; quarantine lift / incident close gated `create`.
- Task 3: complete. Deferred minors (final fix wave): lockFeed/formula update lock rows by raw id before the organisation check (cross-org lock contention); changesItems duplicate payload returns 200 unvalidated; formula→product switch on edit untested; delete-linked-article message not asserted; DTO doc lacks the delete rule.
- Task 2: complete. Deferred minors (final fix wave): replaceBySource `old` loaded without orderBy (audit before-payload order); per-input allocation does not see an entry input of the same call; byReplayOrder id tie-break via localeCompare vs Postgres; pieces now in id order (check frontend in T10).
- Task 4: complete. Deferred minors (final fix wave): history lacks a PAYEE step for a purchase settled at reception; counter seeded lazily (MAX scan on first use); listOrder accepts junk sort segments; unreachable `?? before.status`. For T10: reception > ordered is a 400; zero-amount purchase shows Payée after reception; UI must hide Réceptionner outside COMMANDEE.
- Task 5: complete. Deferred minors (final fix wave): a cancelled act on a closed target cannot be deleted; lockAny skips module read checks (covered by find); no parallel quarantine-create test; create compares raw date strings; completed-later act PATCH date may be future. For T10: planned act on closed target offers Annuler only; plan species/type edit can 409; quarantine create can 409.
- Task 6: complete. Deferred minors (final fix wave): frozen `now` not restored in afterAll; production alert tests still on the wall clock; quantityText lives in indicators.ts.
- Task 10: complete. For the final fix wave: StatTiles `overflow-wrap:anywhere` may split an amount mid-number at 1024–1279px (verify in browser, prefer scaling over breaking); run.ts `--trace` check should run before servers start and reject `--trace=off` form or accept it; entered-done edit test should assert the PATCH body has no doneDate.
- Final review B (purchases/health/alerts, opus): 0 critical; important: (1) re-applying a plan after cancelling its steps → 409 (count includes ANNULE); (2) biosecurityWarningDays is a dead setting → remove (backend, Settings UI, tests); (3) AGENT_ELEVAGE has full sante daily rights — OWNER QUESTION (kept as is). Fix now: PAYEE history step for zero-amount purchase; cancelled act on closed target deletable; unreachable `?? before.status`. New minors to include: incidents update re-checks date against the old lot; no-op PATCH audit rows in health modules; stale comments (purchases numbering lock, quarantine lock doc). Slice-4 notes: category snapshot at reception, advance payments impossible, health consumption not a LotCostSource, COMPTABLE cannot pay.
- Final fix wave frontend pass 2 re-review: all 6 points OK, 0 critical/important. To do at slice close: README clause for the cost-only exception; deferred: plan re-apply e2e matches acts by name (fragile); tile height 88px at 1440 not asserted; inputs not disabled during the post-save re-read.
