import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import type { Browser, Page } from 'playwright';
import { api, enrollAdmin, enrollUser, launch, newPage, PASSWORD, uiLoginWithBackupCode, WEB_URL, type EnrolledAdmin, type EnrolledUser } from './helpers.ts';

/** Text with every kind of space (thin, no-break) turned into a plain one, so `4 820` matches however it is grouped. */
const flat = (text: string) => text.replace(/\s+/g, ' ').trim();
const day = (offset: number) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);

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
