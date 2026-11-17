# Slice 4 — carry-over for later slices

Items found during slice 4 and deliberately left for later. Slice 5 starts with the first section. The controller completes
this file after the final reviews.

## First task of slice 5
- Comptable paying suppliers: one permission per route cannot say « `achats:validate` or `finance:create` » without a new decorator; add a permission alias.
- Personnel (slice 5) feeds the manual `Salaires` finance entries; until then they are typed by the Comptable.
- Kit: `readOnly` taking a reason string would merge `noCreate` (config and prop) and the `left` parameters (carried from slice 3).
- Summary `receivables` and the dashboard scan every issued invoice (`receivablesOf`): one SQL aggregate owned by sales when volumes grow.
- Finance list: its shared period opens on the current month, so an accountant must widen it to see earlier entries (the reference lists them all): decide the default.
- Exports of the health sub-lists, `sort=cost` on feed distributions (carried from slice 3).

## Owner decisions still open
- Comptable paying suppliers (Ruling Q29): supplier payments stay with Directeur de ferme and Propriétaire.
- Agent d'élevage's Santé rights (slice 3, unchanged).
- Manual finance categories are a fixed list; a new category is a migration (Q21); the double entry of a manual expense next to a received purchase is the user's.
- No advance payments (Q3): a deposit before invoicing cannot be recorded; no client credit balance carried to the next invoice.
- No price lists (Q16): the unit price is typed per line.
- Returning an individually tracked animal is refused (Q8); a closed lot never receives a return (Q9).
- « Rentabilité du mois » is the calendar month to date (Q26), so the reference home figures (October) are not reproduced.
- The farm `Marge` and the analytic `Marge du lot` are not expected to add up.
- A stock entry typed with reason Achat outside the purchase workflow never reaches finance.
- A commercial already sees a lot's purchase price and feed cost on the lot page (earlier slices); with sales he can approximate a lot's margin without finance access. Hide those two figures from roles without finance read?
- A health act typed afterwards with a date before an already-invoiced sale is not checked against that sale (withdrawal hole the other way round): refuse it, or raise an alert?
- Goods returned by a credit note re-enter stock at the cost observed on the credit note's date; a later correction of the original purchase price does not re-value them.
- Consequences of the sales grants: the Comptable can issue a draft but not edit or delete it; the Commercial cannot cancel his own issued invoice; the Propriétaire can make a credit note but not record the refund.

## Rulings made during slice 4 (the owner may revisit; all confirmed by the owner — « garde tout » — up to the final wave, whose rulings were reported to the owner)
- Ruling Q1: issue and client payments = ventes:update; COMMERCIAL read,create,update,delete; COMPTABLE read,update,validate.
- Ruling Q2: credit notes and cancelling an issued invoice = ventes:validate (COMPTABLE, PROPRIETAIRE, SUPER_ADMIN).
- Ruling Q3: any number of payments ≤ due; no advance payment on a quote or draft.
- Ruling Q4: credit notes partial by line quantity, optional return of goods, final (no edit/delete).
- Ruling Q5: credit beyond what is due → refundDue, REMBOURSEMENT payment, pill « À rembourser {n} ».
- Ruling Q6: cancelling an issued invoice only with no payment and no credit note; reverses every ledger effect or is refused whole.
- Ruling Q7: selling more than alive → 400 Effectif insuffisant. Q8: returning an individually tracked animal refused. Q9: return to a closed lot → 409.
- Ruling Q10: eggs = derived per-lot balance owned by `eggs` (marketable − sold), no new ledger. Q11: plateau of eggsPerTray (30) snapshotted. Q12: an egg line names a lot.
- Ruling Q13: withdrawal blocks the sale (400, inclusive), no override.
- Ruling Q14: manual VENTE herd events kept (no revenue).
- Ruling Q15: VENTE of stock refuses expired lots.
- Ruling Q16: no price lists. Q17: bon de livraison = print view; reçu RC-NNNN per payment. Q18: FA number at issue; DV/AV at creation.
- Ruling Q19: invoiceDueDays 15; créance alert A_VOIR when overdue and due > 0.
- Ruling Q20: Purchase.activity default Général. Q21: fixed category enum.
- Ruling Q22: manual finance entries = finance:create (COMPTABLE, SUPER_ADMIN); PROPRIETAIRE and DIRECTEUR read-only; an expense may be attributed to one lot.
- Ruling Q23: lot Prix d'achat = total for the lot, a dépense Animaux at entry date.
- Ruling Q24: Rentabilité par lot as the plan defines. Q25: finance:read suffices for lot margins.
- Ruling Q26: « Rentabilité du mois » = calendar month to date. Q27: null/hidden without finance:read. Q28: finance list shows manual and derived entries.
- Ruling Q29: supplier payments unchanged (achats:validate) — owner question still open.
- Ruling Q30: quote lines name their source, availability checked at issue.
- Ruling: health cost 26 727.28 (ledger's stored cent-rounded unit cost) is right; ONE rule for feed and health = per-operation rounding then sum, via a shared helper owned by the stock ledger.
- Ruling: master records use `update` for every verb in the UI too (customers delete = update).
- Ruling Q22: double entry is the user's).
- Ruling: the eggs that leave for incubation are those recorded as `toIncubation` on egg production records; an incubation's `eggsSet` is not deducted again (documented in the egg seam).
- Ruling: an egg sale or return on a closed lot is refused by the seam (409).
- Ruling: the withdrawal registry is mandatory at boot.
- Ruling (corrects the controller's hand-off): no cost snapshot on invoice lines; the ledger is the single truth for the cost of a sale's exits.
- Ruling: refunds (REMBOURSEMENT payments) need `ventes:update` like any payment (brief + frontend); the extra `validate` check added on the controller's dispatch is to be removed in the T5 fix round.
- Ruling: customer balance = Σ due (matches receivables and the alert); `refundDue` shown separately (« À rembourser »).
- Ruling: in the lot view, a manual entry attributed to a lot always counts under `autres`; `aliment`/`sante` are stock-ledger figures only.
- Ruling: `GET /api/settings/documents` (@AnyAuthenticated) exposes only the legal identity printed on documents + invoiceDueDays + eggsPerTray.
- Ruling: binding order extended — … lots ascending → animals ascending → buildings ascending → ONE stock call last; breeding takes the litter lot before the sow.
- Ruling: two LOT lines on one lot write one herd event; cancelling an invoice made from a quote restores the quote; a draft quote past its validity cannot be sent.
- Ruling: a return of goods is valued as a snapshot at the credit note's date (no replay-time re-valuation) — documented and pinned by a test.
- Ruling: withdrawal blocks a sale only when doneDate ≤ sale date ≤ withdrawalUntil.
- Ruling: only credit notes WITH return reduce a lot's sold quantity/kg; without return they reduce revenue only.

## Deferred minor findings (from task and final reviews)
- Deferred minors (final fix wave): money.ts throws RangeError on huge finite input (BigInt(Infinity)) — guard the scaled value; quantity `min: 0.01` with step 1 for whole kinds (row-dependent min 1); clients.test leaves a stub `ventes` module registered; LinesField prefill ref not reset when rows are swapped wholesale; 3-decimal inputs behaviour undocumented in money.ts.
- Task 1: complete. Deferred minors (final fix wave): feed amount conversions through toMoney; `operationCosts` typed with StockSourceType and filtering quantity < 0 BEFORE sales uses it (tell T4); quadratic grouping; redundant `!a.batchId`; stale screenshot achat_detail_375 (T10 re-captures).
- Task 8: complete. Deferred minors (final fix wave): `hint` ignored for textarea/checkbox/multiselect/segmented (document or support); NaN preview if creditableAmount missing; read-only role test duplicates one role; all-SERVICE delivery note shows an empty table.
- Task 2: complete. For T5 dispatch: check `creditable().quantity` before calling creditLineAmount (RangeError → must be a 400); a partial credit may be worth 0 (CHECK must allow 0 or refuse clearly). Deferred minors (final wave): laying rule defined three times (canLay, assertLays, incubations) → one; test comment 0.32/0.31.
- Task 9: complete. Deferred minors (final wave): stale list under the period-error banner (placeholderData); no test for a stored closed lot shown as Valeur actuelle; activityLabel falls back to the raw enum.
- Task 4: complete. Deferred minors (final wave): exitCostsByItem duplicates operationCosts' query/grouping (share); document that exitCostsByItem has no farm scope; createFromQuote skips the duplicate-animal check for old quotes; constraints test accepts either CHECK name.
- Task 3: complete (production code). Deferred to the final fix wave: race test try/finally + timeout; quadratic byItem grouping in sellableAt (push); weaned-litter floor only documented.
- Task 6: complete. Deferred minors (final fix wave): receivables scan every issued invoice per dashboard call (status filter or one SQL aggregate owned by sales); view guard spec must match `CREATE OR REPLACE VIEW` (or use pg_get_viewdef); document the view's dependencies on the models + migration convention; costPerKg null unless every LOT line is weighed; Object.hasOwn in categoryOf; closed lot accepted for attribution (state or refuse); filler assertions and wrong comment in finance.e2e; lots/detail query counts not asserted as absolutes; dashboard no-finance test spies only $queryRaw; DRY (PeriodQueryDto, zero()); duplicate index; refuse purchasePrice on hatched/farrowed lots.
- Task 5: complete. Deferred to the final fix wave: averageCost-after-return test where it matters; per-test timeout on the held-lock credit-note test; firstSoldLots tie-break via localeCompare; list include loads all lines; import placement in sale-view.ts; FA gate without organisation filter in the test.
- Deferred minors (carry-over): breeding `create` locks sow → boar not ascending; `withReturn` DTO doc lacks the snapshot ruling; `InvoicesService` class doc lock chain omits buildings; costPerKg stays null when the unweighed line was fully returned; a cancelled invoice loses its visible link to its quote; filler assertions in finance.e2e and the delegate spy in the dashboard no-finance test.
- Final wave, left as is: breeding `create` locks sow then boar, not in ascending order (a sale of both while a service between them is recorded could deadlock); `sellableAt` loads the whole history of each held article per picker call; the laying-lot pre-filter; `firstSoldLots` tie-break; `createFromQuote` skips the duplicate-animal check for quotes saved before the rule; invoice CSV has no Statut / Payé / Échéance column; no endpoint listing payments or receipts across invoices; the credit-note list has no date filter; « Retour client » herd events appear as ordinary entries in lot indicators; `sale-view.ts` and `invoices.service.ts` are large (split quote and invoice views); every slice-4 page is in the main bundle.

## Verified at the end of slice 4 (commit e0f7abc, run by the controller)
- Backend: type check and lint clean, 264 unit tests, 1 037 API tests on PostgreSQL (46 suites), build.
- Frontend: type check clean, 612 unit tests, build; 68 browser scenarios (auth, bâtiments, production, logistics, commerce, visual).
- Not verified: Docker images were never built (no daemon in the build environment); `scripts/dev.sh` was not run on a real Mac.
- Final wave, left as is: the customer detail also gets the five-tile layout when « À rembourser » shows (not captured); the `StatTiles` unit test does not pin 1, 2, 3, 6 and 7 tiles; tiles not measured at 1280 px; the visual spec restores the legal setting only on success; the `withReturn` DTO description does not state the snapshot ruling; the `InvoicesService` class doc's lock chain omits buildings; `costPerKg` stays empty when the unweighed line was fully returned; a cancelled invoice no longer shows which quote it came from; filler assertions in `finance.e2e` and the delegate spy in the dashboard no-finance test.
