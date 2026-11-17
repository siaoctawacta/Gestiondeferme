import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import type { Browser, Page } from 'playwright';
import {
  api, apiLogin, enrollAdmin, enrollUser, launch, newPage, PASSWORD, uiLoginWithBackupCode, uiLoginWithPassword, WEB_URL,
  type EnrolledAdmin, type EnrolledUser,
} from './helpers.ts';
import { ensureItem, ensureSupplier, REFERENCE_ITEMS, REFERENCE_SUPPLIERS } from './logisticsData.ts';

/** Text with every kind of space (thin, no-break) turned into a plain one, so `1 170 000` matches however it is grouped. */
const flat = (text: string) => text.replace(/\s+/g, ' ').trim();
const day = (offset: number) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);
/** Waits until the page's main text (spaces flattened) matches: a figure that follows a save arrives with the refetch. */
const mainShows = (page: Page, re: RegExp) =>
  page.waitForFunction(
    ([source, flags]) => new RegExp(source, flags).test(document.querySelector('main')?.innerText.replace(/\s+/g, ' ') ?? ''),
    [re.source, re.flags] as const,
  );

// The flow of the slice, one role per step, through the real UI; set-up that is not the point of a step goes through
// the API. The tests below run in order and SHARE STATE (one farm, one purchase, one lot...), as in production.spec.ts.
// The figures are worked out here: 1 000 kg of `Aliment ponte` at 280 (stock already there) + 3 000 kg received at 310
// give a weighted average of (280 000 + 930 000) / 4 000 = 302.5; a distribution of 500 kg costs 500 x 302.5 = 151 250
// and leaves 3 500 kg; a count of 3 400 adjusts by -100.
describe('logistique : achat, réception, stock, distribution, inventaire, santé et alertes', () => {
  let browser: Browser;
  let admin: EnrolledAdmin;
  let farmId = '';
  let lotCode = '';
  let lotId = '';
  let ponteId = '';
  let vaccineId = '';
  let bcNumber = '';
  const users: Record<string, EnrolledUser | { email: string }> = {};
  const emails = {
    stock: 'resp-stock@e2e.test',
    director: 'directeur-logistique@e2e.test',
    storekeeper: 'magasinier@e2e.test',
    vet: 'veterinaire@e2e.test',
    accountant: 'comptable@e2e.test',
  };

  /** A browser session of one role (a fresh context: the roles never share a session). */
  async function asRole(email: string): Promise<Page> {
    const { page } = await newPage(browser);
    const user = users[email] as EnrolledUser | undefined;
    if (user && 'backupCodes' in user) {
      // A Directeur de ferme and a Comptable must enrol a second factor: each UI login burns one backup code.
      await uiLoginWithBackupCode(page, email, user.backupCodes.shift()!);
    } else {
      await uiLoginWithPassword(page, email);
    }
    await page.getByRole('heading', { name: 'Tableau de bord' }).waitFor();
    return page;
  }

  /** A browser session of the seeded super administrator (a UI login burns one of its backup codes). */
  async function asAdmin(): Promise<Page> {
    const { page } = await newPage(browser);
    await page.addInitScript((farm) => localStorage.setItem('ap_farm', farm), farmId);
    await uiLoginWithBackupCode(page, admin.email, admin.backupCodes.shift()!);
    await page.getByRole('heading', { name: 'Tableau de bord' }).waitFor();
    return page;
  }

  /** The reference of the purchase row (`DA-0001`, then `BC-0001` once ordered) after a text filter. */
  const purchaseRow = (page: Page, re: RegExp) => page.getByRole('row', { name: re });

  before(async () => {
    browser = await launch();
    admin = await enrollAdmin('logistics');
    // A farm of its own: the seeded one is shared with the other specs, so the stock and dashboard figures are exactly this flow's.
    farmId = (await api<{ id: string }>('/farms', { method: 'POST', token: admin.token, body: { name: 'Ferme Logistique' } })).id;
    const as = { token: admin.token, farmId };
    const call = <T = { id: string }>(path: string, method = 'GET', body?: unknown) => api<T>(path, { method, token: admin.token, farmId, body });

    const roles: [string, string, string][] = [
      [emails.stock, 'RESP_STOCK', 'Responsable Stock'],
      [emails.director, 'DIRECTEUR_FERME', 'Directrice Logistique'],
      [emails.storekeeper, 'MAGASINIER', 'Magasinier Test'],
      [emails.vet, 'VETERINAIRE', 'Vétérinaire Test'],
      [emails.accountant, 'COMPTABLE', 'Comptable Test'],
    ];
    for (const [email, role, name] of roles) {
      await call('/users', 'POST', { name, email, role, farmIds: [farmId], password: PASSWORD });
    }
    users[emails.director] = await enrollUser(emails.director);
    users[emails.accountant] = await enrollUser(emails.accountant);

    // Set-up: a laying house and its lot (the veterinarian's target), the articles, the supplier, a feed linked to the
    // article, 1 000 kg of it already in stock at 280, and the thresholds that make 4 000 kg `ok` and 3 500 `faible`.
    const site = await call('/sites', 'POST', { name: 'Site Logistique' });
    const building = await call('/buildings', 'POST', { name: 'Poulailler L', type: 'AVICOLE', siteId: site.id, capacity: 6000, status: 'ACTIF' });
    const lot = await call<{ id: string; code: string }>('/batches', 'POST', {
      species: 'AVICOLE', type: 'CHAIR', buildingId: building.id, entryDate: day(-30), initialCount: 5000,
    });
    lotId = lot.id;
    lotCode = lot.code;
    ponteId = await ensureItem(as, REFERENCE_ITEMS.ponte);
    vaccineId = await ensureItem(as, { name: 'Vaccin Newcastle', category: 'VACCIN', unit: 'flacons' });
    await ensureSupplier(as, REFERENCE_SUPPLIERS.agro);
    await call(`/stock/${ponteId}/thresholds`, 'PUT', { minQty: 4000 });
    await call(`/stock/${vaccineId}/thresholds`, 'PUT', { minQty: 5 });
    await call('/stock/movements', 'POST', { itemId: ponteId, type: 'ENTREE', date: day(-10), quantity: 1000, unitCost: 280, reason: 'ACHAT' });
    await call('/feed-products', 'POST', { name: 'Ponte logistique', kind: 'ALIMENT_COMPLET', unitCost: 310, stockItemId: ponteId });
  });

  after(async () => {
    // The articles are shared with the visual spec's reference stock list: this one is not a reference article, so it is
    // deactivated, like every article this spec created (a deactivated article drops out of the list of a farm where it holds nothing).
    // Runs even when `before` failed part-way: every article this spec created is deactivated.
    if (admin) {
      const referenced = new Set<string>(Object.values(REFERENCE_ITEMS).map((i) => i.name));
      const items = await api<{ items: { id: string; name: string; active: boolean }[] }>('/stock-items?pageSize=200', { token: admin.token });
      for (const item of items.items.filter((i) => i.active && !referenced.has(i.name))) {
        await api(`/stock-items/${item.id}`, { method: 'PATCH', token: admin.token, body: { active: false } });
      }
    }
    await browser?.close();
  });

  it('Responsable stock : crée une demande d’achat de deux lignes, au total calculé, sans pouvoir la valider', async () => {
    const page = await asRole(emails.stock);
    await page.goto(`${WEB_URL}/m/achats`);
    await page.getByRole('button', { name: 'Ajouter' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('Fournisseur').selectOption({ label: 'Agro Provende SA' });
    // Dated five days ago, so that the goods can be received (and used) on earlier days.
    await dialog.getByLabel('Date', { exact: true }).fill(day(-5));
    await dialog.getByLabel('Article ligne 1').selectOption({ label: 'Aliment ponte' });
    await dialog.getByLabel('Quantité ligne 1').fill('3000');
    await dialog.getByLabel('Prix unitaire ligne 1').fill('310');
    await dialog.getByRole('button', { name: 'Ajouter une ligne' }).click();
    await dialog.getByLabel('Article ligne 2').selectOption({ label: 'Vaccin Newcastle' });
    await dialog.getByLabel('Quantité ligne 2').fill('20');
    await dialog.getByLabel('Prix unitaire ligne 2').fill('12000');
    // 3 000 x 310 + 20 x 12 000
    assert.match(flat(await dialog.innerText()), /Total : 1 170 000 FCFA/);
    await dialog.getByRole('button', { name: 'Enregistrer' }).click();
    await dialog.waitFor({ state: 'detached' });

    const row = purchaseRow(page, /DA-\d{4}/);
    await row.waitFor();
    const text = flat(await row.innerText());
    assert.match(text, /Agro Provende SA/);
    assert.match(text, /Aliment ponte \+1/);
    assert.match(text, /1 170 000 FCFA/);
    await row.getByText('Demande', { exact: true }).waitFor();
    // The stock manager enters and corrects requests; validating them is the director's.
    assert.equal(await row.getByRole('button', { name: 'Modifier' }).count(), 1);
    assert.equal(await row.getByRole('button', { name: 'Valider' }).count(), 0);
    assert.equal(await row.getByRole('button', { name: 'Réceptionner' }).count(), 0);
    await page.context().close();
  });

  it('Directeur : valide puis commande ; le bon de commande reçoit son numéro', async () => {
    const page = await asRole(emails.director);
    await page.goto(`${WEB_URL}/m/achats`);
    let row = purchaseRow(page, /DA-\d{4}/);
    await row.getByRole('button', { name: 'Valider' }).click();
    let dialog = page.getByRole('dialog');
    await dialog.getByRole('button', { name: 'Valider' }).click();
    await dialog.waitFor({ state: 'detached' });
    await row.getByText('Validée', { exact: true }).waitFor();

    await row.getByRole('button', { name: 'Commander' }).click();
    dialog = page.getByRole('dialog');
    await dialog.getByRole('button', { name: 'Commander' }).click();
    await dialog.waitFor({ state: 'detached' });
    row = purchaseRow(page, /BC-\d{4}/);
    await row.getByText('Commandée', { exact: true }).waitFor();
    bcNumber = flat(await row.innerText()).match(/BC-\d{4}/)![0];
    // The director neither receives (storekeeper) nor edits an order.
    assert.equal(await row.getByRole('button', { name: 'Réceptionner' }).count(), 1);
    assert.equal(await row.getByRole('button', { name: 'Modifier' }).getAttribute('aria-disabled'), 'true');

    // The detail page carries the request number and the lines; the stock has not moved yet.
    // The link is on the first cell (the date).
    await row.getByRole('link').first().click();
    await page.getByRole('heading', { name: bcNumber }).waitFor();
    await mainShows(page, /Montant 1 170 000 FCFA/);
    await page.getByRole('tab', { name: 'Historique' }).click();
    const history = flat(await page.getByRole('tabpanel').innerText());
    for (const step of ['Demande', 'Validée', 'Commandée']) assert.match(history, new RegExp(step));
    const stock = (await api<{ items: { id: string; quantity: number }[] }>('/stock', { token: admin.token, farmId })).items;
    assert.equal(stock.find((s) => s.id === ponteId)!.quantity, 1000);
    await page.context().close();
  });

  it('Magasinier : réceptionne (plafond à la quantité commandée, n° de lot, péremption) ; il ne valide ni ne crée', async () => {
    const page = await asRole(emails.storekeeper);
    await page.goto(`${WEB_URL}/m/achats`);
    const row = purchaseRow(page, new RegExp(bcNumber));
    await row.waitFor();
    assert.equal(await page.getByRole('button', { name: 'Ajouter' }).count(), 0);
    for (const name of ['Valider', 'Commander', 'Annuler', 'Payer', 'Modifier', 'Supprimer']) {
      assert.equal(await row.getByRole('button', { name }).count(), 0, `the storekeeper has no « ${name} »`);
    }
    await row.getByRole('button', { name: 'Réceptionner' }).click();
    const dialog = page.getByRole('dialog');
    // The grid is the order's own lines, prefilled with the ordered quantities.
    assert.equal(await dialog.getByLabel('Quantité reçue ligne 1').inputValue(), '3000');
    assert.equal(await dialog.getByLabel('Quantité reçue ligne 2').inputValue(), '20');
    await dialog.getByLabel('Date de réception').fill(day(-3));
    // More than ordered is refused with the API's own message, before any request.
    await dialog.getByLabel('Quantité reçue ligne 1').fill('3001');
    await dialog.getByRole('button', { name: 'Enregistrer' }).click();
    await dialog.getByText('La quantité reçue dépasse la quantité commandée').waitFor();
    await dialog.getByLabel('Quantité reçue ligne 1').fill('3000');
    await dialog.getByLabel('N° de lot ligne 1').fill('PO-2026-11');
    await dialog.getByLabel('Péremption ligne 1').fill(day(180));
    await dialog.getByLabel('N° de lot ligne 2').fill('NC-2026-11');
    await dialog.getByLabel('Péremption ligne 2').fill(day(200));
    await dialog.getByRole('button', { name: 'Enregistrer' }).click();
    await dialog.waitFor({ state: 'detached' });
    await row.getByText('Reçue', { exact: true }).waitFor();

    // Stocks: 1 000 + 3 000 = 4 000 kg, exactly the minimum (`ok`); the vaccine 20 flacons.
    await page.goto(`${WEB_URL}/m/stocks`);
    const ponte = page.getByRole('row', { name: /Aliment ponte/ });
    await ponte.waitFor();
    let text = flat(await ponte.innerText());
    assert.match(text, /Aliment ponte Aliment 4 000 kg 4 000 ok/);
    await ponte.getByText('ok', { exact: true }).waitFor();
    const vaccine = flat(await page.getByRole('row', { name: /Vaccin Newcastle/ }).innerText());
    assert.match(vaccine, /Vaccin Newcastle Vaccin 20 flacons 5 ok/);

    // The article's page: the weighted-average cost and the two lots.
    await page.getByRole('link', { name: 'Aliment ponte' }).click();
    await page.getByRole('heading', { name: 'Aliment ponte' }).waitFor();
    await mainShows(page, /Quantité 4 000 kg/);
    await mainShows(page, /Valeur 1 210 000 FCFA/);
    await mainShows(page, /Coût moyen 302\.5 FCFA\/kg/);
    text = flat(await page.getByRole('tabpanel').innerText());
    assert.match(text, /PO-2026-11 .* 3 000/);
    await page.context().close();
  });

  it('Administrateur : la pastille de péremption suit « Alerte de péremption » ; le réglage de biosécurité n’existe plus', async () => {
    const page = await asAdmin();
    const lot = (p: Page) => p.getByRole('row', { name: /PO-2026-11/ });
    const openItem = async () => {
      await page.goto(`${WEB_URL}/m/stocks`);
      await page.getByRole('link', { name: 'Aliment ponte' }).click();
      await page.getByRole('heading', { name: 'Aliment ponte' }).waitFor();
      await lot(page).waitFor();
    };
    // The lot expires in 180 days: far beyond the default 30, so no pill.
    await openItem();
    assert.equal(await lot(page).getByText('Bientôt périmé').count(), 0);

    await page.goto(`${WEB_URL}/admin/parametres`);
    const alerts = page.locator('form').filter({ has: page.getByLabel('Alerte de péremption (jours)') });
    await alerts.getByLabel('Alerte de péremption (jours)').waitFor();
    // The dead `biosecurityWarningDays` setting is gone (the API would answer 400): no field, no request.
    assert.equal(await page.locator('main').getByText(/biosécurité/i).count(), 0);
    const puts: string[] = [];
    page.on('request', (r) => { if (r.method() === 'PUT') puts.push(r.url().replace(/.*\/api/, '')); });
    try {
      assert.equal(await alerts.getByLabel('Alerte de péremption (jours)').inputValue(), '30');
      await alerts.getByLabel('Alerte de péremption (jours)').fill('200');
      await alerts.getByRole('button', { name: 'Enregistrer' }).click();
      await page.getByText('Paramètres enregistrés').first().waitFor();
      assert.ok(puts.length > 0 && puts.every((u) => /^\/settings\/[A-Za-z]+$/.test(u) && !/biosecurity/i.test(u)), `PUT ${puts.join(', ')}`);

      // 180 days is now inside the warning window: the API's own judgement shows on the lot.
      await openItem();
      await lot(page).getByText('Bientôt périmé').waitFor();
    } finally {
      // The setting is the organisation's, shared with the other specs: put it back.
      await api('/settings/expiryWarningDays', { method: 'PUT', token: admin.token, body: { value: 30 } });
    }
    await openItem();
    assert.equal(await lot(page).getByText('Bientôt périmé').count(), 0);
    await page.context().close();
  });

  it('Responsable stock : crée un article, enregistre deux entrées, une sortie répartie sur deux lots, la corrige puis la supprime', async () => {
    const page = await asRole(emails.stock);
    await page.goto(`${WEB_URL}/m/stocks`);
    await page.getByRole('button', { name: 'Ajouter' }).click();
    let dialog = page.getByRole('dialog');
    await dialog.getByLabel('Nom').fill('Seaux de test');
    await dialog.getByLabel('Catégorie').selectOption({ label: 'Consommable' });
    await dialog.getByLabel('Unité').fill('seaux');
    await dialog.getByLabel('Seuil minimum').fill('10');
    // The item is created active, with its thresholds for this farm.
    assert.equal(await dialog.getByRole('checkbox', { name: 'Actif' }).isChecked(), true);
    await dialog.getByRole('button', { name: 'Enregistrer' }).click();
    await dialog.waitFor({ state: 'detached' });
    const item = page.getByRole('row', { name: /Seaux de test/ });
    await mainShows(page, /Seaux de test Consommable 0 seaux 10 critique/);

    const entry = async (quantity: string, cost: string, lot: string, expiry: string) => {
      await item.getByRole('button', { name: 'Entrée' }).click();
      dialog = page.getByRole('dialog', { name: 'Entrée — Seaux de test' });
      await dialog.getByLabel('Quantité').fill(quantity);
      await dialog.getByLabel('Coût unitaire (FCFA)').fill(cost);
      await dialog.getByLabel('N° de lot').fill(lot);
      await dialog.getByLabel('Péremption').fill(expiry);
      await dialog.getByRole('button', { name: 'Enregistrer' }).click();
      await dialog.waitFor({ state: 'detached' });
    };
    await entry('100', '50', 'SEA-A', day(100));
    await entry('50', '70', 'SEA-B', day(200));
    await mainShows(page, /Seaux de test Consommable 150 seaux 10 ok/);

    // 120 leave: the lot expiring first (100), then the next (20): one operation, two rows.
    await item.getByRole('button', { name: 'Sortie' }).click();
    dialog = page.getByRole('dialog', { name: 'Sortie — Seaux de test' });
    await dialog.getByLabel('Quantité').fill('120');
    await dialog.getByLabel('Motif').selectOption({ label: 'Perte' });
    await dialog.getByRole('button', { name: 'Enregistrer' }).click();
    await dialog.waitFor({ state: 'detached' });
    await mainShows(page, /Seaux de test Consommable 30 seaux/);

    await page.getByRole('tab', { name: 'Mouvements' }).click();
    const piece = (lot: string) => page.getByRole('row', { name: new RegExp(`Sortie .* ${lot}`) });
    await piece('SEA-A').waitFor();
    assert.match(flat(await piece('SEA-A').innerText()), /Sortie -100 .* Perte SEA-A/);
    assert.match(flat(await piece('SEA-B').innerText()), /Sortie -20 .* Perte SEA-B/);

    // Correcting one piece corrects the operation: the form shows the 120 of the whole operation, not the 20 clicked.
    await piece('SEA-B').getByRole('button', { name: 'Modifier' }).click();
    dialog = page.getByRole('dialog', { name: 'Modifier — Mouvements' });
    await dialog.getByLabel('Quantité').waitFor();
    assert.equal(await dialog.getByLabel('Quantité').inputValue(), '120');
    assert.equal(await dialog.getByLabel('Motif').count(), 0, 'the reason of an exit cannot be edited');
    await dialog.getByLabel('Quantité').fill('130');
    await dialog.getByRole('button', { name: 'Enregistrer' }).click();
    await dialog.waitFor({ state: 'detached' });
    await piece('SEA-B').getByText('-30', { exact: true }).waitFor();
    assert.match(flat(await piece('SEA-A').innerText()), /Sortie -100/);

    // Deleting one piece removes the whole operation.
    await piece('SEA-B').getByRole('button', { name: 'Supprimer' }).click();
    dialog = page.getByRole('dialog');
    await dialog.getByRole('button', { name: 'Supprimer' }).click();
    await dialog.waitFor({ state: 'detached' });
    await piece('SEA-A').waitFor({ state: 'detached' });
    await page.getByRole('tab', { name: 'Stocks' }).click();
    await mainShows(page, /Seaux de test Consommable 150 seaux 10 ok/);
    await page.context().close();
  });

  it('Directeur : une distribution de 500 kg est valorisée au coût moyen pondéré ; le stock baisse et le mouvement apparaît', async () => {
    const page = await asRole(emails.director);
    await page.goto(`${WEB_URL}/m/alimentation`);
    await page.getByRole('tab', { name: 'Distributions' }).click();
    await page.getByRole('button', { name: 'Ajouter' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByRole('combobox', { name: 'Lot' }).selectOption({ label: lotCode });
    await dialog.getByRole('combobox', { name: 'Aliment' }).selectOption({ label: 'Ponte logistique' });
    await dialog.getByLabel('Quantité (kg)').fill('500');
    await dialog.getByRole('button', { name: 'Enregistrer' }).click();
    await dialog.waitFor({ state: 'detached' });
    const row = page.getByRole('row', { name: new RegExp(lotCode) });
    await row.waitFor();
    // 500 kg x 302.5 (not the catalogue price of 310, which would be 155 000)
    assert.match(flat(await row.innerText()), /151 250 FCFA/);

    await page.goto(`${WEB_URL}/m/stocks`);
    const ponte = page.getByRole('row', { name: /Aliment ponte/ });
    await ponte.waitFor();
    assert.match(flat(await ponte.innerText()), /Aliment ponte Aliment 3 500 kg 4 000 faible/);
    await ponte.getByText('faible', { exact: true }).waitFor();

    await page.getByRole('tab', { name: 'Mouvements' }).click();
    const exit = page.getByRole('row', { name: /Consommation/ });
    await exit.waitFor();
    const text = flat(await exit.innerText());
    assert.match(text, /Aliment ponte Sortie -500 302\.5 FCFA Consommation/);
    // Written by the feed distribution: corrected there, so locked here with the reason.
    assert.equal(await exit.getByRole('button', { name: 'Modifier' }).getAttribute('aria-disabled'), 'true');
    assert.equal(await exit.getByRole('button', { name: 'Supprimer' }).getAttribute('title'), "Mouvement issu d'une autre opération");
    await page.context().close();
  });

  it('Responsable stock : une entrée antidatée à un autre prix change le coût de la distribution (le registre fait foi) ; la supprimer le rétablit', async () => {
    // Corrections happen BEFORE the inventory: once it is validated, this past is closed (see the lock test below).
    const page = await asRole(emails.stock);
    const director = await asRole(emails.director);
    const distributionCost = async () => {
      await director.goto(`${WEB_URL}/m/alimentation`);
      await director.getByRole('tab', { name: 'Distributions' }).click();
      const row = director.getByRole('row', { name: new RegExp(lotCode) });
      await row.waitFor();
      return flat(await row.innerText());
    };
    assert.match(await distributionCost(), /151 250 FCFA/);

    // 1 000 kg received two days ago at 400: the average of the day of the distribution becomes
    // (280 000 + 930 000 + 400 000) / 5 000 = 322, so 500 kg cost 161 000, not the 151 250 written at the time.
    await page.goto(`${WEB_URL}/m/stocks`);
    const ponte = page.getByRole('row', { name: /Aliment ponte/ });
    await ponte.getByRole('button', { name: 'Entrée' }).click();
    let dialog = page.getByRole('dialog', { name: 'Entrée — Aliment ponte' });
    await dialog.getByLabel('Date', { exact: true }).fill(day(-2));
    await dialog.getByLabel('Quantité').fill('1000');
    await dialog.getByLabel('Coût unitaire (FCFA)').fill('400');
    await dialog.getByRole('button', { name: 'Enregistrer' }).click();
    await dialog.waitFor({ state: 'detached' });
    await mainShows(page, /Aliment ponte Aliment 4 500 kg/);
    assert.match(await distributionCost(), /161 000 FCFA/);

    // Deleting the late entry puts the ledger, and the cost, back.
    await page.getByRole('tab', { name: 'Mouvements' }).click();
    const late = page.getByRole('row', { name: new RegExp(`^${day(-2)} Aliment ponte Entrée`) });
    await late.waitFor();
    await late.getByRole('button', { name: 'Supprimer' }).click();
    dialog = page.getByRole('dialog');
    await dialog.getByRole('button', { name: 'Supprimer' }).click();
    await dialog.waitFor({ state: 'detached' });
    await late.waitFor({ state: 'detached' });
    assert.match(await distributionCost(), /151 250 FCFA/);
    await director.context().close();
    await page.context().close();
  });

  it('Magasinier compte 3 400 kg ; Responsable stock valide : le niveau est ajusté de −100', async () => {
    let page = await asRole(emails.storekeeper);
    await page.goto(`${WEB_URL}/m/stocks`);
    await page.getByRole('tab', { name: 'Inventaires' }).click();
    // A session dated four days ago: its draft shows what was held THEN (1 000 kg before the reception of day -3, and
    // nothing of the buckets entered today), not today's levels.
    await page.getByRole('button', { name: 'Ajouter' }).click();
    let dialog = page.getByRole('dialog');
    await dialog.getByLabel('Date', { exact: true }).fill(day(-4));
    await dialog.getByRole('button', { name: 'Enregistrer' }).click();
    await dialog.waitFor({ state: 'detached' });
    await page.getByRole('link', { name: day(-4) }).click();
    await page.getByRole('heading', { name: `Inventaire du ${day(-4)}` }).waitFor();
    const past = (name: string) => page.locator('fieldset div.flex.items-center.gap-2').filter({ hasText: name });
    await past('Aliment ponte').waitFor();
    assert.match(flat(await past('Aliment ponte').innerText()), /Théorique ligne \d : 1 000/);
    assert.match(flat(await past('Seaux de test').innerText()), /Théorique ligne \d : 0/);
    // The gap follows the typing, from that quantity.
    await past('Aliment ponte').getByLabel(/^Compté ligne/).fill('990');
    assert.match(flat(await past('Aliment ponte').innerText()), /−10/);
    await page.goBack();
    // The draft is useless: the storekeeper deletes it (the daily rule).
    await page.getByRole('tab', { name: 'Inventaires' }).click();
    const old = page.getByRole('row', { name: new RegExp(day(-4)) });
    await old.getByRole('button', { name: 'Supprimer' }).click();
    dialog = page.getByRole('dialog');
    await dialog.getByRole('button', { name: 'Supprimer' }).click();
    await dialog.waitFor({ state: 'detached' });
    await old.waitFor({ state: 'detached' });

    await page.getByRole('button', { name: 'Ajouter' }).click();
    dialog = page.getByRole('dialog');
    await dialog.getByRole('button', { name: 'Enregistrer' }).click();
    await dialog.waitFor({ state: 'detached' });
    // `/m/stocks/inv-{id}` goes through the router to the count sheet.
    await page.getByRole('link', { name: day(0) }).click();
    await page.waitForURL(/\/m\/stocks\/inv-/);
    await page.getByRole('heading', { name: `Inventaire du ${day(0)}` }).waitFor();
    const inventoryUrl = page.url();
    const line = page.locator('fieldset div.flex.items-center.gap-2').filter({ hasText: 'Aliment ponte' });
    assert.match(flat(await line.innerText()), /Théorique ligne \d : 3 500/);
    await line.getByLabel(/^Compté ligne/).fill('3400');
    assert.match(flat(await line.innerText()), /−100/);
    await page.getByRole('button', { name: 'Enregistrer le brouillon' }).click();
    await page.getByText('Brouillon enregistré').waitFor();
    // Validating needs the `validate` permission, which the storekeeper does not hold.
    assert.equal(await page.getByRole('button', { name: "Valider l'inventaire" }).count(), 0);
    await page.context().close();

    page = await asRole(emails.stock);
    await page.goto(inventoryUrl);
    await page.getByRole('heading', { name: `Inventaire du ${day(0)}` }).waitFor();
    const counted = page.locator('fieldset div.flex.items-center.gap-2').filter({ hasText: 'Aliment ponte' }).getByLabel(/^Compté ligne/);
    assert.equal(await counted.inputValue(), '3400');
    await page.getByRole('button', { name: "Valider l'inventaire" }).click();
    const confirm = page.getByRole('dialog');
    await confirm.getByRole('button', { name: 'Valider' }).click();
    await confirm.waitFor({ state: 'detached' });
    await page.getByText('Validée', { exact: true }).waitFor();
    assert.equal(await page.getByRole('button', { name: "Valider l'inventaire" }).count(), 0);
    assert.equal(await page.getByLabel(/^Compté ligne/).first().isDisabled(), true);
    // A validated session lists what was counted, not every article of the farm as « — » rows.
    assert.equal(await page.getByLabel(/^Compté ligne/).count(), 1);
    assert.equal(await page.getByText(/Écart ligne \d : —/).count(), 0);

    await page.goto(`${WEB_URL}/m/stocks`);
    const ponte = page.getByRole('row', { name: /Aliment ponte/ });
    await ponte.waitFor();
    assert.match(flat(await ponte.innerText()), /Aliment ponte Aliment 3 400 kg 4 000 faible/);
    await page.getByRole('tab', { name: 'Mouvements' }).click();
    const adjustment = page.getByRole('row', { name: /Ajustement/ });
    await adjustment.waitFor();
    assert.match(flat(await adjustment.innerText()), /Aliment ponte Ajustement -100 .* Inventaire/);
    await page.context().close();
  });

  it('Après l’inventaire validé : corriger la distribution ou supprimer l’entrée antérieure est refusé (409) et le stock ne bouge pas', async () => {
    const locked = `Un inventaire validé le ${day(0)} verrouille les mouvements antérieurs de Aliment ponte`;
    const stockOf = async () => (await api<{ items: { id: string; quantity: number }[] }>('/stock', { token: admin.token, farmId })).items.find((i) => i.id === ponteId)!.quantity;
    assert.equal(await stockOf(), 3400);

    // The director corrects the 500 kg of the distribution: refused, the message stays in the dialog.
    let page = await asRole(emails.director);
    await page.goto(`${WEB_URL}/m/alimentation`);
    await page.getByRole('tab', { name: 'Distributions' }).click();
    const row = page.getByRole('row', { name: new RegExp(lotCode) });
    await row.getByRole('button', { name: 'Modifier' }).click();
    let dialog = page.getByRole('dialog');
    await dialog.getByLabel('Quantité (kg)').fill('400');
    await dialog.getByRole('button', { name: 'Enregistrer' }).click();
    await dialog.getByText(locked).waitFor();
    assert.equal(await page.getByRole('dialog').count(), 1, 'the dialog stays open on the refusal');
    await dialog.getByRole('button', { name: 'Annuler' }).click();
    await dialog.waitFor({ state: 'detached' });
    assert.match(flat(await row.innerText()), /151 250 FCFA/);
    await page.context().close();

    // The stock manager deletes the entry of ten days ago: refused as well.
    page = await asRole(emails.stock);
    await page.goto(`${WEB_URL}/m/stocks`);
    await page.getByRole('link', { name: 'Aliment ponte' }).click();
    await page.getByRole('heading', { name: 'Aliment ponte' }).waitFor();
    await page.getByRole('tab', { name: 'Mouvements' }).click();
    const entry = page.getByRole('row', { name: new RegExp(`^${day(-10)} Aliment ponte Entrée`) });
    await entry.getByRole('button', { name: 'Supprimer' }).click();
    dialog = page.getByRole('dialog');
    await dialog.getByRole('button', { name: 'Supprimer' }).click();
    await dialog.getByText(locked).waitFor();
    await dialog.getByRole('button', { name: 'Annuler' }).click();
    await dialog.waitFor({ state: 'detached' });
    await entry.waitFor();
    await page.context().close();

    assert.equal(await stockOf(), 3400);
  });

  it('Vétérinaire : planifie deux vaccinations, réalise l’une depuis un lot de produit (le stock baisse), traite avec délai d’attente', async () => {
    const page = await asRole(emails.vet);
    await page.goto(`${WEB_URL}/m/sante`);
    const add = async (fill: (dialog: ReturnType<Page['getByRole']>) => Promise<void>) => {
      await page.getByRole('button', { name: 'Ajouter' }).click();
      const dialog = page.getByRole('dialog');
      await fill(dialog);
      await dialog.getByRole('button', { name: 'Enregistrer' }).click();
      await dialog.waitFor({ state: 'detached' });
    };
    // A vaccination planned for tomorrow with the stock vaccine, then one planned two days ago (overdue) in free text.
    await add(async (dialog) => {
      await dialog.getByRole('radio', { name: 'Vaccination' }).check();
      await dialog.getByRole('radio', { name: 'Planifié' }).check();
      await dialog.getByLabel('Lot', { exact: true }).selectOption({ label: lotCode });
      await dialog.getByLabel('Date').fill(day(1));
      await dialog.getByLabel('Produit en stock').selectOption({ label: 'Vaccin Newcastle' });
      await dialog.getByLabel('Vétérinaire').fill('Dr Koffi');
    });
    await add(async (dialog) => {
      await dialog.getByRole('radio', { name: 'Vaccination' }).check();
      await dialog.getByRole('radio', { name: 'Planifié' }).check();
      await dialog.getByLabel('Lot', { exact: true }).selectOption({ label: lotCode });
      await dialog.getByLabel('Date').fill(day(-2));
      await dialog.getByLabel('Produit (texte libre)').fill('Gumboro');
    });
    const newcastle = page.getByRole('row', { name: /Newcastle|Vaccin Newcastle/ });
    await newcastle.waitFor();
    assert.match(flat(await newcastle.innerText()), new RegExp(`${day(1)} ${lotCode} Vaccination Vaccin Newcastle Dr Koffi Planifié`));
    const late = page.getByRole('row', { name: /Gumboro/ });
    await late.getByText('En retard', { exact: true }).waitFor();
    // Tiles: 2 acts, 1 planned, 0 done, 1 overdue.
    await mainShows(page, /Total enregistrements 2 Planifié 1 Réalisé 0 En retard 1/);

    // Done from a batch of the product: 4 of the 20 flacons.
    await newcastle.getByRole('button', { name: 'Marquer réalisé' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('Quantité').fill('4');
    await dialog.getByLabel('Lot de produit').selectOption({ label: 'NC-2026-11 (20)' });
    await dialog.getByRole('button', { name: 'Enregistrer' }).click();
    await dialog.waitFor({ state: 'detached' });
    await newcastle.getByText('Réalisé', { exact: true }).waitFor();
    await page.goto(`${WEB_URL}/m/stocks`);
    const vaccine = page.getByRole('row', { name: /Vaccin Newcastle/ });
    await vaccine.waitFor();
    assert.match(flat(await vaccine.innerText()), /Vaccin Newcastle Vaccin 16 flacons 5 ok/);
    await page.goto(`${WEB_URL}/m/stocks`);
    await page.getByRole('link', { name: 'Vaccin Newcastle' }).click();
    await page.getByRole('heading', { name: 'Vaccin Newcastle' }).waitFor();
    assert.match(flat(await page.getByRole('tabpanel').innerText()), /NC-2026-11 .* 16/);
    await page.getByRole('tab', { name: 'Mouvements' }).click();
    const exitRow = page.getByRole('row', { name: /Sortie/ });
    await exitRow.waitFor();
    assert.match(flat(await exitRow.innerText()), new RegExp(`^${day(0)} Vaccin Newcastle Sortie -4 `));

    // The act was planned for tomorrow and completed today: two dates. Moving « Réalisé le » to yesterday moves the
    // stock exit (the planned date stays), whereas an act entered as done has one date that moves both.
    await page.goto(`${WEB_URL}/m/sante`);
    await newcastle.getByRole('button', { name: 'Modifier' }).click();
    const edit = page.getByRole('dialog');
    assert.equal(await edit.getByLabel('Date prévue').inputValue(), day(1));
    assert.equal(await edit.getByLabel('Réalisé le').inputValue(), day(0));
    await edit.getByLabel('Réalisé le').fill(day(-1));
    await edit.getByRole('button', { name: 'Enregistrer' }).click();
    await edit.waitFor({ state: 'detached' });
    await mainShows(page, new RegExp(`${day(1)} Réalisé le ${day(-1)}`));
    await page.goto(`${WEB_URL}/m/stocks`);
    await page.getByRole('link', { name: 'Vaccin Newcastle' }).click();
    // The list page has a tab of the same name and stays mounted while the lazy detail loads: wait for the detail.
    await page.getByRole('heading', { level: 1, name: 'Vaccin Newcastle' }).waitFor();
    await page.getByRole('tab', { name: 'Mouvements' }).click();
    assert.match(flat(await page.getByRole('row', { name: /Sortie/ }).innerText()), new RegExp(`^${day(-1)} Vaccin Newcastle Sortie -4 `));

    // A treatment: 3 days of treatment and 7 of withdrawal: the lot is under withdrawal for 10 days from today.
    await page.goto(`${WEB_URL}/m/sante`);
    await add(async (d) => {
      await d.getByRole('radio', { name: 'Traitement' }).check();
      await d.getByLabel('Lot', { exact: true }).selectOption({ label: lotCode });
      await d.getByLabel('Produit (texte libre)').fill('Amoxicilline');
      await d.getByLabel('Durée (jours)').fill('3');
      await d.getByLabel("Délai d'attente (jours)").fill('7');
    });
    await page.getByRole('row', { name: /Amoxicilline/ }).waitFor();
    await page.goto(`${WEB_URL}/m/lots/${lotId}`);
    await page.getByRole('heading', { name: lotCode }).waitFor();
    await page.getByText(`Délai d'attente jusqu'au ${day(10)}`).waitFor();
    await page.context().close();
  });

  it('Vétérinaire : sur un lot clôturé, un acte planifié peut être annulé ; un acte réalisé n’offre aucune action', async () => {
    // Set-up through the API: a second lot with a done and a planned vaccination, then sold out and closed.
    const vetToken = await apiLogin(emails.vet);
    const buildings = await api<{ items: { id: string; name: string }[] }>('/buildings', { token: admin.token, farmId });
    const lot = await api<{ id: string; code: string }>('/batches', {
      method: 'POST', token: admin.token, farmId,
      body: { species: 'AVICOLE', type: 'CHAIR', buildingId: buildings.items.find((b) => b.name === 'Poulailler L')!.id, entryDate: day(-20), initialCount: 100 },
    });
    const act = (body: object) => api('/health-acts', { method: 'POST', token: vetToken, farmId, body: { type: 'VACCINATION', batchId: lot.id, ...body } });
    await act({ status: 'REALISE', date: day(-5), productName: 'Newcastle fait' });
    await act({ status: 'PLANIFIE', date: day(3), productName: 'Marek prévu' });
    await api(`/batches/${lot.id}/events`, { method: 'POST', token: admin.token, farmId, body: { type: 'VENTE', date: day(-1), quantity: 100 } });
    await api(`/batches/${lot.id}/close`, { method: 'POST', token: admin.token, farmId, body: {} });

    const page = await asRole(emails.vet);
    await page.goto(`${WEB_URL}/m/lots/${lot.id}`);
    await page.getByRole('heading', { name: lot.code }).waitFor();
    await page.getByRole('tab', { name: 'Santé' }).click();
    const planned = page.getByRole('row', { name: /Marek prévu/ });
    const done = page.getByRole('row', { name: /Newcastle fait/ });
    await planned.waitFor();
    // Planned: cancel and delete stay usable (the API allows both on a closed lot); completing and editing stay visible but
    // disabled with the reason. Done: every icon disabled.
    const icons = async (row: typeof planned, disabled: boolean) => {
      const names: string[] = [];
      for (const b of await row.getByRole('button').all()) {
        if (((await b.getAttribute('aria-disabled')) === 'true') === disabled) names.push((await b.getAttribute('aria-label')) ?? '');
      }
      return names;
    };
    assert.deepEqual(await icons(planned, false), ['Annuler', 'Supprimer']);
    assert.deepEqual(await icons(planned, true), ['Marquer réalisé', 'Modifier']);
    assert.deepEqual(await icons(done, false), []);
    assert.equal(await page.getByRole('button', { name: 'Ajouter' }).count(), 0);

    await planned.getByRole('button', { name: 'Annuler' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByRole('button', { name: "Annuler l'intervention" }).click();
    await dialog.waitFor({ state: 'detached' });
    await planned.getByText('Annulé', { exact: true }).waitFor();
    // A cancelled act on a closed lot can no longer be changed.
    assert.deepEqual(await icons(planned, false), []);
    await page.context().close();
  });

  it('Administrateur : modifier un enregistrement dont la valeur n’est plus proposée garde cette valeur sélectionnée et ne l’envoie pas', async () => {
    const call = <T = { id: string }>(path: string, method = 'GET', body?: unknown) => api<T>(path, { method, token: admin.token, farmId, body });
    // A biosecurity entry on a building, and a feed product linked to an article that was deactivated since.
    const buildings = await call<{ items: { id: string; name: string }[] }>('/buildings');
    await call('/biosecurity-logs', 'POST', { date: day(-1), type: 'NETTOYAGE', buildingId: buildings.items.find((b) => b.name === 'Poulailler L')!.id, note: 'avant correction' });
    const retired = await call('/stock-items', 'POST', { name: 'Aliment retiré', category: 'ALIMENT', unit: 'kg', active: true });
    await call('/feed-products', 'POST', { name: 'Produit sur article retiré', kind: 'ALIMENT_COMPLET', unitCost: 200, stockItemId: retired.id });
    await call(`/stock-items/${retired.id}`, 'PATCH', { active: false });

    const page = await asAdmin();
    const writes: string[] = [];
    page.on('request', (r) => { if (['PATCH', 'PUT', 'POST'].includes(r.method()) && !r.url().includes('/auth/')) writes.push(`${r.method()} ${r.url().replace(/.*\/api/, '')} ${r.postData()}`); });
    const options = (select: ReturnType<Page['getByLabel']>) =>
      select.evaluate((el: HTMLSelectElement) => [...el.options].map((o) => `${o.text}${o.selected ? '*' : ''}${o.disabled ? '(off)' : ''}`));

    // 1. The building is among the options once they load: it ends up selected (by its name), and only the note is sent.
    await page.goto(`${WEB_URL}/m/sante`);
    await page.getByRole('tab', { name: 'Biosécurité' }).click();
    await page.getByRole('row', { name: /avant correction/ }).getByRole('button', { name: 'Modifier' }).click();
    let dialog = page.getByRole('dialog');
    await page.waitForFunction(() => [...document.querySelectorAll<HTMLSelectElement>('[role="dialog"] select')].some((s) => s.selectedOptions[0]?.text === 'Poulailler L'));
    assert.ok((await options(dialog.getByLabel('Bâtiment'))).includes('Poulailler L*'));
    await dialog.getByLabel('Note').fill('après correction');
    await dialog.getByRole('button', { name: 'Enregistrer' }).click();
    await dialog.waitFor({ state: 'detached' });
    assert.ok(writes.some((w) => /^PATCH \/biosecurity-logs\/\w+ \{"note":"après correction"\}$/.test(w)), writes.join('\n'));

    // 2. The article is no longer offered: « Valeur actuelle » stays selected (disabled) and is not sent.
    await page.goto(`${WEB_URL}/m/alimentation`);
    await page.getByRole('tab', { name: 'Aliments' }).click();
    await page.getByRole('row', { name: /Produit sur article retiré/ }).getByRole('button', { name: 'Modifier' }).click();
    dialog = page.getByRole('dialog');
    await dialog.getByLabel('Nom').fill('Produit sur article retiré 2');
    const article = dialog.getByLabel(/Article/);
    await page.waitForFunction(() => [...document.querySelectorAll<HTMLSelectElement>('[role="dialog"] select')].some((s) => [...s.options].some((o) => o.text === 'Aliment ponte')));
    assert.ok((await options(article)).includes('Valeur actuelle*(off)'), JSON.stringify(await options(article)));
    await dialog.getByRole('button', { name: 'Enregistrer' }).click();
    await dialog.waitFor({ state: 'detached' });
    assert.ok(writes.some((w) => /^PATCH \/feed-products\/\w+ \{"name":"Produit sur article retiré 2"\}$/.test(w)), writes.join('\n'));
    await page.context().close();
  });

  it('Directeur : le tableau de bord liste « Stock faible » et « Vaccination en retard »', async () => {
    const page = await asRole(emails.director);
    await page.goto(`${WEB_URL}/`);
    await page.getByText('Stock faible : Aliment ponte').waitFor();
    assert.match(flat(await page.locator('main').innerText()), /Stock faible : Aliment ponte 3400 kg \(seuil 4000\)/);
    await page.getByText('Vaccination en retard').waitFor();
    assert.match(flat(await page.locator('main').innerText()), new RegExp(`Vaccination en retard ${lotCode} — Gumboro`));
    // The vaccine is at 16 (minimum 5) and not near expiry: no alert for it.
    assert.equal(await page.getByText(/Stock (faible|critique) : Vaccin Newcastle/).count(), 0);
    await page.context().close();
  });

  it('Comptable : lit les achats et les fournisseurs, sans aucun bouton de workflow', async () => {
    const page = await asRole(emails.accountant);
    await page.goto(`${WEB_URL}/m/achats`);
    const row = purchaseRow(page, new RegExp(bcNumber));
    await row.waitFor();
    const text = flat(await row.innerText());
    assert.match(text, /Agro Provende SA Aliment ponte \+1 3 000 Reçue 1 170 000 FCFA/);
    assert.equal(await page.getByRole('button', { name: 'Ajouter' }).count(), 0);
    assert.equal(await row.getByRole('button').count(), 0, 'no row icon at all');

    // The link is on the first cell (the date).
    await row.getByRole('link').first().click();
    await page.getByRole('heading', { name: bcNumber }).waitFor();
    await mainShows(page, /Montant 1 170 000 FCFA Payé 0 FCFA Reste 1 170 000 FCFA/);
    for (const name of ['Valider', 'Commander', 'Réceptionner', 'Payer', 'Annuler']) {
      assert.equal(await page.getByRole('button', { name }).count(), 0, `the accountant has no « ${name} »`);
    }
    // The order and the receipt are in the history.
    await page.getByRole('tab', { name: 'Historique' }).click();
    assert.match(flat(await page.getByRole('tabpanel').innerText()), /Reçue/);

    await page.goto(`${WEB_URL}/m/fournisseurs`);
    const supplier = page.getByRole('row', { name: /Agro Provende SA/ });
    await supplier.waitFor();
    // What the farm owes: the received goods, nothing paid.
    assert.match(flat(await supplier.innerText()), /Agro Provende SA .* 1 170 000 FCFA/);
    assert.equal(await page.getByRole('button', { name: 'Ajouter' }).count(), 0);
    await page.context().close();
  });

  it('Administrateur : un plan vaccinal ne s’applique pas deux fois au même lot, sauf si toutes ses étapes ont été annulées', async () => {
    const call = <T = { id: string }>(path: string, method = 'GET', body?: unknown) => api<T>(path, { method, token: admin.token, farmId, body });
    await call('/vaccination-plans', 'POST', { name: 'Plan e2e', species: 'AVICOLE', items: [{ ageDays: 5, productName: 'Newcastle' }, { ageDays: 12, productName: 'Gumboro' }] });
    const page = await asAdmin();
    const apply = async () => {
      await page.goto(`${WEB_URL}/m/sante`);
      await page.getByRole('tab', { name: 'Plans vaccinaux' }).click();
      await page.getByRole('row', { name: /Plan e2e/ }).getByRole('button', { name: 'Appliquer à un lot' }).click();
      const dialog = page.getByRole('dialog');
      await dialog.getByLabel('Lot').selectOption({ label: lotCode });
      await dialog.getByRole('button', { name: 'Appliquer' }).click();
      return dialog;
    };
    const planned = () => call<{ items: { id: string; productName: string; status: string }[] }>(`/health-acts?batchId=${lotId}&pageSize=100`).then((r) => r.items.filter((a) => /Newcastle|Gumboro/.test(a.productName ?? '')));
    let dialog = await apply();
    await dialog.waitFor({ state: 'detached' });
    const created = (await planned()).filter((a) => a.status !== 'ANNULE');
    assert.ok(created.length >= 2, 'the two steps were planned');

    // Applied again while its acts stand: refused, the reason stays in the dialog.
    dialog = await apply();
    await dialog.getByText(/déjà/i).waitFor();
    await dialog.getByRole('button', { name: 'Annuler' }).click();
    await dialog.waitFor({ state: 'detached' });

    // Every step cancelled: the plan can be applied again.
    for (const act of created) await call(`/health-acts/${act.id}/cancel`, 'POST');
    dialog = await apply();
    await dialog.waitFor({ state: 'detached' });
    const again = (await planned()).filter((a) => a.status !== 'ANNULE');
    assert.ok(again.length >= 2, 'planned again');
    // Leave the lot as it was: the alerts of the dashboard are asserted above, in this flow's order.
    for (const act of again) await call(`/health-acts/${act.id}/cancel`, 'POST');
    await page.context().close();
  });
});
