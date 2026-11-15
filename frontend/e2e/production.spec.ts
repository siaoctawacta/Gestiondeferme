import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import type { Browser, Page } from 'playwright';
import { api, enrollAdmin, enrollUser, launch, newPage, PASSWORD, uiLoginWithBackupCode, WEB_URL, type EnrolledAdmin, type EnrolledUser } from './helpers.ts';

/** Text with every kind of space (thin, no-break) turned into a plain one, so `4 820` matches however it is grouped. */
const flat = (text: string) => text.replace(/\s+/g, ' ').trim();
/** Waits until the page's main text (spaces flattened) matches: a figure that follows a save arrives with the refetch. */
const mainShows = (page: Page, re: RegExp) =>
  page.waitForFunction(
    ([source, flags]) => new RegExp(source, flags).test(document.querySelector('main')?.innerText.replace(/\s+/g, ' ') ?? ''),
    [re.source, re.flags] as const,
  );
const day = (offset: number) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);

// The tests below run in order and SHARE STATE (one farm, one lot, one laying house, one sow...): each builds on what
// the previous ones created, so none can be run alone, and a failure early on makes the later ones fail too.
// A farm of its own (the seeded one is shared with the other specs), so the dashboard figures are exactly this flow's.
describe('production : lots, ponte, porcs, reproduction et alimentation de bout en bout', () => {
  let browser: Browser;
  let page: Page;
  let admin: EnrolledAdmin;
  let director: EnrolledUser;
  let farmId: string;
  let lotCode = '';
  let lotId = '';
  let layerCode = '';
  let chickId = '';
  const asDirector = (path: string, method = 'GET', body?: unknown) => api(path, { method, token: director.token, farmId, body });

  before(async () => {
    browser = await launch();
    admin = await enrollAdmin('production');
    farmId = (await api<{ id: string }>('/farms', { method: 'POST', token: admin.token, body: { name: 'Ferme Production' } })).id;
    // A Directeur de ferme must enrol a second factor: done once here, the backup codes serve the UI logins below.
    await api('/users', {
      method: 'POST',
      token: admin.token,
      farmId,
      body: { name: 'Directrice Test', email: 'directeur@e2e.test', role: 'DIRECTEUR_FERME', farmIds: [farmId], password: PASSWORD },
    });
    director = await enrollUser('directeur@e2e.test');
    // Sites belong to the Fermes & sites module (Super administrateur): the director then builds on it.
    await api('/sites', { method: 'POST', token: admin.token, farmId, body: { name: 'Site Nord' } });
    ({ page } = await newPage(browser));
    await uiLoginWithBackupCode(page, director.email, director.backupCodes[0]);
    await page.getByRole('heading', { name: 'Tableau de bord' }).waitFor();
  });
  after(async () => {
    await browser.close();
  });

  it('crée « Poulailler A » (5000) puis un lot de 5000 poulets de chair', async () => {
    await page.goto(`${WEB_URL}/m/batiments`);
    await page.getByRole('button', { name: 'Ajouter' }).click();
    let dialog = page.getByRole('dialog');
    await dialog.getByLabel('Nom').fill('Poulailler A');
    await dialog.getByLabel('Type').selectOption({ label: 'Avicole' });
    await dialog.getByLabel('Site').selectOption({ label: 'Site Nord' });
    await dialog.getByLabel('Capacité').fill('5000');
    await dialog.getByLabel('Statut').selectOption({ label: 'Actif' });
    await dialog.getByRole('button', { name: 'Enregistrer' }).click();
    await dialog.waitFor({ state: 'detached' });
    await page.getByRole('row', { name: /Poulailler A/ }).waitFor();

    await page.goto(`${WEB_URL}/m/lots`);
    await page.getByRole('button', { name: 'Ajouter' }).click();
    dialog = page.getByRole('dialog');
    await dialog.getByLabel('Type').selectOption({ label: 'Chair' });
    await dialog.getByLabel('Bâtiment').selectOption({ label: 'Poulailler A' });
    await dialog.getByLabel('Effectif initial').fill('5000');
    await dialog.getByRole('button', { name: 'Enregistrer' }).click();
    await dialog.waitFor({ state: 'detached' });
    const row = page.getByRole('row', { name: /Poulailler A/ });
    await row.waitFor();
    lotCode = (await row.getByRole('link').innerText()).trim();
    assert.match(lotCode, /^LC-\d{4}-\d+$/);
    assert.match(flat(await row.innerText()), /5 000/);
    await row.getByText('En cours', { exact: true }).waitFor();
  });

  it('180 morts : la liste montre 4 820 vivants et 3.6 %, le lot et les mouvements suivent', async () => {
    await page.getByRole('link', { name: lotCode }).click();
    await page.getByRole('heading', { name: lotCode }).waitFor();
    await page.getByRole('button', { name: 'Ajouter' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('Type').selectOption({ label: 'Mortalité' });
    await dialog.getByLabel('Quantité').fill('180');
    await dialog.getByLabel('Cause').fill('Chaleur');
    await dialog.getByRole('button', { name: 'Enregistrer' }).click();
    await dialog.waitFor({ state: 'detached' });
    const event = page.getByRole('row', { name: /Mortalité/ });
    await event.waitFor();
    assert.match(flat(await event.innerText()), /180/);

    await page.goto(`${WEB_URL}/m/lots`);
    const row = page.getByRole('row', { name: new RegExp(lotCode) });
    await row.waitFor();
    const text = flat(await row.innerText());
    assert.match(text, /4 820/);
    assert.match(text, /3\.6%/);
    lotId = (await page.getByRole('link', { name: lotCode }).getAttribute('href'))!.split('/').pop()!;
  });

  it('Bâtiments : occupation 4 820 et taux 96 %', async () => {
    await page.goto(`${WEB_URL}/m/batiments`);
    const row = page.getByRole('row', { name: /Poulailler A/ });
    await row.waitFor();
    const text = flat(await row.innerText());
    assert.match(text, /4 820/);
    assert.match(text, /96%/);
  });

  it('tableau de bord : 4 820 volailles et l’alerte « Mortalité élevée »', async () => {
    await page.goto(`${WEB_URL}/`);
    const card = page.getByText('Volailles vivantes', { exact: true }).locator('xpath=../..');
    await card.waitFor();
    assert.match(flat(await card.innerText()), /4 820/);
    await page.getByText(/Mortalité élevée/).first().waitFor();
    assert.match(flat(await page.getByText(/Mortalité élevée/).first().innerText()), new RegExp(lotCode));
  });

  it('ponte : une collecte d’œufs d’un lot pondeuse apparaît dans Ponte et sur le tableau de bord', async () => {
    // Set-up that is not the point of the test goes through the API: a laying house and its lot.
    await asDirector('/buildings', 'POST', {
      name: 'Pondoir C',
      type: 'AVICOLE',
      siteId: (await api<{ items: { id: string }[] }>('/sites', { token: admin.token, farmId })).items[0].id,
      capacity: 3000,
      status: 'ACTIF',
    });
    const buildings = await asDirector('/buildings') as { items: { id: string; name: string }[] };
    const layer = await asDirector('/batches', 'POST', {
      species: 'AVICOLE',
      type: 'PONDEUSE',
      buildingId: buildings.items.find((b) => b.name === 'Pondoir C')!.id,
      entryDate: day(-100),
      initialCount: 3000,
    }) as { code: string };
    layerCode = layer.code;

    await page.goto(`${WEB_URL}/m/ponte`);
    await page.getByRole('button', { name: 'Ajouter' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('Lot').selectOption({ label: layerCode });
    await dialog.getByLabel('Œufs collectés').fill('2480');
    await dialog.getByLabel('Œufs cassés').fill('42');
    await dialog.getByRole('button', { name: 'Enregistrer' }).click();
    await dialog.waitFor({ state: 'detached' });
    const row = page.getByRole('row', { name: new RegExp(layerCode) });
    await row.waitFor();
    const text = flat(await row.innerText());
    assert.match(text, /2 480/);
    assert.match(text, /1\.7%/);

    await page.goto(`${WEB_URL}/`);
    const card = page.getByText('Œufs (dernier jour)', { exact: true }).locator('xpath=../..');
    await card.waitFor();
    assert.match(flat(await card.innerText()), /2 480/);
  });

  it('reproduction : une saillie donne la mise bas prévue à +114 jours, puis la mise bas crée un lot de porcelets', async () => {
    const buildingIds: Record<string, string> = {};
    const site = (await api<{ items: { id: string }[] }>('/sites', { token: admin.token, farmId })).items[0].id;
    for (const name of ['Porcherie 1', 'Maternité']) {
      const b = await asDirector('/buildings', 'POST', { name, type: 'PORCIN', siteId: site, capacity: 300, status: 'ACTIF' }) as { id: string };
      buildingIds[name] = b.id;
    }
    await asDirector('/animals', 'POST', { category: 'TRUIE', tag: 'TR-014', buildingId: buildingIds['Maternité'] });
    await asDirector('/animals', 'POST', { category: 'VERRAT', tag: 'VR-002', buildingId: buildingIds['Porcherie 1'] });

    const service = day(-20);
    const expected = new Date(Date.parse(service) + 114 * 86_400_000).toISOString().slice(0, 10);
    await page.goto(`${WEB_URL}/m/reproduction`);
    await page.getByRole('button', { name: 'Ajouter' }).click();
    let dialog = page.getByRole('dialog');
    await dialog.getByLabel('Truie').selectOption({ label: 'TR-014' });
    await dialog.getByLabel('Verrat').selectOption({ label: 'VR-002' });
    await dialog.getByLabel('Date de saillie').fill(service);
    await dialog.getByRole('button', { name: 'Enregistrer' }).click();
    await dialog.waitFor({ state: 'detached' });
    const row = page.getByRole('row', { name: /TR-014/ });
    await row.waitFor();
    const text = flat(await row.innerText());
    assert.match(text, new RegExp(service));
    assert.match(text, new RegExp(expected));
    await row.getByText('Gestation', { exact: true }).waitFor();

    await row.getByRole('button', { name: 'Mise bas' }).click();
    dialog = page.getByRole('dialog', { name: /Mise bas/ });
    await dialog.getByLabel('Nés totaux').fill('12');
    await dialog.getByLabel('Nés vivants').fill('11');
    await dialog.getByLabel('Mort-nés').fill('1');
    await dialog.getByLabel('Bâtiment de la portée').selectOption({ label: 'Maternité' });
    await dialog.getByRole('button', { name: 'Enregistrer' }).click();
    await dialog.waitFor({ state: 'detached' });
    await page.getByRole('row', { name: /TR-014/ }).getByText('Mise bas', { exact: true }).first().waitFor();

    await page.goto(`${WEB_URL}/m/porcs`);
    const litter = page.getByRole('row', { name: /Porcelets/ });
    await litter.waitFor();
    assert.match(flat(await litter.innerText()), /Maternité/);
    await page.getByRole('row', { name: /TR-014/ }).getByText('Allaitante', { exact: true }).waitFor();
  });

  it('alimentation : un aliment, puis une distribution avec son coût et son eau', async () => {
    await page.goto(`${WEB_URL}/m/alimentation`);
    await page.getByRole('tab', { name: 'Aliments' }).click();
    await page.getByRole('button', { name: 'Ajouter' }).click();
    let dialog = page.getByRole('dialog');
    await dialog.getByLabel('Nom').fill('Croissance démo');
    await dialog.getByLabel('Type').selectOption({ label: 'Aliment complet' });
    await dialog.getByLabel('Coût unitaire (FCFA/kg)').fill('340');
    await dialog.getByRole('button', { name: 'Enregistrer' }).click();
    await dialog.waitFor({ state: 'detached' });
    await page.getByRole('row', { name: /Croissance démo/ }).waitFor();

    await page.getByRole('tab', { name: 'Distributions' }).click();
    await page.getByRole('button', { name: 'Ajouter' }).click();
    dialog = page.getByRole('dialog');
    await dialog.getByRole('combobox', { name: 'Lot' }).selectOption({ label: lotCode });
    await dialog.getByRole('combobox', { name: 'Aliment' }).selectOption({ label: 'Croissance démo' });
    await dialog.getByLabel('Quantité (kg)').fill('100');
    await dialog.getByLabel('Eau (L)').fill('250');
    await dialog.getByRole('button', { name: 'Enregistrer' }).click();
    await dialog.waitFor({ state: 'detached' });
    const row = page.getByRole('row', { name: new RegExp(lotCode) });
    await row.waitFor();
    const text = flat(await row.innerText());
    assert.match(text, /Croissance démo/);
    assert.match(text, /34 000 FCFA/);
    assert.match(text, /\b250\b/);

    // The same list lives in the lot's own page, scoped to it.
    await page.goto(`${WEB_URL}/m/lots/${lotId}`);
    await page.getByRole('tab', { name: 'Alimentation' }).click();
    await page.getByRole('row', { name: /Croissance démo/ }).waitFor();
  });

  it('alimentation : une formule de deux lignes (100 %) au coût au kg affiché, utilisée dans une distribution', async () => {
    await asDirector('/feed-products', 'POST', { name: 'Maïs démo', kind: 'MATIERE_PREMIERE', unitCost: 200 });
    await page.goto(`${WEB_URL}/m/alimentation`);
    await page.getByRole('tab', { name: 'Formules' }).click();
    await page.getByRole('button', { name: 'Ajouter' }).click();
    let dialog = page.getByRole('dialog');
    await dialog.getByLabel('Nom').fill('Mélange démo');
    await dialog.getByLabel('Stade').fill('Croissance');
    await dialog.getByLabel('Aliment ligne 1').selectOption({ label: 'Croissance démo' });
    await dialog.getByLabel('Pourcentage ligne 1').fill('50');
    await dialog.getByRole('button', { name: 'Ajouter une ligne' }).click();
    await dialog.getByLabel('Aliment ligne 2').selectOption({ label: 'Maïs démo' });
    await dialog.getByLabel('Pourcentage ligne 2').fill('50');
    assert.match(flat(await dialog.getByTestId('formula-total').innerText()), /Total : 100%/);
    // 50 % x 340 + 50 % x 200 = 270 FCFA per kg.
    assert.match(flat(await dialog.getByTestId('formula-cost').innerText()), /^270 FCFA$/);
    await dialog.getByRole('button', { name: 'Enregistrer' }).click();
    await dialog.waitFor({ state: 'detached' });
    assert.match(flat(await page.getByRole('row', { name: /Mélange démo/ }).innerText()), /270 FCFA/);

    await page.getByRole('tab', { name: 'Distributions' }).click();
    await page.getByRole('button', { name: 'Ajouter' }).click();
    dialog = page.getByRole('dialog');
    await dialog.getByRole('combobox', { name: 'Lot' }).selectOption({ label: lotCode });
    await dialog.getByRole('radio', { name: 'Formule' }).click();
    await dialog.getByRole('combobox', { name: 'Formule' }).selectOption({ label: 'Mélange démo' });
    await dialog.getByLabel('Quantité (kg)').fill('100');
    await dialog.getByRole('button', { name: 'Enregistrer' }).click();
    await dialog.waitFor({ state: 'detached' });
    assert.match(flat(await page.getByRole('row', { name: /Mélange démo/ }).innerText()), /27 000 FCFA/);
  });

  it('incubation : une incubation, son mirage puis son éclosion créent un lot de poussins dans Lots avicoles', async () => {
    const site = (await api<{ items: { id: string }[] }>('/sites', { token: admin.token, farmId })).items[0].id;
    await asDirector('/buildings', 'POST', { name: 'Couvoir D', type: 'AVICOLE', siteId: site, capacity: 1000, status: 'ACTIF' });

    await page.goto(`${WEB_URL}/m/ponte`);
    await page.getByRole('tab', { name: 'Incubation' }).click();
    await page.getByRole('button', { name: 'Ajouter' }).click();
    let dialog = page.getByRole('dialog');
    await dialog.getByLabel('Couveuse').fill('Couveuse 1');
    await dialog.getByLabel("Lot d'origine").selectOption({ label: layerCode });
    await dialog.getByLabel('Œufs incubés').fill('300');
    await dialog.getByRole('button', { name: 'Enregistrer' }).click();
    await dialog.waitFor({ state: 'detached' });
    const row = page.getByRole('row', { name: /Couveuse 1/ });
    await row.waitFor();
    assert.match(flat(await row.innerText()), /300/);
    await row.getByText('En cours', { exact: true }).waitFor();

    await row.getByRole('button', { name: 'Mirage' }).click();
    dialog = page.getByRole('dialog', { name: /Mirage/ });
    await dialog.getByLabel('Œufs fertiles').fill('280');
    await dialog.getByRole('button', { name: 'Enregistrer' }).click();
    await dialog.waitFor({ state: 'detached' });
    await page.getByRole('row', { name: /Couveuse 1.*280/ }).waitFor();

    await row.getByRole('button', { name: 'Éclosion' }).click();
    dialog = page.getByRole('dialog', { name: /Éclosion/ });
    await dialog.getByLabel('Poussins éclos').fill('260');
    await dialog.getByLabel('Bâtiment').selectOption({ label: 'Couvoir D' });
    await dialog.getByRole('button', { name: 'Enregistrer' }).click();
    await dialog.waitFor({ state: 'detached' });
    await row.getByText('Éclos', { exact: true }).waitFor();
    assert.match(flat(await row.innerText()), /86\.7%/);
    // The finished incubation keeps its edit and delete icons, disabled with their reason.
    assert.equal(await row.getByRole('button', { name: 'Modifier' }).getAttribute('aria-disabled'), 'true');
    assert.equal(await row.getByRole('button', { name: 'Mirage' }).count(), 0);

    await page.goto(`${WEB_URL}/m/lots`);
    const chicks = page.getByRole('row', { name: /Couvoir D/ });
    await chicks.waitFor();
    const text = flat(await chicks.innerText());
    assert.match(text, /Poussin/);
    assert.match(text, /260/);
    chickId = (await chicks.getByRole('link').getAttribute('href'))!.split('/').pop()!;
  });

  it('reproduction : le sevrage de la portée de TR-014', async () => {
    await page.goto(`${WEB_URL}/m/reproduction`);
    const row = page.getByRole('row', { name: /TR-014/ });
    await row.waitFor();
    await row.getByRole('button', { name: 'Sevrage' }).click();
    const dialog = page.getByRole('dialog', { name: /Sevrage/ });
    await dialog.getByLabel('Nombre sevrés').fill('10');
    await dialog.getByRole('button', { name: 'Enregistrer' }).click();
    await dialog.waitFor({ state: 'detached' });
    await page.getByRole('row', { name: /TR-014/ }).getByText('Sevrage', { exact: true }).first().waitFor();
    assert.match(flat(await page.getByRole('row', { name: /TR-014/ }).innerText()), /\b10\b/);
    // Once weaned, the record is locked: its icons stay, disabled.
    const locked = page.getByRole('row', { name: /TR-014/ }).getByRole('button', { name: 'Modifier' });
    assert.equal(await locked.getAttribute('aria-disabled'), 'true');
    assert.equal(await locked.getAttribute('title'), 'Enregistrement verrouillé');
  });

  it('lot de poussins : Clôturer est refusé tant que des animaux restent, puis Clôturer et Rouvrir', async () => {
    await page.goto(`${WEB_URL}/m/lots/${chickId}`);
    await page.getByRole('heading', { level: 1 }).waitFor();
    // The API refuses to close a lot that still holds animals; its French message stays in the dialog.
    await page.getByRole('button', { name: 'Clôturer' }).click();
    let dialog = page.getByRole('dialog');
    await dialog.getByRole('button', { name: 'Clôturer' }).click();
    await dialog.getByText(/compte encore 260 animaux/).waitFor();
    await dialog.getByRole('button', { name: 'Annuler' }).click();
    await dialog.waitFor({ state: 'detached' });

    // The whole lot is sold, then it can be closed.
    await page.getByRole('button', { name: 'Ajouter' }).click();
    dialog = page.getByRole('dialog');
    await dialog.getByLabel('Type').selectOption({ label: 'Vente' });
    await dialog.getByLabel('Quantité').fill('260');
    await dialog.getByRole('button', { name: 'Enregistrer' }).click();
    await dialog.waitFor({ state: 'detached' });
    await page.getByRole('row', { name: /Vente\s+260\b/ }).waitFor();
    await page.getByRole('button', { name: 'Clôturer' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Clôturer' }).click();
    await page.getByRole('dialog').waitFor({ state: 'detached' });
    await page.getByRole('button', { name: 'Rouvrir' }).waitFor();
    await page.getByText('Clôturé', { exact: true }).first().waitFor();
    // A closed lot takes no more operations and offers no other action.
    assert.equal(await page.getByRole('button', { name: 'Transférer' }).count(), 0);
    assert.equal(await page.getByRole('button', { name: 'Ajouter' }).count(), 0);
    // Its movements are read-only: no edit icon on the sale.
    assert.equal(await page.getByRole('row', { name: /Vente/ }).getByRole('button', { name: 'Modifier' }).count(), 0);

    await page.getByRole('button', { name: 'Rouvrir' }).click();
    await page.getByRole('button', { name: 'Clôturer' }).waitFor();
    await page.getByText('En cours', { exact: true }).first().waitFor();
    assert.equal(await page.getByRole('button', { name: 'Rouvrir' }).count(), 0);
  });

  it('pesées : deux pesées du lot de chair, puis la courbe de poids moyen apparaît', async () => {
    await page.goto(`${WEB_URL}/m/lots/${lotId}`);
    await page.getByRole('heading', { name: lotCode }).waitFor();
    // The lot was entered today: edit its entry date (the new Modifier action) so earlier weighings are possible.
    await page.getByRole('button', { name: 'Modifier' }).filter({ hasText: 'Modifier' }).click();
    let dialog = page.getByRole('dialog', { name: /Modifier/ });
    await dialog.getByLabel("Date d'entrée").fill(day(-30));
    await dialog.getByRole('button', { name: 'Enregistrer' }).click();
    await dialog.waitFor({ state: 'detached' });
    // The page refetches the lot once saved: its age (30 days) follows the new entry date.
    await mainShows(page, /Âge \(jours\) 30/);

    await page.getByRole('tab', { name: 'Pesées' }).click();
    const weigh = async (date: string, sample: string, grams: string) => {
      await page.getByRole('button', { name: 'Ajouter' }).click();
      dialog = page.getByRole('dialog');
      await dialog.getByLabel('Date').fill(date);
      await dialog.getByLabel("Taille de l'échantillon").fill(sample);
      await dialog.getByLabel('Poids moyen (g)').fill(grams);
      await dialog.getByRole('button', { name: 'Enregistrer' }).click();
      await dialog.waitFor({ state: 'detached' });
    };
    await weigh(day(-10), '30', '600');
    await page.getByRole('row', { name: /600/ }).waitFor();
    // One point makes no curve.
    assert.equal(await page.getByRole('img', { name: 'Courbe de poids moyen' }).count(), 0);
    await weigh(day(-3), '30', '1000');
    await page.getByRole('img', { name: 'Courbe de poids moyen' }).waitFor();
    await mainShows(page, /Poids moyen 1[\s\u202f\u00a0]000 g/);
  });

  it('mortalité modifiée : la liste recalcule vivants et taux, puis revient à 3.6 %', async () => {
    const setDeaths = async (quantity: string) => {
      await page.goto(`${WEB_URL}/m/lots/${lotId}`);
      const event = page.getByRole('row', { name: /Mortalité/ });
      await event.waitFor();
      await event.getByRole('button', { name: 'Modifier' }).click();
      const dialog = page.getByRole('dialog');
      await dialog.getByLabel('Quantité').fill(quantity);
      await dialog.getByRole('button', { name: 'Enregistrer' }).click();
      await dialog.waitFor({ state: 'detached' });
      await page.getByRole('row', { name: new RegExp(`Mortalité\\s+${quantity}\\b`) }).waitFor();
    };
    const listRow = async () => {
      await page.goto(`${WEB_URL}/m/lots`);
      const row = page.getByRole('row', { name: new RegExp(lotCode) });
      await row.waitFor();
      return flat(await row.innerText());
    };
    await setDeaths('90');
    let text = await listRow();
    assert.match(text, /4 910/);
    assert.match(text, /1\.8%/);
    await setDeaths('180');
    text = await listRow();
    assert.match(text, /4 820/);
    assert.match(text, /3\.6%/);
  });

  it('pesée d’un lot de porcs : saisie et affichage en kilogrammes', async () => {
    await page.goto(`${WEB_URL}/m/porcs`);
    const litter = page.getByRole('row', { name: /Porcelets/ });
    await litter.waitFor();
    // The same status label and tone as on the lot's page.
    await litter.getByText('En cours', { exact: true }).waitFor();
    await litter.getByRole('link').click();
    await page.getByRole('link', { name: 'Cheptel porcin' }).waitFor();
    await page.getByText('En cours', { exact: true }).first().waitFor();
    await page.getByRole('tab', { name: 'Pesées' }).click();
    await page.getByRole('button', { name: 'Ajouter' }).click();
    const dialog = page.getByRole('dialog');
    assert.equal(await dialog.getByLabel('Poids moyen (g)').count(), 0);
    await dialog.getByLabel("Taille de l'échantillon").fill('5');
    await dialog.getByLabel('Poids moyen (kg)').fill('6.5');
    await dialog.getByRole('button', { name: 'Enregistrer' }).click();
    await dialog.waitFor({ state: 'detached' });
    await page.getByRole('row', { name: /6\.5 kg/ }).waitFor();
    await mainShows(page, /Poids moyen 6\.5 kg/);
  });

  it('un agent d’élevage ajoute une mortalité mais ne voit aucune suppression', async () => {
    await api('/users', {
      method: 'POST',
      token: admin.token,
      farmId,
      body: { name: 'Agent Test', email: 'agent@e2e.test', role: 'AGENT_ELEVAGE', farmIds: [farmId], password: PASSWORD },
    });
    const { context, page: agent } = await newPage(browser);
    await agent.goto(`${WEB_URL}/login`);
    await agent.getByLabel('Adresse e-mail').fill('agent@e2e.test');
    await agent.getByLabel('Mot de passe').fill(PASSWORD);
    await agent.getByRole('button', { name: 'Se connecter' }).click();
    await agent.getByRole('heading', { name: 'Tableau de bord' }).waitFor();

    await agent.goto(`${WEB_URL}/m/lots/${lotId}`);
    await agent.getByRole('heading', { name: lotCode }).waitFor();
    await agent.getByRole('button', { name: 'Ajouter' }).click();
    const dialog = agent.getByRole('dialog');
    await dialog.getByLabel('Type').selectOption({ label: 'Mortalité' });
    await dialog.getByLabel('Quantité').fill('5');
    await dialog.getByRole('button', { name: 'Enregistrer' }).click();
    await dialog.waitFor({ state: 'detached' });
    await agent.getByRole('row', { name: /Mortalité\s+5\b/ }).waitFor();
    assert.equal(await agent.getByRole('button', { name: 'Supprimer' }).count(), 0);
    assert.equal(await agent.getByRole('button', { name: 'Modifier' }).count(), 0);

    await agent.goto(`${WEB_URL}/m/lots`);
    await agent.getByRole('row', { name: new RegExp(lotCode) }).waitFor();
    assert.equal(await agent.getByRole('button', { name: 'Supprimer' }).count(), 0);
    await context.close();
  });

  it('le journal d’audit liste les opérations de chaque module', async () => {
    await page.goto(`${WEB_URL}/audit`);
    await page.getByRole('heading', { name: "Journal d'audit" }).waitFor();
    for (const module of ['Lots avicoles', 'Ponte & œufs', 'Reproduction', 'Cheptel porcin', 'Alimentation & eau', 'Bâtiments']) {
      await page.getByRole('row').filter({ hasText: module }).filter({ hasText: 'Création' }).first().waitFor();
    }
    // The agent's mortality is attributed to the agent.
    await page.getByRole('row').filter({ hasText: 'Agent Test' }).first().waitFor();
  });
});
