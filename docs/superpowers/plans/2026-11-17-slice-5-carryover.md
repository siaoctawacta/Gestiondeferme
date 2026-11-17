# Slice 5 — carry-over (end of the five planned slices)

Slice 5 (personnel & tâches, équipements & maintenance, rapports, QR, alert masking, remaining exports, demo seed,
final documentation) closes the plan approved in `docs/superpowers/specs/2026-11-14-agripilot-design.md`. This file
lists what was decided on the owner's behalf, what stays open, and what was deliberately left out.

## Owner decisions still open

Money seen by roles without finance access (Resp. avicole, Resp. porcin, Vétérinaire, Resp. stock, Commercial,
Agent d'élevage, Magasinier). Hidden today: lot purchase price, lot feed cost, feed distribution costs, maintenance
costs, salaries, the finance sections of the dashboard and reports. Still visible, by module design or because no
ruling asked to hide it:

- Stock: average cost and value per article, unit costs of stock movements (list and export). A stock reader can
  therefore rebuild a lot's feed cost from the movements.
- Feed catalogue: unit cost of feed products and cost per kg of formulas (list and export).
- Purchases and supplier balances for Resp. stock and Magasinier (they run the purchases).
- Sales, payments, customer balances and the receivable amount in alerts for the Commercial (he runs the sales).
- A Resp. avicole / porcin can type a lot's purchase price when creating the lot (he then no longer sees it; an
  edit by him never changes it).

Decide whether stock values and catalogue prices should also be hidden from roles without finance access.

Other open points:

- Health act typed afterwards with a date before an already-invoiced sale: not checked (carried from slice 4).
- Agent d'élevage's Santé rights: unchanged since slice 3.
- A list CSV export uses the decimal comma (Excel in French); list money headers carry no unit, report headers do.
- The demo seed creates a super-administrateur among its 12 demo accounts: never load it on a reachable
  installation, or delete the accounts afterwards.

## Rulings made during slice 5 (the owner may revisit)

- Q1: supplier payments stay `achats:validate` (Directeur, Propriétaire); the Comptable does not pay suppliers.
- Q2–Q3: module `personnel`; employees need no user account; one optional linked user.
- Q4: create/edit/delete a task = `taches:create`; start/complete/reopen = `taches:update`, limited to one's own
  tasks without `create`.
- Q5, Q43: recurrence (daily, weekly, monthly); a monthly series keeps its original day (31 → 28 Feb → 31 Mar); the
  next occurrence drops a lot that closed or an equipment that was retired.
- Q6: one optional proof photo per task (JPEG/PNG/WebP, 5 Mo).
- Q8–Q9: salaries stay manual finance entries, prefilled from the payroll preview; salaries visible only with
  finance read.
- Q10: an intervention's cost is a derived finance expense (Entretien), never a lot cost; its activity follows the
  equipment's current building (a later move re-classifies past expenses between activities; totals are unchanged).
- Q12, Q45: « En panne » only through a declared breakdown, left only by a corrective intervention; retirement
  allowed with an open breakdown, refused with open tasks, dated after purchase and the last intervention/breakdown.
- Q16–Q20, Q46: seven reports gated per section by module read; money only with finance read; a report is refused
  only when no section is visible.
- Q21, Q49: « Masquer l'alerte » per user for `alertAckDays` (7) or until the level worsens; each new breakdown and
  each new due date of a task is a new alert.
- Q23: one identical « QR code inconnu ou inaccessible » for a missing, foreign or forbidden record.
- Q26–Q27: demo seed refused in production unless `ALLOW_DEMO_SEED=1`; its dates are relative to the day it runs
  (the reference's October figures are not reproduced); `demo:reset` needs `ALLOW_DEMO_RESET=1` and a local database.
- Q31: the finance entries list opens on all dates; Synthèse opens on the month to date.
- Q32, Q38, Q39: lot purchase price and feed costs hidden without finance read; such a role's edits never change them.
- Q40: deleting an equipment follows the master-data rule (`update`).
- Q41: the payroll preview under « toutes les fermes » answers 403.
- Q42, Q48: only open tasks block an employee's departure or hire date; reopening a task clears a responsible who
  is no longer in post at the due date and a retired equipment.
- Q44, Q47: « en retard à la fin de la période » for tasks and health acts = planned on or before the last day and
  not done by then; cancelled health acts are never counted (no cancellation date is stored).
- Q50: « Tâches & personnel » opens with tasks read or personnel read; each tab follows its own permission.
- Reports show each role only the species its screens show (health and feed figures).

## Known limits (documented, not planned)

- Docker images, `docker compose config`, backup/restore commands and `scripts/dev.sh` on a real Mac or Windows
  machine were never run: the build environment has no Docker daemon. Everything else in the README was executed.
- Past-period reports: lot performance columns are cumulative since entry (labelled so); « Créances clients » and
  stock levels are today's state (labelled so).
- An animal bought after a date but born before it counts in the headcount of that past date (no purchase date on
  the animal).
- Equipment: a breakdown date is not checked against earlier interventions; `statusCounts` on the Réformés tab
  count the equipment in service.
- A user's alert masks stored before the alert keys changed stop matching and simply expire.
- No offline mode, mobile app, AI or IoT (out of scope by the owner's first decision); no tax; no advance
  payments; no price lists; fixed manual finance categories.

## Small items left as they are

- « Remettre en service » confirms with the red button style; the tasks subtitle shows above the Employés tab for
  the Comptable; a QR path with a trailing slash is refused; focus after « Masquer l'alerte » in the masked view.
- `User.employee` relation name; Swagger text of the building overview; whitespace realignment in `schema.prisma`.
- Unit-test coverage gaps noted by reviews: PATCH/DELETE of employees, attendance, equipment and maintenance, the
  quotidien and annuel reports, and QR kinds animal/bâtiment/article are covered by backend tests but not by a
  browser journey.

## Verification at the end of slice 5

Controller run at 816029b (Linux, PostgreSQL 16 local):

- Backend: `tsc --noEmit` and eslint clean, unit 397 tests (51 suites), e2e 1338 tests (56 suites), build OK.
- Frontend: `tsc -b` clean, unit 790 tests (46 files), build OK.
- Browser (`npm run e2e`): 83 of 83.
- Demo seed: loaded on the development database and on a scratch database, second run refused as already loaded.
- Not verified: Docker, a real Mac or Windows machine, a hosted database.
