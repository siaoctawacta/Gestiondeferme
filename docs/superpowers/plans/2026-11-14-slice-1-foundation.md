# AgriPilot Slice 1 — Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A running, tested AgriPilot with login + 2FA, the 12 roles, multi-farm administration (fermes, sites, bâtiments, zones, utilisateurs), audit log, and the reference app's shell and dashboard wired to a real API.

**Architecture:** Two independent npm projects. `backend/` is a NestJS REST API over PostgreSQL through Prisma, with access control, audit and list/export behaviour concentrated in three deep modules (`access`, `audit`, `listing`). `frontend/` is a React + Vite single-page app whose module screens are all rendered by one config-driven `ModulePage` kit, talking to the API through one typed client.

**Tech Stack:** Node 22, NestJS 11+, Prisma (newest stable major, not a release candidate), PostgreSQL 16, argon2, otplib, Jest + supertest. React 19, Vite, TypeScript, Tailwind CSS 4, TanStack Query, React Router, Recharts, lucide-react, Vitest + Testing Library, Playwright.

**Spec:** `docs/superpowers/specs/2026-11-14-agripilot-design.md`. Reference UI: `docs/reference/screens/*.png`, `docs/reference/screens-text.txt`, `docs/reference/reference-styles.css`.

Later slices (each gets its own plan when reached): 2 Production · 3 Santé, stocks, achats · 4 Ventes, finance · 5 Opérations, rapports, alertes, QR, seed, docs.

## Global Constraints

- UI text is French; currency label `FCFA`; app name `AgriPilot`, tagline `Ferme avicole & porcine`.
- Design tokens are copied verbatim from the `:root{…}` block of `docs/reference/reference-styles.css` (oklch values, `--radius:.875rem`, `--shadow-card`, `--gradient-hero`).
- Fonts: `Plus Jakarta Sans` 600/700/800 for headings and numbers, `Manrope` 400/500/600/700 for body. Self-host through `@fontsource/*` packages (no runtime request to Google).
- Routes kept from the reference: `/`, `/alertes`, `/rapports`, `/m/:module`, `/audit`. Module slugs: `batiments, lots, ponte, porcs, reproduction, alimentation, sante, stocks, fournisseurs, achats, clients, ventes, finance, taches, equipements`.
- API prefix `/api`; Swagger UI at `/api/docs`; all bodies validated with `class-validator` (`whitelist: true, forbidNonWhitelisted: true`).
- Every farm-owned table has `farmId`; every request for farm-owned data carries header `X-Farm-Id`.
- Roles enum (exact): `SUPER_ADMIN, PROPRIETAIRE, DIRECTEUR_FERME, RESP_AVICOLE, RESP_PORCIN, VETERINAIRE, RESP_STOCK, COMPTABLE, COMMERCIAL, AGENT_ELEVAGE, MAGASINIER, AUDITEUR`.
- 2FA is mandatory for `SUPER_ADMIN, PROPRIETAIRE, DIRECTEUR_FERME, COMPTABLE`.
- Lockout: 5 consecutive failed logins lock the account for 15 minutes.
- Access JWT lifetime 15 min, held in memory only; refresh token 7 days, rotating, in an httpOnly `SameSite=Lax` cookie named `ap_refresh` scoped to `/api/auth`, stored hashed.
- No secrets in the repo: `backend/.env.example` only; `.env` is git-ignored.
- Commit after every task; never commit `node_modules`, `dist`, `.env`, `uploads/`.

## Review Focus

1. **Farm isolation by guessed id** — a user assigned to farm A sends `X-Farm-Id` of farm B, or requests `/api/buildings/<id of farm B>` with farm A's header: expect 403 / 404, never data. (Test in Task 2 and Task 6.)
2. **Refresh token reuse** — an already-rotated refresh token is presented again: expect 401 and all of that user's refresh tokens revoked. (Task 3.)
3. **2FA bypass** — a user with mandatory 2FA not yet enrolled, or holding only the first-step token, calls any non-auth endpoint: expect 403 with code `TWO_FACTOR_REQUIRED`. (Task 4.)
4. **Last Super Admin** — deleting, deactivating or demoting the only active `SUPER_ADMIN`: expect 409. (Task 6.)
5. **Building in use / impossible capacity** — deleting a site that has buildings, or a building capacity ≤ 0: expect 409 / 400 with a French message the UI shows. (Task 6; UI message in Task 10.)

---

## File Structure

```
backend/
  prisma/schema.prisma            # slice-1 tables
  prisma/seed.ts                  # organisation, first farm, super admin
  src/main.ts                     # bootstrap: helmet, cookie-parser, validation pipe, swagger, /api prefix
  src/app.module.ts
  src/prisma/prisma.service.ts    # PrismaClient provider
  src/access/                     # roles, permissions map, guard, decorators, request context
  src/auth/                       # login, refresh, logout, me, password, 2FA
  src/audit/                      # interceptor, service, GET /audit
  src/listing/                    # list query DTO, paginate(), toCsv(), toXlsx()
  src/admin/{farms,sites,buildings,zones,users,settings}/
  src/dashboard/                  # GET /dashboard
  test/                           # e2e (supertest) against a real test database
frontend/
  src/styles/tokens.css           # reference :root tokens + tailwind theme mapping
  src/lib/api.ts                  # typed fetch client (token, refresh, farm header)
  src/lib/auth.tsx                # AuthProvider, useAuth, can()
  src/lib/format.ts               # number/date/FCFA formatting as the reference
  src/components/ui/              # Button, Card, Pill, Dialog, Input, Select, Table
  src/components/shell/           # Sidebar, Topbar, FarmSwitcher, AppLayout, nav.ts
  src/components/module/          # ModulePage, StatTiles, DataTable, RecordDialog, types.ts
  src/modules/                    # one config per module slug
  src/pages/                      # Login, Dashboard, Audit, Account, admin/*, ComingSoon
  e2e/                            # Playwright
docker-compose.yml  README.md  scripts/dev-db.sh
```

---

### Task 1: Backend scaffold, database, health check

**Files:**
- Create: `backend/` (Nest project), `backend/prisma/schema.prisma`, `backend/src/prisma/prisma.service.ts`, `backend/src/main.ts`, `backend/.env.example`, `backend/test/setup.ts`, `backend/test/health.e2e-spec.ts`, `scripts/dev-db.sh`, `.gitignore`

**Interfaces:**
- Produces: `PrismaService` (injectable, extends the Prisma client); `createTestApp(): Promise<INestApplication>` and `resetDb(): Promise<void>` in `backend/test/setup.ts`; env vars `DATABASE_URL`, `JWT_SECRET`, `TOTP_ENC_KEY`, `WEB_ORIGIN`, `PORT` (default 3000).
- `scripts/dev-db.sh` starts the local PostgreSQL 16 cluster (`pg_ctlcluster 16 main start`) and creates role `agripilot` / databases `agripilot` and `agripilot_test` if missing; idempotent.

Schema for this task (all ids `String @id @default(cuid())`, all with `createdAt`, `updatedAt`):
- `Organization(name, currency "FCFA", legalId?, address?)`
- `Farm(organizationId, name, location?, active)`
- `Site(farmId, name)` — unique `(farmId, name)`
- `Building(farmId, siteId, name, type AVICOLE|PORCIN|AUTRE, capacity Int, status ACTIF|VIDE_SANITAIRE|MAINTENANCE)` — unique `(farmId, name)`
- `Zone(farmId, buildingId, name, capacity Int?)`
- `User(organizationId, email unique, name, passwordHash, role Role, active, failedLogins Int, lockedUntil?, totpSecretEnc?, totpEnabledAt?, backupCodes String[], lastLoginAt?)`
- `UserFarm(userId, farmId)` — composite id
- `RefreshToken(userId, tokenHash unique, expiresAt, revokedAt?, replacedById?)`
- `PasswordReset(userId, tokenHash unique, expiresAt, usedAt?)`
- `LoginLog(userId?, email, success, ip?, userAgent?, createdAt)`
- `AuditLog(userId?, userName, farmId?, module, action CREATE|UPDATE|DELETE|LOGIN|LOGOUT|OTHER, recordId?, label?, before Json?, after Json?, createdAt)`
- `Setting(organizationId, key, value Json)` — unique `(organizationId, key)`

- [ ] **Step 1:** Run `scripts/dev-db.sh`; verify `pg_isready` reports accepting connections.
- [ ] **Step 2:** Scaffold Nest in `backend/`, add Prisma, write the schema above, run the first migration (`prisma migrate dev --name init`).
- [ ] **Step 3: Write the failing test** `backend/test/health.e2e-spec.ts`:

```ts
it('GET /api/health reports database up', async () => {
  const res = await request(app.getHttpServer()).get('/api/health');
  expect(res.status).toBe(200);
  expect(res.body).toEqual({ status: 'ok', db: 'up' });
});
it('rejects unknown body fields', async () => {
  const res = await request(app.getHttpServer()).post('/api/auth/login').send({ email: 'a@b.c', password: 'x', evil: 1 });
  expect(res.status).toBe(400);
});
```

- [ ] **Step 4:** Run `npm run test:e2e` in `backend/` — expect FAIL (no route).
- [ ] **Step 5:** Implement `main.ts` bootstrap (shared `configureApp(app)` used by both `main.ts` and `createTestApp`), `HealthController` (runs `SELECT 1`), and a stub `POST /auth/login` DTO so validation is exercised.
- [ ] **Step 6:** Run `npm run test:e2e` — expect PASS. Swagger UI answers at `/api/docs`.
- [ ] **Step 7:** Commit `feat(backend): scaffold API, schema and health check`.

### Task 2: Access module

**Files:**
- Create: `backend/src/access/roles.ts`, `permissions.ts`, `access.service.ts`, `access.guard.ts`, `decorators.ts`, `access.module.ts`
- Test: `backend/src/access/permissions.spec.ts`, `backend/test/access.e2e-spec.ts`

**Interfaces:**
- Produces:
  - `type Action = 'read'|'create'|'update'|'delete'|'validate'`
  - `type ModuleKey = 'dashboard'|'alertes'|'rapports'|'batiments'|'fermes'|'utilisateurs'|'parametres'|'lots'|'ponte'|'porcs'|'reproduction'|'alimentation'|'sante'|'stocks'|'fournisseurs'|'achats'|'clients'|'ventes'|'finance'|'taches'|'equipements'|'audit'`
  - `can(role: Role, module: ModuleKey, action: Action): boolean`
  - `permissionsFor(role: Role): Record<ModuleKey, Action[]>` (sent to the frontend in `/auth/me`)
  - `@RequirePermission(module: ModuleKey, action: Action)`, `@Public()`, `@NoFarm()` (endpoint does not need `X-Farm-Id`)
  - `@Ctx() ctx: RequestContext` where `RequestContext = { user: {id,name,role,organizationId}, farmId: string | null, allFarms: boolean, farmIds: string[] }`
  - Global `AccessGuard`: verifies the bearer JWT; resolves the farm (`X-Farm-Id` = a farm id, or `all` — allowed only for `SUPER_ADMIN, PROPRIETAIRE, AUDITEUR` and only on `read`); 401 unauthenticated, 403 forbidden.
- Farm visibility: `SUPER_ADMIN`, `PROPRIETAIRE`, `AUDITEUR` see every farm of the organisation; other roles only farms in `UserFarm`.

Permission map (the one source of truth; `R`=read, `W`=read+create+update+delete, `V`=W+validate; unlisted = none; everyone gets `dashboard:R`, `alertes:R`):

| Role | Map |
|---|---|
| SUPER_ADMIN | every module `V` |
| PROPRIETAIRE | every module `R`; `achats:validate`; `rapports:V`; `finance:R` |
| DIRECTEUR_FERME | `V` on batiments, lots, ponte, porcs, reproduction, alimentation, sante, stocks, fournisseurs, achats, taches, equipements; `R` on clients, ventes, finance, rapports, audit |
| RESP_AVICOLE | `W` lots, ponte, alimentation, sante, taches; `R` batiments, stocks, rapports |
| RESP_PORCIN | `W` porcs, reproduction, alimentation, sante, taches; `R` batiments, stocks, rapports |
| VETERINAIRE | `W` sante; `R` lots, ponte, porcs, reproduction, alimentation, stocks, batiments, rapports |
| RESP_STOCK | `W` stocks, fournisseurs; achats `read,create,update`; `R` alimentation, rapports |
| COMPTABLE | `W` finance; `R` ventes, achats, clients, fournisseurs, rapports |
| COMMERCIAL | `W` clients, ventes; `R` stocks, lots, porcs, rapports |
| AGENT_ELEVAGE | `read,create` on lots, ponte, porcs, alimentation, sante; taches `read,update`; `R` batiments |
| MAGASINIER | stocks `read,create`; achats `read,update`; `R` fournisseurs |
| AUDITEUR | every module `R` (including audit, utilisateurs) |

`fermes`, `utilisateurs`, `parametres`: `SUPER_ADMIN` only for writes; `PROPRIETAIRE` and `AUDITEUR` read.

- [ ] **Step 1: Write failing unit tests** in `permissions.spec.ts`:

```ts
expect(can('AUDITEUR', 'ventes', 'read')).toBe(true);
expect(can('AUDITEUR', 'ventes', 'create')).toBe(false);
expect(can('AGENT_ELEVAGE', 'lots', 'create')).toBe(true);
expect(can('AGENT_ELEVAGE', 'lots', 'delete')).toBe(false);
expect(can('AGENT_ELEVAGE', 'finance', 'read')).toBe(false);
expect(can('PROPRIETAIRE', 'achats', 'validate')).toBe(true);
expect(can('PROPRIETAIRE', 'lots', 'create')).toBe(false);
expect(can('MAGASINIER', 'stocks', 'delete')).toBe(false);
expect(can('SUPER_ADMIN', 'utilisateurs', 'delete')).toBe(true);
for (const r of ALL_ROLES) expect(can(r, 'dashboard', 'read')).toBe(true);
```

- [ ] **Step 2: Write failing e2e tests** in `access.e2e-spec.ts` using a test-only controller registered in the test module (`GET /api/_probe` with `@RequirePermission('lots','create')`): no token → 401; `AUDITEUR` → 403; `RESP_AVICOLE` assigned to farm A with `X-Farm-Id: A` → 200; same user with `X-Farm-Id: B` → 403; missing header → 400; `X-Farm-Id: all` as `RESP_AVICOLE` → 403; `X-Farm-Id: all` as `AUDITEUR` on a read probe → 200 with `ctx.allFarms === true`. Test helper `tokenFor(userId)` signs a JWT directly.
- [ ] **Step 3:** Run both — expect FAIL.
- [ ] **Step 4:** Implement the files above.
- [ ] **Step 5:** Run both — expect PASS.
- [ ] **Step 6:** Commit `feat(backend): role permissions and farm-scoped access guard`.

### Task 3: Authentication

**Files:**
- Create: `backend/src/auth/auth.controller.ts`, `auth.service.ts`, `tokens.service.ts`, `password.ts`, `dto/*.ts`, `auth.module.ts`, `backend/prisma/seed.ts`
- Test: `backend/test/auth.e2e-spec.ts`

**Interfaces:**
- Consumes: `AccessGuard`, `@Public()`, `@NoFarm()`, `permissionsFor`.
- Produces endpoints (all `@NoFarm()`):
  - `POST /api/auth/login {email,password}` → `200 {accessToken, user}` | `200 {twoFactorRequired:true, challengeToken}` | `200 {twoFactorSetupRequired:true, setupToken}` | `401 {message:'Identifiants invalides'}` | `423 {message:'Compte verrouillé…', lockedUntil}`. Sets `ap_refresh` cookie only when `accessToken` is returned.
  - `POST /api/auth/refresh` (cookie) → `200 {accessToken, user}` and rotates the cookie.
  - `POST /api/auth/logout` → 204, revokes the token, clears the cookie.
  - `GET /api/auth/me` → `{user, farms: {id,name}[], permissions, canSeeAllFarms}`.
  - `POST /api/auth/change-password {currentPassword,newPassword}` → 204.
  - `POST /api/auth/reset-password {token,newPassword}` → 204 (`@Public()`); reset tokens are issued in Task 6.
  - `user` shape: `{id, name, email, role, twoFactorEnabled}`.
- `hashPassword(p): Promise<string>`, `verifyPassword(hash,p): Promise<boolean>` (argon2id). Password policy: min 10 chars.
- `issueSession(user, res): Promise<{accessToken,user}>` in `tokens.service.ts` (used by Task 4).
- JWT claims: `{sub, role, org, stage: 'full'|'2fa'|'setup'}`; `AccessGuard` accepts only `stage:'full'` except on routes marked `@AllowStage('2fa'|'setup')`.
- Seed: organisation `AgriPilot`, farm `Ferme Kpalimé`, super admin from env `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD` (seed refuses to run without them).
- Rate limit: `@nestjs/throttler`, 10 requests/min per IP on `/auth/login`, `/auth/2fa/*`, `/auth/reset-password`.

- [ ] **Step 1: Write failing tests** (`auth.e2e-spec.ts`), each one `it`:
  - valid login for a non-mandatory role returns `accessToken`, `user.role`, and a `Set-Cookie: ap_refresh` with `HttpOnly`
  - wrong password → 401 with the same message as unknown email
  - 5 wrong passwords then the right one → 423; after moving `lockedUntil` into the past → 200 and `failedLogins` reset to 0
  - inactive user → 401
  - `refresh` with the cookie → new access token and a different cookie value
  - **reuse:** refresh with the old cookie after rotation → 401, and the newer token is also revoked (next refresh with it → 401)
  - `logout` then `refresh` → 401
  - `me` returns only assigned farms for `RESP_AVICOLE` and all farms for `PROPRIETAIRE`
  - `change-password` with wrong current password → 400; with a 6-char new password → 400
  - every login attempt writes a `LoginLog` row with the right `success`
- [ ] **Step 2:** Run — expect FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run — expect PASS.
- [ ] **Step 5:** Commit `feat(backend): login, rotating refresh tokens, lockout`.

### Task 4: Two-factor authentication

**Files:**
- Create: `backend/src/auth/two-factor.service.ts`, `two-factor.controller.ts`, `crypto.ts`
- Modify: `backend/src/auth/auth.service.ts` (login branches)
- Test: `backend/test/two-factor.e2e-spec.ts`

**Interfaces:**
- Consumes: `issueSession`, `@AllowStage`.
- Produces:
  - `POST /api/auth/2fa/setup` (stage `setup` or `full`) → `{otpauthUrl, qrDataUrl, secret}`; stores the secret encrypted (AES-256-GCM with `TOTP_ENC_KEY`), not yet enabled.
  - `POST /api/auth/2fa/enable {code}` (stage `setup` or `full`) → `{backupCodes: string[8]}` and, when called with a `setup` token, also the full session (`accessToken`, `user`, cookie).
  - `POST /api/auth/2fa/verify {code}` (stage `2fa`) → full session. `code` is a 6-digit TOTP or a backup code; a backup code works once.
  - `POST /api/auth/2fa/disable {password, code}` (stage `full`) → 204; 403 for the four mandatory roles.
  - `encrypt(text): string`, `decrypt(blob): string` in `crypto.ts`.
- TOTP: 30 s step, ±1 window, issuer `AgriPilot`. Backup codes: 8 codes of 10 chars, stored hashed.
- Login decision: 2FA enabled → `twoFactorRequired`; not enabled and role mandatory → `twoFactorSetupRequired`; else full session.

- [ ] **Step 1: Write failing tests:**
  - `COMPTABLE` without 2FA logs in → `twoFactorSetupRequired` and no `ap_refresh` cookie
  - the `setupToken` on `GET /api/auth/me` → 403 with `code: 'TWO_FACTOR_REQUIRED'`
  - setup → enable with a code generated from the returned secret → 8 backup codes + full session; `me` now works
  - enable with a wrong code → 400 and 2FA stays disabled
  - next login → `twoFactorRequired`; `verify` with a valid code → session; the `challengeToken` on `me` → 403
  - `verify` with a backup code works once, second time → 401
  - `disable` as `COMPTABLE` → 403; as `COMMERCIAL` with correct password and code → 204
  - the stored `totpSecretEnc` does not contain the plain secret
- [ ] **Step 2:** Run — expect FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run — expect PASS.
- [ ] **Step 5:** Commit `feat(backend): TOTP two-factor with backup codes`.

### Task 5: Audit and listing modules

**Files:**
- Create: `backend/src/audit/audit.service.ts`, `audit.interceptor.ts`, `audited.decorator.ts`, `audit.controller.ts`, `audit.module.ts`; `backend/src/listing/list-query.dto.ts`, `paginate.ts`, `export.ts`
- Test: `backend/src/listing/export.spec.ts`, `backend/test/audit.e2e-spec.ts`

**Interfaces:**
- Produces:
  - `AuditService.log(entry: {ctx?: RequestContext; userName?: string; module: string; action: AuditAction; recordId?: string; label?: string; before?: unknown; after?: unknown}): Promise<void>` — strips keys `passwordHash, totpSecretEnc, backupCodes, tokenHash` from `before`/`after`.
  - `@Audited(module: string, opts?: {label?: (record) => string})` on a controller method: the global `AuditInterceptor` logs CREATE for POST, UPDATE for PATCH/PUT (with `before` loaded through an optional `loadBefore` on the service, `after` = response), DELETE for DELETE. Failed requests are not logged.
  - `GET /api/audit` (`@RequirePermission('audit','read')`, farm optional) → paginated list, filters `search`, `module`, `from`, `to`.
  - `class ListQueryDto { search?: string; status?: string; page = 1; pageSize = 25 (max 200); sort?: string /* "field:asc|desc" */; format?: 'csv'|'xlsx' }`
  - `type Page<T> = { items: T[]; total: number; page: number; pageSize: number }`
  - `paginate<T>(q: ListQueryDto, find: (args:{skip:number;take:number}) => Promise<T[]>, count: () => Promise<number>): Promise<Page<T>>`
  - `type ExportColumn<T> = { header: string; value: (row: T) => string | number | null }`
  - `toCsv<T>(rows: T[], cols: ExportColumn<T>[]): string` — `;` separator, UTF-8 BOM, CRLF, quotes doubled, and a leading `'` added to any cell starting with `= + - @` (spreadsheet formula injection).
  - `toXlsx<T>(rows, cols, sheetName): Promise<Buffer>` (exceljs).
  - `sendExport(res, format, filename, rows, cols)` sets headers and sends.

- [ ] **Step 1: Write failing unit tests** (`export.spec.ts`): a row `{name: 'A;"b"', qty: 1000, note: '=1+1'}` yields the line `"A;""b""";1000;'=1+1`; output starts with `﻿`; `toXlsx` returns a buffer that exceljs reads back with the same header and values.
- [ ] **Step 2: Write failing e2e tests** (`audit.e2e-spec.ts`) with a test-only audited controller: POST creates one `AuditLog` (`action CREATE`, `userName`, `module`, `after`); PATCH records `before` and `after`; a request failing validation records nothing; a logged user object never contains `passwordHash`; `GET /api/audit` as `AGENT_ELEVAGE` → 403, as `AUDITEUR` → 200; successful login writes an audit row with `action LOGIN` (wire into Task 3's service).
- [ ] **Step 3:** Run — expect FAIL. **Step 4:** Implement. **Step 5:** Run — expect PASS.
- [ ] **Step 6:** Commit `feat(backend): audit trail and list/export helpers`.

### Task 6: Administration resources

**Files:**
- Create: `backend/src/admin/farms/*`, `sites/*`, `buildings/*`, `zones/*`, `users/*`, `settings/*`, `admin.module.ts`
- Test: `backend/test/admin.e2e-spec.ts`, `backend/test/users.e2e-spec.ts`

**Interfaces:**
- Consumes: `@RequirePermission`, `@Ctx`, `@Audited`, `ListQueryDto`, `paginate`, `sendExport`.
- Produces (every list returns `Page<T>` and honours `format`):
  - `GET|POST /api/farms`, `PATCH|DELETE /api/farms/:id` — module `fermes`, `@NoFarm()`. Creating a farm also creates no sites. Delete → 409 if it has buildings.
  - `GET|POST /api/sites`, `PATCH|DELETE /api/sites/:id` — module `batiments`. Delete → 409 `Ce site contient des bâtiments` if it has buildings.
  - `GET|POST /api/buildings`, `GET|PATCH|DELETE /api/buildings/:id` — module `batiments`. List item: `{id, name, type, siteId, siteName, capacity, occupation, occupationRate, status, zones: number}`. `occupation` comes from `BuildingsService.occupationOf(buildingIds: string[]): Promise<Map<string, number>>`, which returns 0 for all until slice 2 replaces its body with the herd ledger. List also returns `statusCounts: Record<status, number>` beside `items`.
  - `GET|POST /api/zones?buildingId=`, `PATCH|DELETE /api/zones/:id` — module `batiments`.
  - `GET|POST /api/users`, `PATCH /api/users/:id`, `DELETE /api/users/:id`, `POST /api/users/:id/reset-link` → `{url, expiresAt}` (one-time, 24 h; revokes the user's refresh tokens), `POST /api/users/:id/reset-2fa` → 204 — module `utilisateurs`, `@NoFarm()`. Create body `{name,email,role,farmIds[],password}`.
  - `GET /api/settings`, `PUT /api/settings/:key` — module `parametres`, `@NoFarm()`. Known keys with defaults: `currency "FCFA"`, `mortalityDailyPct 0.5`, `mortalityCumulPct 3`, `consumptionDeviationPct 25`, `expiryWarningDays 30`, `farrowingWarningDays 7`, `gestationDays 114`, `legal {name,address,nif,rccm}`. Unknown key → 400.
- Validation messages are French (shown as-is by the UI). Unique-name conflicts → 409 `Ce nom existe déjà`.
- All farm-owned queries filter by `ctx.farmId` (or `ctx.farmIds` when `allFarms`); a record of another farm is 404.

- [ ] **Step 1: Write failing tests** (`admin.e2e-spec.ts`):
  - building CRUD as `DIRECTEUR_FERME`; list returns `siteName`, `occupation 0`, `occupationRate 0`, and `statusCounts`
  - `search=poul` and `status=ACTIF` filter; `sort=capacity:desc` orders; `pageSize=2&page=2` pages
  - `?format=csv` → `text/csv` with header row `Nom;Type;Site;Capacité;Occupation;Statut;Taux occ.`
  - capacity `0` or `-5` → 400; duplicate name in the same farm → 409; same name in another farm → 201
  - **isolation:** building of farm B requested with farm A header → 404 on GET, PATCH and DELETE; listing under A never contains B's rows
  - `X-Farm-Id: all` as `PROPRIETAIRE` lists buildings of both farms; POST under `all` → 403
  - delete a site with buildings → 409; delete a farm with buildings → 409
  - `AGENT_ELEVAGE` can GET buildings, POST → 403
  - each write produced an `AuditLog` row with module `batiments`
- [ ] **Step 2: Write failing tests** (`users.e2e-spec.ts`):
  - `SUPER_ADMIN` creates a user; response has no `passwordHash`; the new user can log in
  - duplicate email → 409; unknown role → 400; `farmIds` containing a farm of another organisation → 400
  - `DIRECTEUR_FERME` on `/api/users` → 403; `AUDITEUR` GET → 200, POST → 403
  - **last super admin:** deleting, deactivating or changing the role of the only active `SUPER_ADMIN` → 409 `Au moins un Super Administrateur actif est requis`
  - `reset-link` returns a URL whose token works once on `/api/auth/reset-password` and fails the second time; an expired token → 400
  - `reset-2fa` clears the secret; next login of a mandatory role → `twoFactorSetupRequired`
  - `PUT /api/settings/gestationDays {value: 114}` → 200; `PUT /api/settings/nope` → 400
- [ ] **Step 3:** Run — expect FAIL. **Step 4:** Implement. **Step 5:** Run — expect PASS.
- [ ] **Step 6:** Commit `feat(backend): farms, sites, buildings, zones, users, settings`.

### Task 7: Dashboard endpoint

**Files:**
- Create: `backend/src/dashboard/dashboard.controller.ts`, `dashboard.service.ts`, `dashboard.types.ts`, `dashboard.module.ts`
- Test: `backend/test/dashboard.e2e-spec.ts`

**Interfaces:**
- Produces `GET /api/dashboard` (module `dashboard`, read) → `DashboardDto`, the contract later slices fill in without changing its shape:

```ts
type DashboardDto = {
  farmName: string;
  tasks: { done: number; pending: number };
  kpis: { poultryAlive: number; activePoultryBatches: number; pigs: number;
          eggsLastDay: number; layingRate: number | null; mortalityRate: number | null };
  eggSeries: { date: string; eggs: number }[];            // last 5 recorded days
  profitability: { revenue: number; expenses: number; margin: number; marginPct: number | null };
  activeBuildings: number;
  feedDistributedKg: number; waterConsumedL: number;       // last recorded day
  revenueVsExpenses: { activity: 'Avicole'|'Porcin'|'Général'; revenue: number; expenses: number }[];
  alerts: { total: number; items: { key: string; title: string; detail: string; level: 'A_VOIR'|'URGENT'; module: string }[] };
  upcomingTasks: { id: string; title: string; assignee: string; dueDate: string; priority: 'NORMALE'|'HAUTE'|'URGENTE' }[];
};
```

- In slice 1 only `farmName` and `activeBuildings` are real; numbers are `0`, rates `null`, arrays empty, `revenueVsExpenses` has the three activities at 0. Under `X-Farm-Id: all`, `farmName` is `Toutes les fermes`.
- Also `GET /api/alerts` → `{total: 0, items: []}` with the same item shape.

- [ ] **Step 1: Write failing test:** with 2 `ACTIF` buildings and 1 `MAINTENANCE` in farm A, `GET /api/dashboard` returns `activeBuildings: 2`, `farmName: 'Ferme Kpalimé'`, `kpis.mortalityRate: null`, `revenueVsExpenses` of length 3; with farm B header → `activeBuildings: 0`.
- [ ] **Step 2:** Run — FAIL. **Step 3:** Implement. **Step 4:** Run — PASS.
- [ ] **Step 5:** Commit `feat(backend): dashboard contract`.

### Task 8: Frontend scaffold, design tokens, shell

**Files:**
- Create: `frontend/` (Vite React TS), `src/styles/tokens.css`, `src/components/ui/{Button,Card,Pill,Input,Select,Dialog,Table}.tsx`, `src/components/shell/{nav.ts,Sidebar,Topbar,AppLayout}.tsx`, `src/lib/format.ts`
- Test: `src/lib/format.test.ts`, `src/components/shell/Sidebar.test.tsx`

**Interfaces:**
- Produces:
  - `NAV: { group: string | null; items: { slug: ModuleKey; label: string; to: string; icon: LucideIcon }[] }[]` with exactly the reference order and labels: (no group) Tableau de bord `/`, Alertes `/alertes`, Rapports `/rapports`; ADMINISTRATION Bâtiments, Fermes & sites `/admin/fermes`, Utilisateurs `/admin/utilisateurs`, Paramètres `/admin/parametres`; PRODUCTION Lots avicoles, Ponte & œufs, Cheptel porcin, Reproduction, Alimentation & eau; SANTÉ Santé & biosécurité; LOGISTIQUE Stocks; COMMERCIAL Fournisseurs, Achats, Clients, Ventes; FINANCE Dépenses & recettes; OPÉRATIONS Tâches & personnel, Équipements; (no group, last) Journal d'audit `/audit`.
  - `<Sidebar permissions alertCount />` hides items whose module lacks `read`; hides a group with no visible item. Active item: ink-soft pill with a green icon chip, as in `home.png`.
  - `<AppLayout>`: sidebar 256 px fixed on ≥ 1024 px, off-canvas drawer with a menu button below; top bar with `Rechercher un module…` (filters NAV, Enter navigates) and the bell with red dot linking to `/alertes`.
  - `Pill` tones: `success | warning | danger | neutral` (dot + label, as the reference status pills).
  - `formatNumber(11570) === '11 570'` (narrow no-break space as thousands separator, as the reference), `formatMoney(3970000) === '3 970 000 FCFA'`, `formatPct(3.6) === '3.6%'`, `formatDate('2026-10-22T00:00:00Z') === '2026-10-22'`.
- Tailwind theme maps the tokens (`bg-background`, `bg-card`, `text-muted-foreground`, `bg-primary`, `bg-ink`, `rounded-[var(--radius)]`…); headings use the `font-display` family.

- [ ] **Step 1:** Scaffold, install dependencies, copy tokens.
- [ ] **Step 2: Write failing tests:** the four `format` assertions above; `Sidebar` rendered with permissions of `AGENT_ELEVAGE` shows `Lots avicoles` and not `Dépenses & recettes`, `Utilisateurs` or the `FINANCE` heading; with `alertCount={14}` the Alertes item shows `14`.
- [ ] **Step 3:** Run `npm test` — FAIL. **Step 4:** Implement. **Step 5:** Run — PASS; `npm run build` succeeds.
- [ ] **Step 6:** Commit `feat(frontend): design tokens, UI primitives and app shell`.

### Task 9: API client, auth flow, farm switcher

**Files:**
- Create: `src/lib/api.ts`, `src/lib/auth.tsx`, `src/pages/Login.tsx`, `src/pages/Account.tsx`, `src/pages/ResetPassword.tsx`, `src/components/shell/FarmSwitcher.tsx`, `src/App.tsx` (router)
- Test: `src/lib/api.test.ts`, `src/pages/Login.test.tsx`

**Interfaces:**
- Consumes: Task 3/4 endpoints, `DashboardDto`.
- Produces:
  - `api.get<T>(path, params?)`, `api.post<T>(path, body?)`, `api.patch<T>`, `api.put<T>`, `api.del(path)`, `api.download(path, params, filename)`. Base URL `import.meta.env.VITE_API_URL ?? '/api'`; sends `credentials: 'include'`, `Authorization`, and `X-Farm-Id` from the current farm. On a 401 it calls `/auth/refresh` once (concurrent 401s share one refresh) and retries; if refresh fails it clears the session and redirects to `/login`. Throws `ApiError {status, message, code?}` with the server's French message.
  - `useAuth(): { user, farms, farmId, setFarmId, canSeeAllFarms, can(module, action), login(email,password), verify2fa(code), logout() }`. `farmId` is remembered in `localStorage` key `ap_farm` (try/catch) and falls back to the first farm; changing it invalidates all queries.
  - Routes: `/login`, `/reset/:token` public; everything else inside `<RequireAuth>` + `<AppLayout>`; a route whose module lacks `read` renders a 403 card `Accès non autorisé`.
  - `Login.tsx` steps: credentials → (if `twoFactorRequired`) 6-digit code or backup code → (if `twoFactorSetupRequired`) QR + code, then shows the 8 backup codes once with a "J'ai enregistré mes codes" confirm.
  - `Account.tsx` (`/compte`): change password; enable/disable 2FA.
  - `FarmSwitcher` at the sidebar foot: user initials avatar, name, active farm (as `SA / Super Admin / Ferme Kpalimé` in the reference), opens a menu of farms (+ `Toutes les fermes` when allowed), `Mon compte`, `Déconnexion`.
- Dev: Vite proxies `/api` to `http://localhost:3000`.

- [ ] **Step 1: Write failing tests** (`api.test.ts`, fetch mocked): adds `Authorization` and `X-Farm-Id`; on 401 refreshes once and retries with the new token; two parallel 401s trigger a single refresh call; failed refresh rejects with `ApiError` 401 and clears the token; a 409 body `{message:'Ce nom existe déjà'}` surfaces as `error.message`.
- [ ] **Step 2: Write failing tests** (`Login.test.tsx`): wrong credentials show `Identifiants invalides`; a `twoFactorRequired` response shows the code field; a 423 shows the locked message.
- [ ] **Step 3:** Run — FAIL. **Step 4:** Implement. **Step 5:** Run — PASS.
- [ ] **Step 6:** Commit `feat(frontend): API client, login with 2FA, farm switcher`.

### Task 10: ModulePage kit, Bâtiments and admin pages

**Files:**
- Create: `src/components/module/{types.ts,ModulePage.tsx,StatTiles.tsx,DataTable.tsx,RecordDialog.tsx,ConfirmDialog.tsx}`, `src/modules/{index.ts,batiments.tsx}`, `src/pages/ModuleRoute.tsx`, `src/pages/ComingSoon.tsx`, `src/pages/admin/{Farms.tsx,Users.tsx,Settings.tsx}`
- Test: `src/components/module/ModulePage.test.tsx`

**Interfaces:**
- Produces (`types.ts`) — the contract every later module config uses:

```ts
type Field =
  | { name: string; label: string; type: 'text'|'number'|'date'|'textarea'; required?: boolean; min?: number }
  | { name: string; label: string; type: 'select'; required?: boolean;
      options: { value: string; label: string }[] | { endpoint: string; valueKey?: string; labelKey?: string } };
type Column<T> = { key: string; header: string; align?: 'left'|'right';
                   render?: (row: T) => ReactNode; sortable?: boolean };
type StatusDef = { value: string; label: string; tone: 'success'|'warning'|'danger'|'neutral' };
type ModuleConfig<T extends { id: string }> = {
  slug: ModuleKey; group: string; title: string; subtitle: string;
  endpoint: string;                       // e.g. '/buildings'
  columns: Column<T>[]; fields: Field[];
  statuses?: StatusDef[]; statusKey?: keyof T;
  statTiles?: 'statuses' | 'totalOnly';   // tiles: "Total enregistrements" + first 3 statuses
  toForm?: (row: T) => Record<string, unknown>;
  detailPath?: (row: T) => string; qr?: boolean;
  tabs?: { key: string; label: string; element: ReactNode }[];
};
```

  - `<ModulePage config />` reproduces `m_batiments.png` / `m_lots.png`: breadcrumb group, title, subtitle; `Exporter` (menu CSV / Excel → `api.download(endpoint, {format})`) and green `Ajouter`; stat tiles; card with `Rechercher…` (debounced 300 ms → `search`), status select (`Tous les statuts` + statuses), table with uppercase muted headers, status pills, row actions (QR when `qr`, edit, delete); pagination footer shown only when `total > pageSize`; empty state `Aucun enregistrement`; `Ajouter`, edit and delete are hidden without the matching permission.
  - `RecordDialog` builds the form from `fields`, shows server validation messages under the form, disables submit while saving.
  - `modules/index.ts`: `MODULES: Partial<Record<ModuleKey, ModuleConfig<any>>>`; `ModuleRoute` renders `ModulePage` for a configured slug and `ComingSoon` (same header, card `Module en cours de construction`) for the others.
  - `batiments` config: columns `NOM, TYPE, SITE, CAPACITÉ, OCCUPATION, STATUT, TAUX OCC.` (rate as a pill: ≥ 90 % warning, else success, 0 % neutral); statuses `ACTIF→Actif (success)`, `VIDE_SANITAIRE→Vide sanitaire (warning)`, `MAINTENANCE→Maintenance (danger)`; fields name, type, site (select from `/sites`), capacity (min 1), status; tab `Zones`.
  - `Farms.tsx`: farms list + sites of the active farm, both through `ModulePage`. `Users.tsx`: columns Nom, Email, Rôle (French labels), Fermes, 2FA, Statut; row actions edit, `Lien de réinitialisation` (shows the URL to copy), `Réinitialiser 2FA`. `Settings.tsx`: one form for the known setting keys.
- Role labels (exact): Super Administrateur, Propriétaire / Direction, Directeur de ferme, Responsable avicole, Responsable porcin, Vétérinaire, Responsable stock, Comptable, Commercial, Agent d'élevage, Magasinier, Auditeur.

- [ ] **Step 1: Write failing tests** (`ModulePage.test.tsx`, API mocked) with the `batiments` config: renders the 7 headers and a row `Poulailler A`; tiles show `Total enregistrements 6`, `Actif 5`; typing in search requests `search=poul`; choosing `Maintenance` requests `status=MAINTENANCE`; `Ajouter` opens a dialog and submit POSTs `/buildings` then refetches; a 409 from the server shows `Ce nom existe déjà` in the dialog and keeps it open; with read-only permissions there is no `Ajouter` and no edit/delete buttons; delete asks for confirmation and a 409 shows the server message.
- [ ] **Step 2:** Run — FAIL. **Step 3:** Implement. **Step 4:** Run — PASS.
- [ ] **Step 5:** Commit `feat(frontend): module page kit, bâtiments and administration`.

### Task 11: Dashboard, Alertes, Rapports, Journal d'audit pages

**Files:**
- Create: `src/pages/Dashboard.tsx`, `src/pages/dashboard/{KpiCard,EggChart,ProfitCard,FarmTile,RevenueBars,AlertsCard,TasksCard}.tsx`, `src/pages/Alerts.tsx`, `src/pages/Reports.tsx`, `src/pages/Audit.tsx`, `src/assets/farm.jpg`
- Test: `src/pages/Dashboard.test.tsx`

**Interfaces:**
- Consumes: `DashboardDto`, `/alerts`, `/audit`, `formatNumber`, `formatMoney`.
- Layout copies `home.png` exactly: greeting `Bonjour 👋 — {farmName}`, title `Tableau de bord`; segmented `Tâches terminées n | En attente n`; black `+ Nouvelle tâche` → `/m/taches`; row of 4 KPI cards (first one ink-black: `Volailles vivantes`, sub `n lots en cours`; `Porcs` / `Cheptel actif`; `Œufs (dernier jour)` / `Taux de ponte n%`; `Mortalité lots` / `Lots avicoles en cours`); `Production d'œufs` area chart with `Voir tout` → `/m/ponte`; green gradient `Rentabilité du mois` card with donut `Marge n%` and the three money lines; farm photo tile with pill `n bâtiments actifs` and glass tiles `Aliment distribué` / `Eau consommée`; `Recettes vs dépenses` grouped bars; `Alertes ouvertes (n)` list with `À voir` / `Urgent` pills; `Tâches à venir` table with `Gérer`.
- Null rates render as `—`; empty series render the card with `Aucune donnée pour le moment` instead of an empty chart.
- `farm.jpg`: a licence-free aerial farm photo generated or sourced without copying the reference's image file; if none can be obtained, a CSS gradient + pattern placeholder of the same size.
- `Alerts.tsx`: header `Alertes & notifications`, subtitle `n alertes ouvertes, calculées automatiquement à partir de vos données.`, list as `alertes.png`, empty state. `Reports.tsx`: header `Rapports` / `Synthèse au {dd/mm/yyyy}`, buttons `CSV`, `Imprimer / PDF`, indicator table built from `DashboardDto` (same 12 rows as `rapports.png`). `Audit.tsx`: columns `DATE, UTILISATEUR, ACTION, MODULE, ÉLÉMENT`, `Exporter`, empty text `Aucune action enregistrée pour le moment.`; no "Réinitialiser les données" button (that was a prototype feature).

- [ ] **Step 1: Write failing test:** given a `DashboardDto` with the reference's values (11570, 245, 2480, layingRate 87, mortalityRate 3.6, revenue 3970000, expenses 2835000, margin 1135000, marginPct 29, activeBuildings 5), the page shows `11 570`, `245`, `2 480`, `Taux de ponte 87%`, `3.6%`, `3 970 000 FCFA`, `29%`, `5 bâtiments actifs`; given the slice-1 empty DTO it shows `—` for mortality and `Aucune donnée pour le moment`.
- [ ] **Step 2:** Run — FAIL. **Step 3:** Implement. **Step 4:** Run — PASS.
- [ ] **Step 5:** Commit `feat(frontend): dashboard, alertes, rapports, audit`.

### Task 12: Run-it-all, end-to-end check, visual comparison

**Files:**
- Create: `docker-compose.yml`, `backend/Dockerfile`, `frontend/Dockerfile`, `frontend/nginx.conf`, `README.md`, `frontend/e2e/{auth.spec.ts,batiments.spec.ts,visual.spec.ts}`, `frontend/playwright.config.ts`, `scripts/dev.sh`

**Interfaces:**
- `scripts/dev.sh`: starts the database, runs migrations + seed, starts API (3000) and web (5173).
- `docker-compose.yml`: `db` (postgres:16, volume), `api` (runs `prisma migrate deploy` then starts; volume for `uploads/`), `web` (nginx serving the build, proxying `/api` to `api`, SPA fallback, `Cache-Control: no-cache` for `index.html`, long cache for hashed assets). Secrets come from a root `.env` (documented in README, not committed).
- README: what it is, prerequisites, dev and docker start, first login, environment variables, test commands, `pg_dump` backup/restore procedure, slice status.

- [ ] **Step 1: Write Playwright tests** (run against `scripts/dev.sh`, Chromium at the pre-installed path, `--trace off`):
  - `auth.spec.ts`: seeded super admin logs in → forced 2FA setup (code computed in the test from the shown secret) → backup codes → lands on `Tableau de bord`; logout; login again asks for a code; reload keeps the session (refresh cookie).
  - `batiments.spec.ts`: create site `Site Nord`, create `Poulailler A` capacity 5000, see it in the table with pill `Actif`; duplicate name shows `Ce nom existe déjà`; delete it; an `AUDITEUR` user sees no `Ajouter`; `Journal d'audit` lists the create.
  - `visual.spec.ts`: at 1440×900 capture `/` and `/m/batiments` into `docs/reference/built/`; assert sidebar width 256 px, `getComputedStyle(body).fontFamily` starts with `Manrope`, h1 font family `Plus Jakarta Sans`, the primary button background equals the token; at 390×844 assert no horizontal scroll (`scrollWidth <= clientWidth`) and the drawer opens.
- [ ] **Step 2:** Run all backend and frontend tests and the Playwright suite — all PASS.
- [ ] **Step 3:** Open the two captures beside `docs/reference/screens/home.png` and `m_batiments.png`; fix every visible difference in spacing, colour, radius, type size; re-run.
- [ ] **Step 4:** `docker compose config` validates (the Docker daemon is not available in the build container; note this in the README as not run here).
- [ ] **Step 5:** Commit `feat: docker setup, README, end-to-end tests` and push.

---

## Self-review notes

- Spec coverage for slice 1: auth + 2FA (T3, T4), roles and farm scoping (T2), admin tables (T1, T6), audit (T5), exports CSV/XLSX (T5, used T6), shell + tokens + fonts (T8), ModulePage kit (T10), dashboard contract (T7, T11), responsive (T12), security items — validation (T1), rate limit and lockout (T3), headers (T1 bootstrap), least privilege (T2). Attachments, QR, real alerts and print layouts belong to later slices.
- Review Focus items map to tests in T2/T6 (1), T3 (2), T4 (3), T6 (4), T6/T10 (5).
