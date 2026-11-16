import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { LONG_SUITE } from './suites.ts';
import type { Browser, Locator, Page } from 'playwright';
import {
  api, enrollAdmin, enrollUser, launch, newPage, PASSWORD, uiLoginWithBackupCode, uiLoginWithPassword, WEB_URL,
  type EnrolledAdmin, type EnrolledUser,
} from './helpers.ts';

/** Text with every kind of space (thin, no-break) turned into a plain one, so `1 050 000` matches however it is grouped. */
const flat = (text: string) => text.replace(/\s+/g, ' ').trim();
const day = (offset: number) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);
/** An amount as the UI prints it, spaces flattened (`1 420 000 FCFA`). */
const money = (n: number) => flat(`${new Intl.NumberFormat('fr-FR').format(n)} FCFA`);

// The flow of the slice, one role per step, through the real UI; set-up that is not the point of a step goes through
// the API. The tests below run in order and SHARE STATE (one farm, one customer, one invoice...), as in logistics.spec.ts.
// The overdue invoice (FA-4) is dated and due YESTERDAY, so it is overdue on any day; on the first day of a month
// yesterday is in the previous month, and the month-to-date figures below then leave its 400 000 out (`overdueInMonth`).
//
// The figures are worked out here:
// - FA-1: 300 chickens at 3 500 = 1 050 000; paid 600 000 at issue -> due 450 000 (Partielle); lot 5 000 -> 4 700.
// - FA-2: 10 plateaux of eggs (30 each = 300 eggs) at 2 500 = 25 000; the laying lot had 3 x 2 000 = 6 000 eggs -> 5 700.
// - FA-3: 100 kg of feed at 500 = 50 000; the article had 1 000 kg -> 900.
// - FA-1 is then settled (450 000), a credit note of 30 chickens with return = 105 000 -> refund due 105 000, lot 4 730,
//   then refunded.
// - FA-4 (Mme Afi, a prestation of 400 000 dated yesterday, due yesterday) is overdue.
// Month to date: revenue 1 050 000 + 25 000 + 50 000 + 400 000 - 105 000 = 1 420 000 (1 020 000 without FA-4 when
// yesterday is in the previous month); expenses 950 000 (salaires) + 40 000 (transport, attributed to the chickens' lot)
// = 990 000; margin 430 000 (30 000); receivables 25 000 + 50 000 + 400 000 (all time, whatever the month).
// The lot's margin: revenue 1 050 000 - 105 000 = 945 000, cost 40 000 -> 905 000, 270 sold.
describe('commerce : devis, facture, paiements, avoir, remboursement, finance et alertes', LONG_SUITE, () => {
  let browser: Browser;
  let admin: EnrolledAdmin;
  let farmId = '';
  let lotCode = '';
  let lotId = '';
  let layerId = '';
  let withdrawalCode = '';
  let withdrawalId = '';
  let cancelLotId = '';
  let articleId = '';
  let invoiceId = '';
  let invoiceNumber = '';
  let overdueNumber = '';
  // Whether the overdue invoice (dated yesterday) falls in the month to date: not on the first day of a month.
  let overdueInMonth = true;
  const users: Record<string, EnrolledUser | { email: string }> = {};
  const emails = {
    commercial: 'commercial@e2e.test',
    accountant: 'comptable-commerce@e2e.test',
    owner: 'proprietaire@e2e.test',
    director: 'directeur-commerce@e2e.test',
    storekeeper: 'magasinier-commerce@e2e.test',
  };

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

  /** Picks the option of a select whose text contains `text` (the sources are labelled `code — name (n vivants)`). */
  async function pick(select: Locator, text: string): Promise<void> {
    // The options of a source arrive with the sellables request: wait (up to 10 s) for the one asked for.
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

  /** Fills line `n` of a sale grid. */
  async function line(dialog: Locator, n: number, v: { kind: string; source?: string; unit?: string; designation?: string; quantity: string; price: string }): Promise<void> {
    await dialog.getByLabel(`Type ligne ${n}`).selectOption({ label: v.kind });
    if (v.source) await pick(dialog.getByLabel(`Source ligne ${n}`), v.source);
    if (v.designation) await dialog.getByLabel(`Désignation ligne ${n}`).fill(v.designation);
    if (v.unit) await dialog.getByLabel(`Unité ligne ${n}`).selectOption({ label: v.unit });
    await dialog.getByLabel(`Quantité ligne ${n}`).fill(v.quantity);
    await dialog.getByLabel(`Prix unitaire ligne ${n}`).fill(v.price);
  }

  const mainText = async (page: Page) => flat(await page.locator('main').innerText());
  const mainShows = (page: Page, re: RegExp) =>
    page.waitForFunction(
      ([source, flags]) => new RegExp(source, flags).test(document.querySelector('main')?.innerText.replace(/\s+/g, ' ') ?? ''),
      [re.source, re.flags] as const,
    );
  const alive = async (id: string) => (await call<{ alive: number }>(`/batches/${id}`)).alive;
  const eggBalance = async () => (await call<{ items: { id: string; available: number }[] }>(`/sales/sellables?kind=OEUFS&date=${day(0)}`)).items.find((s) => s.id === layerId)!.available;
  const stockOf = async () => (await call<{ items: { id: string; quantity: number }[] }>('/stock')).items.find((i) => i.id === articleId)!.quantity;
  const invoice = (id: string) => call<Record<string, any>>(`/sales/${id}`);
  before(async () => {
    browser = await launch();
    admin = await enrollAdmin('commerce');
    // A farm of its own: the seeded one is shared with the other specs, so the figures below are exactly this flow's.
    farmId = (await api<{ id: string }>('/farms', { method: 'POST', token: admin.token, body: { name: 'Ferme Commerce' } })).id;

    const roles: [string, string, string][] = [
      [emails.commercial, 'COMMERCIAL', 'Commercial Test'],
      [emails.accountant, 'COMPTABLE', 'Comptable Commerce'],
      [emails.owner, 'PROPRIETAIRE', 'Propriétaire Test'],
      [emails.director, 'DIRECTEUR_FERME', 'Directrice Commerce'],
      [emails.storekeeper, 'MAGASINIER', 'Magasinier Commerce'],
    ];
    for (const [email, role, name] of roles) await call('/users', 'POST', { name, email, role, farmIds: [farmId], password: PASSWORD });
    for (const email of [emails.accountant, emails.owner, emails.director]) users[email] = await enrollUser(email);

    const site = await call('/sites', 'POST', { name: 'Site Commerce' });
    const house = (name: string, capacity: number) => call('/buildings', 'POST', { name, type: 'AVICOLE', siteId: site.id, capacity, status: 'ACTIF' });
    const chair = await call<{ id: string; code: string }>('/batches', 'POST', {
      species: 'AVICOLE', type: 'CHAIR', buildingId: (await house('Poulailler V1', 6000)).id, entryDate: day(-30), initialCount: 5000,
    });
    lotId = chair.id;
    lotCode = chair.code;
    const layer = await call<{ id: string }>('/batches', 'POST', {
      species: 'AVICOLE', type: 'PONDEUSE', buildingId: (await house('Pondoir V2', 3000)).id, entryDate: day(-60), initialCount: 3000,
    });
    layerId = layer.id;
    for (const offset of [-3, -2, -1]) await call('/egg-production', 'POST', { batchId: layerId, date: day(offset), collected: 2000, broken: 0, toIncubation: 0 });
    // A lot under withdrawal (treated today: no sale for three days) and a lot to cancel a sale on.
    const treated = await call<{ id: string; code: string }>('/batches', 'POST', {
      species: 'AVICOLE', type: 'CHAIR', buildingId: (await house('Poulailler V3', 500)).id, entryDate: day(-20), initialCount: 200,
    });
    withdrawalCode = treated.code;
    withdrawalId = treated.id;
    cancelLotId = (await call<{ id: string }>('/batches', 'POST', {
      species: 'AVICOLE', type: 'CHAIR', buildingId: (await house('Poulailler V4', 1500)).id, entryDate: day(-20), initialCount: 1000,
    })).id;
    // The article sold: 1 000 kg at 320.
    articleId = (await call('/stock-items', 'POST', { name: 'Aliment vendu', category: 'ALIMENT', unit: 'kg', active: true })).id;
    await call('/stock/movements', 'POST', { itemId: articleId, type: 'ENTREE', date: day(-20), quantity: 1000, unitCost: 320, reason: 'ACHAT' });
  });

  after(async () => {
    // The article is shared with the stock list of the visual spec: it is deactivated (it holds nothing in the seeded farm).
    if (admin) {
      const items = await api<{ items: { id: string; name: string; active: boolean }[] }>('/stock-items?pageSize=200', { token: admin.token });
      for (const item of items.items.filter((i) => i.active && i.name === 'Aliment vendu')) {
        await api(`/stock-items/${item.id}`, { method: 'PATCH', token: admin.token, body: { active: false } });
      }
    }
    await browser?.close();
  });

  it('Commercial : crée le client Restaurant Le Palmier, puis un devis de 300 poulets à 3 500, l’envoie, le fait accepter et le facture', async () => {
    const page = await asRole(emails.commercial);
    await page.goto(`${WEB_URL}/m/clients`);
    await page.getByRole('button', { name: 'Ajouter' }).click();
    let dialog = page.getByRole('dialog');
    await dialog.getByLabel('Nom').fill('Restaurant Le Palmier');
    await dialog.getByLabel('Type').selectOption({ label: 'Restaurant' });
    await dialog.getByLabel('Téléphone').fill('+228 93 12 34 56');
    await dialog.getByLabel('Ville').fill('Lomé');
    await dialog.getByRole('button', { name: 'Enregistrer' }).click();
    await dialog.waitFor({ state: 'detached' });
    await page.getByRole('row', { name: /Restaurant Le Palmier/ }).waitFor();
    // The second customer of the flow (overdue invoice) goes through the API.
    await call('/customers', 'POST', { name: 'Marché Hédzranawoé — Mme Afi', type: 'REVENDEUR', phone: '+228 98 65 43 21', city: 'Lomé' });

    await page.goto(`${WEB_URL}/m/ventes`);
    await page.getByRole('tab', { name: 'Devis' }).click();
    await page.getByRole('button', { name: 'Ajouter' }).click();
    dialog = page.getByRole('dialog');
    await dialog.getByLabel('Client').selectOption({ label: 'Restaurant Le Palmier' });
    await line(dialog, 1, { kind: 'Lot', source: lotCode, quantity: '300', price: '3500' });
    // 300 x 3 500
    assert.match(flat(await dialog.innerText()), /Total : 1 050 000 FCFA/);
    await dialog.getByRole('button', { name: 'Enregistrer' }).click();
    await dialog.waitFor({ state: 'detached' });
    const row = page.getByRole('row', { name: /DV-0001/ });
    await row.waitFor();
    assert.match(flat(await row.innerText()), /Restaurant Le Palmier Poulets de chair 1 050 000 FCFA .* Brouillon/);
    // Nothing moved: a quote reserves nothing.
    assert.equal(await alive(lotId), 5000);

    for (const [action, status] of [['Envoyer', 'Envoyé'], ['Accepter', 'Accepté']] as const) {
      await row.getByRole('button', { name: action }).click();
      dialog = page.getByRole('dialog');
      await dialog.getByRole('button', { name: action }).click();
      await dialog.waitFor({ state: 'detached' });
      await mainShows(page, new RegExp(`DV-0001 .*${status}`));
    }
    await row.getByRole('button', { name: 'Facturer' }).click();
    dialog = page.getByRole('dialog');
    await dialog.getByRole('button', { name: 'Facturer' }).click();
    await dialog.waitFor({ state: 'detached' });
    await mainShows(page, /DV-0001 .*Facturé/);
    // The draft invoice exists, unnumbered, and the lot is untouched.
    await page.getByRole('tab', { name: 'Factures' }).click();
    await page.getByRole('row', { name: /Brouillon/ }).first().waitFor();
    assert.equal(await alive(lotId), 5000);
    await page.context().close();
  });

  it('Commercial : émet le brouillon avec 600 000 FCFA comptant : 300 poulets sortent du lot, la facture est Partielle, reste dû 450 000', async () => {
    const page = await asRole(emails.commercial);
    await page.goto(`${WEB_URL}/m/ventes`);
    const draft = page.getByRole('row', { name: /Brouillon/ }).first();
    await draft.getByRole('button', { name: 'Émettre' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('Paiement comptant').check();
    assert.equal(await dialog.getByLabel('Montant (FCFA)').inputValue(), '1050000');
    await dialog.getByLabel('Montant (FCFA)').fill('600000');
    await dialog.getByRole('button', { name: 'Émettre', exact: true }).click();
    await dialog.waitFor({ state: 'detached' });
    const row = page.getByRole('row', { name: /FA-0001/ });
    await row.waitFor();
    assert.match(flat(await row.innerText()), /Restaurant Le Palmier Poulets de chair 300 1 050 000 FCFA 450 000 FCFA/);
    invoiceNumber = 'FA-0001';
    invoiceId = (await call<{ items: { id: string; number: string }[] }>('/sales')).items.find((i) => i.number === invoiceNumber)!.id;
    assert.equal(await alive(lotId), 4700);
    const detail = await invoice(invoiceId);
    assert.deepEqual([detail.total, detail.paid, detail.due, detail.status], [1050000, 600000, 450000, 'PARTIELLE']);

    // The detail page reads the same figures, with the receipt of the payment.
    // The first column (the date) links to the detail.
    await row.getByRole('link', { name: day(0) }).click();
    await page.getByRole('heading', { name: invoiceNumber }).waitFor();
    await mainShows(page, /Total 1 050 000 FCFA Payé 600 000 FCFA Avoirs 0 FCFA Reste dû 450 000 FCFA/);
    assert.match(await mainText(page), /Partielle/);
    await page.getByRole('tab', { name: 'Paiements' }).click();
    await mainShows(page, /RC-0001/);
    // The lot's list now reads 4 700 alive.
    await page.goto(`${WEB_URL}/m/lots`);
    await page.getByRole('row', { name: new RegExp(lotCode) }).waitFor();
    assert.match(flat(await page.getByRole('row', { name: new RegExp(lotCode) }).innerText()), /4 700/);
    await page.context().close();
  });

  it('Commercial : facture 10 plateaux d’œufs (300 œufs) : le solde d’œufs du lot pondeuse baisse de 300', async () => {
    assert.equal(await eggBalance(), 6000);
    const page = await asRole(emails.commercial);
    await page.goto(`${WEB_URL}/m/ventes`);
    await page.getByRole('button', { name: 'Ajouter' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('Client').selectOption({ label: 'Restaurant Le Palmier' });
    // The source label carries the balance (6 000 eggs = 200 plateaux of 30).
    await line(dialog, 1, { kind: 'Œufs', source: '6 000 œufs disponibles (200 plateaux)', quantity: '10', price: '2500' });
    assert.equal(await dialog.getByLabel('Unité ligne 1').inputValue(), 'PLATEAU');
    assert.match(flat(await dialog.innerText()), /Total : 25 000 FCFA/);
    await dialog.getByRole('button', { name: 'Enregistrer' }).click();
    await dialog.waitFor({ state: 'detached' });
    await page.getByRole('row', { name: /FA-0002/ }).waitFor();
    assert.match(flat(await page.getByRole('row', { name: /FA-0002/ }).innerText()), /Œufs \(plateau\) 10 25 000 FCFA 25 000 FCFA/);
    assert.equal(await eggBalance(), 5700);
    // The sellable label of the invoice form reads the new balance (5 700 eggs = 190 plateaux).
    await page.getByRole('button', { name: 'Ajouter' }).click();
    const again = page.getByRole('dialog');
    await again.getByLabel('Type ligne 1').selectOption({ label: 'Œufs' });
    await pick(again.getByLabel('Source ligne 1'), '5 700 œufs disponibles (190 plateaux)');
    await again.getByRole('button', { name: 'Annuler' }).click();
    await again.waitFor({ state: 'detached' });
    await page.context().close();
  });

  it('Commercial : un lot en délai d’attente n’est plus proposé, et l’émission d’un brouillon antérieur au traitement est refusée avec le message exact', async () => {
    const customerId = (await call<{ items: { id: string; name: string }[] }>('/customers')).items.find((c) => c.name === 'Restaurant Le Palmier')!.id;
    // A draft on the lot while it is clear, then the lot is treated (three days of withdrawal): issuing is refused.
    await call('/sales', 'POST', { customerId, date: day(0), lines: [{ kind: 'LOT', batchId: withdrawalId, quantity: 10, unitPrice: 3500 }] });
    await call('/health-acts', 'POST', { type: 'TRAITEMENT', status: 'REALISE', date: day(0), productName: 'Amoxicilline', withdrawalDays: 3, batchId: withdrawalId });
    const page = await asRole(emails.commercial);
    await page.goto(`${WEB_URL}/m/ventes`);
    // The picker lists the lot, disabled, with the reason.
    await page.getByRole('button', { name: 'Ajouter' }).click();
    const form = page.getByRole('dialog');
    await form.getByLabel('Type ligne 1').selectOption({ label: 'Lot' });
    const listed = form.getByLabel('Source ligne 1').locator('option', { hasText: withdrawalCode });
    await listed.waitFor({ state: 'attached' });
    assert.equal(await listed.isDisabled(), true);
    assert.match(flat((await listed.textContent()) ?? ''), new RegExp(`Délai d'attente jusqu'au ${day(3)}`));
    await form.getByRole('button', { name: 'Annuler' }).click();
    await form.waitFor({ state: 'detached' });

    await page.getByRole('row', { name: /Brouillon/ }).first().getByRole('button', { name: 'Émettre' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByRole('button', { name: 'Émettre', exact: true }).click();
    await dialog.getByText(`Le lot ${withdrawalCode} est en délai d'attente jusqu'au ${day(3)} : vente impossible`).waitFor();
    assert.equal(await alive(withdrawalId), 200, 'nothing left the lot');
    const drafts = await call<{ items: { status: string }[] }>('/sales?status=BROUILLON');
    assert.equal(drafts.items.length, 1, 'the refused draft is still a draft');
    await dialog.getByRole('button', { name: 'Annuler' }).click();
    // The draft is useless: deleted.
    await page.getByRole('row', { name: /Brouillon/ }).first().getByRole('button', { name: 'Supprimer' }).click();
    const confirm = page.getByRole('dialog');
    await confirm.getByRole('button', { name: 'Supprimer' }).click();
    await confirm.waitFor({ state: 'detached' });
    assert.equal((await call<{ total: number }>('/sales')).total, 2);
    await page.context().close();
  });

  it('Commercial : vend 100 kg d’un article (le stock passe de 1 000 à 900), puis une vente antérieure à un inventaire validé est refusée', async () => {
    assert.equal(await stockOf(), 1000);
    const page = await asRole(emails.commercial);
    await page.goto(`${WEB_URL}/m/ventes`);
    await page.getByRole('button', { name: 'Ajouter' }).click();
    let dialog = page.getByRole('dialog');
    await dialog.getByLabel('Client').selectOption({ label: 'Restaurant Le Palmier' });
    await line(dialog, 1, { kind: 'Article', source: 'Aliment vendu', quantity: '100', price: '500' });
    await dialog.getByRole('button', { name: 'Enregistrer' }).click();
    await dialog.waitFor({ state: 'detached' });
    await page.getByRole('row', { name: /FA-0003/ }).waitFor();
    assert.equal(await stockOf(), 900);

    // A validated inventory yesterday (the count equals the theoretical 1 000 kg of that day) closes the past.
    const session = await call<{ id: string }>('/inventories', 'POST', { date: day(-1) });
    await call(`/inventories/${session.id}/lines`, 'PUT', { lines: [{ itemId: articleId, countedQty: 1000 }] });
    await call(`/inventories/${session.id}/validate`, 'POST');

    await page.goto(`${WEB_URL}/m/ventes`);
    await page.getByRole('button', { name: 'Ajouter' }).click();
    dialog = page.getByRole('dialog');
    await dialog.getByLabel('Client').selectOption({ label: 'Restaurant Le Palmier' });
    await dialog.getByLabel('Date', { exact: true }).fill(day(-5));
    await line(dialog, 1, { kind: 'Article', source: 'Aliment vendu', quantity: '10', price: '500' });
    await dialog.getByRole('button', { name: 'Enregistrer' }).click();
    await dialog.getByText(`Un inventaire validé le ${day(-1)} verrouille les mouvements antérieurs de Aliment vendu`).waitFor();
    assert.equal(await stockOf(), 900);
    await page.context().close();
  });

  it('Commercial : sans Avoir, Annuler ni Finance ; Propriétaire : annule une facture sans paiement et les poulets reviennent dans le lot', async () => {
    const page = await asRole(emails.commercial);
    // Commercial holds neither `ventes:validate` nor finance: no Avoir, no Annuler, no Finance menu.
    const customerId = (await call<{ items: { id: string; name: string }[] }>('/customers')).items.find((c) => c.name === 'Restaurant Le Palmier')!.id;
    const sold = await call<{ id: string; number: string }>('/sales/issued', 'POST', {
      customerId, date: day(0), lines: [{ kind: 'LOT', batchId: cancelLotId, quantity: 50, unitPrice: 3000 }],
    });
    assert.equal(await alive(cancelLotId), 950);
    await page.goto(`${WEB_URL}/m/ventes/${sold.id}`);
    await page.getByRole('heading', { name: sold.number }).waitFor();
    assert.equal(await page.getByRole('button', { name: 'Avoir' }).count(), 0);
    assert.equal(await page.getByRole('button', { name: 'Annuler' }).count(), 0);
    assert.equal(await page.locator('aside').getByRole('link', { name: 'Finance' }).count(), 0);
    await page.context().close();

    const owner = await asRole(emails.owner);
    await owner.goto(`${WEB_URL}/m/ventes/${sold.id}`);
    await owner.getByRole('heading', { name: sold.number }).waitFor();
    // The Propriétaire validates (cancel, credit note) but cannot record a payment.
    assert.equal(await owner.getByRole('button', { name: 'Encaisser' }).count(), 0);
    await owner.getByRole('button', { name: 'Annuler' }).click();
    const dialog = owner.getByRole('dialog');
    await dialog.getByLabel('Motif').fill('Commande annulée par le client');
    await dialog.getByRole('button', { name: "Confirmer l'annulation" }).click();
    await dialog.waitFor({ state: 'detached' });
    await owner.getByText('Annulée', { exact: true }).first().waitFor();
    assert.equal(await alive(cancelLotId), 1000);
    assert.match(await mainText(owner), /Motif de l'annulation : Commande annulée par le client/);
    await owner.context().close();
  });

  it('Comptable : encaisse le reste (Soldée), émet un avoir de 30 poulets avec retour (lot +30, À rembourser 105 000) et rembourse', async () => {
    const page = await asRole(emails.accountant);
    await page.goto(`${WEB_URL}/m/ventes/${invoiceId}`);
    await page.getByRole('heading', { name: invoiceNumber }).waitFor();
    await page.getByRole('button', { name: 'Encaisser' }).click();
    let dialog = page.getByRole('dialog');
    assert.equal(await dialog.getByLabel('Montant (FCFA)').inputValue(), '450000');
    await dialog.getByRole('button', { name: 'Enregistrer' }).click();
    await dialog.waitFor({ state: 'detached' });
    await mainShows(page, /Payé 1 050 000 FCFA .* Reste dû 0 FCFA/);
    assert.match(await mainText(page), /Soldée/);
    let detail = await invoice(invoiceId);
    assert.deepEqual([detail.paid, detail.due, detail.status], [1050000, 0, 'SOLDEE']);

    await page.getByRole('button', { name: 'Avoir' }).click();
    dialog = page.getByRole('dialog');
    await dialog.getByLabel('Motif').fill('30 poulets non conformes');
    await dialog.getByLabel('Retour des marchandises').check();
    await dialog.getByLabel(/^Quantité à créditer/).fill('30');
    assert.match(flat(await dialog.innerText()), /Total : 105 000 FCFA/);
    await dialog.getByRole('button', { name: 'Enregistrer' }).click();
    await dialog.waitFor({ state: 'detached' });
    await mainShows(page, /À rembourser 105 000 FCFA/);
    detail = await invoice(invoiceId);
    assert.deepEqual([detail.credited, detail.refundDue, detail.due, detail.status], [105000, 105000, 0, 'SOLDEE']);
    assert.equal(await alive(lotId), 4730, 'the 30 returned chickens are back in the lot');
    assert.equal(detail.lines[0].creditableQuantity, 270);

    await page.getByRole('button', { name: 'Rembourser' }).click();
    dialog = page.getByRole('dialog');
    assert.equal(await dialog.getByLabel('Montant (FCFA)').inputValue(), '105000');
    await dialog.getByRole('button', { name: 'Enregistrer' }).click();
    await dialog.waitFor({ state: 'detached' });
    // The refund is done when the button is gone (it shows while something is owed back): the credit note alone does not say so.
    await page.getByRole('button', { name: 'Rembourser' }).waitFor({ state: 'detached' });
    detail = await invoice(invoiceId);
    assert.deepEqual([detail.refunded, detail.refundDue, detail.status], [105000, 0, 'SOLDEE']);
    assert.doesNotMatch(await mainText(page), /À rembourser/);
    // The customer owes the two unpaid invoices (25 000 + 50 000) and is owed nothing back.
    const customerId = (await call<{ items: { id: string; name: string }[] }>('/customers')).items.find((c) => c.name === 'Restaurant Le Palmier')!.id;
    const customer = await call<{ balance: number; refundDue: number }>(`/customers/${customerId}`);
    assert.deepEqual([customer.balance, customer.refundDue], [75000, 0]);
    await page.goto(`${WEB_URL}/m/clients/${customerId}`);
    await mainShows(page, /Reste dû 75 000 FCFA/);
    assert.doesNotMatch(await mainText(page), /À rembourser/);
    await page.context().close();
  });

  it('Comptable : saisit des salaires de 950 000 et un transport de 40 000 attribué au lot des poulets (options de lot du module Finance)', async () => {
    const page = await asRole(emails.accountant);
    await page.goto(`${WEB_URL}/m/finance`);
    await page.getByRole('button', { name: 'Ajouter' }).click();
    let dialog = page.getByRole('dialog');
    await dialog.getByLabel('Libellé').fill('Salaires du mois');
    await dialog.getByLabel('Activité').selectOption({ label: 'Général' });
    await dialog.getByLabel('Catégorie').selectOption({ label: 'Salaires' });
    await dialog.getByLabel('Montant').fill('950000');
    await dialog.getByRole('button', { name: 'Enregistrer' }).click();
    await dialog.waitFor({ state: 'detached' });
    await page.getByRole('row', { name: /Salaires du mois/ }).waitFor();

    await page.getByRole('button', { name: 'Ajouter' }).click();
    dialog = page.getByRole('dialog');
    await dialog.getByLabel('Libellé').fill('Transport des poulets');
    await dialog.getByLabel('Activité').selectOption({ label: 'Avicole' });
    await dialog.getByLabel('Catégorie').selectOption({ label: 'Transport' });
    await dialog.getByLabel('Montant').fill('40000');
    // The Comptable reads neither Lots nor Porcs: the lots come from the finance options.
    await pick(dialog.getByLabel('Lot'), lotCode);
    await dialog.getByRole('button', { name: 'Enregistrer' }).click();
    await dialog.waitFor({ state: 'detached' });
    const row = page.getByRole('row', { name: /Transport des poulets/ });
    await row.waitFor();
    assert.match(flat(await row.innerText()), /Dépense Avicole Transport 40 000 FCFA/);
    const entries = await call<{ items: { label: string; batchId: string | null }[] }>('/finance/entries');
    assert.equal(entries.items.find((e) => e.label === 'Transport des poulets')!.batchId, lotId);
    // The derived rows sit beside the manual ones, locked, and the credit note is a negative revenue.
    assert.ok(entries.items.some((e) => e.label.includes(invoiceNumber)));
    await page.context().close();
  });

  it('Comptable : crée une facture à échéance dépassée pour Mme Afi', async () => {
    // Dated and due yesterday: overdue whatever the day of the month. On the first day of a month yesterday is in the
    // previous month, which the month-to-date figures of the next step take into account.
    overdueInMonth = day(-1).slice(0, 7) === day(0).slice(0, 7);
    const customerId = (await call<{ items: { id: string; name: string }[] }>('/customers')).items.find((c) => c.name.startsWith('Marché Hédzranawoé'))!.id;
    const sold = await call<{ id: string; number: string }>('/sales/issued', 'POST', {
      customerId, date: day(-1), dueDate: day(-1), lines: [{ kind: 'SERVICE', designation: 'Prestation de transport', quantity: 1, unitPrice: 400000 }],
    });
    overdueNumber = sold.number;
    assert.equal(overdueNumber, 'FA-0005');
  });

  it('Comptable : la Synthèse, la Rentabilité par lot et la carte du tableau de bord donnent les chiffres calculés', async () => {
    const page = await asRole(emails.accountant);
    await page.goto(`${WEB_URL}/m/finance`);
    await page.getByRole('tab', { name: 'Synthèse' }).click();
    // 1 420 000 with the overdue invoice in the month, 1 020 000 without it (first day of a month).
    const revenue = overdueInMonth ? 1_420_000 : 1_020_000;
    const margin = revenue - 990_000;
    await mainShows(page, new RegExp(`Chiffre d'affaires ${money(revenue)}`));
    const text = await mainText(page);
    for (const expected of [new RegExp(`Dépenses ${money(990_000)}`), new RegExp(`Marge ${money(margin)}`), /Créances clients 475 000 FCFA/, /Activité Général/, /Salaires/, /Transport/]) assert.match(text, expected);
    const summary = await call<{ revenue: number; expenses: number; margin: number; receivables: number }>('/finance/summary');
    assert.deepEqual([summary.revenue, summary.expenses, summary.margin, summary.receivables], [revenue, 990000, margin, 475000]);

    await page.getByRole('tab', { name: 'Rentabilité par lot' }).click();
    const row = page.getByRole('row', { name: new RegExp(lotCode) });
    await row.waitFor();
    // Sold 300 - 30 returned, cost 40 000 (the attributed transport), revenue 1 050 000 - 105 000, margin 905 000.
    assert.match(flat(await row.innerText()), new RegExp(`${lotCode} .* 270 40 000 FCFA 945 000 FCFA .*905 000 FCFA`));
    const lot = await call<{ costs: { autres: number }; totalCost: number; revenue: number; margin: number }>(`/finance/lots/${lotId}`);
    assert.deepEqual([lot.costs.autres, lot.totalCost, lot.revenue, lot.margin], [40000, 40000, 945000, 905000]);

    // The dashboard's `Rentabilité du mois` matches the Synthèse.
    await page.goto(`${WEB_URL}/`);
    await page.getByText('Rentabilité du mois').waitFor();
    const home = await mainText(page);
    for (const expected of [money(revenue), money(990_000), money(margin)]) assert.ok(home.includes(expected), `the dashboard shows ${expected}`);
    await page.context().close();
  });

  it('Directeur : l’alerte Créance de la facture échue figure dans Alertes ; Propriétaire en lecture seule sur Finance', async () => {
    const page = await asRole(emails.director);
    await page.goto(`${WEB_URL}/alertes`);
    await page.getByText(`Créance ${overdueNumber}`).waitFor();
    assert.ok((await mainText(page)).includes(`Créance ${overdueNumber} Marché Hédzranawoé — Mme Afi — 400 000 FCFA`));
    // The paid and the not-yet-due invoices raise nothing.
    assert.equal(await page.getByText(`Créance ${invoiceNumber}`).count(), 0);
    await page.context().close();

    const owner = await asRole(emails.owner);
    await owner.goto(`${WEB_URL}/m/finance`);
    await owner.getByRole('row', { name: /Salaires du mois/ }).waitFor();
    assert.equal(await owner.getByRole('button', { name: 'Ajouter' }).count(), 0, 'the Propriétaire reads finance but does not enter anything');
    await owner.context().close();
  });

  it('Commercial : ni menu Finance ni rentabilité au tableau de bord ; Magasinier : pas de Ventes', async () => {
    const page = await asRole(emails.commercial);
    assert.equal(await page.locator('aside').getByRole('link', { name: 'Finance' }).count(), 0);
    assert.equal(await page.getByText('Rentabilité du mois').count(), 0);
    assert.ok((await page.locator('aside').getByRole('link', { name: 'Ventes' }).count()) > 0);
    await page.goto(`${WEB_URL}/m/finance`);
    await page.getByText('Accès non autorisé').waitFor();
    await page.context().close();

    const keeper = await asRole(emails.storekeeper);
    assert.equal(await keeper.locator('aside').getByRole('link', { name: 'Ventes' }).count(), 0);
    assert.equal(await keeper.locator('aside').getByRole('link', { name: 'Finance' }).count(), 0);
    assert.ok((await keeper.locator('aside').getByRole('link', { name: 'Stocks' }).count()) > 0);
    await keeper.goto(`${WEB_URL}/m/ventes`);
    await keeper.getByText('Accès non autorisé').waitFor();
    // The stock movements written by the sales are labelled for what they are.
    await keeper.goto(`${WEB_URL}/m/stocks`);
    const level = keeper.getByRole('row', { name: /Aliment vendu/ });
    await level.waitFor();
    assert.match(flat(await level.innerText()), /Aliment vendu Aliment 900 kg/);
    await keeper.getByRole('tab', { name: 'Mouvements' }).click();
    const movement = keeper.getByRole('row', { name: /Aliment vendu .*Vente/ });
    await movement.waitFor();
    assert.match(flat(await movement.innerText()), /Aliment vendu Sortie -100 .* Vente/);
    await keeper.context().close();
  });
});
