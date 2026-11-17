import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { after, before, describe, it } from 'node:test';
import type { Browser, Locator, Page } from 'playwright';
import {
  api, apiLogin, enrollAdmin, enrollUser, launch, newPage, PASSWORD, uiLoginWithBackupCode, uiLoginWithPassword, WEB_URL,
  type EnrolledAdmin, type EnrolledUser,
} from './helpers.ts';

/** Text with every kind of space (thin, no-break) turned into a plain one, so `150 000` matches however it is grouped. */
const flat = (text: string) => text.replace(/\s+/g, ' ').trim();
const day = (offset: number) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);
/** A 1x1 PNG: the proof photo of a task. */
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

// The operations flow of slice 5, one role per step, through the real UI; set-up that is not the point of a step goes
// through the API. The tests below run in order and SHARE STATE (one farm, two employees, one recurring task, one
// piece of equipment...), as in commerce.spec.ts.
//
// The figures are worked out here:
// - salaries: Kodjo A. 150 000 + Yawa M. 120 000 = 270 000 for the month (payroll prefill, no proration).
// - the weekly task is due YESTERDAY: completing it creates the next occurrence one week after ITS due date (not after the
//   completion date), so the new row is due today + 6; it was overdue (an alert) until completed.
// - the corrective intervention costs 30 000: the finance view lists it as an Entretien expense, derived, not typed.
describe('opérations : personnel, tâches, équipements, rapports, QR et alertes', () => {
  let browser: Browser;
  let admin: EnrolledAdmin;
  let farmId = '';
  const lots: { id: string; code: string }[] = [];
  let buildingBId = '';
  let equipmentId = '';
  const users: Record<string, EnrolledUser | { email: string }> = {};
  const emails = {
    director: 'directeur-ops@e2e.test',
    accountant: 'comptable-ops@e2e.test',
    avicole: 'resp-avicole-ops@e2e.test',
    agent: 'agent-ops@e2e.test',
    commercial: 'commercial-ops@e2e.test',
    storekeeper: 'magasinier-ops@e2e.test',
  };
  const EQUIPMENT = 'Ventilateur Poulailler B #3';
  const WEEKLY = (code: string) => `Pesée hebdomadaire ${code}`;
  const ONE_OFF = 'Nettoyer les abreuvoirs';
  const YAWA_TASK = 'Compter les plateaux';
  const month = new Date().toISOString().slice(0, 7);

  const call = <T = { id: string }>(path: string, method = 'GET', body?: unknown) => api<T>(path, { method, token: admin.token, farmId, body });

  /** A browser session of one role (a fresh context: the roles never share a session), on the flow's farm. */
  async function asRole(email: string): Promise<Page> {
    const { page } = await newPage(browser);
    await page.addInitScript((farm) => localStorage.setItem('ap_farm', farm), farmId);
    const user = users[email] as EnrolledUser | undefined;
    if (user && 'backupCodes' in user) await uiLoginWithBackupCode(page, email, user.backupCodes.shift()!);
    else await uiLoginWithPassword(page, email);
    await page.getByRole('heading', { name: 'Tableau de bord' }).waitFor();
    return page;
  }

  /** Picks the option of a select whose text contains `text` (waits for the options a request brings). */
  async function pick(select: Locator, text: string): Promise<void> {
    const handle = await select.elementHandle();
    assert.ok(handle, 'the select exists');
    await select.page().waitForFunction(
      ([el, wanted]) => Array.from((el as HTMLSelectElement).options).some((o) => (o.textContent ?? '').replace(/\s+/g, ' ').includes(wanted as string)),
      [handle, text],
      { timeout: 10_000 },
    ).catch(() => undefined); // the assertion below names the options that did arrive
    const options = await select.locator('option').evaluateAll((els) => els.map((e) => ({ value: (e as HTMLOptionElement).value, text: e.textContent ?? '' })));
    const found = options.find((o) => flat(o.text).includes(text));
    assert.ok(found, `an option contains « ${text} » (got ${JSON.stringify(options.map((o) => flat(o.text)))})`);
    await select.selectOption(found.value);
  }

  const mainText = async (page: Page) => flat(await page.locator('main').innerText());
  const mainShows = (page: Page, re: RegExp) =>
    page.waitForFunction(
      ([source, flags]) => new RegExp(source, flags).test(document.querySelector('main')?.innerText.replace(/[\s  ]+/g, ' ') ?? ''),
      [re.source, re.flags] as const,
    );
  /** The number the bell announces (`Alertes (3 ouvertes)`), 0 when it announces none. */
  async function bell(page: Page): Promise<number> {
    const label = (await page.locator('header a[aria-label^="Alertes"]').getAttribute('aria-label')) ?? '';
    return Number(/\((\d+)/.exec(label)?.[1] ?? 0);
  }
  /** Polls a condition (a count that follows a refetch) for up to 10 s. */
  async function until(check: () => Promise<boolean>): Promise<void> {
    for (let i = 0; i < 100; i += 1) {
      if (await check()) return;
      await new Promise((r) => setTimeout(r, 100));
    }
    assert.fail('the condition did not hold within 10 s');
  }
  const rowOf = (page: Page, re: RegExp) => page.getByRole('row', { name: re });

  before(async () => {
    browser = await launch();
    admin = await enrollAdmin('operations');
    // A farm of its own: the seeded one is shared with the other specs, so the figures below are exactly this flow's.
    farmId = (await api<{ id: string }>('/farms', { method: 'POST', token: admin.token, body: { name: 'Ferme Opérations' } })).id;

    const roles: [string, string, string][] = [
      [emails.director, 'DIRECTEUR_FERME', 'Directrice Opérations'],
      [emails.accountant, 'COMPTABLE', 'Comptable Opérations'],
      [emails.avicole, 'RESP_AVICOLE', 'Responsable Avicole'],
      [emails.agent, 'AGENT_ELEVAGE', 'Agent Kodjo'],
      [emails.commercial, 'COMMERCIAL', 'Commercial Opérations'],
      [emails.storekeeper, 'MAGASINIER', 'Magasinier Opérations'],
    ];
    for (const [email, role, name] of roles) await call('/users', 'POST', { name, email, role, farmIds: [farmId], password: PASSWORD });
    for (const email of [emails.director, emails.accountant]) users[email] = await enrollUser(email);

    const site = await call('/sites', 'POST', { name: 'Site Opérations' });
    const house = (name: string, capacity: number) => call('/buildings', 'POST', { name, type: 'AVICOLE', siteId: site.id, capacity, status: 'ACTIF' });
    const a = await house('Poulailler A', 6000);
    buildingBId = (await house('Poulailler B', 6000)).id;
    for (const buildingId of [a.id, buildingBId, a.id]) {
      const lot = await call<{ id: string; code: string }>('/batches', 'POST', { species: 'AVICOLE', type: 'CHAIR', buildingId, entryDate: day(-20), initialCount: 1000 });
      lots.push(lot);
    }
  });

  after(async () => {
    await browser?.close();
  });

  it('Directeur : crée les employés Kodjo A. (lié au compte de l’agent) et Yawa M., avec leur salaire', async () => {
    const page = await asRole(emails.director);
    await page.goto(`${WEB_URL}/m/taches`);
    await page.getByRole('tab', { name: 'Employés' }).click();
    const agentOption = 'Agent Kodjo';
    for (const [name, job, salary, link] of [['Kodjo A.', 'Ouvrier avicole', '150000', agentOption], ['Yawa M.', 'Ouvrière', '120000', '']] as const) {
      await page.getByRole('button', { name: 'Ajouter' }).click();
      const dialog = page.getByRole('dialog');
      await dialog.getByLabel('Nom affiché').fill(name);
      await dialog.getByLabel('Poste').fill(job);
      await dialog.getByLabel("Date d'embauche").fill(day(-30));
      await dialog.getByLabel('Salaire mensuel (FCFA)').fill(salary);
      if (link) await pick(dialog.getByLabel('Compte utilisateur'), link);
      await dialog.getByRole('button', { name: 'Enregistrer' }).click();
      await dialog.waitFor({ state: 'detached' });
    }
    const kodjo = rowOf(page, /Kodjo A\./);
    await kodjo.waitFor();
    assert.match(flat(await kodjo.innerText()), /Kodjo A\. Ouvrier avicole CDI .* Actif 150 000 FCFA/);
    assert.match(flat(await rowOf(page, /Yawa M\./).innerText()), /Yawa M\. Ouvrière CDI .* Actif 120 000 FCFA/);
    await page.getByRole('columnheader', { name: 'SALAIRE MENSUEL' }).waitFor();
    // The user is linked once: the second employee cannot take the same account.
    const linked = await call<{ items: { name: string; userName: string | null }[] }>('/employees');
    assert.equal(linked.items.find((e) => e.name === 'Kodjo A.')?.userName, 'Agent Kodjo');
    await page.context().close();
  });

  it('Responsable avicole : saisit la journée de présence ; il ne voit aucun salaire', async () => {
    const page = await asRole(emails.avicole);
    await page.goto(`${WEB_URL}/m/taches`);
    await page.getByRole('tab', { name: 'Présences' }).click();
    await page.getByRole('button', { name: 'Ajouter' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByText('Employé ligne 1').waitFor({ state: 'attached' });
    const names = await dialog.locator('p', { hasText: /Employé ligne \d :/ }).allInnerTexts();
    assert.deepEqual(names.map((n) => flat(n).replace(/^Employé ligne \d : /, '')).sort(), ['Kodjo A.', 'Yawa M.']);
    const at = (name: string) => names.findIndex((n) => n.includes(name)) + 1;
    await dialog.getByLabel(`Heures ligne ${at('Kodjo A.')}`).fill('8');
    await dialog.getByLabel(`Statut ligne ${at('Yawa M.')}`).selectOption({ label: 'Absent' });
    await dialog.getByLabel(`Note ligne ${at('Yawa M.')}`).fill('Malade');
    await dialog.getByRole('button', { name: 'Enregistrer' }).click();
    await dialog.waitFor({ state: 'detached' });
    const kodjo = rowOf(page, /Kodjo A\./);
    await kodjo.waitFor();
    assert.match(flat(await kodjo.innerText()), /Kodjo A\. Présent 8/);
    assert.match(flat(await rowOf(page, /Yawa M\./).innerText()), /Yawa M\. Absent .*Malade/);

    // No salary for a role without finance:read: no column, no figure in the API either.
    await page.getByRole('tab', { name: 'Employés' }).click();
    await rowOf(page, /Kodjo A\./).waitFor();
    assert.equal(await page.getByRole('columnheader', { name: 'SALAIRE MENSUEL' }).count(), 0);
    const token = await apiLogin(emails.avicole);
    const list = await api<{ items: { monthlySalary: number | null }[] }>('/employees', { token, farmId });
    assert.deepEqual(list.items.map((e) => e.monthlySalary), [null, null]);
    // The employees are master data: this role records attendance but adds no employee.
    assert.equal(await page.getByRole('button', { name: 'Ajouter' }).count(), 0);
    await page.context().close();
  });

  it('Responsable avicole : crée « Pesée hebdomadaire » pour Kodjo, hebdomadaire, échue hier ; Alertes la signale', async () => {
    const page = await asRole(emails.avicole);
    await page.goto(`${WEB_URL}/m/taches`);
    await page.getByRole('button', { name: 'Ajouter' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('Tâche', { exact: true }).fill(WEEKLY(lots[0].code));
    await pick(dialog.getByLabel('Responsable'), 'Kodjo A.');
    await dialog.getByLabel('Échéance').fill(day(-1));
    await pick(dialog.getByLabel('Récurrence'), 'Chaque semaine');
    await dialog.getByRole('radio', { name: 'Lot' }).click();
    await pick(dialog.getByLabel('Lot', { exact: true }), lots[0].code);
    await dialog.getByRole('button', { name: 'Enregistrer' }).click();
    await dialog.waitFor({ state: 'detached' });
    const row = rowOf(page, new RegExp(WEEKLY(lots[0].code)));
    await row.waitFor();
    assert.match(flat(await row.innerText()), new RegExp(`${WEEKLY(lots[0].code)} Kodjo A\\. ${day(-1)} Normale À faire`));

    // The other tasks of the flow: a one-off one for Kodjo, one for Yawa (who has no account), and the late-task alert.
    const kodjo = (await call<{ items: { id: string; name: string }[] }>('/employees/options')).items;
    const id = (name: string) => kodjo.find((e) => e.name === name)!.id;
    await call('/tasks', 'POST', { title: ONE_OFF, assigneeId: id('Kodjo A.'), dueDate: day(1), priority: 'HAUTE' });
    await call('/tasks', 'POST', { title: YAWA_TASK, assigneeId: id('Yawa M.'), dueDate: day(1) });

    await page.goto(`${WEB_URL}/alertes`);
    const alert = page.getByRole('listitem').filter({ hasText: 'Tâche en retard' });
    await alert.waitFor();
    assert.match(flat(await alert.innerText()), new RegExp(`Tâche en retard ${WEEKLY(lots[0].code)} \\(Kodjo A\\.\\)`));
    await page.context().close();
  });

  it('Agent : « Mes tâches », Démarrer puis Terminer avec photo ; la tâche suivante est créée ; la preuve s’ouvre ; rien sur la tâche de Yawa', async () => {
    const page = await asRole(emails.agent);
    await page.goto(`${WEB_URL}/m/taches`);
    await rowOf(page, new RegExp(WEEKLY(lots[0].code))).waitFor();
    // The agent advances tasks but creates none: no Ajouter, no edit icon.
    assert.equal(await page.getByRole('button', { name: 'Ajouter' }).count(), 0);
    assert.equal(await page.getByRole('button', { name: 'Modifier' }).count(), 0);
    await page.getByLabel('Toutes les tâches').selectOption({ label: 'Mes tâches' });
    await mainShows(page, /Pesée hebdomadaire/);
    // Wait for the filtered list itself (the other user's row leaves) before asserting its absence.
    await rowOf(page, new RegExp(YAWA_TASK)).waitFor({ state: 'detached' });
    assert.equal(await page.getByText(YAWA_TASK).count(), 0, 'only Kodjo’s tasks under « Mes tâches »');
    // Everything again: Yawa's task shows, with no Démarrer for this agent.
    await page.getByLabel('Toutes les tâches').selectOption({ label: 'Toutes les tâches' });
    const yawa = rowOf(page, new RegExp(YAWA_TASK));
    await yawa.waitFor();
    assert.equal(await yawa.getByRole('button', { name: 'Démarrer' }).count(), 0);
    assert.equal(await yawa.getByRole('button', { name: 'Terminer' }).count(), 0);
    // The API says the same: not the agent's task.
    const token = await apiLogin(emails.agent);
    const all = await api<{ items: { id: string; title: string; mine: boolean }[] }>('/tasks', { token, farmId });
    const yawaId = all.items.find((t) => t.title === YAWA_TASK)!.id;
    await assert.rejects(api(`/tasks/${yawaId}/start`, { method: 'POST', token, farmId }), /403/);
    await assert.rejects(api('/tasks', { method: 'POST', token, farmId, body: { title: 'Interdit', dueDate: day(0) } }), /403/);

    await page.getByLabel('Toutes les tâches').selectOption({ label: 'Mes tâches' });
    const weekly = rowOf(page, new RegExp(WEEKLY(lots[0].code)));
    await weekly.getByRole('button', { name: 'Démarrer' }).click();
    await mainShows(page, new RegExp(`${WEEKLY(lots[0].code)}.* En cours`));
    await weekly.getByRole('button', { name: 'Terminer' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByText(`La prochaine occurrence sera créée pour le ${day(6)}`).waitFor();
    await dialog.getByLabel('Photo (preuve)').setInputFiles({ name: 'preuve.png', mimeType: 'image/png', buffer: PNG });
    await dialog.getByRole('button', { name: 'Enregistrer' }).click();
    await dialog.waitFor({ state: 'detached' });

    const done = page.getByRole('row', { name: new RegExp(`${WEEKLY(lots[0].code)}.* Terminée`) });
    await done.waitFor();
    const next = page.getByRole('row', { name: new RegExp(`${WEEKLY(lots[0].code)}.* ${day(6)} .* À faire`) });
    await next.waitFor();
    assert.equal(await done.getByRole('button', { name: 'Démarrer' }).count(), 0, 'a finished task is not started again');
    // The proof opens in a new tab, as the photo that was sent.
    const popup = page.waitForEvent('popup');
    await done.getByRole('button', { name: 'Voir la preuve' }).click();
    const proof = await popup;
    await proof.waitForLoadState();
    await proof.waitForURL(/^blob:/);
    assert.equal(await proof.evaluate(() => document.contentType), 'image/png');
    await proof.close();

    // A task that was started, completed and reopened goes back to « À faire » (its photo-less completion left no next occurrence).
    const oneOff = rowOf(page, new RegExp(ONE_OFF));
    await oneOff.getByRole('button', { name: 'Terminer' }).click();
    const finish = page.getByRole('dialog');
    await finish.getByRole('button', { name: 'Enregistrer' }).click();
    await finish.waitFor({ state: 'detached' });
    const finished = page.getByRole('row', { name: new RegExp(`${ONE_OFF}.* Terminée`) });
    await finished.waitFor();
    await finished.getByRole('button', { name: 'Rouvrir' }).click();
    await page.getByRole('row', { name: new RegExp(`${ONE_OFF}.* À faire`) }).waitFor();
    assert.equal(await page.getByRole('row', { name: new RegExp(ONE_OFF) }).count(), 1, 'reopening a one-off task leaves one row');

    // The late-task alert is gone now that the weekly task is completed (its next occurrence is due in six days).
    await page.goto(`${WEB_URL}/alertes`);
    await page.getByRole('heading', { name: 'Alertes & notifications' }).waitFor();
    await mainShows(page, /alertes? ouvertes?/);
    assert.equal(await page.getByText('Tâche en retard').count(), 0);
    await page.context().close();
  });

  it('Directeur : le tableau de bord compte la tâche terminée et les tâches en attente, et liste les tâches à venir', async () => {
    const page = await asRole(emails.director);
    await mainShows(page, /Tâches terminées 1/);
    assert.match(await mainText(page), /En attente 3/);
    await mainShows(page, new RegExp(ONE_OFF));
    const text = await mainText(page);
    for (const title of [ONE_OFF, YAWA_TASK, WEEKLY(lots[0].code)]) assert.ok(text.includes(title), `« Tâches à venir » lists ${title} (got ${text})`);
    await page.context().close();
  });

  it('Directeur : crée l’équipement « Ventilateur Poulailler B #3 » (Bâtiment Poulailler B, intervalle 90 jours)', async () => {
    const page = await asRole(emails.director);
    await page.goto(`${WEB_URL}/m/equipements`);
    await page.getByRole('button', { name: 'Ajouter' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('Nom', { exact: true }).fill(EQUIPMENT);
    await dialog.getByLabel('Type', { exact: true }).selectOption({ label: 'Ventilateur' });
    await dialog.getByRole('radio', { name: 'Bâtiment' }).click();
    await pick(dialog.getByLabel('Bâtiment', { exact: true }), 'Poulailler B');
    await dialog.getByLabel('Intervalle de maintenance (jours)').fill('90');
    await dialog.getByRole('button', { name: 'Enregistrer' }).click();
    await dialog.waitFor({ state: 'detached' });
    const row = rowOf(page, new RegExp(EQUIPMENT));
    await row.waitFor();
    assert.match(flat(await row.innerText()), new RegExp(`${EQUIPMENT} Ventilateur Poulailler B .*Bon`));
    equipmentId = (await call<{ items: { id: string; name: string }[] }>('/equipment')).items.find((e) => e.name === EQUIPMENT)!.id;
    await page.context().close();
  });

  it('Agent : déclare une panne ; Alertes affiche « Équipement en panne » avec l’icône d’urgence', async () => {
    const page = await asRole(emails.agent);
    await page.goto(`${WEB_URL}/m/equipements`);
    const row = rowOf(page, new RegExp(EQUIPMENT));
    await row.waitFor();
    // The agent declares breakdowns only: no intervention, no retirement, no edit.
    for (const name of ['Intervention', 'Réformer', 'Modifier', 'Ajouter']) assert.equal(await page.getByRole('button', { name }).count(), 0, `no « ${name} » for the agent`);
    await row.getByRole('button', { name: 'Déclarer une panne' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('Description').fill('Le moteur ne démarre plus');
    await dialog.getByRole('button', { name: 'Enregistrer' }).click();
    await dialog.waitFor({ state: 'detached' });
    await page.getByRole('row', { name: new RegExp(`${EQUIPMENT}.* En panne`) }).waitFor();
    assert.equal(await row.getByRole('button', { name: 'Déclarer une panne' }).count(), 0, 'already broken: nothing more to declare');

    await page.goto(`${WEB_URL}/alertes`);
    const alert = page.getByRole('listitem').filter({ hasText: 'Équipement en panne' });
    await alert.waitFor();
    assert.match(flat(await alert.innerText()), new RegExp(`Équipement en panne ${EQUIPMENT}`));
    assert.equal(await alert.locator('svg.lucide-circle-alert').count(), 1, 'the urgent icon');
    await page.context().close();
  });

  it('Directeur : enregistre une intervention corrective de 30 000 qui répare la panne : état Bon, alerte disparue', async () => {
    const page = await asRole(emails.director);
    await page.goto(`${WEB_URL}/m/equipements`);
    const row = rowOf(page, new RegExp(EQUIPMENT));
    await row.getByRole('button', { name: 'Intervention' }).click();
    const dialog = page.getByRole('dialog');
    assert.equal(await dialog.getByRole('radio', { name: 'Corrective' }).getAttribute('aria-checked'), 'true', 'a broken equipment starts a corrective intervention');
    await dialog.getByLabel('Description').fill('Remplacement du moteur');
    await dialog.getByLabel('Coût (FCFA)').fill('30000');
    const repairs = dialog.getByLabel(new RegExp('^Répare la panne du '));
    assert.equal(await repairs.isChecked(), true);
    await dialog.getByRole('button', { name: 'Enregistrer' }).click();
    await dialog.waitFor({ state: 'detached' });
    await page.getByRole('row', { name: new RegExp(`${EQUIPMENT}.* Bon`) }).waitFor();
    await page.getByRole('tab', { name: 'Interventions' }).click();
    const intervention = rowOf(page, /Remplacement du moteur/);
    await intervention.waitFor();
    assert.match(flat(await intervention.innerText()), /Corrective Remplacement du moteur .*30 000 FCFA/);
    await page.goto(`${WEB_URL}/alertes`);
    await page.getByRole('heading', { name: 'Alertes & notifications' }).waitFor();
    await mainShows(page, /alertes? ouvertes?/);
    assert.equal(await page.getByText('Équipement en panne').count(), 0, 'the breakdown alert is gone');
    await page.context().close();
  });

  it('Comptable : la dépense « Maintenance … » de 30 000 figure dans Dépenses & recettes ; « Salaires du mois » préremplit 270 000', async () => {
    const page = await asRole(emails.accountant);
    await page.goto(`${WEB_URL}/m/finance`);
    const maintenance = rowOf(page, new RegExp(`Maintenance ${EQUIPMENT} — `));
    await maintenance.waitFor();
    const text = flat(await maintenance.innerText());
    assert.match(text, /Dépense .* Entretien 30 000 FCFA/);
    assert.match(text, new RegExp(`Maintenance ${EQUIPMENT} — Remplacement du moteur`));
    // Derived, not typed: the row cannot be edited here.
    assert.equal(await maintenance.getByRole('button', { name: 'Modifier' }).getAttribute('aria-disabled'), 'true');

    await page.getByRole('button', { name: 'Ajouter' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByRole('button', { name: 'Salaires du mois' }).click();
    await dialog.getByLabel('Mois des salaires').fill(month);
    await dialog.getByRole('button', { name: 'Pré-remplir' }).click();
    await dialog.getByLabel('Montant').waitFor();
    await page.waitForFunction(() => (document.querySelector('[role="dialog"] input[inputmode], [role="dialog"] input[type="number"]') as HTMLInputElement | null)?.value === '270000');
    assert.equal(await dialog.getByLabel('Montant').inputValue(), '270000');
    assert.equal(await dialog.getByLabel('Catégorie').inputValue(), 'SALAIRES');
    await dialog.getByRole('button', { name: 'Enregistrer' }).click();
    await dialog.waitFor({ state: 'detached' });
    const salaries = rowOf(page, /Salaires .* Dépense Général Salaires 270 000 FCFA/);
    await salaries.waitFor();
    // A second preparation of the same month warns that the entry exists.
    await page.getByRole('button', { name: 'Ajouter' }).click();
    const again = page.getByRole('dialog');
    await again.getByRole('button', { name: 'Salaires du mois' }).click();
    await again.getByLabel('Mois des salaires').fill(month);
    await again.getByRole('button', { name: 'Pré-remplir' }).click();
    await again.getByRole('status').getByText(/existe déjà pour ce mois/).waitFor();
    await again.getByRole('button', { name: 'Annuler' }).click();
    await page.context().close();
  });

  it('Rapports : synthèse du Comptable et du Responsable avicole, rapport mensuel, CSV au bon nom, sanitaire et zootechnique', async () => {
    // The Responsable avicole reads the synthèse without any money figure.
    const farmer = await asRole(emails.avicole);
    await farmer.goto(`${WEB_URL}/rapports`);
    await farmer.getByText('Volailles vivantes').first().waitFor();
    assert.equal(await farmer.getByText("Chiffre d'affaires").count(), 0, 'no revenue for a role without finance:read');
    assert.equal(await farmer.getByRole('tab', { name: 'Mensuel' }).count(), 1);
    await farmer.getByRole('tab', { name: 'Mensuel' }).click();
    await farmer.getByRole('heading', { name: 'Tâches', exact: true }).waitFor();
    assert.equal(await farmer.getByRole('heading', { name: 'Finance' }).count(), 0, 'no Finance section without finance:read');
    await farmer.context().close();

    const page = await asRole(emails.accountant);
    await page.goto(`${WEB_URL}/rapports`);
    await page.getByText("Chiffre d'affaires").first().waitFor();
    await page.getByRole('tab', { name: 'Mensuel' }).click();
    await page.getByRole('heading', { name: 'Finance' }).waitFor();
    const finance = flat(await page.getByRole('tabpanel').innerText());
    assert.match(finance, /Entretien/, 'the maintenance expense is in the monthly finance section');
    assert.match(finance, /Salaires/);

    const download = page.waitForEvent('download');
    await page.getByRole('button', { name: 'CSV' }).click();
    const file = await download;
    assert.match(file.suggestedFilename(), new RegExp(`^rapport-mensuel-${month}-01_\\d{4}-\\d{2}-\\d{2}\\.csv$`));
    const csv = readFileSync((await file.path())!, 'utf8').replace(/^﻿/, '');
    assert.equal(csv.split(/\r?\n/)[0], 'Section;Indicateur;Valeur;Unité');
    assert.ok(/^Finance;/m.test(csv), 'the CSV carries the Finance section');
    assert.ok(!/\d\.\d/.test(csv.split(/\r?\n/).filter((l) => /^(Finance|Tâches|Équipements);/.test(l)).join('\n')), 'decimals are written with a comma');

    // Two more types, for a role that reads them all.
    const director = await asRole(emails.director);
    await director.goto(`${WEB_URL}/rapports`);
    await director.getByRole('tab', { name: 'Sanitaire' }).click();
    await director.getByRole('heading', { name: "Délais d'attente en cours" }).waitFor();
    await director.getByRole('heading', { name: 'Mortalité par lot' }).waitFor();
    await director.getByRole('tab', { name: 'Zootechnique' }).click();
    await director.getByRole('heading', { name: 'Performances des lots' }).waitFor();
    await director.getByRole('heading', { name: 'Rentabilité des lots' }).waitFor();
    await director.getByRole('tab', { name: 'Hebdomadaire' }).click();
    await director.getByRole('heading', { name: 'Équipements' }).waitFor();
    const weekly = director.waitForEvent('download');
    await director.getByRole('button', { name: 'Excel' }).click();
    assert.match((await weekly).suggestedFilename(), /^rapport-hebdomadaire-\d{4}-\d{2}-\d{2}_\d{4}-\d{2}-\d{2}\.xlsx$/);
    await director.context().close();
    await page.context().close();
  });

  it('Lots : QR code d’un lot, planche de 3 étiquettes, /q/lot/{id} ouvre le lot pour le Commercial et reste inconnu pour le Magasinier', async () => {
    const page = await asRole(emails.director);
    await page.goto(`${WEB_URL}/m/lots`);
    const row = rowOf(page, new RegExp(lots[1].code));
    await row.waitFor();
    await row.getByRole('button', { name: 'QR code' }).click();
    let dialog = page.getByRole('dialog');
    await dialog.getByRole('heading', { name: `QR code — ${lots[1].code}` }).waitFor();
    await dialog.getByRole('img', { name: `QR code ${lots[1].code}` }).waitFor();
    assert.ok((await dialog.innerText()).includes(`${WEB_URL}/q/lot/${lots[1].id}`), 'the dialog shows the address the QR encodes');
    await dialog.getByRole('button', { name: "Imprimer l'étiquette" }).waitFor();
    await dialog.getByRole('button', { name: 'Fermer' }).last().click();

    await page.getByRole('button', { name: 'Exporter' }).click();
    await page.getByRole('menuitem', { name: 'Étiquettes QR' }).click();
    dialog = page.getByRole('dialog');
    await dialog.getByRole('heading', { name: /^Étiquettes QR/ }).waitFor();
    await dialog.getByText(/3 étiquettes, planche A4 de 3 × 8/).waitFor();
    assert.equal(await dialog.getByTestId('qr-label').count(), 3);
    await page.context().close();

    const commercial = await asRole(emails.commercial);
    await commercial.goto(`${WEB_URL}/q/lot/${lots[1].id}`);
    await commercial.waitForURL(new RegExp(`/m/lots/${lots[1].id}$`));
    await commercial.getByRole('heading', { name: lots[1].code }).first().waitFor();
    await commercial.goto(`${WEB_URL}/q/lot/00000000-0000-4000-8000-000000000000`);
    await commercial.getByText('QR code inconnu ou inaccessible').waitFor();
    await commercial.context().close();

    const keeper = await asRole(emails.storekeeper);
    await keeper.goto(`${WEB_URL}/q/lot/${lots[1].id}`);
    await keeper.getByText('QR code inconnu ou inaccessible').waitFor();
    assert.ok(!keeper.url().includes('/m/lots'), 'the storekeeper is not taken to the lot');
    await keeper.getByRole('link', { name: 'Retour au tableau de bord' }).click();
    await keeper.getByRole('heading', { name: 'Tableau de bord' }).waitFor();
    // The same answer for a missing record and for one the role may not read.
    const token = await apiLogin(emails.storekeeper);
    const forbidden = await fetch(`${WEB_URL}/api/qr/lot/${lots[1].id}`, { headers: { authorization: `Bearer ${token}`, 'x-farm-id': farmId } });
    const missing = await fetch(`${WEB_URL}/api/qr/lot/00000000-0000-4000-8000-000000000000`, { headers: { authorization: `Bearer ${token}`, 'x-farm-id': farmId } });
    assert.deepEqual([forbidden.status, missing.status], [404, 404]);
    await keeper.context().close();
  });

  it('Alertes : « Masquer l’alerte » baisse la pastille, « Afficher les alertes masquées (1) » la rend, « Réafficher » la remet', async () => {
    // An open alert to work with: the equipment is broken again (a new breakdown gives a new alert).
    await call(`/equipment/${equipmentId}/breakdowns`, 'POST', { date: day(0), description: 'Courroie cassée' });
    const page = await asRole(emails.director);
    await page.goto(`${WEB_URL}/alertes`);
    const title = 'Équipement en panne';
    const item = page.getByRole('listitem').filter({ hasText: title });
    await item.waitFor();
    await until(async () => (await bell(page)) >= 1);
    const before = await bell(page);
    assert.ok(before >= 1, `the bell announces the alert (${before})`);
    await page.getByRole('button', { name: `Masquer l'alerte : ${title}` }).click();
    await until(async () => (await bell(page)) === before - 1);
    assert.equal(await bell(page), before - 1, 'the bell goes down by one');
    assert.equal(await page.getByText(title).count(), 0, 'the masked alert leaves the list');
    // It is still there for the others: masking is per user.
    const other = await apiLogin(emails.avicole);
    const theirs = await api<{ items: { title: string }[] }>('/alerts', { token: other, farmId });
    assert.ok(theirs.items.some((a) => a.title === title), 'another user still sees it');

    await page.getByRole('link', { name: 'Afficher les alertes masquées (1)' }).click();
    const masked = page.getByRole('listitem').filter({ hasText: title });
    await masked.waitFor();
    await page.getByRole('button', { name: `Réafficher l'alerte : ${title}` }).click();
    await until(async () => (await bell(page)) === before);
    assert.equal(await bell(page), before, 'the bell is back to its first value');
    assert.equal(await page.getByRole('link', { name: /Afficher les alertes masquées/ }).count(), 0, 'nothing is masked any more');
    await page.context().close();
  });

  it('Équipement : un équipement ayant une tâche ouverte ne peut pas être réformé ; la fiche de l’équipement et du bâtiment s’ouvre', async () => {
    await call('/tasks', 'POST', { title: 'Graisser le ventilateur', dueDate: day(2), equipmentId });
    const page = await asRole(emails.director);
    await page.goto(`${WEB_URL}/m/equipements`);
    const row = rowOf(page, new RegExp(EQUIPMENT));
    await row.getByRole('button', { name: 'Réformer' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByRole('button', { name: 'Réformer', exact: true }).click();
    await dialog.getByText('Des tâches ouvertes portent sur cet équipement').waitFor();
    await dialog.getByRole('button', { name: 'Annuler' }).click();
    await row.waitFor();

    await row.getByRole('link', { name: EQUIPMENT }).click();
    await page.getByRole('heading', { name: EQUIPMENT }).waitFor();
    await page.getByRole('tab', { name: 'Pannes' }).click();
    await mainShows(page, /Courroie cassée/);
    await page.getByRole('button', { name: 'QR code' }).click();
    await page.getByRole('dialog').getByRole('heading', { name: `QR code — ${EQUIPMENT}` }).waitFor();
    await page.getByRole('dialog').getByRole('button', { name: 'Fermer' }).last().click();

    await page.goto(`${WEB_URL}/m/batiments/${buildingBId}`);
    await page.getByRole('heading', { name: 'Poulailler B' }).first().waitFor();
    await mainShows(page, new RegExp(EQUIPMENT));
    await page.context().close();
  });

  it('Rôles : le Comptable ouvre « Tâches & personnel » sur Employés (sans Tâches) ; le Magasinier avance les siennes mais ne crée rien ; aucun coût sans finance:read', async () => {
    const accountant = await asRole(emails.accountant);
    // The accountant has personnel:read but no taches: the page opens on Employés, with the salaries, without Tâches.
    await accountant.locator('aside').getByRole('link', { name: /Tâches & personnel/ }).click();
    await accountant.getByRole('tab', { name: 'Employés' }).waitFor();
    assert.equal(await accountant.getByRole('tab', { name: 'Tâches' }).count(), 0, 'no Tâches tab for the accountant');
    assert.deepEqual(await accountant.getByRole('tab').allInnerTexts(), ['Employés', 'Présences']);
    await accountant.getByRole('columnheader', { name: 'SALAIRE MENSUEL' }).waitFor();
    assert.equal(await accountant.getByRole('button', { name: 'Ajouter' }).count(), 0, 'read-only for the accountant');
    // The same salaries through the API.
    const acc = await call<{ items: { monthlySalary: number | null }[] }>('/employees');
    assert.deepEqual(acc.items.map((e) => e.monthlySalary).sort(), [120000, 150000]);
    await accountant.context().close();

    const keeper = await asRole(emails.storekeeper);
    await keeper.goto(`${WEB_URL}/m/taches`);
    await rowOf(keeper, new RegExp(YAWA_TASK)).waitFor();
    assert.equal(await keeper.getByRole('button', { name: 'Ajouter' }).count(), 0);
    assert.equal(await keeper.getByRole('button', { name: 'Démarrer' }).count(), 0, 'none of the tasks is the storekeeper’s');
    await keeper.context().close();

    // No cost without finance:read: not in the interventions, not in the equipment sheet, not in the API.
    const token = await apiLogin(emails.avicole);
    const maintenance = await api<{ items: { cost: number | null }[] }>('/maintenance', { token, farmId });
    assert.ok(maintenance.items.length > 0 && maintenance.items.every((m) => m.cost === null), 'interventions carry no cost');
    const sheet = await api<{ maintenanceCost: number | null }>(`/equipment/${equipmentId}`, { token, farmId });
    assert.equal(sheet.maintenanceCost, null);
    const farmer = await asRole(emails.avicole);
    await farmer.goto(`${WEB_URL}/m/equipements`);
    await farmer.getByRole('tab', { name: 'Interventions' }).click();
    await rowOf(farmer, /Remplacement du moteur/).waitFor();
    assert.equal(await farmer.getByRole('columnheader', { name: 'COÛT' }).count(), 0);
    assert.ok(!(await mainText(farmer)).includes('30 000'));
    await farmer.context().close();
  });
});
