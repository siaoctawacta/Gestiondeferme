# AgriPilot Slice 5 — Personnel & tâches, équipements & maintenance, rapports, alertes, QR, démo, documentation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The last slice closes the cahier's web scope. A task is planned once, and from then on its overdue alert, the dashboard « Tâches à venir » and the agent's « Mes tâches » follow from it. An equipment record carries its maintenance: a breakdown raises an urgent alert and an intervention clears it. Reports are computed on the server by the same functions as the dashboard and finance, then exported to CSV or Excel and printed. Every lot, animal, building, article and equipment has a printable QR label that opens its page. A demo farm « Ferme Kpalimé » is loaded through the real write paths, and the README and an operator's guide close the delivery.

**Architecture:** Three new backend modules. **Personnel** (`personnel`) holds employees, attendance and a payroll preview. **Tasks** (`tasks`) has ONE pure action-based workflow file, `task-workflow.ts`, checked under the row lock, plus recurrence, a proof photo and its alert rule. **Equipment** (`equipment`) holds equipment, interventions and breakdowns; a pure `equipment-state.ts` computes the next maintenance (cached on the row like `FarmStockItem`), and alert rules and a derived finance row `MAINTENANCE` complete it. **Reports** (`reports`) owns no figure. It composes `FarmKpisService` (the production KPIs, extracted from `DashboardService`), `FinanceSummaryService`, `LotProfitabilityService`, `IndicatorsService.batchPerformanceMany`, `StockOverviewService` and period figures, each owned by its module (eggs, herd, breeding, feed, health, tasks, equipment). **QR** resolves `kind/id` to a page under the caller's permissions and draws the SVG with the `qrcode` package already used for 2FA. **Alert acknowledgements** are stored per user in `indicators`. The demo seed boots the Nest app in-process and replays the reference through HTTP with a minted token, so every write passes the guards, DTO validation, ledgers and audit. The frontend screens are `ModuleConfig`s on the existing kit (`taches` with tabs Tâches | Employés | Présences, `equipements` with tabs Équipements | Interventions | Réformés), plus detail pages Équipement and Bâtiment, a Reports page on `/reports/:type`, a QR dialog, a label sheet, `/q/:kind/:id` and `/scan`.

**Tech Stack:** unchanged (NestJS 11, Prisma 7 pinned, PostgreSQL; React 19, Vite, Tailwind 4, TanStack Query). No new dependency: QR images use `qrcode` (backend, already present); uploads use multer from `@nestjs/platform-express`; scanning uses the browser's `BarcodeDetector` when present.

**Spec:** `docs/superpowers/specs/2026-11-14-agripilot-design.md`. Relevant sections: Opérations data model (employee, attendance, task — responsable, date, heure, priorité, statut, preuve photo; equipment; maintenance — préventive/corrective, cost, supplier, next date); Alerts (maintenance due / panne, tâche en retard, acknowledgement); API (`/employees`, `/attendance`, `/tasks`, `/equipment`, `/maintenance`, `/reports/:type`, `/qr/:kind/:id`); Frontend (Reports: quotidien, hebdomadaire, mensuel, annuel, sanitaire, zootechnique; CSV and Excel from the API; PDF through print layouts; QR and the camera scan page; présences and employés under Tâches; maintenance under Équipements); Roles; KPI formulas; Tenancy (employees, tasks and equipment per farm); Edit and delete; Delivery slice 5. Reference UI: `docs/reference/screens/m_taches.png`, `m_equipements.png`, `alertes.png`, `rapports.png`, `home.png` (Tâches terminées / En attente / Nouvelle tâche, Tâches à venir), `audit.png`, and `docs/reference/screens-text.txt` (sections `m_taches`, `m_equipements`, `alertes`, `rapports`, `home`, `audit`). Carry-over: `docs/superpowers/plans/2026-11-16-slice-4-carryover.md` and the slice 1–3 carry-over files. Placeholders still showing « Module en cours de construction » (`frontend/src/pages/ComingSoon.tsx` through `ModuleRoute`, since `frontend/src/modules/index.ts` registers no config for them): `taches` and `equipements`. No other sidebar entry is a placeholder.

## Global Constraints

- All Global Constraints of the slice 1–4 plans still apply:
  - French UI and messages; `/api`; strict DTOs.
  - `farmId` plus indexes on farm-owned tables.
  - `X-Farm-Id`, with `all` read-only.
  - Every route carries exactly one of `@Public` / `@RequirePermission` / `@AnyAuthenticated` (Task 1 adds `@RequireAnyPermission`, which counts as the second).
  - Audit in the transaction, none on a no-op.
  - Calendar dates as `YYYY-MM-DD`; no future-dated operations. A task's due date and a next maintenance date are plans and may be in the future; a completion, an attendance, a breakdown and an intervention may not.
  - Decimals in the DB, numbers in the API, `toMoney` at the edge, money through `common/money.ts`.
  - Body ids answer 400, path ids 404.
  - Lists have pagination, sort, export and `statusCounts`.
  - Frontend queries go through `useFarmQuery`; screens are `ModuleConfig`s; ONE form engine; every figure comes from the API (no browser-side aggregation, no browser-built CSV); permissions go through config and `canRunAction`; formatting goes through `lib/format.ts` / `lib/money.ts`.
- Permission rules, expressed only with the existing decorators plus the alias of Task 1. Master records use `@RequireMaster` (`update`), daily entries use `@RequireDaily` (`create`), and workflow steps use `@RequirePermission(module, action)`. Module keys of this slice:
  - `personnel` (NEW key: employees and attendance, shown as tabs of « Tâches & personnel »);
  - `taches`;
  - `equipements`;
  - `rapports`;
  - `alertes`.
- Grants (`backend/src/access/permissions.ts`, pre-flight Q2, Q4, Q11; the other rows are unchanged):

  | Role | `personnel` | `taches` | `equipements` | `rapports` |
  |---|---|---|---|---|
  | SUPER_ADMIN | V | V | V | V |
  | PROPRIETAIRE | R | R | R | V (unchanged) |
  | DIRECTEUR_FERME | V | V (unchanged) | V (unchanged) | R |
  | RESP_AVICOLE, RESP_PORCIN | `read, create` | W (unchanged) | `read, create` | R |
  | VETERINAIRE | — | `read, update` | — | R |
  | RESP_STOCK | — | `read, update` | — | R |
  | COMPTABLE | R | — | — | R |
  | COMMERCIAL | — | — | — | R |
  | AGENT_ELEVAGE | — | `read, update` (unchanged) | `read, create` | — |
  | MAGASINIER | — | `read, update` | — | — |
  | AUDITEUR | R | R | R | R |

  `taches:update` without `taches:create` means « advance the tasks assigned to me » (Task 3). The five roles that read reports without `finance:read` are RESP_AVICOLE, RESP_PORCIN, VETERINAIRE, RESP_STOCK and COMMERCIAL: no money in their reports, exports or prints.
- Lock order is unchanged and binding: document or record row (`lockRow`, scoped to `ctx.farmIds`) → its status through the module's pure workflow file → counter → lots ascending → animals ascending → buildings ascending → ONE stock call last; breeding takes the litter lot before the sow. The new rows lock first and alone: `Task`, `Equipment` (then its `Maintenance` / `Breakdown` row), `Employee` (then `Attendance`). No slice-5 write touches a ledger.
- **Reports re-aggregate nothing.** Every figure in a report is the return value of a function that already serves a screen (dashboard, finance, lot profitability, stock list, health list, tasks, equipment), or of ONE new period function owned by the module of the data. The dashboard is rewired onto the same period functions, so it calls them too. A report test compares each figure with the screen endpoint that shows it.
- Money visibility: a figure in FCFA (finance blocks, salaries, maintenance costs) is `null` or omitted for a role without `finance:read`, in JSON, CSV, XLSX and print alike. It is never shown as 0.
- Alerts are a pure rule plus a batched loader with a fixed query count (one query per rule, whatever the number of rows), `modules` set, a stable `key`, and ` — {ferme}` appended under `all` with several farms.
- New settings (`backend/src/admin/settings/settings.service.ts`, and the Settings screen):
  - `alertAckDays` 7 (`Masquage des alertes (jours)`), a positive integer, at most 90;
  - `maintenanceWarningDays` 0 (`Préavis de maintenance (jours)`), a new `nonNegativeInteger` parser, at most 90.
- New environment variables:
  - `APP_URL`: the public address encoded in QR codes; default the first origin of `WEB_ORIGIN`.
  - `UPLOAD_DIR`: default `uploads` under the backend's working directory; `/app/uploads` in Docker (the existing `api-uploads` volume).
  - `DEMO_PASSWORD` (demo users, at least 10 characters) and `ALLOW_DEMO_SEED`: read by the demo seed only.
- DB tests: one DB-test agent at a time (the `agripilot_test` database is shared). TDD with a behavioural RED: each test is seen failing for the behaviour, not for a missing import.

## Review Focus

1. **Reports re-aggregating instead of reusing single definitions.** Every report figure must equal the screen that shows it: `synthese` equals `GET /dashboard` field for field; the period finance block equals `GET /finance/summary` for the same period; zootechnique rows equal `GET /batches/:id` performance and `GET /finance/lots`; the dashboard itself is moved onto `EggProductionService.periodFigures` and `FeedService.periodFigures`, never left with a private copy. No `SUM(...)` over operational tables inside `backend/src/reports/`. (Tasks 1, 5.)
2. **Money visibility by role in reports and exports.** The five rapports readers without `finance:read` get no `Chiffre d'affaires`, `Dépenses`, `Marge`, `Créances`, salary or maintenance cost: not in JSON, not in CSV/XLSX columns, not in print. A salary or cost column is absent, not empty. Sections are gated by the module's read permission (`lots`, `porcs`, `sante`, `stocks`, `alimentation`, `taches`, `equipements`), and a report whose every section is gated is a 403. (Tasks 2, 4, 5, 11.)
3. **The seed bypassing ledgers.** The demo seed writes through HTTP routes only. The exceptions are explicit and limited to tables that are not ledgers: the `DocumentCounter` moves (no API sets a counter, as in the e2e seed) and the demo marker. Every headcount, stock level, egg balance, invoice status and finance figure after the seed equals what the screens compute; re-running is a no-op; a failed run is refused, never half-repeated. (Task 7.)
4. **Alert query counts and visibility.** The task and equipment rules run one query each, whatever the number of tasks or equipment (asserted with `test/query-counter.ts`). `Tâche en retard` needs `taches:read` and the equipment alerts need `equipements:read`. Acknowledgement adds exactly one query, hides an alert only for its user, never hides a worsened alert, and never changes the count a report gives. (Tasks 3, 4, 6.)
5. **QR links leaking data or bypassing permissions.** A QR encodes only `{APP_URL}/q/{kind}/{id}` (no code, no name, no token). The resolve and label routes answer the same 404 `QR code inconnu ou inaccessible` for a missing record, another organisation, an unassigned farm and a role without the module's read. The label sheet and the dialog are built only from the API's answer. Following a QR switches the active farm only to a farm the user is assigned to. (Tasks 6, 8.)

---

## File Structure

```
backend/src/
  access/       # (modify) permissions.ts (personnel key + grants), decorators.ts (RequireAnyPermission), access.guard.ts
  sales/        # (modify) receivables.ts (SQL aggregate), payments journal, split sale-view.ts → quote-view.ts / invoice-view.ts
  breeding/     # (modify) breeding.service.ts (sow/boar locked in ascending order)
  indicators/   # (modify) alerts-registry.ts (ranks), indicators.service.ts (batchPerformanceMany); alerts/alert-acks.service.ts
  personnel/    # Employee, Attendance, payroll preview
  tasks/        # Task: task-workflow.ts, task-alerts.ts, task-reads.service.ts, proof storage
  equipment/    # Equipment, Maintenance, Breakdown: equipment-state.ts, equipment-alerts.ts
  finance/      # (modify) FinanceLedgerView + origin MAINTENANCE
  dashboard/    # (modify) farm-kpis.service.ts extracted; tasks and upcomingTasks wired
  reports/      # report-periods.ts, report-sections.ts, report-export.ts, reports.service.ts, reports.controller.ts
  qr/           # qr.controller.ts, qr.service.ts, qr-targets.ts
  common/       # (modify) uploads.ts
prisma/demo/    # seed-demo.ts, demo-client.ts, demo-*.ts
frontend/src/
  components/module/  # (modify) qr kind, QrDialog, QrLabelSheet, readOnly reason
  modules/{taches,tachesShared,personnel,equipements,equipementsShared}.tsx
  pages/{Reports,Alerts,QrResolve,ScanQr}.tsx, pages/reports/*, pages/details/{EquipmentDetail,BuildingDetail}.tsx
  e2e/operations.spec.ts, e2e/operationsData.ts
docs/guide-utilisateur.md, README.md
```

---

### Task 1: Carry-over prerequisites (backend)

**Files:**
- Modify: `backend/src/access/{decorators.ts,access.guard.ts,permissions.ts}`, `backend/src/purchases/purchases.controller.ts`, `backend/src/sales/{receivables.ts,sales.module.ts,invoices.controller.ts,credit-notes.controller.ts,dto/*.ts}`, `backend/src/finance/finance-summary.service.ts`, `backend/src/dashboard/dashboard.service.ts`, `backend/src/breeding/breeding.service.ts`, `backend/src/indicators/alerts/{alert.types.ts,alerts-registry.ts,production-alerts.service.ts,stock-alerts.service.ts,health-alerts.service.ts}`, `backend/src/sales/receivable-alerts.service.ts`, `backend/src/feed/feed-distributions.controller.ts`
- Create: `backend/src/sales/{payments-journal.controller.ts,payments-journal.ts,quote-view.ts,invoice-view.ts}` (`sale-view.ts` keeps only the shared line view)
- Test: `backend/src/access/permissions.spec.ts`, `backend/src/indicators/alerts/alerts-registry.spec.ts`, `backend/test/{route-permissions.e2e-spec.ts,purchases.e2e-spec.ts,sales-payments.e2e-spec.ts,finance.e2e-spec.ts,lock-order.int-spec.ts,feed.e2e-spec.ts}`

**Schema:** none.

**Interfaces:**
- `RequireAnyPermission(...pairs: [ModuleKey, Action][])`: `PERMISSION_KEY` holds an array of pairs, and the guard passes when ANY pair is granted (the farm checks are unchanged). The route-permission walk reads arrays. A single pair stays `RequirePermission`.
- Supplier payments (pre-flight Q1): `POST /api/purchases/:id/payments` and `DELETE /api/purchases/:id/payments/:paymentId` → `@RequireAnyPermission(['achats','validate'], ['finance','create'])`. COMPTABLE thus records supplier payments; the purchase workflow (validate, order, cancel) stays `achats:validate`. Frontend in Task 8 (`Payer` gated by `can('achats','validate') || can('finance','create')`).
- `receivables.ts`: `receivablesTotal(client, farmIds, opts?: { statuses?; dueBefore? }): Promise<Decimal>` is ONE `$queryRaw`: `SUM(GREATEST(0, total − credited − paid + refunded))` over the invoices, with credited / paid / refunded as correlated sums. It is the aggregate owned by sales. `FinanceSummaryService.summary` and the dashboard use it. `receivablesOf` stays for the per-invoice readers (customer balance, créance alert).
- Payments journal (needed by the reports and by the deferred « no endpoint listing payments »): `GET /api/sales/payments?from=&to=&kind=&method=&customerId=&search=` (`ventes:read`, registered before `GET /sales/:id`).
  - Returns `Page<{ id, number, date, kind, method, amount, reference, invoiceId, invoiceNumber, customerId, customerName }>` plus `totals { received, refunded, net }`.
  - Sortable `date`, `number`, `amount`; default `date:desc`.
  - Export header: `Date;N° reçu;Type;Mode;Facture;Client;Montant`.
- Invoice export gains `Statut;Payé;Échéance` (header `Date;N° facture;Client;Produit;Quantité;Total;Payé;Reste dû;Échéance;Statut`). `GET /api/credit-notes` gains `from` / `to`.
- `sale-view.ts` split: quote rows and detail → `quote-view.ts`; invoice rows, detail and columns → `invoice-view.ts`. No behaviour change, and the existing tests stay green unchanged.
- Breeding `create`: sow and boar locked through `lockRow` in ascending id order (the sow is no longer always first). Litter before sow is kept for the record paths.
- Alert ranks:
  - `AlertsRegistry.register(rule, rank: AlertRank)` with `ALERT_RANK = { STOCK: 10, PRODUCTION: 20, HEALTH: 30, TASKS: 40, EQUIPMENT: 50, SALES: 60 }` in `alert.types.ts`.
  - `run` orders by level (URGENT first), then rank, then the rule's own order; the order no longer depends on module initialisation.
  - The existing registrations get their ranks (the stock alerts now come before mortality, as on `alertes.png`; pre-flight Q22).
- `GET /api/feed-distributions?sort=cost` → 400 `Tri invalide` (`cost` leaves the sortable list: it sorted by the stored cost, not the ledger cost shown; pre-flight Q35).
- Lot money (pre-flight Q32): `GET /api/batches`, `GET /api/batches/:id` and the herd list return `purchasePrice: null` and performance `feedCost: null` to a role without `finance:read` (writes unchanged: a master writer may still send a purchase price). Test: COMMERCIAL reads LC-2026-14 → both null; COMPTABLE through `/finance/lots` unchanged; DIRECTEUR → values.

- [ ] **Step 1: Write failing tests:**
  - Permissions:
    - `can('COMPTABLE','finance','create')` true and a COMPTABLE supplier payment of 300 000 on a received BC → 201; DELETE → 200.
    - COMMERCIAL supplier payment → 403.
    - The route walk accepts an array permission and fails on a route with an empty array.
  - Receivables: the slice-4 fixture (FA-0309 1 000 000 paid 600 000, FA-0310 paid then credited 105 000 with `refundDue`) → `receivablesTotal` = 400 000 = Σ `receivablesOf(...).due`. Summary `receivables` 400 000 with the query count of `summary` one lower than before.
  - Journal: FA-0309 `RC-0001` 600 000 `ESPECES` and the FA-0310 refund 105 000 `MOBILE_MONEY` → `totals { received: 1 650 000, refunded: 105 000, net: 1 545 000 }` over the fixture's payments; `kind=REMBOURSEMENT` filters; CSV header exact; COMPTABLE 200, MAGASINIER 403; another farm's payment never listed.
  - Invoice CSV header exact.
  - Credit notes `from=2026-10-22` excludes the earlier ones.
  - Lock order: a sale issuing TR-027 and VR-002 racing `POST /breeding` of the same pair 20 times → no deadlock, no 500.
  - Ranks: rules registered SALES, STOCK, PRODUCTION come back STOCK, PRODUCTION, SALES within A_VOIR, and URGENT before all.
  - `sort=cost` → 400.
- [ ] **Step 2:** Run: FAIL. **Step 3:** Implement. **Step 4:** Run all backend suites: PASS.
- [ ] **Step 5:** Commit `feat(backend): slice 4 carry-over — permission alias, receivables aggregate, payments journal, ascending breeding locks, alert ranks`.

### Task 2: Personnel — employees, attendance, payroll preview (backend)

**Files:**
- Create: `backend/src/personnel/{personnel.module.ts,employees.controller.ts,employees.service.ts,attendance.controller.ts,attendance.service.ts,employee-rules.ts,employee-view.ts,dto/*.ts}`; migration `…_slice5_personnel`
- Modify: `backend/src/access/permissions.ts` (key `personnel`, the grants table above for `personnel`, `taches`, `equipements`), `backend/prisma/schema.prisma`, `backend/src/app.module.ts`, `frontend/src/lib/modules.ts` (the `ModuleKey` union gains `personnel`)
- Test: `backend/src/personnel/employee-rules.spec.ts`, `backend/src/access/permissions.spec.ts`, `backend/test/personnel.e2e-spec.ts`, `backend/test/route-permissions.e2e-spec.ts`

**Schema:**
- `enum ContractType { CDI CDD JOURNALIER STAGE }` with labels `CDI`, `CDD`, `Journalier`, `Stage`.
- `Employee(id, farmId, name String (as shown: « Kodjo A. »), fullName String?, jobTitle String, phone String?, contractType, hireDate DATE, endDate DATE?, monthlySalary Decimal(12,2)?, userId String?, note String?, createdAt, updatedAt)`:
  - unique `(farmId, name)` and `(farmId, userId)` (NULLs distinct);
  - CHECK `monthlySalary >= 0`, CHECK `"endDate" IS NULL OR "endDate" >= "hireDate"`;
  - indexes `farmId`, `userId`.
- `enum AttendanceStatus { PRESENT ABSENT CONGE MALADIE }`; `Attendance(id, farmId, employeeId, date DATE, status, hours Decimal(4,2)?, note String?, createdById)`:
  - unique `(employeeId, date)`;
  - CHECK `hours IS NULL OR (hours > 0 AND hours <= 24)`;
  - CHECK `hours IS NULL OR status = 'PRESENT'`;
  - index `(farmId, date)`.

**Interfaces:**
- `employee-rules.ts` (pure):
  - `isActiveOn(e: { hireDate; endDate }, day): boolean`, inclusive on both ends.
  - `employmentStatus(e, today): 'ACTIF' | 'PARTI'` (`PARTI` when `endDate < today`), labels `Actif` / `Parti`.
  - `monthBounds('YYYY-MM') → { from, to }`.
  - `payrollOf(employees, month) → { lines: { employeeId, name, jobTitle, monthlySalary: Decimal }[], total: Decimal }`: every employee with a salary who is active at least one day of the month; no proration (pre-flight Q8); total through `sumAmounts`.
  - `payrollLabel(month)` → `Salaires octobre 2026`.
- Module `personnel`:
  - `GET /api/employees?status=ACTIF|PARTI&search=` (read) → `Page<{ id, name, fullName, jobTitle, phone, contractType, hireDate, endDate, status, userId, userName, monthlySalary: number | null }>` plus `statusCounts`.
    - `monthlySalary` is `null` without `finance:read`.
    - Default sort `name:asc`; sortable `name`, `hireDate`.
    - Export `Nom;Nom complet;Poste;Contrat;Téléphone;Embauche;Départ;Statut`, plus `Salaire mensuel` only with `finance:read`.
  - `GET /api/employees/:id` (+ `attendanceLast30: { PRESENT, ABSENT, CONGE, MALADIE }`, `openTasks`).
  - Master (`@RequireMaster('personnel')`): `POST`, `PATCH`, `DELETE /api/employees`.
    - Duplicate name → 409 `Un employé porte déjà ce nom dans cette ferme`.
    - `userId` not a user of the organisation assigned to the farm → 400 `Utilisateur invalide pour cette ferme`.
    - A user already linked in the farm → 409 `Cet utilisateur est déjà lié à un employé de cette ferme`.
    - Delete of an employee with tasks or attendance → 409 `Cet employé a un historique : indiquez sa date de départ`.
    - `endDate` before an attendance or a task completion of his → 409 `Des présences ou des tâches sont enregistrées après cette date`.
  - `GET /api/employees/user-options` (`personnel:update`) → `{ items: { id, name, email, role }[] }`: active users assigned to the farm and not linked yet (the Directeur has no `utilisateurs` read).
  - `GET /api/employees/options?at=YYYY-MM-DD` (`@RequireAnyPermission(['taches','read'], ['personnel','read'])`) → `{ items: { id, name, jobTitle, userId }[] }` of the employees active at `at` (default today). No salary.
  - Attendance:
    - `GET /api/attendance?from=&to=&employeeId=&status=&search=` (read) → `Page<{ id, date, employeeId, employeeName, status, hours, note }>` plus `statusCounts`; default `date:desc, employeeName:asc`; export `Date;Employé;Statut;Heures;Note`.
    - Daily (`@RequireDaily('personnel')`): `POST /api/attendance`, `PATCH /api/attendance/:id` and `DELETE /api/attendance/:id`.
    - `POST /api/attendance/day { date, entries: [{ employeeId, status, hours?, note? }] }` sets the day sheet of the listed employees in one transaction (insert or update by `(employeeId, date)`); it returns the rows, and the audit has one row per changed entry.
    - Rules: future date → 400 (existing message); employee not of the farm → 400 `Employé invalide pour cette ferme`; inactive that day → 400 `{name} n'est pas en poste le {date}`; duplicate on `POST /attendance` → 409 `La présence de {name} le {date} est déjà saisie`; `hours` with a non-`PRESENT` status → 400 `Les heures ne s'indiquent que pour une présence`.
  - Payroll preview: `GET /api/employees/payroll?month=YYYY-MM` (`finance:create`) → `{ month, label, lines, total, existing: { id, amount } | null }`.
    - `existing` is the manual `FinanceEntry` of the farm with category `SALAIRES` and that exact `label`.
    - The route writes nothing; the Comptable posts the entry through `POST /finance/entries` (pre-flight Q8).
    - Under `all` → 400 `Sélectionnez une ferme`; a month after the current one → 400 `Le mois ne peut pas être dans le futur`.

- [ ] **Step 1: Write failing unit tests:**
  - `isActiveOn` on the hire day and on the end day → true; the day after the end → false.
  - Payroll for `2026-10` over these employees → total 475 000:
    - Kodjo A. (Agent d'élevage, CDI, 2025-01-06, 85 000);
    - Dr Koffi (Vétérinaire, CDD, 2026-01-01, 250 000);
    - Yawa M. (Ouvrière, Journalier, 2026-03-01, 60 000);
    - Ama K. (Agent d'élevage, CDI, 2024-06-01, 80 000).
  - With Yawa ending 2026-09-30 → 415 000 for October, 475 000 for September.
  - An employee hired 2026-10-31 counts in October.
  - `payrollLabel('2026-10')` = `Salaires octobre 2026`.
  - Grants: `can('RESP_AVICOLE','personnel','create')` true, `can('RESP_AVICOLE','personnel','update')` false, `can('AGENT_ELEVAGE','personnel','read')` false, `can('VETERINAIRE','taches','update')` true, `can('AGENT_ELEVAGE','equipements','create')` true.
- [ ] **Step 2: Write failing e2e tests:**
  - Writes:
    - The four reference employees created by DIRECTEUR → 201; Kodjo A. linked to the farm's AGENT_ELEVAGE user → 201; RESP_AVICOLE create → 403.
    - Duplicate name → 409; a user of farm B → 400; the same user twice → 409.
  - Reads:
    - COMPTABLE list → `monthlySalary` 85 000; RESP_AVICOLE list → `null`, and the CSV has no `Salaire mensuel` column; AGENT → 403.
  - Attendance:
    - RESP_AVICOLE `POST /attendance/day` for 2026-10-20 (Kodjo `PRESENT` 8, Yawa `ABSENT`) → 2 rows; the same sheet again → 200, no audit row; Kodjo `ABSENT` with hours → 400.
    - Yawa after her end date → 400 exact; tomorrow → 400.
  - Deletes and payroll:
    - Delete Kodjo → 409 exact.
    - Payroll by COMPTABLE → 475 000; after a manual entry `Salaires octobre 2026` 475 000, `existing` set.
    - DIRECTEUR payroll → 403; `all` → 400.
  - Isolation and walk: another farm's employee GET → 404; route walk.
- [ ] **Step 3:** Run: FAIL. **Step 4:** Implement. **Step 5:** Run all backend suites: PASS.
- [ ] **Step 6:** Commit `feat(backend): personnel — employees, attendance, payroll preview`.

### Task 3: Tâches — workflow, recurrence, proof photo, overdue alert, dashboard (backend)

**Files:**
- Create: `backend/src/tasks/{tasks.module.ts,tasks.controller.ts,tasks.service.ts,task-workflow.ts,task-view.ts,task-reads.service.ts,task-alerts.ts,task-alerts.service.ts,dto/*.ts}`, `backend/src/common/uploads.ts`; migration
- Modify: `backend/src/dashboard/{dashboard.service.ts,dashboard.module.ts}`, `backend/src/app.module.ts`, `backend/.env.example`, `docker-compose.yml` (`UPLOAD_DIR: /app/uploads`)
- Test: `backend/src/tasks/{task-workflow.spec.ts,task-alerts.spec.ts}`, `backend/test/tasks.e2e-spec.ts`, `backend/test/dashboard.e2e-spec.ts`

**Schema:**
- Enums:
  - `enum TaskStatus { A_FAIRE EN_COURS TERMINEE }`;
  - `enum TaskPriority { NORMALE HAUTE URGENTE }`;
  - `enum TaskRecurrence { AUCUNE QUOTIDIENNE HEBDOMADAIRE MENSUELLE }`.
- `Task(id, farmId, title, description?, assigneeId? → Employee, dueDate DATE, dueTime String?, priority DEFAULT NORMALE, status DEFAULT A_FAIRE, recurrence DEFAULT AUCUNE, batchId?, buildingId?, equipmentId? (FK added by Task 4's migration), startedAt?, completedDate DATE?, completedById?, proofPath?, proofMime?, previousTaskId? unique, createdById, createdAt, updatedAt)`:
  - CHECK `"dueTime" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'`;
  - CHECK at most one of `batchId`, `buildingId`, `equipmentId`;
  - CHECK (`status = 'TERMINEE'`) = (`"completedDate" IS NOT NULL`);
  - CHECK (`"proofPath" IS NULL`) = (`"proofMime" IS NULL`);
  - indexes `(farmId, status)`, `(farmId, dueDate)`, `assigneeId`.

**Interfaces:**
- `task-workflow.ts` (pure, the only place a task status is compared):
  - `TASK_ACTIONS = ['edit','delete','start','complete','reopen','proof']`.
  - Allowed from: edit, delete and proof → `A_FAIRE | EN_COURS` (proof also `TERMINEE`); start → `A_FAIRE`; complete → `A_FAIRE | EN_COURS`; reopen → `TERMINEE`.
  - `refusal(status, action): string | null` gives the exact 409:
    - edit: `Une tâche terminée ne peut plus être modifiée : rouvrez-la`;
    - delete: `Une tâche terminée ne peut pas être supprimée`;
    - start: `Seule une tâche à faire peut être démarrée`;
    - complete: `Cette tâche est déjà terminée`;
    - reopen: `Seule une tâche terminée peut être rouverte`.
  - `statusAfter(action)`.
  - `isOverdue({ status, dueDate }, today)`: open and `dueDate < today`.
  - `nextDueDate(dueDate, recurrence)`: `+1 d`, `+7 d`, or the same day of the next month clamped to its last day.
- Routes, module `taches`:
  - `GET /api/tasks?status=&assigneeId=&mine=&priority=&from=&to=&search=` (read) → `Page<TaskRow>` plus `statusCounts` (stored statuses).
    - `TaskRow = { id, title, description, assigneeId, assigneeName, dueDate, dueTime, priority, status, overdue, recurrence, target: { kind: 'LOT'|'BATIMENT'|'EQUIPEMENT', id, label } | null, completedDate, hasProof, mine }`.
    - `mine=true` means the assignee's `userId` is the caller.
    - Default sort `dueDate:asc, priority (URGENTE first), title:asc` (pre-flight Q36); sortable `dueDate`, `priority`, `title`.
    - Export `Tâche;Responsable;Échéance;Heure;Priorité;Statut;Cible;Récurrence`.
  - `GET /api/tasks/:id`.
  - Daily (`@RequireDaily('taches')`): `POST /api/tasks`, `PATCH /api/tasks/:id` and `DELETE /api/tasks/:id` (edit and delete through `refusal`).
    - Body-id checks: assignee of the farm (400 `Responsable invalide pour cette ferme`) and active on `dueDate` (400 `{name} n'est pas en poste à cette date`).
    - Lot open of the farm (400 `Lot invalide pour cette ferme`); building / equipment of the farm (400 `Bâtiment invalide pour cette ferme` / `Équipement invalide pour cette ferme`).
    - Two targets → 400 `Une tâche concerne au plus un lot, un bâtiment ou un équipement`.
  - Progress (`taches:update`): `POST /api/tasks/:id/start`, `POST /api/tasks/:id/complete { date? }` and `POST /api/tasks/:id/reopen`.
    - Under the task lock, `refusal` first.
    - A caller without `taches:create` must be the assignee's user → 403 `Vous ne pouvez faire avancer que les tâches qui vous sont assignées`.
    - `complete`: date default today, not future, not before `dueDate − 30 days` (400 `Date de réalisation invalide`). A recurring task creates the next occurrence (same title, description, assignee, priority, time, target, recurrence, `previousTaskId`, `dueDate = nextDueDate(dueDate)`) in the same transaction, unless its assignee has left (then created unassigned).
    - `reopen` deletes the generated next occurrence when it is still `A_FAIRE` with no proof, else 409 `L'occurrence suivante a déjà commencé : rouvrez-la ou modifiez-la`.
  - Proof photo (pre-flight Q6): `POST /api/tasks/:id/proof` multipart `file` (`taches:update`, same assignee rule).
    - JPEG / PNG / WebP of at most 5 Mo, checked by magic bytes; anything else → 400 `Photo invalide : JPEG, PNG ou WebP de 5 Mo au plus`.
    - Written by `common/uploads.ts` (`saveUpload(dir, buffer, ext)`, atomic rename, path inside `UPLOAD_DIR/tasks/{farmId}/`, never a client-supplied name) and replaces the previous file after commit.
    - `GET /api/tasks/:id/proof` (`taches:read`) streams it with its MIME type and `Cache-Control: private, no-store`; `DELETE /api/tasks/:id/proof` (`taches:update`).
- `TaskReads` (exported):
  - `counts(farmIds, today) → { done, pending }`: `pending` = `A_FAIRE + EN_COURS`; `done` = `TERMINEE` with `completedDate` within the last 30 days (pre-flight Q7).
  - `upcoming(farmIds, limit 5)`: open tasks by `dueDate`, URGENTE → HAUTE → NORMALE, title, as `UpcomingTaskDto` (`assignee` `—` without one).
  - `periodFigures(farmIds, from, to) → { completed, overdueAtEnd, created }` for the reports.
  - The dashboard's `tasks()` and `upcomingTasks()` stubs call them.
- Alert rule (rank `TASKS`), with `task-alerts.ts` pure and `TaskAlertsService` running ONE query.
  - It fires for an open task with `dueDate < today`: title `Tâche en retard`; detail `{title} ({assignee})`, or `{title}` without an assignee.
  - Level `A_VOIR` (the reference's yellow, whatever the priority); module and modules `['taches']`; key `task:{id}`.
  - Order: `dueDate`, title, id. A task due today raises nothing.

- [ ] **Step 1: Write failing unit tests:**
  - Workflow: every allowed (status, action) pair is true and every other false.
  - `nextDueDate`: `2026-10-23` HEBDOMADAIRE → `2026-10-30`; `2026-01-31` MENSUELLE → `2026-02-28`; `2026-12-31` QUOTIDIENNE → `2027-01-01`.
  - Rule with clock 2026-11-14 and tasks due 10-23, 10-24, 10-18 (one `EN_COURS`) plus one `TERMINEE` → three alerts in the order 10-18, 10-23, 10-24, details `Nettoyage Porcherie 2 (Yawa M.)`, `Pesée hebdomadaire LC-2026-14 (Kodjo A.)`, `Vaccination Gumboro LC-2026-15 (Dr Koffi)`; due 2026-11-14 → none.
- [ ] **Step 2: Write failing e2e tests:**
  - The reference tasks, by RESP_AVICOLE, give `statusCounts { A_FAIRE: 2, EN_COURS: 1, TERMINEE: 1 }`:
    - `Pesée hebdomadaire LC-2026-14`, Kodjo A., 2026-10-23, Normale, lot LC-2026-14, HEBDOMADAIRE;
    - `Vaccination Gumboro LC-2026-15`, Dr Koffi, 2026-10-24, Haute;
    - `Nettoyage Porcherie 2`, Yawa M., 2026-10-18, Urgente, building Porcherie 2, then started;
    - `Collecte des œufs`, Ama K., 2026-10-22, Normale, then completed.
  - Permissions:
    - AGENT (Kodjo's user) `POST /tasks` → 403; starts Pesée → 200 `EN_COURS`; starts Nettoyage → 403 exact; `mine=true` → only Pesée.
    - COMMERCIAL GET → 403 and no `Tâche en retard` in his `/alerts`.
  - Workflow:
    - Completing Pesée on 2026-11-14 → a new `A_FAIRE` task due 2026-10-30 with `previousTaskId`.
    - Reopening Pesée → the occurrence is deleted; completing again, starting the occurrence, then reopening → 409 exact.
    - PATCH a `TERMINEE` task → 409 exact.
    - Two targets → 400; an assignee of farm B → 400; `all` POST → 403; a due date next month → 201; completion tomorrow → 400.
  - Proof:
    - A 6 Mo JPEG → 400; a text file renamed `.png` → 400; a valid PNG → 201, `hasProof` true, and GET returns the bytes with `image/png`.
    - Another farm's proof → 404.
  - Dashboard: `tasks { done: 1, pending: 3 }`, and `upcomingTasks` = Nettoyage, Pesée, Vaccination with assignees and priorities.
  - Query count: the rule runs 1 query with 3 or with 60 tasks.
  - Audit rows: one per action, plus the generated occurrence.
- [ ] **Step 3:** Run: FAIL. **Step 4:** Implement. **Step 5:** Run all backend suites: PASS.
- [ ] **Step 6:** Commit `feat(backend): tasks — workflow, recurrence, proof photo, overdue alert, dashboard tasks`.

### Task 4: Équipements & maintenance (backend)

**Files:**
- Create: `backend/src/equipment/{equipment.module.ts,equipment.controller.ts,equipment.service.ts,maintenance.controller.ts,maintenance.service.ts,equipment-state.ts,equipment-view.ts,equipment-alerts.ts,equipment-alerts.service.ts,dto/*.ts}`; migration (tables, the `Task.equipmentId` FK, `CREATE OR REPLACE VIEW "FinanceLedgerView"` with the new branch)
- Modify: `backend/src/finance/{finance-rules.ts,finance-ledger.ts,finance-entry-view.ts}` (origin `MAINTENANCE`), the finance view guard spec, `backend/src/admin/settings/settings.service.ts` (`maintenanceWarningDays`, `nonNegativeInteger`), `backend/src/app.module.ts`
- Test: `backend/src/equipment/{equipment-state.spec.ts,equipment-alerts.spec.ts}`, `backend/test/equipment.e2e-spec.ts`, `backend/test/finance.e2e-spec.ts`

**Schema:**
- `enum EquipmentType { COUVEUSE BALANCE POMPE GROUPE_ELECTROGENE VENTILATEUR CHAUFFAGE ABREUVOIR MANGEOIRE VEHICULE AUTRE }`, with labels `Couveuse`, `Balance`, `Pompe`, `Groupe électrogène`, `Ventilateur`, `Chauffage`, `Abreuvoir`, `Mangeoire`, `Véhicule`, `Autre`.
- `enum EquipmentCondition { BON A_SURVEILLER EN_PANNE }`, with labels and tones `Bon` success, `À surveiller` warning, `En panne` danger.
- `Equipment(id, farmId, name, type, siteId?, buildingId?, brand?, serialNumber?, purchaseDate DATE?, maintenanceIntervalDays Int?, firstMaintenanceDate DATE?, nextMaintenanceDate DATE? (cache), condition DEFAULT BON, retiredAt DATE?, note?, createdAt, updatedAt)`:
  - unique `(farmId, name)`;
  - CHECK NOT (`siteId` and `buildingId` both set);
  - CHECK `maintenanceIntervalDays > 0`;
  - indexes `(farmId, condition)`, `(farmId, nextMaintenanceDate)`.
- `enum MaintenanceKind { PREVENTIVE CORRECTIVE }` with labels `Préventive`, `Corrective`.
- `Maintenance(id, farmId, equipmentId, kind, date DATE, description, performedBy String?, supplierId?, cost Decimal(14,2) DEFAULT 0, nextDate DATE?, createdById, createdAt)`; CHECK `cost >= 0`; CHECK `"nextDate" IS NULL OR "nextDate" > date`; index `(equipmentId, date)`.
- `Breakdown(id, farmId, equipmentId, date DATE, description, reportedById, repairId? unique → Maintenance, resolvedDate DATE?)`:
  - CHECK (`"repairId" IS NULL`) = (`"resolvedDate" IS NULL`);
  - partial unique index `(equipmentId) WHERE "resolvedDate" IS NULL` (one open breakdown).
- `FinanceLedgerView` gains origin `MAINTENANCE`: a `Maintenance` with `cost > 0` gives:
  - date, kind `DEPENSE`, category `ENTRETIEN`;
  - activity from the equipment's building type (`AVICOLE` → `AVICOLE`, `PORCIN` → `PORCIN`, otherwise `GENERAL`);
  - label `Maintenance {équipement} — {description}`, id `maintenance:{id}`, `batchId` null. It is never a lot cost (pre-flight Q10).

**Interfaces:**
- `equipment-state.ts` (pure):
  - `nextMaintenance(eq: { firstMaintenanceDate; maintenanceIntervalDays }, interventions: { date; nextDate; createdAt }[]): string | null` has three cases:
    1. The latest intervention (by date, then `createdAt`) with a `nextDate` → that date.
    2. The latest intervention without one, on an equipment with an interval → `date + interval`.
    3. No intervention → `firstMaintenanceDate`.
  - `maintenanceDue(next, today, warningDays)` = `next ≤ today + warningDays`.
  - `conditionGuard(from, to)`: `→ EN_PANNE` gives 400 `L'état « En panne » se déclare par une panne`; `EN_PANNE →` gives 409 `Un équipement en panne est remis en service par une intervention corrective`.
- The service recomputes `nextMaintenanceDate` from `nextMaintenance()` under the equipment lock on every intervention write. A test asserts the cache equals the recomputation after create, edit and delete.
- Routes, module `equipements`:
  - `GET /api/equipment?status=BON|A_SURVEILLER|EN_PANNE&type=&retired=false|true&search=` (read; `retired` default false).
    - Returns `Page<{ id, name, type, location, siteId, buildingId, condition, nextMaintenance, maintenanceDue, retiredAt, openBreakdown: { id, date, description } | null, hasHistory }>` plus `statusCounts` (of the equipment in service). `hasHistory` is true when an intervention, breakdown or task exists (it gates the delete icon).
    - `location` = building name ?? site name ?? null.
    - Sortable `name`, `nextMaintenance` (the cached column); default `name:asc`.
    - Export `Équipement;Type;Emplacement;Prochaine maintenance;État`.
  - `GET /api/equipment/:id` adds `brand, serialNumber, purchaseDate, maintenanceIntervalDays, firstMaintenanceDate, interventions, breakdowns, openTasks, maintenanceCost: number | null`. `maintenanceCost` is null without `finance:read`; it is the Σ of the equipment's rows of the finance view, read through `FinanceLedger`.
  - Master (`@RequireMaster('equipements')`):
    - `POST /api/equipment`, `PATCH /api/equipment/:id` (condition only between `BON` and `A_SURVEILLER`, via `conditionGuard`), `DELETE /api/equipment/:id`.
    - Delete with an intervention, breakdown or task → 409 `Cet équipement a un historique : réformez-le`.
    - Duplicate → 409 `Un équipement porte déjà ce nom dans cette ferme`; site and building together → 400 `Indiquez un site ou un bâtiment, pas les deux`; a site or building of another farm → 400.
    - `POST /api/equipment/:id/retire { date }` and `POST /api/equipment/:id/reinstate`. Any write on retired equipment → 409 `Équipement réformé`.
  - Daily (`@RequireDaily('equipements')`): `POST /api/equipment/:id/breakdowns { date, description }`.
    - Sets `EN_PANNE`; a second open one → 409 `Une panne est déjà déclarée pour cet équipement`.
    - Date not future, not before `purchaseDate`.
  - Interventions:
    - `GET /api/maintenance?equipmentId=&kind=&from=&to=&search=` (read) → `Page<{ id, date, equipmentId, equipmentName, kind, description, performedBy, supplierName, cost: number | null, nextDate, repairs: boolean }>`; export `Date;Équipement;Type;Description;Intervenant;Prochaine date`, plus `Coût` with `finance:read`.
    - Master (`@RequireMaster('equipements')`, pre-flight Q11): `POST`, `PATCH`, `DELETE /api/maintenance`.
    - Body `{ equipmentId, kind, date, description, performedBy?, supplierId?, cost?, nextDate?, repairsBreakdown?: boolean, conditionAfter?: 'BON' | 'A_SURVEILLER' }`.
    - Lock order: the equipment row, then the maintenance row, then the breakdown.
    - `repairsBreakdown`: CORRECTIVE only (400 `Seule une intervention corrective répare une panne`), on an open breakdown (409 `Aucune panne ouverte sur cet équipement`), dated ≥ the breakdown (400 `L'intervention précède la panne`). It resolves the breakdown and sets `conditionAfter ?? BON`.
    - Deleting a repairing intervention reopens its breakdown (`EN_PANNE`), refused when another breakdown is open (409 `Une autre panne est ouverte : supprimez-la d'abord`).
    - Bad body ids → 400 `Équipement invalide pour cette ferme` / `Fournisseur invalide`; future date → 400.
- Alert rule (rank `EQUIPMENT`), with `equipment-alerts.ts` pure and ONE query over equipment in service with `condition = 'EN_PANNE' OR nextMaintenanceDate <= today + warningDays`:
  - `Équipement en panne`: URGENT, detail `{name}`, key `breakdown:{equipmentId}`.
  - `Maintenance due`: A_VOIR, detail `{name}`, key `maintenance:{equipmentId}:{nextMaintenance}`. It is not raised for equipment `EN_PANNE`.
  - Modules `['equipements']`; order: breakdowns by name, then dues by date and name.

- [ ] **Step 1: Write failing unit tests:**
  - `nextMaintenance`:
    - first date 2026-10-30 and no intervention → `2026-10-30`;
    - an intervention 2026-11-10 with next 2027-02-10 → `2027-02-10`;
    - a later one 2026-12-01 without next, interval 90 → `2027-03-01`;
    - no interval and none → the first date.
  - `maintenanceDue('2026-11-15', 2026-11-14, 0)` false, with warning 1 true.
  - Rule (clock 2026-11-14), the reference equipment gives exactly `Équipement en panne` / `Ventilateur Poulailler B #3` URGENT, then `Maintenance due` / `Couveuse 1200 œufs` and `Maintenance due` / `Groupe électrogène 20 kVA`:
    - Groupe électrogène 20 kVA (Bon, next 2026-10-30);
    - Couveuse 1200 œufs (À surveiller, 2026-10-25);
    - Pompe forage (Bon, 2026-11-15);
    - Ventilateur Poulailler B #3 (En panne, 2026-10-20).
- [ ] **Step 2: Write failing e2e tests:**
  - Reference rows by DIRECTEUR give the list rows with `location` `Site Nord`, `Incubation`, `Site Sud`, `Poulailler B` and `statusCounts { BON: 2, A_SURVEILLER: 1, EN_PANNE: 1 }`:
    - Groupe électrogène 20 kVA: GROUPE_ELECTROGENE, site Site Nord, first 2026-10-30;
    - Couveuse 1200 œufs: COUVEUSE, site Incubation, 2026-10-25, PATCH `A_SURVEILLER`;
    - Pompe forage: POMPE, Site Sud, 2026-11-15;
    - Ventilateur Poulailler B #3: VENTILATEUR, building Poulailler B, 2026-10-20, breakdown by AGENT 2026-11-02 `Moteur grillé`.
  - Breakdown and condition rules:
    - A second breakdown → 409.
    - PATCH condition `EN_PANNE` → 400 exact; PATCH Ventilateur to `BON` → 409 exact.
    - AGENT intervention → 403; AGENT reads `cost: null`.
  - Interventions and finance:
    - A preventive on Groupe 2026-11-10 `Vidange`, cost 45 000, next 2027-02-10 → `nextMaintenance` 2027-02-10, `Maintenance due` gone.
    - `/finance/entries` lists `Maintenance Groupe électrogène 20 kVA — Vidange` Dépense Général Entretien 45 000, and the summary expenses grow by 45 000.
    - A 30 000 corrective `Remplacement moteur` repairing the Ventilateur breakdown → `BON`, `Équipement en panne` gone, row activity `Avicole` (Poulailler B).
    - Deleting that corrective → `EN_PANNE` again.
    - PATCH of `maintenance:{id}` in finance → 409 (the existing derived message).
    - The lot profitability of the lots in Poulailler B is unchanged.
  - Retire and delete:
    - Retire the Pompe → absent from the default list and from alerts, present with `retired=true`; PATCH on it → 409.
    - Delete Groupe → 409 exact.
  - Isolation and counts:
    - An equipment of farm B in a task or intervention body → 400; GET → 404.
    - The rule runs 1 query for 4 or 40 equipment; COMMERCIAL sees no equipment alert.
    - Route walk; audit rows.
- [ ] **Step 3:** Run: FAIL. **Step 4:** Implement. **Step 5:** Run all backend suites: PASS.
- [ ] **Step 6:** Commit `feat(backend): equipment, interventions and breakdowns, maintenance and breakdown alerts, maintenance expenses`.

### Task 5: Rapports — server reports from the single definitions (backend)

**Files:**
- Create: `backend/src/dashboard/farm-kpis.service.ts` (the body of `DashboardService.kpis`, `layingFigures`, `eggSeries`, `feedDistributedKg`, `waterConsumedL`, moved, not copied), `backend/src/reports/{reports.module.ts,reports.controller.ts,reports.service.ts,report-periods.ts,report-sections.ts,report-export.ts,dto/report-query.dto.ts}`, `backend/src/health/health-report.ts`
- Modify:
  - `backend/src/dashboard/{dashboard.service.ts,dashboard.module.ts}` (exports `FarmKpisService`);
  - `backend/src/eggs/egg-production.service.ts` (`periodFigures`);
  - `backend/src/feed/feed.service.ts` (`periodFigures`);
  - `backend/src/herd/herd-ledger.service.ts` (`eventTotals`);
  - `backend/src/pigs/herd-list.service.ts` (`totalPigs(farmIds, at?)`);
  - `backend/src/breeding/breeding.service.ts` (`periodFigures`);
  - `backend/src/indicators/indicators.service.ts` (`batchPerformanceMany`);
  - `backend/src/stock/stock-overview.service.ts` (`levelCounts`);
  - `backend/src/listing/export.ts` (exports `csvCell`, the decimal comma of pre-flight Q19);
  - `backend/src/app.module.ts`.
- Test: `backend/src/reports/{report-periods.spec.ts,report-export.spec.ts}`, `backend/src/listing/export.spec.ts`, `backend/test/reports.e2e-spec.ts`, `backend/test/dashboard.e2e-spec.ts`

**Interfaces:**
- Single-definition moves (each a refactor with the existing tests unchanged, then a caller):
  - `EggProductionService.periodFigures(farmIds, from, to) → { collected, broken, downgraded, toIncubation, marketable, henDays }`. The dashboard's latest-day laying figures become `periodFigures` of each farm's latest day, so `layingRate(collected, henDays)` is ONE computation.
  - `FeedService.periodFigures(farmIds, from, to) → { feedKg, waterL }`; the dashboard reads it for each farm's latest recorded day.
  - `HerdLedgerService.eventTotals(batchIds, from, to) → Map<batchId, Record<BatchEventType, number>>`; `liveCounts(ids, at)` is unchanged.
  - `HerdListService.totalPigs(farmIds, at?)`: live animals at `at` (birth ≤ at < exit) + pig lots alive at `at`.
  - `BreedingService.periodFigures(farmIds, from, to) → { services, farrowings, bornAlive, stillborn, weaned }`.
  - `IndicatorsService.batchPerformanceMany(ctx, batchIds) → Map<batchId, BatchPerformance>` runs a fixed number of queries; `batchPerformance(ctx, id)` becomes `batchPerformanceMany(ctx, [id]).get(id)`.
  - `StockOverviewService.levelCounts(ctx) → { faible, critique }` uses the same level function as the list.
  - `HealthReport` (health module, exported): `periodFigures(farmIds, from, to) → { done: Record<HealthActType, number>, overdueAtEnd, openQuarantines, incidents, biosecurityLogs }` (`overdueActWhere` reused) and `withdrawalsAt(farmIds, day) → { target, until }[]`.
- `report-periods.ts` (pure):
  - `REPORT_TYPES = ['synthese','quotidien','hebdomadaire','mensuel','annuel','sanitaire','zootechnique']`.
  - `reportPeriod(type, q: { date?; from?; to? }, today) → { from, to }` per type:
    - `quotidien`: `[date, date]`;
    - `hebdomadaire`: ISO week, Monday to Sunday, containing `date`;
    - `mensuel`: the calendar month;
    - `annuel`: the calendar year;
    - `sanitaire` / `zootechnique`: `from` / `to`, default the month to date;
    - `synthese`: the month to date (the dashboard's).
  - `to` is clipped to today. Errors: future `date` → 400 `La date ne peut pas être dans le futur`; `from > to` → 400 `La date de début est après la date de fin` (`PERIOD_ORDER`); more than 366 days → 400 `La période ne peut pas dépasser 366 jours`.
  - `reportTitle(type, period)`:
    - `Synthèse au 14/11/2026`;
    - `Rapport quotidien du 22/10/2026`;
    - `Rapport hebdomadaire du 19/10/2026 au 25/10/2026`;
    - `Rapport mensuel — octobre 2026`;
    - `Rapport annuel 2026`;
    - `Rapport sanitaire du 01/10/2026 au 31/10/2026`;
    - `Rapport zootechnique du 01/10/2026 au 31/10/2026`.
- `ReportDto = { type, title, from, to, generatedAt, farmName, sections: ReportSection[] }`.
  - `ReportSection = { key, title, rows?: { key, label, value: number | null, unit: '' | '%' | 'kg' | 'L' | 'FCFA' | 'j' | 'g' }[], cards?: { activity, revenue, expenses, margin }[], table?: { columns: { key, header, unit? }[], rows: Record<string, string | number | null>[] } }`.
  - `farmName` is `Toutes les fermes` under `all`.
- Sections (`report-sections.ts`). Each is built only from the functions above, plus `FinanceSummaryService.summary`, `LotProfitabilityService`, `TaskReads.periodFigures`, the equipment counts and the payments journal totals. Each declares the permission that shows it:
  - `synthese` = the reference, in this order. Section `indicateurs`, every rapports reader:
    - `Volailles vivantes`, `Porcs (cheptel)`, `Taux de mortalité (lots en cours)` %, `Œufs produits (dernier jour)`, `Taux de ponte` %, `Aliment distribué` kg, `Eau consommée` L;
    - then, with `finance:read` only, `Chiffre d'affaires`, `Dépenses`, `Marge indicative`, `Créances clients` FCFA;
    - then `Alertes ouvertes` (the count of open alerts of the role, acknowledgements ignored; pre-flight Q21).
    - Section `activites` (`finance:read`): the three cards `Activité Avicole` / `Activité Porcin` / `Activité Général`.
    - It reads `FarmKpisService` and the dashboard's summary call: it equals `/dashboard`.
  - `quotidien` | `hebdomadaire` | `mensuel` | `annuel` sections, each with its gate:
    - `Production avicole` (`lots:read`): `Lots en cours (au {to})`, `Volailles vivantes (au {to})`, `Entrées`, `Morts`, `Ventes`, `Réformes`, `Œufs collectés`, `Œufs commercialisables`, `Taux de ponte moyen` %.
    - `Production porcine` (`porcs:read`): `Porcs (au {to})`, `Morts`, `Ventes`, `Saillies`, `Mises bas`, `Nés vivants`, `Mort-nés`, `Sevrés`.
    - `Alimentation & eau` (`alimentation:read`): `Aliment distribué` kg, `Eau consommée` L.
    - `Santé` (`sante:read`): `Vaccinations réalisées`, `Traitements réalisés`, `Désinfections réalisées`, `Actes en retard (au {to})`, `Quarantaines en cours`, `Incidents`, `Contrôles de biosécurité`.
    - `Stocks` (`stocks:read`): `Articles en stock faible`, `Articles en stock critique` (current state, labelled `(aujourd'hui)`).
    - `Tâches` (`taches:read`): `Tâches terminées`, `Tâches créées`, `Tâches en retard (au {to})`.
    - `Équipements` (`equipements:read`): `Pannes déclarées`, `Interventions`, `Équipements en panne (aujourd'hui)`.
    - `Finance` (`finance:read`): `Chiffre d'affaires`, `Dépenses`, `Marge`, `Taux de marge` % (from `summary(from, to)`), `Créances clients`, `Encaissements`, `Remboursements` (payments journal totals); the cards by activity; a table `CATÉGORIE, TYPE, MONTANT` from `byCategory`.
  - `sanitaire` (needs `sante:read`, else 403):
    - the `Santé` section;
    - a table `Délais d'attente en cours` (`LOT / ANIMAL, JUSQU'AU`) from `withdrawalsAt(to)`;
    - a table `Mortalité par lot` (`LOT, TYPE, MORTS (PÉRIODE), TAUX DE MORTALITÉ`), its rows filtered by species read (`lots` / `porcs`); `mortalityRate` is the lot list's.
  - `zootechnique` (needs `lots:read` or `porcs:read`, else 403):
    - a table `Performances des lots` (`LOT, TYPE, ÂGE (J), EFFECTIF, MORTS, MORTALITÉ, DERNIER POIDS (G), GMD (G/J), IC, TAUX DE PONTE`) for the lots open at some point of the period, filtered by species read, from `batchPerformanceMany` + `liveCounts(to)`;
    - the `Production porcine` reproduction rows;
    - with `finance:read`, a table `Rentabilité des lots` from `LotProfitabilityService` for the same period and lots (`LOT, COÛT TOTAL, RECETTES, MARGE, COÛT / ANIMAL`).
- Routes (module `rapports`):
  - `GET /api/reports` (read) → `{ types: { type, label }[] }`: the types with at least one visible section for the role. Labels: `Synthèse`, `Quotidien`, `Hebdomadaire`, `Mensuel`, `Annuel`, `Sanitaire`, `Zootechnique`.
  - `GET /api/reports/:type?date=&from=&to=&format=csv|xlsx` (read): unknown type → 404 `Rapport inconnu`; every section gated → 403 `Ce rapport n'est pas accessible à votre rôle`. `all` is allowed (consolidated, read-only).
  - Export (`report-export.ts`, pure, cells through `csvCell`):
    - CSV: `Section;Indicateur;Valeur;Unité` for the rows (cards as `{Activité X};Recettes|Dépenses|Marge;…;FCFA`); each table follows after an empty line with its own title line and header; filename `rapport-{type}-{from}_{to}`.
    - XLSX: sheet `Indicateurs`, plus one sheet per table (31-character names).
    - A gated section is absent from both.
- Query count: fixed per type, whatever the number of lots (zootechnique asserted with 3 and 30 lots).

- [ ] **Step 1: Write failing unit tests:**
  - `reportPeriod('hebdomadaire', { date: '2026-10-22' }, 2026-11-17)` → 2026-10-19 … 2026-10-25; `mensuel` 2026-02-10 → 02-01 … 02-28; `annuel` 2026-06-01 with today 2026-11-17 → 2026-01-01 … 2026-11-17.
  - Future → throws; 367 days → throws.
  - Titles exact.
  - CSV of a report with one row section and one table → exact text with BOM and CRLF; `3.6` written `3,6`; `-1135000` stays a number; a gated section is absent.
- [ ] **Step 2: Write failing e2e tests** on the slice 2–4 reference fixture (lots, eggs, feed, the October invoices and manual entries):
  - `synthese` for SUPER_ADMIN equals `/dashboard` field for field: 11 570, 245, 3.6, 2 480, 87, the last-day feed and water, the month's money, alerts total.
  - `quotidien?date=2026-10-22` → `Œufs collectés` 2 480, `Aliment distribué` 1 520 kg, `Eau consommée` 3 770 L.
  - `hebdomadaire?date=2026-10-22` → `Œufs collectés` 9 975.
  - `mensuel?date=2026-10-15` → `Œufs collectés` 12 465, feed 1 800 kg, water 4 370 L.
  - The finance section equals `/finance/summary?from=2026-10-01&to=2026-10-31`: `Chiffre d'affaires` 3 970 000; `Taux de marge` = the summary's `marginPct`; `Activité Général` margin −1 135 000; `Encaissements` = the journal's `received`.
  - The dashboard KPIs are unchanged after the move (existing dashboard tests green).
  - Money visibility:
    - RESP_AVICOLE `synthese` → no money row, no `activites` section;
    - its CSV has no `Chiffre d'affaires`;
    - COMMERCIAL `mensuel` → `Production avicole`, `Production porcine`, `Stocks`, no `Finance`;
    - COMPTABLE `mensuel` → `Finance` only (plus `indicateurs` in synthese);
    - COMPTABLE `sanitaire` → 403 exact; AGENT and MAGASINIER → 403 on every route;
    - `GET /reports` for VETERINAIRE lists `synthese`, the four period types, `sanitaire` and `zootechnique`.
  - Zootechnique: LC-2026-14's row equals `GET /batches/:id` performance (GMD, IC, mortality); the profitability table equals `/finance/lots` for COMPTABLE + SUPER_ADMIN, and is absent for RESP_AVICOLE.
  - `all` → `byFarm`-consolidated figures and `farmName` `Toutes les fermes`.
  - XLSX opens with `exceljs` and holds the sheets.
  - The query count does not grow from 3 to 30 lots.
- [ ] **Step 3:** Run: FAIL. **Step 4:** Implement. **Step 5:** Run all backend suites: PASS (existing CSV tests updated for the decimal comma only).
- [ ] **Step 6:** Commit `feat(backend): reports — synthèse, daily to annual, sanitaire and zootechnique from the single definitions, CSV and Excel`.

### Task 6: QR codes, building overview, alert acknowledgement, remaining exports (backend)

**Files:**
- Create: `backend/src/qr/{qr.module.ts,qr.controller.ts,qr.service.ts,qr-targets.ts,dto/*.ts}`, `backend/src/indicators/alerts/alert-acks.service.ts`, `backend/src/admin/buildings/building-overview.ts`; migration (`AlertAck`)
- Modify:
  - `backend/src/dashboard/{dashboard.controller.ts,dashboard.service.ts,dashboard.types.ts}`;
  - `backend/src/admin/buildings/buildings.controller.ts`;
  - the list controllers of `/quarantines`, `/incidents`, `/biosecurity-logs`, `/vaccination-plans`, `/incubations`, `/inventories`, `/stock/movements`, `/feed-products`, `/feed-formulas`, `/water`, `/batches/:id/events`, `/batches/:id/weighings`, `/animals/:id/weighings`, `/animals/:id/heats` (to `sendList`);
  - `backend/src/configure-app.ts` (reads `APP_URL`); `backend/.env.example`.
- Test: `backend/src/qr/qr-targets.spec.ts`, `backend/test/{qr.e2e-spec.ts,alerts-ack.e2e-spec.ts,exports.e2e-spec.ts,buildings.e2e-spec.ts}`

**Schema:**
- `AlertAck(id, userId, key String, level AlertLevel, acknowledgedAt timestamptz DEFAULT now())`: unique `(userId, key)`; index `userId`.

**Interfaces:**
- QR (pre-flight Q23–Q25):
  - `QrKind = 'lot' | 'animal' | 'batiment' | 'article' | 'equipement'`. `qr-targets.ts` (pure) maps each kind and record to:
    - its module: lot → `lots` or `porcs` by species, animal → `porcs`, bâtiment → `batiments`, article → `stocks`, équipement → `equipements`;
    - its path: `/m/lots/{id}`, `/m/porcs/lot-{id}`, `/m/porcs/{id}`, `/m/batiments/{id}`, `/m/stocks/{id}`, `/m/equipements/{id}`;
    - its label and sub-label: `LC-2026-14` / `Poulets de chair — Poulailler A`; `TR-027` / `Truie Large White`; `Poulailler A` / `Avicole — Site Nord`; `Vaccin Gumboro` / `Vaccin — flacon`; `Groupe électrogène 20 kVA` / `Groupe électrogène — Site Nord`.
  - `GET /api/qr/:kind/:id` (`@AnyAuthenticated`, `@NoFarm`) → `{ kind, id, farmId, farmName, path, url, label, sublabel, svg }`.
    - `url` = `{APP_URL}/q/{kind}/{id}`; `svg` = `QRCode.toString(url, { type: 'svg', errorCorrectionLevel: 'M', margin: 1 })`.
    - `farmId` is null for an article (organisation catalogue).
    - The record must be of the organisation, its farm among the caller's farms (every farm for the `ALL_FARMS_ROLES`), the module readable by the role, and the equipment not retired. Any failure → 404 `QR code inconnu ou inaccessible` (the same body and timing class for « missing » and « forbidden »).
  - `POST /api/qr/labels { kind, ids: string[] }` (1…60 ids, `@AnyAuthenticated`, `@NoFarm`) → `{ labels: [...same shape...] }`. One inaccessible id → 400 `QR code inconnu ou inaccessible` (body ids), with nothing returned.
- Building overview (the page a building's QR opens): `GET /api/buildings/:id/overview` (`batiments:read`) → `{ building, site, occupation, capacity, lots: { id, code, species, alive }[] | null, animals: number | null, equipment: { id, name, condition, nextMaintenance }[] | null, openTasks: number | null, lastHealthActs: {…}[] | null }`. Each part is null without its module's read (`lots`/`porcs`, `equipements`, `taches`, `sante`) and is read from the existing services (`occupationByBuilding`, equipment list, task reads, health act list).
- Acknowledgement (pre-flight Q21):
  - `POST /api/alerts/ack { key }` (`alertes:read`): the key must be among the caller's open alerts now, else 404 `Alerte introuvable`. It stores the current level; a repeat is a no-op.
  - `POST /api/alerts/unack { key }`.
  - `GET /api/alerts?acknowledged=include` → items gain `acknowledged: boolean`; `total` counts the unacknowledged ones; `acknowledgedCount` is added.
  - An acknowledgement hides the alert while `now − acknowledgedAt < alertAckDays` days AND the level is not worse than the stored one (A_VOIR acknowledged, now URGENT → shown).
  - The dashboard list and `alerts.total` follow the same rule. The report's `Alertes ouvertes` ignores acknowledgements. No audit (a per-user display preference). One extra query.
- Exports: the lists above serve `?format=csv|xlsx`, with exact headers matching their screens' columns:
  - `/quarantines` `Début;Lot / animal;Motif;Fin;Statut` + `statusCounts`;
  - `/incidents` `Date;Titre;Gravité;Cible;Statut` + `statusCounts`;
  - `/biosecurity-logs` `Date;Type;Bâtiment;Produit;Visiteur;Note`;
  - `/vaccination-plans` `Nom;Espèce;Type de lot;Étapes`;
  - `/incubations` `Code;Couveuse;Début;Œufs incubés;Fertiles;Éclosion prévue;Poussins;Taux d'éclosion;Statut`;
  - `/inventories` `Date;Statut;Lignes comptées;Note`;
  - `/stock/movements` `Date;Article;Type;Quantité;Coût unitaire;Motif;N° de lot`;
  - `/feed-products` `Nom;Type;Coût unitaire;Actif`;
  - `/feed-formulas` `Nom;Espèce;Stade;Coût / kg;Actif`;
  - `/water` `Date;Lot / bâtiment;Eau (L)`;
  - lot events `Date;Type;Quantité;Cause`;
  - weighings `Date;Échantillon;Poids moyen (g)` / `Date;Poids (kg)`;
  - heats `Date;Note`.

- [ ] **Step 1: Write failing tests:**
  - QR:
    - SUPER_ADMIN `GET /qr/lot/{LC-2026-14}` → the path `/m/lots/…`, url `http://localhost:5173/q/lot/…`, and an `<svg` whose decoded content is the url (decoded in the test with the `qrcode` matrix or by regenerating and comparing).
    - The pig lot → `/m/porcs/lot-…`.
    - COMMERCIAL lot → 200; MAGASINIER lot → 404 exact; a farm-B user → 404; an unknown id → 404 with the identical body.
    - A retired equipment → 404; an article for VETERINAIRE → 200.
    - Labels with 3 ids → 3 labels in order; 61 ids → 400; one foreign id → 400.
  - Overview: Poulailler A → occupation 4 820 and its lot; RESP_STOCK sees `lots: null`.
  - Acknowledgement:
    - Acknowledging `task:{id}` → `total` −1 for that user only (another user unchanged); the dashboard total −1; the report's `Alertes ouvertes` unchanged.
    - After `alertAckDays` + 1 days (clock) → shown again.
    - An acknowledged `A_VOIR` stock alert turning `critique` (URGENT) → shown again.
    - An unknown key → 404; unack → shown; the query count +1 only.
  - Exports: each export returns its exact header; `statusCounts` on quarantines and incidents; COMMERCIAL export of `/stock/movements` → 200 (he reads stocks); MAGASINIER `/incidents` → 403.
- [ ] **Step 2:** Run: FAIL. **Step 3:** Implement. **Step 4:** Run all backend suites: PASS.
- [ ] **Step 5:** Commit `feat(backend): QR codes and label data, building overview, per-user alert acknowledgement, remaining list exports`.

### Task 7: Demo seed « Ferme Kpalimé » (backend)

**Files:**
- Create: `backend/prisma/demo/{seed-demo.ts,demo-client.ts,demo-users.ts,demo-production.ts,demo-logistics.ts,demo-commerce.ts,demo-operations.ts,demo-dates.ts}`, `backend/test/demo-seed.e2e-spec.ts`
- Modify: `backend/package.json` (scripts `seed:demo`, `demo:reset`), `backend/Dockerfile` (the demo files are compiled into the image), `scripts/dev.sh` (`--demo` flag runs `seed:demo` after the seed), `backend/.env.example`

**Interfaces:**
- `seed-demo.ts`:
  - It boots `NestFactory.create(AppModule)`, applies `configureApp`, listens on `127.0.0.1:0`, and signs a `full` access token for the `SEED_ADMIN_EMAIL` user with `signAccessToken` (`access/access-token.ts`).
  - It replays the demo through `demo-client.ts` (`fetch` with `Authorization` and `X-Farm-Id`; any non-2xx stops the run with the route and message).
  - The ONLY direct SQL writes are `DocumentCounter` moves (DA 86, BC 140, FA 300/304/308/309, as `frontend/e2e/referenceData.ts` does) and the marker `Setting(key = 'demoSeed', value = { version: 1, at })`, written last.
- Guards:
  - `NODE_ENV=production` without `ALLOW_DEMO_SEED=1` → exit 1 `La démo ne se charge pas en production (ALLOW_DEMO_SEED=1 pour forcer)`.
  - Marker present → exit 0 `Données de démonstration déjà chargées`.
  - The farm `Ferme Kpalimé` has any building, lot, stock movement or document without the marker → exit 1 `La ferme contient déjà des données : chargez la démo sur une base vierge (npm run demo:reset en développement)`. A failed run is therefore never half-repeated.
- `demo:reset` runs `prisma migrate reset --force`, then `prisma db seed`, then `seed:demo`. It is refused when `NODE_ENV=production`.
- Content: the rows of all 19 reference screens, through the same routes and in the same order as `frontend/e2e/referenceData.ts` (ported, not imported: separate npm projects), plus:
  - `demo-users.ts`: one user per role, `{role}@kpalime.demo` (e.g. `agent.elevage@kpalime.demo`), password `DEMO_PASSWORD` (required, ≥ 10 characters), all assigned to Ferme Kpalimé. The four mandatory-2FA roles enrol at first login (pre-flight Q28).
  - Settings `legal`: `Ferme Kpalimé`, `Route d'Atakpamé, Kpalimé, Togo`, NIF `À compléter`, RCCM `À compléter`.
  - Sites `Site Nord`, `Site Sud`, `Incubation`; the six buildings of `m_batiments`.
  - Employees: the four of Task 2. Kodjo A. is linked to `agent.elevage@`, Dr Koffi to `veterinaire@`. Attendance for the last 5 working days.
  - Tasks: the four of `m_taches`. Nettoyage is started; Collecte is completed on the seed day.
  - Equipment: the four of `m_equipements`.
    - Groupe: a preventive intervention 2026-07-30 `Vidange` 35 000 with next 2026-10-30.
    - Couveuse: `À surveiller`.
    - Pompe: first maintenance = max(2026-11-15, seed day + 1).
    - Ventilateur: breakdown 2026-11-02 `Moteur grillé`.
  - The stock, purchases, health, sales and finance rows of slices 3–4.
- Expected state after the seed (asserted by `demo-seed.e2e-spec.ts` on the test database):
  - Dashboard: `poultryAlive` 11 570, `activePoultryBatches` 3, `pigs` 245, `eggsLastDay` 2 480, `layingRate` 87, `mortalityRate` 3.6, `activeBuildings` 5, `tasks { done: 1, pending: 3 }`.
  - Lists: `/tasks` statusCounts 2/1/1; `/equipment` 2/1/1.
  - `/alerts` total 14, with these titles:
    - `Stock faible : Aliment ponte`, `Stock critique : Aliment engraissement porc`;
    - `Mortalité élevée LC-2026-14`, `Mortalité élevée LP-2026-03`, `Mise bas TR-014`;
    - `Vaccination à venir` (documented difference: the reference's `Vaccination en retard`), `Désinfection en retard`;
    - `Tâche en retard` ×3;
    - `Maintenance due` ×2 (Couveuse, Groupe), `Équipement en panne`;
    - `Créance FA-0309`.
  - Finance: `/finance/summary?from=2026-10-01&to=2026-10-31` gives revenue 3 970 000 and receivables 400 000. Expenses are 2 955 000, the documented double vaccine entry of slice 4; the July maintenance falls outside October.
  - Every invoice status is as `m_ventes`.
  - A second run → exit 0 and no new row in any table (row counts compared).
  - `NODE_ENV=production` → exit 1.
- Documented differences (kept in the file header and the README) cover the vaccination à venir, the extra egg days, the supplier balance, the month-to-date profitability, the task completion date, the Pompe date when seeded after 2026-11-14, the alert order and the dashboard feed and water of the latest day.

- [ ] **Step 1: Write the failing spec** (the expected state above; the seed run as a child process against `agripilot_test`, after `resetDb`). **Step 2:** Run: FAIL.
- [ ] **Step 3:** Implement. **Step 4:** Run the spec and all backend suites: PASS. Run `npm run demo:reset` on the dev database by hand and open the app: the home shows the figures above.
- [ ] **Step 5:** Commit `feat(backend): demo seed « Ferme Kpalimé » through the API write paths`.

### Task 8: Kit QR, label sheet, scan, alerts page, readOnly reason, lazy pages (frontend)

**Files:**
- Create: `frontend/src/components/module/{QrDialog.tsx,QrLabelSheet.tsx}`, `frontend/src/pages/{QrResolve.tsx,ScanQr.tsx}`, `frontend/src/lib/qr.ts`
- Modify:
  - `frontend/src/components/module/{types.ts,DataTable.tsx,ModulePage.tsx,ExportMenu.tsx}`;
  - `frontend/src/modules/{lots.tsx,porcs.tsx,porcsShared.tsx,batiments.tsx,stocks.tsx,lotsShared.tsx,alimentation.tsx,sante.tsx,ponte.tsx,stocksShared.tsx,purchaseActions.tsx,finance.tsx}`;
  - `frontend/src/pages/Alerts.tsx`, `frontend/src/lib/alerts.ts`, `frontend/src/components/shell/{Sidebar.tsx,Topbar.tsx}`, `frontend/src/App.tsx`, `frontend/src/pages/admin/Settings.tsx`.
- Test: `frontend/src/components/module/{QrDialog.test.tsx,ModulePage.test.tsx}`, `frontend/src/pages/{Alerts.test.tsx,QrResolve.test.tsx,ScanQr.test.tsx}`

**Interfaces:**
- Kit:
  - `qr?: QrKind | ((row: T) => QrKind | null)` replaces `qr?: boolean`. The row icon (`QR code`, `QrCode` icon) opens `QrDialog` for `{kind, row.id}`; the existing link-to-detail behaviour is removed.
  - `QrDialog`: title `QR code — {label}`; the SVG from the API (inserted as an image built from the SVG text, `<img src="data:image/svg+xml;…">`, never `innerHTML`); `{sublabel}`, `{farmName}`, the URL in small text; buttons `Imprimer l'étiquette` and `Fermer`.
  - With `qr` set, `ExportMenu` adds `Étiquettes QR`: it opens `QrLabelSheet` for the visible page's rows (at most 60) through `POST /qr/labels`.
  - Print layout: A4, 3 × 8 labels of 63,5 × 33,9 mm, each with the QR (25 mm), the label in bold, the sub-label, the farm; `@media print` shows only the sheet; header `Étiquettes QR — {module title}`.
  - Configs: `lots` `'lot'`, `porcs` `(r) => r.kind === 'LOT' ? 'lot' : 'animal'`, `batiments` `'batiment'` (plus Task 10's detail), `stocks` `'article'`, `equipements` `'equipement'` (Task 10). No QR on tasks, employees or documents (pre-flight Q23).
  - `readOnly?: boolean | string` on `ModuleList`, merging the slice-3 carry-over: a string keeps every row icon visible but disabled with the string as its tooltip and hides `Ajouter` (what `noCreate` plus `canEdit`/`canDelete` reasons did). The `ModuleList` `noCreate` prop and the `left` parameters of `animalWeighings` / `animalHeats` / the lot embedded lists are removed in favour of `readOnly={ANIMAL_LEFT}` / `readOnly="Lot clôturé"`. `ModuleConfig.noCreate` (records made elsewhere) stays.
  - `exportable: false` is removed from the configs whose endpoints now export (Task 6).
- Pages:
  - `/q/:kind/:id` (`QrResolve`, inside the authenticated shell): calls `GET /qr/:kind/:id`.
    - If `farmId` differs from the active farm and the user has it, it switches the farm through the farm switcher's setter (queries reset as on a manual switch), then `navigate(path, { replace: true })`.
    - A 404 shows the card `QR code inconnu ou inaccessible` with a link `Retour au tableau de bord`.
    - Not logged in: the existing login redirect keeps `from`, so the QR resumes after login.
  - `/scan` (`ScanQr`, title `Scanner un QR code`):
    - With `'BarcodeDetector' in window` and a camera: a `<video>` from `getUserMedia({ video: { facingMode: 'environment' } })`, decoded every 300 ms. A same-origin URL whose path starts with `/q/` → navigate; another value → `Ce QR code n'appartient pas à AgriPilot`. The stream is stopped on unmount.
    - Otherwise: `Votre navigateur ne lit pas les QR codes : ouvrez l'appareil photo de votre téléphone et visez l'étiquette, le lien s'ouvrira dans AgriPilot.`
    - Always a field `Lien ou code de l'étiquette` + `Ouvrir`.
    - Linked as `Scanner un QR code` in the user card menu at the sidebar foot (no new topbar control).
  - `Alerts.tsx` (pre-flight Q21):
    - Each card gets an icon button `Masquer l'alerte` (`EyeOff`, top right, ghost) → `POST /alerts/ack`.
    - Under the subtitle, when `acknowledgedCount > 0`, a link `Afficher les alertes masquées ({n})` toggles `?acknowledged=include`. Masked cards show at 60 % opacity with `Réafficher` (→ `/alerts/unack`).
    - Subtitle unchanged (`{total} alertes ouvertes, calculées automatiquement à partir de vos données.`). Bell badge and sidebar count read `total`.
  - Settings screen: `Masquage des alertes (jours)`, `Préavis de maintenance (jours)`.
- Carry-over:
  - Supplier `Payer` / delete payment gated by `can('achats','validate') || can('finance','create')`.
  - Feed distributions `COÛT` no longer sortable.
  - Finance entries list default period per pre-flight Q31 (no period).
  - Lot pages and lists show `—` for `Prix d'achat` and the feed cost when the API sends `null` (pre-flight Q32); the lot form keeps the field for its writers.
  - Detail pages, print sheets, `Reports`, `Audit` and admin pages are loaded with `lazyRetry` (`components/lazyRetry.tsx`) so the main chunk no longer holds them; the module configs stay eager (the registry needs them).

- [ ] **Step 1: Write failing tests:**
  - The QR icon on a lot row opens the dialog with the mocked SVG and label `LC-2026-14`; the dialog uses an `<img>`, no raw SVG injection.
  - `Étiquettes QR` posts `/qr/labels` with the 3 visible ids and renders 3 labels.
  - `QrResolve`: 200 for another assigned farm → farm switched and navigated to `/m/lots/…`; 404 → the exact card.
  - `ScanQr` without `BarcodeDetector` shows the exact fallback text; pasting `http://localhost/q/lot/abc` navigates to `/q/lot/abc`; `https://evil.example/q/lot/abc` → `Ce QR code n'appartient pas à AgriPilot`.
  - Alerts: `Masquer l'alerte` posts the key and the card disappears; `Afficher les alertes masquées (1)` shows it with `Réafficher`.
  - `ModuleList readOnly="Lot clôturé"`: icons disabled with that tooltip, no `Ajouter`.
  - COMPTABLE sees `Payer` on a received purchase.
  - The weighings export menu is present on `/animals/:id/weighings`.
- [ ] **Step 2:** Run: FAIL. **Step 3:** Implement against the Task 1 and 6 contracts with mocked APIs. **Step 4:** Run unit + build: PASS; the build output shows separate chunks for the detail pages and `Reports`.
- [ ] **Step 5:** Commit `feat(frontend): QR dialog, label sheet, scan and QR links, alert acknowledgement, readOnly reason, lazy pages`.

### Task 9: Tâches & personnel screens, dashboard and payroll wiring (frontend)

**Files:**
- Create: `frontend/src/modules/{taches.tsx,tachesShared.tsx,personnel.tsx,taskActions.tsx}`, `frontend/src/modules/AttendanceDayForm.tsx`
- Modify: `frontend/src/modules/{index.ts,finance.tsx,financeShared.tsx}`, `frontend/src/pages/Dashboard.tsx`, `frontend/src/lib/dashboard.ts`
- Test: `frontend/src/modules/taches.test.tsx`, `frontend/src/pages/Dashboard.test.tsx`, `frontend/src/modules/finance.test.tsx`

**Interfaces:**
- `taches` as `m_taches.png`:
  - Header: group `Opérations`, title `Tâches & personnel`, `tabLabel` `Tâches`, subtitle `Planification des tâches, responsables et priorités.`, endpoint `/tasks`.
  - Columns `TÂCHE, RESPONSABLE, ÉCHÉANCE, PRIORITÉ, STATUT` (`PRIORITÉ` as text `Normale` / `Haute` / `Urgente`, as the reference list; `RESPONSABLE` `—` without one).
  - Statuses `À faire` warning, `En cours` warning, `Terminée` success; tiles `Total enregistrements`, `À faire`, `En cours`, `Terminée`; filter `Tous les statuts`.
  - Extra filter `mine`: `Toutes les tâches` / `Mes tâches`, shown only when the user is linked to an employee (`GET /employees/options` holds his `userId`).
  - Daily permissions: create, edit and delete `create`; `canEdit` `Terminée` → `Tâche terminée — rouvrez-la`; `canDelete` `Terminée` → `Une tâche terminée ne peut pas être supprimée`.
  - Form:
    - `Tâche`, `Description`, `Responsable` (select `/employees/options`), `Échéance`, `Heure`;
    - `Priorité` (`Normale` default, `Haute`, `Urgente`);
    - `Récurrence` (`Aucune`, `Tous les jours`, `Chaque semaine`, `Chaque mois`);
    - `Concerne` (segmented `Rien | Lot | Bâtiment | Équipement`) + the dependent select (`/batches?status=EN_COURS`, `/buildings`, `/equipment`; each needs its module's read, else the segment option is hidden).
  - Row actions (`taskActions.tsx`, shared with nothing else), visible when `can('taches','create') || row.mine`:
    - `Démarrer` (`Play`; `À faire`; permission `update`);
    - `Terminer` (`CircleCheck`; `À faire`, `En cours`; `update`). The dialog has `Date de réalisation` (default today) and `Photo (preuve)` (file, optional), plus the hint `La prochaine occurrence sera créée pour le {date}` on a recurring task. It posts `/complete`, then `/proof`;
    - `Rouvrir` (`RotateCcw`; `Terminée`; `update`);
    - `Voir la preuve` (`Image`; `hasProof`), which opens the image fetched as a blob.
- Tab `Employés` (config in `personnel.tsx`, slug `personnel`, endpoint `/employees`):
  - Columns `NOM, POSTE, CONTRAT, TÉLÉPHONE, EMBAUCHE, STATUT`, plus `SALAIRE MENSUEL` when `can('finance','read')` (from the API value, `—` if null); statuses `Actif` success, `Parti` neutral.
  - Master permissions (`update` for create, edit and delete as precedent).
  - Form: `Nom affiché` (hint `Ex. Kodjo A.`), `Nom complet`, `Poste`, `Contrat`, `Téléphone`, `Date d'embauche`, `Date de départ` (edit only), `Salaire mensuel (FCFA)` (with `finance:read` only), `Compte utilisateur` (select `/employees/user-options`, optional), `Note`.
- Tab `Présences` (slug `personnel`, endpoint `/attendance`):
  - Columns `DATE, EMPLOYÉ, STATUT, HEURES, NOTE`; statuses `Présent` success, `Absent` danger, `Congé` neutral, `Maladie` warning.
  - `Ajouter` opens `AttendanceDayForm`: `Date` + a fixed `lines` grid of the employees active that day (`Employé` read-only, `Statut` default `Présent`, `Heures`, `Note`) → `POST /attendance/day`. Edit and delete per row are daily.
- Dashboard:
  - `Nouvelle tâche` opens the generated task dialog of the `taches` config (shown with `can('taches','create')`, hidden otherwise).
  - `Tâches terminées {done}` / `En attente {pending}` and `Tâches à venir` read the API (the `Gérer` link is unchanged).
- Finance: the entry form gains, for `can('finance','create')`, a button `Salaires du mois` → a month input → `GET /employees/payroll`. It prefills `Libellé` (`Salaires octobre 2026`), `Type` Dépense, `Activité` Général, `Catégorie` Salaires, `Montant` (total), `Date` (last day of the month, or today for the current month). When `existing` is set it warns `Une écriture « Salaires octobre 2026 » de 950 000 FCFA existe déjà pour ce mois.` The entry is posted by the normal form.

- [ ] **Step 1: Write failing tests:**
  - The list renders the 5 headers and the 4 reference rows with pills (`Nettoyage Porcherie 2 Yawa M. 2026-10-18 Urgente En cours` warning, `Collecte des œufs … Terminée` success) and the tiles 4/2/1/1.
  - An AGENT linked to Kodjo sees `Démarrer` on Pesée only, no `Ajouter`, no edit icons.
  - `Terminer` with a photo posts `/complete` then a multipart `/proof`; the recurring hint shows `2026-10-30`.
  - A `Terminée` row's edit icon is disabled with the exact reason.
  - Employés: COMPTABLE sees `SALAIRE MENSUEL`, RESP_AVICOLE does not.
  - The attendance day form posts the grid.
  - The dashboard `Nouvelle tâche` opens the dialog for RESP_AVICOLE and is absent for COMMERCIAL.
  - The finance `Salaires du mois` prefill and the duplicate warning.
- [ ] **Step 2:** Run: FAIL. **Step 3:** Implement against the Task 2–3 contracts with mocked APIs. **Step 4:** Run unit + build: PASS.
- [ ] **Step 5:** Commit `feat(frontend): tâches & personnel — tâches, employés, présences, dashboard tasks, payroll prefill`.

### Task 10: Équipements screens, equipment and building detail pages (frontend)

**Files:**
- Create: `frontend/src/modules/{equipements.tsx,equipementsShared.tsx,equipmentActions.tsx}`, `frontend/src/pages/details/{EquipmentDetail.tsx,BuildingDetail.tsx}`
- Modify: `frontend/src/modules/{index.ts,batiments.tsx}`
- Test: `frontend/src/modules/equipements.test.tsx`, `frontend/src/pages/details/BuildingDetail.test.tsx`

**Interfaces:**
- `equipements` as `m_equipements.png`:
  - Header: group `Opérations`, title `Équipements`, `tabLabel` `Équipements`, subtitle `Couveuses, balances, pompes, groupes et maintenance.`, endpoint `/equipment`.
  - Columns `ÉQUIPEMENT, TYPE, EMPLACEMENT, PROCHAINE MAINTENANCE, ÉTAT` (`statusKey` `condition`); statuses `Bon` success, `À surveiller` warning, `En panne` danger; tiles `Total enregistrements`, `Bon`, `À surveiller`, `En panne`; filter `Tous les statuts`.
  - `qr: 'equipement'`, `detail: EquipmentDetail`.
  - Master permissions (`update` create and edit, `delete` delete); `canDelete` → `Équipement avec historique — réformez-le` when the row has history (`hasHistory` from the API row; add it to Task 4's row contract).
  - Form:
    - `Nom`, `Type`, `Emplacement` (segmented `Site | Bâtiment`) + dependent select (`/sites`, `/buildings`);
    - `Marque`, `N° de série`, `Date d'achat`, `Intervalle de maintenance (jours)`;
    - `Prochaine maintenance` (create only);
    - `État` (`Bon | À surveiller`, edit only; with `En panne` the select is disabled and hints `Remis en service par une intervention corrective`);
    - `Note`.
  - Row actions (`equipmentActions.tsx`, shared with the detail page):
    - `Déclarer une panne` (`TriangleAlert`; not `En panne`; permission `create`). The dialog has `Date` and `Description`.
    - `Intervention` (`Wrench`; `update`). The dialog has:
      - `Type` (`Préventive | Corrective`), `Date`, `Description`, `Intervenant`;
      - `Fournisseur` (`/suppliers`, `optionsPermission` `fournisseurs:read`);
      - `Coût (FCFA)` (only with `finance:read`);
      - `Prochaine maintenance` (hint `Par défaut : {date + intervalle}` when the equipment has an interval);
      - when `En panne` and Corrective, the checkbox `Répare la panne du {date}` (checked) + `État après intervention` (`Bon` default, `À surveiller`).
    - `Réformer` (`Archive`; `update`; confirmation `Réformer {nom} ? Il n'apparaîtra plus dans la liste ni dans les alertes.`).
- Tabs:
  - `Interventions` (endpoint `/maintenance`): columns `DATE, ÉQUIPEMENT, TYPE, DESCRIPTION, INTERVENANT, PROCHAINE DATE`, plus `COÛT` with `finance:read`; master permissions.
  - `Réformés` (endpoint `/equipment?retired=true`): columns `ÉQUIPEMENT, TYPE, EMPLACEMENT, RÉFORMÉ LE`; `noCreate`; row action `Remettre en service`.
- `EquipmentDetail` `/m/equipements/:id`:
  - Header: name, type, location, condition pill.
  - Tiles: `Prochaine maintenance`, `Interventions`, `Pannes`, and `Coût de maintenance` (API `maintenanceCost`; tile absent when null).
  - Tabs: `Interventions` (embedded, scope `equipmentId`), `Pannes` (`DATE, DESCRIPTION, RÉPARÉE LE`), `Tâches` (embedded `taches` list, scope `equipmentId`).
  - The QR button and the shared actions.
- `BuildingDetail` `/m/batiments/:id` (from `/buildings/:id/overview`):
  - Header: name, type, site, status pill; tiles `Capacité`, `Occupation`, `Taux d'occupation`.
  - Cards, each rendered only when its part is non-null: `Lots et animaux`, `Équipements`, `Tâches ouvertes`, `Derniers actes sanitaires`.
  - The QR button. `batiments` gets `detail: BuildingDetail` and `qr: 'batiment'`.

- [ ] **Step 1: Write failing tests:**
  - The list renders the 5 headers, the 4 reference rows with pills (`Ventilateur Poulailler B #3 Ventilateur Poulailler B 2026-10-20 En panne` danger) and the tiles 4/2/1/1.
  - AGENT sees `Déclarer une panne` but not `Intervention` / `Réformer` / `Ajouter`.
  - The intervention dialog on a broken equipment shows `Répare la panne du 2026-11-02` and posts `repairsBreakdown: true`.
  - DIRECTEUR sees the `Coût (FCFA)` field and the `COÛT` column; RESP_AVICOLE does not.
  - A row with history has a disabled delete icon with the exact reason.
  - BuildingDetail without `lots: …` (null) renders no `Lots et animaux` card.
- [ ] **Step 2:** Run: FAIL. **Step 3:** Implement against the Task 4 and 6 contracts with mocked APIs. **Step 4:** Run unit + build: PASS.
- [ ] **Step 5:** Commit `feat(frontend): équipements — liste, interventions, réformés, fiches équipement et bâtiment`.

### Task 11: Rapports page on the API (frontend)

**Files:**
- Create: `frontend/src/pages/reports/{ReportView.tsx,ReportControls.tsx,reportTypes.ts}`, `frontend/src/styles/print-report.css`
- Modify: `frontend/src/pages/Reports.tsx`; delete `frontend/src/pages/reportCsv.ts` (and its test)
- Test: `frontend/src/pages/Reports.test.tsx`

**Interfaces:**
- `Reports` (`/rapports?type=&date=&from=&to=`, URL state):
  - Header: title `Rapports`; subtitle = the API's `title` (`Synthèse au 14/11/2026` for the default type).
  - Actions: `CSV` (outline, as the reference), `Excel` (outline, pre-flight Q20) and `Imprimer / PDF` (primary). The files are downloaded from `/reports/{type}?format=csv|xlsx` with the same query through `saveBlob`, using the API's filename.
- `ReportControls` (only when `GET /reports` lists more than `synthese`):
  - A `TabBar` `Synthèse | Quotidien | Hebdomadaire | Mensuel | Annuel | Sanitaire | Zootechnique` of the listed types.
  - Inputs: `Jour` (quotidien), `Semaine du` (hebdomadaire), `Mois` (mensuel; `type=month`), `Année` (annuel; number), `Du` / `Au` (sanitaire, zootechnique).
  - Defaults today / the current month; no future value accepted by the inputs (`max`).
- `ReportView` renders the sections in API order:
  - a `rows` section → a `Card` table `INDICATEUR | VALEUR` (values formatted by unit with `formatNumber` / `formatPct` / `signedMoney` / `${n} kg` / `${n} L`; `—` for null);
  - a `cards` section → `ActivityCards` (existing);
  - a `table` section → `DataTable`-styled table with its headers, plus a section title above every section except the synthèse's first (the reference has none).
  - The synthèse is pixel-identical to the reference layout (rows table, then the three activity cards).
- Print (`print-report.css`, `@media print`):
  - Shell, controls and buttons are hidden.
  - A header shows the farm's legal name (`/settings/documents`), the report title and `Généré le {dd/mm/yyyy à hh:mm}`.
  - Tables do not break inside a row; a section starts a new page only if it would not fit.
- No figure is computed in the browser; the old browser CSV builder is removed.

- [ ] **Step 1: Write failing tests:**
  - The default view renders `Synthèse au 14/11/2026` and the 12 reference rows in order with `3 970 000 FCFA` and the three cards (mocked API).
  - With the mocked RESP_AVICOLE answer it renders no money row and no card.
  - `CSV` requests `/reports/synthese?format=csv` and `Excel` `…format=xlsx`.
  - Choosing `Mensuel` with `2026-10` requests `/reports/mensuel?date=2026-10-01` and renders section titles `Production avicole`, `Finance`.
  - A `table` section renders its headers.
  - A 403 from the API shows `Ce rapport n'est pas accessible à votre rôle`.
  - With a single listed type (synthese only), no tab bar is rendered.
- [ ] **Step 2:** Run: FAIL. **Step 3:** Implement against the Task 5 contract with mocked APIs. **Step 4:** Run unit + build: PASS.
- [ ] **Step 5:** Commit `feat(frontend): rapports — synthèse et rapports périodiques, sanitaire, zootechnique, CSV, Excel, impression`.

### Task 12: End-to-end flow, visual comparison, documentation

**Files:**
- Create: `frontend/e2e/operations.spec.ts`, `frontend/e2e/operationsData.ts`, `docs/guide-utilisateur.md`
- Modify: `frontend/e2e/{visual.spec.ts,referenceData.ts}`, `README.md`, `backend/.env.example`, `.env.example`, `docker-compose.yml` (if `APP_URL` / `UPLOAD_DIR` need wiring)
- Write: `docs/superpowers/plans/2026-11-17-slice-5-carryover.md` (at slice close: the project's final open list)

**Interfaces:**
- E2E flow through the UI (API seeding for set-up; tests share state as `commerce.spec.ts`):
  1. The Directeur creates employees `Kodjo A.` (linked to the agent user) and `Yawa M.`.
  2. RESP_AVICOLE records the attendance day and creates `Pesée hebdomadaire LC-2026-14`, weekly, for Kodjo, due yesterday; `Alertes` shows `Tâche en retard` / `Pesée hebdomadaire LC-2026-14 (Kodjo A.)`.
  3. The agent logs in, filters `Mes tâches`, then `Démarrer` and `Terminer` with a photo. The row reads `Terminée`, a new `À faire` row is due +7 days, and `Voir la preuve` shows the image. The agent has no `Démarrer` on Yawa's task.
  4. The agent declares a breakdown on `Ventilateur Poulailler B #3`; `Alertes` shows `Équipement en panne` with the urgent icon.
  5. The Directeur records a corrective intervention of 30 000 that repairs it: the état reads `Bon`, the alert is gone, and the Comptable's `Dépenses & recettes` lists `Maintenance Ventilateur Poulailler B #3 — …` 30 000.
  6. The Comptable prepares `Salaires du mois` (prefilled total) and saves it.
  7. In `Rapports`, `Mensuel` shows the `Finance` section for the Comptable and a CSV whose first line is `Section;Indicateur;Valeur;Unité`; RESP_AVICOLE's synthèse has no `Chiffre d'affaires`.
  8. Lots → `Étiquettes QR` prints 3 labels. Opening a label's `/q/lot/{id}` as the Commercial lands on the lot page; as the Magasinier it shows `QR code inconnu ou inaccessible`.
  9. Masking an alert lowers the bell badge by 1 and `Afficher les alertes masquées (1)` brings it back.
- Visual:
  - Seed the reference rows of `m_taches` and `m_equipements` (through the API, in `referenceData.ts`, with a fixed clock where the alerts need it), plus the complete `alertes` set (14).
  - Capture into `docs/reference/built/`: `m_taches.png`, `m_equipements.png`, `alertes.png`, `rapports.png`, `home.png`, `audit.png`, `taches_375.png`, `equipement_detail_375.png`, `batiment_detail_1440.png`, `qr_dialogue_375.png`, `etiquettes_qr.png`, `rapport_mensuel_impression.png`.
  - Measured rects, headers, tiles, pill tones, icons and disabled-icon reasons as for the earlier screens; the home's `Tâches terminées 1` / `En attente 3` and `Tâches à venir` rows.
  - Documented differences are listed in the spec header, among them: alert order (URGENT first by rank), `Vaccination à venir`, task list order by due date, the `Réformés` tab and `Excel` button, no QR icon on task rows, no `Réinitialiser les données` on the audit page.
- `README.md` final:
  - Installation on Linux, macOS and Windows; Docker (`docker compose up`, seed, demo, logs).
  - All environment variables, including `APP_URL`, `UPLOAD_DIR`, `DEMO_PASSWORD` and `ALLOW_DEMO_SEED`.
  - Demo: `npm run seed:demo`, `npm run demo:reset`, the demo accounts and the documented differences.
  - Roles and who does what per module (the full grants table, generated from `permissionsFor` by a test that fails when the README table drifts).
  - Business rules: ledgers, finance views, no double counting, withdrawal, numbering, alerts and thresholds, acknowledgement, QR.
  - Backup and restore (database plus uploads plus `TOTP_ENC_KEY`).
  - Tests (each suite and its command) and the verified state.
  - Limits and what is deferred (the Out of scope list below and every open owner decision).
  - « État d'avancement »: the five slices done.
- `docs/guide-utilisateur.md` (French, pre-flight Q30):
  - Getting started (login, 2FA, farm switcher).
  - Per role, the daily gestures: Agent (mortality, weighings, feed, eggs, my tasks, breakdown); Responsable avicole / porcin; Vétérinaire; Stock / Magasinier; Commercial; Comptable (payments, finance, salaries, reports); Directeur; Propriétaire / Auditeur.
  - Alerts and what clears each one; QR labels and scanning; reports and printing.
  - What to do when a number looks wrong (the ledger and the correction paths: avoir, ajustement, réouverture).

- [ ] **Step 1: Write the tests.** **Step 2:** Run: FAIL where the flow is not wired. **Step 3:** Fix frontend wiring; report backend defects instead of fixing them. **Step 4:** Run every suite: PASS.
- [ ] **Step 5:** Write the README, the guide and the carry-over file. Commit `feat: operations end-to-end flow, captures, final README and operator's guide` and push.

---

## Pre-flight questions for the controller

| # | Question | Design / reference | Recommended default | Consequence |
|---|---|---|---|---|
| Q1 | Comptable paying suppliers (open since slice 3, Ruling Q29) | Design: Comptable « dépenses, recettes, … paiements »; one permission per route could not say « or ». | Add `@RequireAnyPermission`; supplier payments = `achats:validate` OR `finance:create`. | Comptable records supplier payments; validation and ordering stay with Directeur / Propriétaire. |
| Q2 | Where personnel lives and who manages it | Design: employee, attendance tables; « présences and employés under Tâches »; no RH role. | New module key `personnel` (tabs of « Tâches & personnel »): employees = master (`update`: Directeur, Super admin); attendance = daily (`create`: + Resp. avicole / porcin); read: Propriétaire, Comptable, Auditeur. | One more key in the grants and the route walk; Agent cannot see the staff list. |
| Q3 | Must employees have user accounts? | Reference assignees « Kodjo A. », « Dr Koffi » are names; Agent « tasks assigned to them ». | No. An employee may be linked to ONE user of the farm; only linked employees get « Mes tâches » and can advance their tasks. | Day labourers without a login are assignable; a chef d'équipe advances their tasks for them. |
| Q4 | Who assigns tasks, who advances them | Design: Agent « tasks assigned to them »; reference assigns a task to the vet. | Create / edit / delete = `taches:create` (Resp. avicole, Resp. porcin, Directeur, Super admin). Start / complete / reopen = `taches:update`, limited to one's own tasks without `create`. Grant `taches: read, update` to Vétérinaire, Resp. stock, Magasinier (Agent already has it). | These roles see every task of the farm (read) but advance only theirs; the Commercial and the Comptable see no tasks. |
| Q5 | Recurrence | Not specified; reference « Pesée hebdomadaire ». | `Aucune / Tous les jours / Chaque semaine / Chaque mois`; completing creates the next occurrence (no scheduler); reopening removes it if untouched. | An abandoned series ends only by editing the last occurrence's recurrence to `Aucune`. |
| Q6 | Task « preuve photo » | Design task field; no attachments module exists. | One optional photo per task, JPEG / PNG / WebP ≤ 5 Mo on the `api-uploads` volume, served behind `taches:read`. No general attachments module. | Backups must include the volume (README); other attachments stay out of scope. |
| Q7 | Dashboard « Tâches terminées / En attente » | Reference 1 / 3 next to 4 tasks. | Pending = open tasks; done = completed in the last 30 days; « Tâches à venir » = 5 open tasks by due date, then priority. | The counts move with time; the reference order (insertion) is not kept. |
| Q8 | Do salaries post finance entries automatically? | Owner's decision: salaries are entered by hand; slice-4 carry-over: personnel « feeds » them. | Stay manual: a payroll preview (Σ monthly salaries of employees active in the month, no proration) prefills the Comptable's manual `Salaires` entry and warns if one exists. | No automatic expense; attendance does not change pay; the double entry stays the user's. |
| Q9 | Who sees salaries | Money gating precedent (Q27). | `monthlySalary` only with `finance:read` (JSON, column, export); entered by Directeur / Super admin (who hold it). | Resp. avicole / porcin manage attendance without seeing pay. |
| Q10 | Maintenance cost: finance entry, lot cost? | Design: maintenance has a cost and a supplier; « general charges stay under Général, not spread over lots ». | A derived expense in the finance view (origin `MAINTENANCE`, `Entretien`, activity from the building's type, else Général), not editable there; never a lot cost. | The Comptable must not type it again (hint on the finance list); the alternative (manual only) loses the link. |
| Q11 | Equipment rights | Code: only Directeur and Super admin hold `equipements`; Agent and responsables cannot report a breakdown. | Resp. avicole, Resp. porcin, Agent: `equipements: read, create` (declare a breakdown); inventory, interventions and retirement = `update` (Directeur, Super admin); cost shown with `finance:read`. | Field staff can raise `Équipement en panne`; only the manager closes it. |
| Q12 | Equipment état | Reference: `Bon`, `À surveiller`, `En panne`. | `Bon` / `À surveiller` set by hand; `En panne` only by declaring a breakdown, left only by a corrective intervention that repairs it. | A breakdown cannot be « fixed » by editing the row; the history keeps every breakdown. |
| Q13 | « Maintenance due » rule and levels | Reference (14/11): 10-25 and 10-30 alerted A_VOIR, 11-15 not; the broken fan has no « Maintenance due »; « Équipement en panne » red. | Due when next ≤ today + `maintenanceWarningDays` (default 0); none for broken equipment; panne URGENT, due A_VOIR; one title for due and overdue. | No advance warning unless the setting is raised. |
| Q14 | « Prochaine maintenance » definition | Design: maintenance has a « next date ». | The latest intervention's next date, else its date + the equipment's interval, else the date entered at creation; cached on the row under the lock. | A preventive done without a next date and without an interval leaves no next date (no alert). |
| Q15 | Location, retirement | Reference « Site Nord », « Incubation », « Poulailler B »; 6 buildings, none named Incubation. | Site or building (not both); the demo creates a site `Incubation`; equipment with history is retired (`Réformer`), shown in a `Réformés` tab, never deleted. | One extra tab on the reference screen. |
| Q16 | What each report contains | Design: quotidien, hebdomadaire, mensuel, annuel, sanitaire, zootechnique; reference shows the synthèse only. | The seven types of Task 5, sections gated by module read, money with `finance:read`; synthèse = dashboard figures. | Comptable sees finance sections only; a report with no visible section is a 403. |
| Q17 | Period semantics | Not specified. | ISO week Monday–Sunday; calendar month / year; clipped to today; headcounts « au {fin} »; stock levels are today's (no stock history by date) and say so. | A past monthly report shows today's stock alerts counts, labelled `(aujourd'hui)`. |
| Q18 | Propriétaire « validations (rapports) » | Design role table; `rapports: V` granted. | No report validation workflow: reports are computed, nothing to approve. | `rapports:validate` stays unused. |
| Q19 | CSV number format | Lists export `3.6` (dot); the old browser report CSV wrote `3,6`. | Decimal comma in every CSV through `toCsv` (one change); XLSX keeps native numbers. | Existing CSV tests with decimals are updated; French Excel reads numbers. |
| Q20 | Report buttons | Reference: `CSV`, `Imprimer / PDF`; design: CSV and Excel. | Keep both and add `Excel` between them. | One extra button on `rapports.png` (documented). |
| Q21 | Alert acknowledgement | Design: « a user can acknowledge an alert (key + user + date) to hide it »; reference shows no control. | Per-user `Masquer l'alerte`, valid `alertAckDays` (7) days or until the level worsens; dashboard and badge count the user's visible alerts; reports count all open alerts. | A masked overdue task reappears after 7 days; the report count may exceed the badge. |
| Q22 | Alert order | Reference mixes levels (Mise bas urgent fifth). | URGENT first, then fixed rule ranks: stock, production, health, tasks, equipment, sales; within a rule by date. | `alertes.png` order differs (documented); stock alerts now precede mortality as in the reference. |
| Q23 | What gets a QR, what it encodes, who may open it | Design: lot, building, animal, stock item, medication; reference shows a QR icon on every row. | Lot, animal, building, article (medicines included), equipment; QR = `{APP_URL}/q/{kind}/{id}`; login, farm assignment and module read required; one 404 for missing and forbidden. No QR on tasks, employees, documents. | A label stolen from the farm reveals nothing without an account; task rows lose the reference's QR icon. |
| Q24 | Scanning | Design: « a scan page uses the device camera ». | `/scan` with the browser's `BarcodeDetector` where available; otherwise the phone's camera app opens the URL; manual link field. No library. | iPhone Safari users scan with the camera app (works, as the QR is a URL). |
| Q25 | Label sheet | Not specified. | A4, 3 × 8 labels (63,5 × 33,9 mm), up to 60 per print, from `Exporter › Étiquettes QR`. | Other label stock needs a print-scale adjustment by the user. |
| Q26 | Demo seed in production, reset | Not specified. | `seed:demo` refused when `NODE_ENV=production` unless `ALLOW_DEMO_SEED=1`; only on a blank farm; idempotent via a marker; reset only in development (`demo:reset` = migrate reset + seeds). | A production install starts empty; evaluation installs set the flag once. |
| Q27 | Demo dates | Reference captured 14/11/2026 with October data. | Keep the reference dates; dates a rule needs relative (planned vaccination +2 d, stock consumption, Pompe next date, task completion on the seed day). | « Rentabilité du mois » shows the current month (0 after October); differences listed in the README. |
| Q28 | Demo users | Not specified. | One user per role `{role}@kpalime.demo`, password `DEMO_PASSWORD`; Kodjo A. → Agent, Dr Koffi → Vétérinaire; the 4 mandatory-2FA roles enrol at first login. | 12 accounts to delete before real use (README says how). |
| Q29 | Audit « Réinitialiser les données » button | Reference audit screen. | Not built: the audit log is immutable; data reset is the CLI `demo:reset` in development. | `audit.png` lacks that button (documented). |
| Q30 | Operator's guide | Design: « docs » in slice 5, no format. | `docs/guide-utilisateur.md` in French, per role, plus the README for installers. | One more document to keep in step with the screens. |
| Q31 | Finance list default period (slice-4 carry-over) | Reference lists all entries; today the list opens on the current month. | The entries list opens with no period (all dates); Synthèse keeps the month to date. | Long lists for old farms (paginated). |
| Q32 | Lot purchase price and feed cost visible to roles without finance (slice-4 open) | Money gating precedent. | Hide `Prix d'achat` and feed cost on lot pages and lot lists without `finance:read`. | Commercial and Resp. stock lose two figures they saw before. |
| Q33 | Health act back-dated before an invoiced sale (slice-4 open) | Withdrawal blocks sales forward only. | Leave as is this slice (documented limit); no new check. | A late treatment entry does not flag the earlier sale. |
| Q34 | Agent d'élevage Santé rights (slice-3 open) | Cahier limits the agent to field entry. | Keep full daily Santé rights (unchanged). | The agent can cancel a vet's planned act. |
| Q35 | `sort=cost` on feed distributions (slice-3 carry-over) | The sort used the stored cost, not the ledger cost shown. | Remove sorting by cost (400 `Tri invalide`, column not sortable). | No cost sort on distributions. |
| Q36 | Task list default order | Reference: insertion order. | Due date ascending, then priority, then title. | `m_taches.png` row order differs (documented). |

## End of project

Before declaring the five slices complete, the controller verifies and records in `docs/superpowers/plans/2026-11-17-slice-5-carryover.md`:

- **Suites:** backend type check, lint, unit tests, every API suite on PostgreSQL (including `demo-seed.e2e-spec.ts` and the route-permission walk) and build. Frontend type check, lint, unit tests and build. Counts noted next to the slice-4 figures (264 / 1 037 / 612 / 68).
- **Browser:** the full Playwright run (auth, bâtiments, production, logistics, commerce, operations, visual) from a clean e2e database, with no retry and no skipped scenario.
- **Fresh install following the README only:** a fresh clone on an empty PostgreSQL, then `scripts/dev.sh` (Linux), `npm run seed:demo`, and login as Super admin with 2FA enrolment and as each demo role. Each role's sidebar matches the README grants table.
- **Docker:** `docker compose build` and `up` where a daemon exists; the API is healthy, the seed and the demo run through `docker compose run --rm api …`, and a backup and restore follow the README. If no daemon is available, say so explicitly; it stays « not verified », as in slices 1–4. Likewise `scripts/dev.sh` on a real Mac (and the Windows manual steps) are « verified » or « not verified ».
- **Reference comparison of every screen:** all 19 of `docs/reference/screens/` against `docs/reference/built/`, plus the new screens (task, equipment and building details, QR dialog and labels, report print). Each documented difference is listed once with its reason.
- **Demo seed:** the expected state of Task 7 holds on the dev database; a second run is a no-op; `demo:reset` works; production refuses.
- **Security pass:** `/api/qr/*` answers one 404 for every refusal; the uploads directory is not served statically; proof photos need `taches:read` on the farm; no money field reaches a role without `finance:read` in any report, export or list.
- **Deferred list:** the Out of scope below plus every remaining open owner decision (Q3–Q36 not ruled otherwise, the slice 1–4 open lists) are copied into the README « Limites » section.

## Out of scope

- Native mobile app, offline mode and synchronisation (Phase 3); AI forecasting and IoT sensors (Phases 4–5): design non-goals.
- E-mail, SMS, WhatsApp and push notifications of alerts, tasks or reports; scheduled or e-mailed reports.
- Payroll engine (taxes, CNSS, payslips, proration by attendance), time clock, leave balances, GPS check-in.
- A general attachments module (only the task proof photo), server-generated PDF (print layouts only), a QR library for camera decoding on browsers without `BarcodeDetector`.
- Equipment depreciation, spare-parts stock linked to interventions, maintenance plans with several schedules per equipment, intervention work orders.
- Editable role map and custom roles; multiple languages and currencies; automated backup infrastructure.
- Advance payments, price lists, client credit balances (slice-4 owner decisions, unchanged).
- QR on tasks, employees and commercial documents.

---

## Self-review notes

- **Spec coverage:**
  - Personnel (employees, attendance, link to users, salaries feeding the manual entry) is covered by T2 and T9.
  - Tasks (responsable, date, heure, priorité, statut, preuve photo, recurrence, links to lot / building / equipment, overdue alert, dashboard « Tâches à venir » and counts) by T3 and T9.
  - Equipment and maintenance (préventive / corrective, cost, supplier, next date, breakdowns, maintenance due / panne alerts, cost to finance under Entretien) by T4 and T10.
  - Reports (quotidien to annuel, sanitaire, zootechnique; CSV and Excel from the API; print) by T5 and T11.
  - Alerts (every design rule now implemented, acknowledgement) by T3, T4, T6 and T8.
  - QR (lot, building, animal, stock item, medication; scan page with the camera) by T6 and T8.
  - Exports of the remaining lists by T6; the demo seed « Ferme Kpalimé » by T7; documentation by T12.
- **Slice-4 « First task of slice 5 »:**
  - In T1: the permission alias (Q1), the receivables aggregate, the payments journal and invoice export columns, ascending breeding locks, alert ranks, `sort=cost` (Q35).
  - Elsewhere: salaries (T2, Q8); the kit `readOnly` reason (T8); the finance list default (T8, Q31); the health sub-list exports (T6).
- **Deferred minors from slice 4 taken here:** the payments listing, the invoice CSV columns, the credit-note date filter, the large `sale-view.ts` split, lazy loading of slice-4 pages, the sow → boar lock order. The rest stays deferred and is copied into the slice-5 carry-over.
- **Review Focus → tests:** 1 (T5's equality tests with dashboard, summary, batch performance and lot profitability); 2 (T2, T4, T5 role tests, T11, T12); 3 (T7's state and idempotency spec); 4 (T3, T4 query counts and visibility; T6 acknowledgement); 5 (T6 QR tests, T8 resolve and scan tests, T12 flow).
- **Tracks:** the backend runs T1 → T2 → T3 → T4 → T5 → T6 → T7 (T3 needs employees, T4 adds the task FK and the finance branch, T5 reads T2–T4, T6's overview reads T4, T7 needs everything). The frontend runs T8 (after T1; QR contract mocked), T9 (after the T2–T3 contracts), T10 (after T4 and T6) and T11 (after T5), all coding against the contracts above with mocked APIs. T12 reconciles both and is the only task that runs the full browser suite.
