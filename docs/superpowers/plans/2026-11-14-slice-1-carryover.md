# Slice 1 — carry-over for later slices

Items found during slice 1 reviews and deliberately left for later. Slice 2 starts with the first section.

## First task of slice 2
- App-level `ErrorBoundary` with retry around lazy-loaded chunks (a failed chart download currently blanks the page).
- `ModuleConfig` additions needed by the production modules: detail page route `/m/:module/:id` (`detail` component), per-row `canEdit`/`canDelete`, a custom `form` component for documents with line items, `params` on endpoint options and dependent selects, parent-scoped embedded lists with create defaults, tabs holding either a config or an element, field types `time`, `file`, number `max`/`step`.
- Backend: require at least one farm for farm-limited roles on user create/update (currently only checked in the UI).
- Building delete must be refused while occupied (herd ledger).

## Deferred minor findings (from task and final reviews)
- Task 1: minor (deferred): resetDb has no guard that DB name ends in _test → carry into Task 3 dispatch
- Task 1: minor (deferred): CORS fails open if WEB_ORIGIN unset; no startup env validation → carry into Task 3 dispatch
- Task 1: minor (deferred): ConfigModule imported but unused / dotenv loaded twice
- Task 1: minor (deferred): health returns 500 not {db:'down'} when DB down; no enableShutdownHooks
- Task 1: minor (deferred): dev DB role SUPERUSER; no FK indexes on farmId; weak swagger test
- Task 2: minor (deferred): non-full stages skip farm scoping (document on AllowStage); dead cleanup call access.e2e-spec.ts:243; no test for org-mismatch / PROPRIETAIRE all=200; Ctx undefined on @Public; eslint synckit warning
- Task 3: minor (deferred): rotation not one transaction; change-password has no guess limit; dead length check in resetPassword; MaxLength magic number; lazy dummy hash; unused @nestjs/config dep; service takes Express req/res; 423 reveals account existence; report inaccuracy re logout
- Task 3: minor (deferred): claim-race with concurrent logout calls revokeAll (tiny window); no TRUST_PROXY test; weak interleaving test
- Task 4: minor (deferred): disable password oracle outside lockout; enable with full token needs no password re-check; loose base64 key parsing; no AAD; decrypt failure → 500; spaces in code; lastLoginAt before 2nd factor; guard-before-throttler for unauthenticated 2FA calls
- Task 5: minor (deferred): add /api/audit header-path 403 tests (unassigned farm, other org, all) → carried into T6; `all` vs no-header differ on null-farm rows; invalid calendar dates shift silently; export truncates at 10k silently; csv exponent notation; sanitize ignores toJSON (Decimal) → fix before money routes (slice 2+); findForAudit before pipes; migration no backfill
- Task 8: minor (deferred): mobile drawer aria-modal without focus trap/Escape; no tests for Topbar search/Dialog; formatDate throws on invalid date; text-white vs ink-foreground; unmapped tokens (chart-*, popover-foreground…) in @theme → needed by T11 charts, carry to T11; bell a11y label; fragile input height override
- Task 6: minor (deferred): last-admin check uses stale target snapshot (narrow 3-request race) → re-read FOR UPDATE in tx; user-delete history counts outside tx; name uniqueness inconsistent (farms CI, sites/buildings CS, zones manual, races → 500); building delete cascades zones w/o audit (slice 2 occupancy guard); export cap 10k silent; settings legal no length limit; settings audit no before; test setup POSTs lack expect(201); global unique email reveals other-tenant existence
- Task 7: minor (deferred): missing farm row reports as "Toutes les fermes"; `all` test can't distinguish (add farm-B building); no missing-header / no-permission tests on the two routes
- Task 9: minor (deferred): cross-tab refresh race (Web Locks); test gaps (ResetPassword, Account, 429, failed boot restore); mandatory roles duplicated client-side (expose flag in /auth/me)
- Task 8: minor (deferred): group margin keyed by index drifts 2px for restricted roles; shell.png stale (re-capture in T12)
- Task 9: minor (deferred): no test for cancelQueries ordering / from-not-carried-after-logout / rapid double farm switch
- Task 10: minor (deferred): missing tests (export menu, QR hidden, skeletons, reset 2FA, zones tab, settings read-only); empty location sends ''; zone capacity can't be cleared; settings PUTs sequential partial save; clipboard failure silent; farm switcher not refreshed after farm create (→ fold: reload /auth/me after farm write)
- Task 11: minor (deferred): chart plot offsets 4–7px; CSV filename UTC date; brittle test locator; "0 alerte ouverte" singular
- Task 10: minor (deferred): no tests for multi-page options, /auth/me reload after farm write, hidden tab, emptyText; Farms title now "Fermes" (nav label "Fermes & sites"); success notices auto-dismiss 5s
- Task 11: minor (deferred): CSV decimals use dot (fr Excel); flat small series gives negative axis min; AlertsCard count flashes dashboard total; no farm-switch test for Audit placeholder
- Task 12: minor (deferred): devDependencies in runtime image; nginx master as root; title y not asserted; e2e waitFor accepts leftover servers; volume name prefix in README
- Task 12: minor (deferred): dev.sh exits 0 when a server crashes; configure-app.spec env restore writes "undefined"
- Final fix wave re-review (backend): B1–B14 all ADDRESSED, no new Critical/Important. Parked minors: disable does not count wrong TOTP codes; P2003 message also for missing-parent FK; FarmsService.scope conversion not verified by re-reviewer.
- Ruling: parked — ErrorBoundary for lazy chunks (real, load-bearing for UX) becomes the first task of the slice 2 plan together with the ModuleConfig additions; no second fix wave per process — cost if wrong: a failed chart download shows a blank page until slice 2 task 1 lands.
- Ruling: parked — F7 2px subtitle margin / forced button height, F15 double-Escape in drawer+menu — cosmetic.
