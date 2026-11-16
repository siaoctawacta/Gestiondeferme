import assert from 'node:assert/strict';
import { appendFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import { LONG_SUITE } from './suites.ts';
import { fileURLToPath } from 'node:url';
import type { Browser, Locator, Page } from 'playwright';
import { api, enrollAdmin, launch, newPage, uiLoginWithBackupCode, WEB_URL, type EnrolledAdmin } from './helpers.ts';
import { PLANNED_VACCINATION_DATE, seedCommerceReferenceData, seedLogisticsReferenceData, seedReferenceData } from './referenceData.ts';

const BUILT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'docs', 'reference', 'built');

// Reference values measured on docs/reference/screens/m_batiments.png (1440x900): the page
// title starts at x=288 (glyphs at x=290, y=123..146), the first stat tile spans
// x=288..558 and y=201..288, i.e. 271x88.
const REF = { titleLeft: 288, tile: { left: 288, width: 271, height: 88 } };
// Measured on the reference captures of the production screens (1440x900): relative to the first tile's top
// (y=201), the table header band starts 181px lower; it is 40px tall (72px when three header lines wrap, as in
// Lots avicoles), a body row is 56px (84px with wrapped cells), a pill is 20px tall and one px rule follows the header.
const REF_SCREENS = {
  m_lots: {
    path: '/m/lots', wait: 'LC-2026-14',
    tiles: ['Total enregistrements', 'En cours', 'Clôturé'],
    headers: ['CODE LOT', 'TYPE', 'SOUCHE', 'BÂTIMENT', "DATE D'ENTRÉE", 'EFFECTIF INITIAL', 'MORTALITÉ CUMULÉE', 'POIDS MOYEN (G)', 'STATUT', 'VIVANTS', 'MORTALITÉ'],
    pills: [['En cours', 'warning'], ['Clôturé', 'success'], ['3.6%', 'warning'], ['2.5%', 'success'], ['6.4%', 'danger']],
    headerHeight: 72, rowHeight: 84,
    row: ['LC-2026-14', 'Chair', 'Cobb 500', 'Poulailler A', '2026-09-20', '5 000', '180', '1 450', 'En cours', '4 820', '3.6%'],
  },
  m_ponte: {
    path: '/m/ponte', wait: 'LP-2026-03',
    tiles: ['Total enregistrements'],
    headers: ['DATE', 'LOT', 'ŒUFS COLLECTÉS', 'ŒUFS CASSÉS', 'MIS EN INCUBATION', 'TAUX DE CASSE'],
    pills: [['1.7%', 'success'], ['3.6%', 'warning']],
    headerHeight: 40, rowHeight: 56,
    row: ['2026-10-20', 'LP-2026-03', '2 455', '88', '0', '3.6%'],
  },
  m_porcs: {
    path: '/m/porcs', wait: 'TR-014',
    tiles: ['Total enregistrements', 'Actif', 'Gestante', 'Allaitante'],
    headers: ['IDENTIFIANT', 'CATÉGORIE', 'RACE', 'BÂTIMENT', 'DATE DE NAISSANCE', 'POIDS (KG)', 'STATUT'],
    pills: [['Actif', 'success'], ['Gestante', 'success'], ['Allaitante', 'success']],
    headerHeight: 40, rowHeight: 56,
    row: ['TR-014', 'Truie', 'Large White', 'Maternité', '2024-02-10', '210', 'Gestante'],
  },
  m_reproduction: {
    path: '/m/reproduction', wait: 'TR-014',
    tiles: ['Total enregistrements', 'Gestation', 'Mise bas', 'Sevrage'],
    headers: ['TRUIE', 'VERRAT / IA', 'DATE SAILLIE', 'NÉS TOTAUX', 'NÉS VIVANTS', 'SEVRÉS', 'STATUT', 'MISE BAS PRÉVUE'],
    pills: [['Gestation', 'warning'], ['Mise bas', 'success'], ['2026-10-27', 'warning'], ['2027-02-01', 'success'], ['2026-09-11', 'success']],
    headerHeight: 40, rowHeight: 56,
    row: ['TR-014', 'VR-002', '2026-07-05', '0', '0', '0', 'Gestation', '2026-10-27'],
  },
  m_alimentation: {
    path: '/m/alimentation', wait: 'Croissance chair',
    tiles: ['Total enregistrements'],
    headers: ['DATE', 'LOT / BÂTIMENT', 'ALIMENT', 'ALIMENT (KG)', 'EAU (L)', 'COÛT'],
    pills: [],
    headerHeight: 40, rowHeight: 56,
    row: ['2026-10-22', 'LC-2026-14', 'Croissance chair', '620', '1 250', '210 800 FCFA'],
  },
  m_stocks: {
    path: '/m/stocks', wait: 'Aliment ponte',
    tiles: ['Total enregistrements'],
    headers: ['ARTICLE', 'CATÉGORIE', 'QUANTITÉ', 'UNITÉ', 'SEUIL MINIMUM', 'NIVEAU', 'JOURS DE STOCK'],
    pills: [['ok', 'success'], ['faible', 'warning'], ['critique', 'danger']],
    headerHeight: 40, rowHeight: 56,
    row: ['Aliment ponte', 'Aliment', '900', 'kg', '1 500', 'faible', '2'],
    more: [
      ['Aliment croissance chair', 'Aliment', '4 200', 'kg', '2 000', 'ok', '6'],
      ['Aliment engraissement porc', 'Aliment', '600', 'kg', '1 500', 'critique', '1'],
      ['Vaccin Gumboro', 'Médicament', '12', 'flacons', '5', 'ok', '—'],
      ['Copeaux litière', 'Consommable', '80', 'sacs', '40', 'ok', '13'],
    ],
  },
  m_fournisseurs: {
    path: '/m/fournisseurs', wait: 'VetoPlus',
    tiles: ['Total enregistrements'],
    headers: ['NOM', 'PRODUITS FOURNIS', 'TÉLÉPHONE', 'EMAIL', 'SOLDE'],
    pills: [],
    headerHeight: 40, rowHeight: 56,
    row: ['VetoPlus', 'Vaccins, médicaments', '+228 91 44 55 66', 'contact@vetoplus.tg', '120 000 FCFA'],
    // Reference: Agro Provende SA owes 850 000. Its two purchases of the reference list are an order and a request, and
    // the balance counts received purchases only: 0 (see `seedLogisticsReferenceData`).
    more: [
      ['Agro Provende SA', 'Aliments volaille & porc', '+228 90 11 22 33', 'ventes@agroprovende.tg', '0 FCFA'],
      ['Couvoir du Golfe', "Poussins d'un jour", '+228 92 77 88 99', 'info@couvoirgolfe.tg', '0 FCFA'],
    ],
  },
  m_achats: {
    path: '/m/achats', wait: 'BC-0142',
    tiles: ['Total enregistrements', 'Demande', 'Validée', 'Commandée'],
    headers: ['DATE', 'RÉFÉRENCE', 'FOURNISSEUR', 'ARTICLE', 'QUANTITÉ', 'STATUT', 'MONTANT'],
    pills: [['Commandée', 'warning'], ['Reçue', 'success'], ['Demande', 'neutral']],
    headerHeight: 40, rowHeight: 56,
    row: ['2026-10-20', 'BC-0142', 'Agro Provende SA', 'Aliment ponte', '3 000', 'Commandée', '930 000 FCFA'],
    more: [
      ['2026-10-15', 'BC-0141', 'VetoPlus', 'Vaccin Gumboro', '10', 'Reçue', '120 000 FCFA'],
      ['2026-10-22', 'DA-0089', 'Agro Provende SA', 'Aliment engraissement porc', '4 000', 'Demande', '1 120 000 FCFA'],
    ],
  },
  m_sante: {
    path: '/m/sante', wait: 'Newcastle',
    tiles: ['Total enregistrements', 'Planifié', 'Réalisé', 'En retard'],
    headers: ['DATE', 'LOT / ANIMAL', 'TYPE', 'PRODUIT', 'DOSE', 'VÉTÉRINAIRE', 'STATUT'],
    pills: [['Planifié', 'warning'], ['Réalisé', 'success'], ['En retard', 'danger']],
    headerHeight: 40, rowHeight: 56,
    row: ['2026-10-18', 'LC-2026-14', 'Vaccination', 'Newcastle', 'Eau de boisson', 'Dr Koffi', 'Réalisé'],
    // The planned vaccination is dated two days ahead, not 2026-10-24 (past: it would read `En retard`).
    more: [
      [PLANNED_VACCINATION_DATE, 'LC-2026-15', 'Vaccination', 'Gumboro', '1 goutte', 'Dr Koffi', 'Planifié'],
      ['2026-10-20', 'TR-021', 'Traitement', 'Fer injectable porcelets', '1 ml', 'Dr Amah', 'Réalisé'],
      ['2026-10-15', 'Porcherie 2', 'Désinfection', 'Virkon S', '1%', 'Équipe', 'En retard'],
    ],
  },
  m_clients: {
    path: '/m/clients', wait: 'Restaurant Le Palmier',
    tiles: ['Total enregistrements'],
    headers: ['NOM', 'TYPE', 'TÉLÉPHONE', 'VILLE'],
    pills: [],
    headerHeight: 40, rowHeight: 56,
    row: ['Restaurant Le Palmier', 'Restaurant', '+228 93 12 34 56', 'Lomé'],
    more: [
      ['Marché Hédzranawoé — Mme Afi', 'Revendeur', '+228 98 65 43 21', 'Lomé'],
      ['SuperMarché Ramco', 'Grossiste', '+228 22 21 00 00', 'Lomé'],
    ],
  },
  // What is still due is yellow, overdue or not (FA-0309 is past its due date and still yellow in the reference).
  m_ventes: {
    path: '/m/ventes', wait: 'FA-0310',
    tiles: ['Total enregistrements'],
    headers: ['DATE', 'N° FACTURE', 'CLIENT', 'PRODUIT', 'QUANTITÉ', 'TOTAL', 'RESTE DÛ'],
    pills: [['0 FCFA', 'success'], ['400 000 FCFA', 'warning']],
    headerHeight: 40, rowHeight: 56,
    row: ['2026-10-21', 'FA-0310', 'Restaurant Le Palmier', 'Poulets de chair', '300', '1 050 000 FCFA', '0 FCFA'],
    more: [
      ['2026-10-20', 'FA-0309', 'Marché Hédzranawoé — Mme Afi', 'Œufs (plateau)', '400', '1 000 000 FCFA', '400 000 FCFA'],
      ['2026-10-12', 'FA-0305', 'SuperMarché Ramco', 'Porcs', '12', '1 620 000 FCFA', '0 FCFA'],
      ['2026-10-05', 'FA-0301', 'Restaurant Le Palmier', 'Porcelets', '10', '300 000 FCFA', '0 FCFA'],
    ],
  },
  // The list opens on the current month: the period is set to October to show the reference rows. Besides the five
  // manual entries it lists what is derived (four invoices, the received purchase BC-0141): `extra` rows.
  m_finance: {
    path: '/m/finance', wait: 'Salaires septembre',
    prepare: async (page: Page) => {
      await page.getByLabel('Du', { exact: true }).fill('2026-10-01');
      await page.getByLabel('Au', { exact: true }).fill('2026-10-31');
    },
    tiles: ['Total enregistrements'],
    headers: ['DATE', 'LIBELLÉ', 'TYPE', 'ACTIVITÉ', 'CATÉGORIE', 'MONTANT'],
    pills: [['950 000 FCFA', 'danger'], ['1 050 000 FCFA', 'success']],
    headerHeight: 40, rowHeight: 56,
    row: ['2026-10-01', 'Salaires septembre', 'Dépense', 'Général', 'Salaires', '950 000 FCFA'],
    more: [
      ['2026-10-03', 'Aliment chair 6 t', 'Dépense', 'Avicole', 'Aliment', '1 020 000 FCFA'],
      ['2026-10-08', 'Électricité CEET', 'Dépense', 'Général', 'Énergie', '185 000 FCFA'],
      ['2026-10-10', 'Vaccins & médicaments', 'Dépense', 'Avicole', 'Santé', '120 000 FCFA'],
      ['2026-10-14', 'Aliment porc 2 t', 'Dépense', 'Porcin', 'Aliment', '560 000 FCFA'],
    ],
    extra: 5,
    headerOffset: 229,
  },
} as const;
// Row edit / delete icons stay on every row, as in the reference. A row that cannot be changed shows them
// disabled (aria-disabled) with the reason as tooltip: [row text, icon, reason].
const DISABLED_ICONS: Record<string, [string, string, string][]> = {
  m_lots: [
    ['LC-2026-12', 'Modifier', 'Lot clôturé'],
    ['LC-2026-12', 'Supprimer', 'Lot clôturé'],
    ['LC-2026-14', 'Supprimer', 'Lot avec historique — clôturez-le'],
  ],
  m_reproduction: [
    ['TR-021', 'Modifier', 'Enregistrement verrouillé'],
    ['TR-021', 'Supprimer', 'Enregistrement verrouillé'],
  ],
  // Only a draft invoice can still be edited or deleted; a derived finance row points at its document.
  m_ventes: [
    ['FA-0310', 'Modifier', 'Enregistrement verrouillé'],
    ['FA-0310', 'Supprimer', 'Enregistrement verrouillé'],
  ],
  m_finance: [
    ['FA-0310', 'Modifier', "Écriture générée par une facture — corrigez le document d'origine"],
    ['FA-0310', 'Supprimer', "Écriture générée par une facture — corrigez le document d'origine"],
  ],
  // Only a request (Demande) can still be edited or deleted.
  m_achats: [
    ['BC-0142', 'Modifier', 'Enregistrement verrouillé'],
    ['BC-0142', 'Supprimer', 'Enregistrement verrouillé'],
    ['BC-0141', 'Modifier', 'Enregistrement verrouillé'],
  ],
};
const TOLERANCE = 2;
const near = (actual: number, expected: number, what: string) =>
  assert.ok(Math.abs(actual - expected) <= TOLERANCE, `${what}: ${actual} is not within ${TOLERANCE}px of ${expected}`);

async function box(locator: Locator) {
  const b = await locator.boundingBox();
  assert.ok(b, 'element has no layout box');
  return b;
}

const SEED_BUILDINGS = [
  { name: 'Poulailler A', type: 'AVICOLE', site: 'Site Nord', capacity: 5000, status: 'ACTIF' },
  { name: 'Poulailler B', type: 'AVICOLE', site: 'Site Nord', capacity: 5000, status: 'ACTIF' },
  { name: 'Pondoir C', type: 'AVICOLE', site: 'Site Nord', capacity: 3000, status: 'ACTIF' },
  { name: 'Porcherie 1', type: 'PORCIN', site: 'Site Sud', capacity: 300, status: 'ACTIF' },
  { name: 'Porcherie 2', type: 'PORCIN', site: 'Site Sud', capacity: 300, status: 'VIDE_SANITAIRE' },
  { name: 'Maternité', type: 'PORCIN', site: 'Site Sud', capacity: 40, status: 'ACTIF' },
];

const flat = (t: string) => t.replace(/\s+/g, ' ').trim();

/** Header labels, tile labels, one reference row and the measured rects of a production screen. */
async function compareWithReference(page: Page, name: string, ref: (typeof REF_SCREENS)[keyof typeof REF_SCREENS]): Promise<void> {
  // The last header cell is the screen-reader-only « Actions » column.
  const headers = (await page.locator('thead th').allInnerTexts()).map(flat).filter((h) => h && h !== 'ACTIONS');
  assert.deepEqual(headers, [...ref.headers], `${name}: column order and labels`);
  for (const label of ref.tiles) await page.getByText(label, { exact: true, selector: 'p' }).first().waitFor();

  const tile = await box(page.getByText('Total enregistrements', { exact: true, selector: 'p' }).locator('xpath=..'));
  near(tile.width, REF.tile.width, `${name}: tile width`);
  near(tile.height, REF.tile.height, `${name}: tile height`);
  const header = await box(page.locator('thead tr').first());
  // `m_finance` carries a row of filters (period, type, activity, category) the reference does not draw: +48px.
  near(header.y - tile.y, 'headerOffset' in ref ? ref.headerOffset : 181, `${name}: table header offset from the tiles`);
  near(header.height - 1, ref.headerHeight, `${name}: table header height`);
  const firstRow = await box(page.locator('tbody tr').first());
  near(firstRow.y - (header.y + header.height), 0, `${name}: the first row follows the header`);
  near(firstRow.height - 1, ref.rowHeight, `${name}: first row height`);
  // Every pill of the table is 20px tall (Alimentation & eau has none).
  for (const pill of await page.locator('tbody tr span.inline-flex.rounded-full').all()) near((await box(pill)).height, 20, `${name}: pill height`);

  // Pill tones, as on the reference (green / yellow / red): the pill's background is compared with the tone's token.
  for (const [label, tone] of ref.pills) {
    const colors = await page.evaluate(([text, tone]) => {
      const classes = { success: 'bg-primary-soft', warning: 'bg-warning/35', danger: 'bg-destructive/15', neutral: 'bg-muted' } as const;
      const probe = document.createElement('span');
      probe.className = classes[tone as keyof typeof classes];
      document.body.append(probe);
      const expected = getComputedStyle(probe).backgroundColor;
      probe.remove();
      const pill = [...document.querySelectorAll('tbody span.inline-flex.rounded-full')].find((e) => (e.textContent ?? '').replace(/\s+/g, ' ').trim() === text);
      return { expected, actual: pill ? getComputedStyle(pill).backgroundColor : null };
    }, [label, tone]);
    assert.equal(colors.actual, colors.expected, `${name}: pill « ${label} » is ${tone}`);
  }

  // Every row keeps its edit and delete icons (none is hidden); the rows that cannot be changed show them disabled, with the reason.
  const bodyRows = await page.locator('tbody tr').count();
  for (const icon of ['Modifier', 'Supprimer']) {
    assert.equal(await page.locator('tbody').getByRole('button', { name: icon }).count(), bodyRows, `${name}: every row has its « ${icon} » icon`);
  }
  for (const [rowText, icon, reason] of DISABLED_ICONS[name] ?? []) {
    const button = page.getByRole('row', { name: new RegExp(rowText) }).getByRole('button', { name: icon });
    assert.equal(await button.getAttribute('aria-disabled'), 'true', `${name}: ${rowText} « ${icon} » is disabled`);
    assert.equal(await button.getAttribute('title'), reason, `${name}: ${rowText} « ${icon} » says why`);
  }

  // The reference row (the API orders rows its own way, so find it by its content).
  const rows = (await page.locator('tbody tr').all());
  const cells = await Promise.all(rows.map(async (r) => (await r.locator('td').allInnerTexts()).map(flat).filter(Boolean)));
  for (const expected of [ref.row, ...('more' in ref ? ref.more : [])]) {
    assert.ok(cells.some((c) => JSON.stringify(c) === JSON.stringify(expected)), `${name}: a row reads ${expected.join(' | ')} (got ${JSON.stringify(cells)})`);
  }
  if ('more' in ref) assert.equal(bodyRows, ref.more.length + 1 + ('extra' in ref ? ref.extra : 0), `${name}: exactly the reference rows${'extra' in ref ? ' and the derived ones' : ''}`);
}

/** Waits until the page's main text (spaces flattened, no-break spaces included) matches. */
const mainShowsText = (page: Page, re: RegExp) =>
  page.waitForFunction(
    ([source, flags]) => new RegExp(source, flags).test(document.querySelector('main')?.innerText.replace(/[\s\u202f\u00a0]+/g, ' ') ?? ''),
    [re.source, re.flags] as const,
  );

async function settle(page: Page): Promise<void> {
  await page.waitForLoadState('networkidle');
  await page.evaluate(() => document.fonts.ready);
}

// Precondition: the server's date is after 2026-10-22, because the reference rows are dated October 2026 (no future
// dates are accepted). The overdue-farrowing alert counts days from today, so it is matched with a regex and
// home.png differs by that one number from day to day.
describe('rendu : captures et comparaison avec la référence', LONG_SUITE, () => {
  let browser: Browser;
  let page: Page;
  let admin: EnrolledAdmin;
  const foreignRequests: string[] = [];

  before(async () => {
    mkdirSync(BUILT, { recursive: true });
    browser = await launch();
    admin = await enrollAdmin('visual');
    // The committed captures are twice the size of the reference (layout measurements stay in CSS pixels).
    const opened = await newPage(browser, undefined, 2);
    page = opened.page;
    // Other specs add farms to the organisation: this one always looks at the seeded farm.
    await opened.context.addInitScript((farm) => localStorage.setItem('ap_farm', farm), admin.farmId);
    page.on('request', (r) => {
      if (!r.url().startsWith(WEB_URL) && !r.url().startsWith('data:') && !r.url().startsWith('blob:')) foreignRequests.push(r.url());
    });
    await uiLoginWithBackupCode(page, admin.email, admin.backupCodes[0]);
    await page.getByRole('heading', { name: 'Tableau de bord' }).waitFor();
  });
  after(async () => {
    await browser.close();
  });

  it('capture le tableau de bord vide (shell.png, home-empty.png)', async () => {
    await settle(page);
    await page.screenshot({ path: join(BUILT, 'shell.png') });
    await page.screenshot({ path: join(BUILT, 'home-empty.png'), fullPage: true });
  });

  it('sème les lignes de référence par l’API, puis capture home.png et les écrans de module (sans simulation)', async () => {
    const sites = new Map<string, string>();
    for (const name of new Set(SEED_BUILDINGS.map((b) => b.site))) {
      // batiments.spec.ts may already have created `Site Nord` in the shared farm.
      const existing = await api<{ items: { id: string; name: string }[] }>('/sites', { token: admin.token, farmId: admin.farmId });
      const found = existing.items.find((s) => s.name === name);
      const id = found?.id ?? (await api<{ id: string }>('/sites', { method: 'POST', token: admin.token, farmId: admin.farmId, body: { name } })).id;
      sites.set(name, id);
    }
    const buildings = new Map<string, string>();
    for (const b of SEED_BUILDINGS) {
      const created = await api<{ id: string }>('/buildings', {
        method: 'POST',
        token: admin.token,
        farmId: admin.farmId,
        body: { name: b.name, type: b.type, siteId: sites.get(b.site), capacity: b.capacity, status: b.status },
      });
      buildings.set(b.name, created.id);
    }
    const production = await seedReferenceData(admin, buildings);
    await seedLogisticsReferenceData(admin, production, buildings);
    await seedCommerceReferenceData(admin, production);

    await page.goto(`${WEB_URL}/`);
    await page.getByRole('heading', { name: 'Tableau de bord' }).waitFor();
    await page.getByText('Mortalité élevée').first().waitFor();
    await settle(page);
    await page.screenshot({ path: join(BUILT, 'home.png'), fullPage: true });

    const text = flat(await page.locator('main').innerText());
    for (const expected of ['11 570', '3 lots en cours', '245', '2 480', 'Taux de ponte 87%', '3.6%', 'Mise bas TR-014', /Dépassée depuis \d+ j \(2026-10-27\)/, 'Mortalité élevée LC-2026-14', 'Mortalité élevée LP-2026-03', '5 bâtiments actifs',
      // Stock and health alerts (slice 3), exact texts: title and detail.
      'Stock critique : Aliment engraissement porc 600 kg (seuil 1500)', 'Stock faible : Aliment ponte 900 kg (seuil 1500)']) {
      assert.ok(typeof expected === 'string' ? text.includes(expected) : expected.test(text), `home shows « ${expected} »`);
    }

    // « Rentabilité du mois » is the calendar month to date (ruling Q26): the reference documents are dated October 2026.
    // Run in October 2026 (after the 22nd) the card shows the reference October figures (the double vaccine entry of the
    // reference data included: BC-0141 + the manual « Vaccins & médicaments », 120 000 each, hence 2 955 000, not 2 835 000);
    // run later, the month holds none of them and the card reads 0. Literal figures, not the API's own summary. A documented
    // difference of home.png.
    assert.ok(flat(await page.locator('main').innerText()).includes('Rentabilité du mois'), 'home shows the profitability card');
    const [revenue, expenses, margin] = new Date().toISOString().startsWith('2026-10') ? ['3 970 000 FCFA', '2 955 000 FCFA', '1 015 000 FCFA'] : ['0 FCFA', '0 FCFA', '0 FCFA'];
    const card = page.getByRole('heading', { name: 'Rentabilité du mois' }).locator('xpath=..');
    for (const [label, expected] of [["Chiffre d'affaires", revenue], ['Dépenses', expenses], ['Marge', margin]]) {
      const figure = card.locator('dt', { hasText: new RegExp(`^${label}$`) }).locator('xpath=following-sibling::dd');
      assert.equal(flat(await figure.innerText()), expected, `home card: ${label}`);
    }
    const homeText = flat(await page.locator('main').innerText());
    assert.ok(homeText.includes('Recettes vs dépenses'), 'home shows the revenue chart');

    // The home shows the five most urgent alerts; the full list (the Alertes page) also has the overdue disinfection
    // and the overdue receivable (FA-0309 fell due on 2026-11-04).
    await page.goto(`${WEB_URL}/alertes`);
    await page.getByText('Désinfection en retard').first().waitFor();
    await page.getByText('Créance FA-0309').waitFor();
    await settle(page);
    const alertsText = flat(await page.locator('main').innerText());
    for (const expected of ['Désinfection en retard Porcherie 2 — Virkon S', 'Stock critique : Aliment engraissement porc 600 kg (seuil 1500)', 'Créance FA-0309 Marché Hédzranawoé — Mme Afi — 400 000 FCFA']) {
      assert.ok(alertsText.includes(expected), `the alerts page shows « ${expected} »`);
    }
    await page.screenshot({ path: join(BUILT, 'alertes.png'), fullPage: true });

    // Rapports: the receivables of the whole period; the money rows follow the month, like the home card.
    await page.goto(`${WEB_URL}/rapports`);
    await page.getByText('Créances clients').waitFor();
    await settle(page);
    const reportText = flat(await page.locator('main').innerText()).replace(/[\u202f\u00a0]/g, ' ');
    for (const expected of ['Créances clients 400 000 FCFA', 'Activité Avicole', 'Activité Porcin', 'Activité Général']) {
      assert.ok(reportText.includes(expected), `the reports page shows « ${expected} »`);
    }
    await page.screenshot({ path: join(BUILT, 'rapports.png'), fullPage: true });

    await page.goto(`${WEB_URL}/m/batiments`);
    await page.getByRole('row', { name: /Poulailler A/ }).waitFor();
    await settle(page);
    await page.screenshot({ path: join(BUILT, 'm_batiments.png') });

    for (const [name, ref] of Object.entries(REF_SCREENS)) {
      await page.goto(`${WEB_URL}${ref.path}`);
      if ('prepare' in ref) await ref.prepare(page);
      await page.getByRole('row', { name: new RegExp(ref.wait) }).first().waitFor();
      await settle(page);
      await page.screenshot({ path: join(BUILT, `${name}.png`) });
      await compareWithReference(page, name, ref);
    }
    assert.equal(await page.title(), 'Dépenses & recettes — AgriPilot');

    // The reference period (October, as captured): the Synthèse reproduces the reference figures. Differences: the received
    // purchase BC-0141 (120 000, activity Général) is an expense next to the manual `Vaccins & médicaments` row of the same
    // amount (the reference has the manual row only), so the Général activity reads -1 255 000, not -1 135 000.
    await page.goto(`${WEB_URL}/m/finance`);
    await page.getByRole('tab', { name: 'Synthèse' }).click();
    await page.getByLabel('Du', { exact: true }).fill('2026-10-01');
    await page.getByLabel('Au', { exact: true }).fill('2026-10-31');
    await page.getByText("Chiffre d'affaires", { exact: true }).waitFor();
    const october = await api<{ revenue: number; expenses: number; margin: number; receivables: number; byActivity: { activity: string; revenue: number; expenses: number; margin: number }[] }>(
      '/finance/summary?from=2026-10-01&to=2026-10-31', { token: admin.token, farmId: admin.farmId });
    assert.equal(october.revenue, 3_970_000, 'October revenue = the reference chiffre d’affaires');
    assert.equal(october.expenses, 2_955_000, 'October expenses = the reference 2 835 000 + the received purchase 120 000');
    assert.equal(october.receivables, 400_000);
    const byActivity = Object.fromEntries(october.byActivity.map((a) => [a.activity, a]));
    assert.deepEqual([byActivity.AVICOLE.revenue, byActivity.AVICOLE.expenses, byActivity.AVICOLE.margin], [2_050_000, 1_140_000, 910_000]);
    assert.deepEqual([byActivity.PORCIN.revenue, byActivity.PORCIN.expenses, byActivity.PORCIN.margin], [1_920_000, 560_000, 1_360_000]);
    assert.deepEqual([byActivity.GENERAL.revenue, byActivity.GENERAL.expenses, byActivity.GENERAL.margin], [0, 1_255_000, -1_255_000]);
    await mainShowsText(page, /Activité Avicole\s*910 000 FCFA/);
    await settle(page);
    await page.screenshot({ path: join(BUILT, 'finance_synthese.png') });
    assert.deepEqual(foreignRequests, [], 'every asset (fonts included) is served locally');
  });

  it('mobile 375x812 : feuille d’inventaire, réception, tuiles d’un achat, cinq onglets de Santé, formulaire d’acte, bon de commande à l’impression', async () => {
    const { context, page: phone } = await newPage(browser, { width: 375, height: 812 });
    // The organisation holds other specs' farms: this one looks at the seeded farm, whichever sorts first.
    await context.addInitScript((farm) => localStorage.setItem('ap_farm', farm), admin.farmId);
    await uiLoginWithBackupCode(phone, admin.email, admin.backupCodes[2]);
    await phone.getByRole('heading', { name: 'Tableau de bord' }).waitFor();
    const report = (what: string, values: unknown) => console.log(`[375px] ${what}: ${JSON.stringify(values)}`);
    const pageWidth = () => phone.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, clientWidth: document.documentElement.clientWidth }));
    const noPageScroll = async (what: string) => {
      const { scrollWidth } = await pageWidth();
      assert.ok(scrollWidth <= 375, `${what}: document scrollWidth ${scrollWidth} > 375`);
      return scrollWidth;
    };
    /** Right edge of the element, in the viewport. */
    const right = async (locator: Locator) => (await box(locator)).x + (await box(locator)).width;

    // 1. The count sheet: five items, four columns. The grid scrolls INSIDE its container, the page does not.
    const inventory = await api<{ id: string }>('/inventories', { method: 'POST', token: admin.token, farmId: admin.farmId, body: { date: new Date().toISOString().slice(0, 10) } });
    await phone.goto(`${WEB_URL}/m/stocks/inv-${inventory.id}`);
    await phone.getByLabel('Compté ligne 1').waitFor();
    await settle(phone);
    const grid = phone.locator('fieldset .overflow-x-auto');
    const gridBox = await grid.evaluate((el) => ({ clientWidth: el.clientWidth, scrollWidth: el.scrollWidth }));
    assert.ok(gridBox.scrollWidth > gridBox.clientWidth, 'the count grid is wider than its container and scrolls inside it');
    report('inventory sheet', { page: await noPageScroll('inventory sheet'), grid: gridBox });
    // The last column (the gap) is reachable by scrolling the grid, not the page.
    await grid.evaluate((el) => { el.scrollLeft = el.scrollWidth; });
    assert.ok((await pageWidth()).scrollWidth <= 375, 'scrolling the grid does not widen the page');
    await phone.screenshot({ path: join(BUILT, 'm_stocks_inventaire_375.png') });

    // 2. A purchase in `Demande` with the long amount: tiles, then the order (BC-0142) with its reception dialog.
    await phone.goto(`${WEB_URL}/m/achats`);
    await phone.getByRole('row', { name: /DA-0089/ }).getByRole('link').first().click();
    await phone.getByRole('heading', { name: 'DA-0089' }).waitFor();
    await settle(phone);
    const tiles = await phone.locator('main .grid > div').evaluateAll((els) =>
      els.map((tile) => {
        const value = tile.querySelector('p:last-child') as HTMLElement;
        const t = tile.getBoundingClientRect();
        const v = value.getBoundingClientRect();
        return { text: value.textContent?.replace(/\s+/g, ' '), tileRight: Math.round(t.right), valueRight: Math.round(v.right), valueScroll: value.scrollWidth, valueClient: value.clientWidth };
      }),
    );
    report('purchase tiles', tiles);
    for (const t of tiles) {
      assert.ok(t.valueScroll <= t.valueClient, `tile « ${t.text} » overflows its box (${t.valueScroll} > ${t.valueClient})`);
      assert.ok(t.valueRight <= t.tileRight, `tile « ${t.text} » sticks out of its tile`);
      assert.ok(t.tileRight <= 375, 'a tile stays inside the viewport');
    }
    assert.ok(tiles.some((t) => /1 120 000 FCFA/.test(t.text ?? '')), 'the long amount is shown whole');
    // Same check on an older screen with amounts: no figure sticks out of its card on the dashboard.
    await phone.goto(`${WEB_URL}/`);
    await phone.getByText('Volailles vivantes', { exact: true }).waitFor();
    await settle(phone);
    const figures = await phone.locator('main .font-display').evaluateAll((els) =>
      els.map((el) => {
        const card = el.closest('[class*="rounded"]') ?? el.parentElement!;
        const e = el.getBoundingClientRect();
        const c = card.getBoundingClientRect();
        return { text: el.textContent?.replace(/\s+/g, ' ').slice(0, 30), scroll: el.scrollWidth, client: el.clientWidth, right: Math.round(e.right), cardRight: Math.round(c.right) };
      }),
    );
    report('dashboard figures', figures);
    for (const f of figures) assert.ok(f.scroll <= f.client && f.right <= f.cardRight && f.cardRight <= 375, `dashboard figure « ${f.text} » stays inside its card`);
    await noPageScroll('dashboard');
    await phone.goto(`${WEB_URL}/m/achats`);
    await phone.getByRole('row', { name: /DA-0089/ }).getByRole('link').first().click();
    await phone.getByRole('heading', { name: 'DA-0089' }).waitFor();
    await noPageScroll('purchase detail');
    await phone.screenshot({ path: join(BUILT, 'achat_detail_375.png') });

    await phone.goto(`${WEB_URL}/m/achats`);
    await phone.getByRole('row', { name: /BC-0142/ }).getByRole('link').first().click();
    await phone.getByRole('heading', { name: 'BC-0142' }).waitFor();
    await phone.getByRole('button', { name: 'Réceptionner' }).click();
    const dialog = phone.getByRole('dialog');
    await dialog.getByLabel('Quantité reçue ligne 1').waitFor();
    const panel = await box(dialog);
    assert.ok(panel.x >= 0 && panel.x + panel.width <= 375 && panel.y >= 0 && panel.y + panel.height <= 812, 'the reception dialog fits the phone');
    const receptionGrid = await dialog.locator('fieldset .overflow-x-auto').evaluate((el) => ({ clientWidth: el.clientWidth, scrollWidth: el.scrollWidth }));
    report('reception dialog', { panel, grid: receptionGrid, page: await noPageScroll('reception dialog') });
    const save = dialog.getByRole('button', { name: 'Enregistrer' });
    await save.scrollIntoViewIfNeeded();
    assert.ok((await right(save)) <= 375, 'the Enregistrer button is inside the phone');
    await phone.screenshot({ path: join(BUILT, 'achat_reception_375.png') });
    await dialog.getByRole('button', { name: 'Annuler' }).click();

    // 3. Print view of the bon de commande: the app chrome is hidden, the sheet shows, its table header is legible.
    await phone.emulateMedia({ media: 'print' });
    const printed = await phone.evaluate(() => {
      // Hidden = takes no space (an element inside a `display: none` ancestor keeps its own `display`).
      const shown = (el: Element | null) => Boolean(el) && (el as Element).getClientRects().length > 0;
      const sheet = document.querySelector('section[aria-label="Bon de commande"]');
      const head = sheet?.querySelector('thead th') as HTMLElement | null;
      // Any CSS colour (oklab here) as RGBA, through a canvas.
      const ctx = document.createElement('canvas').getContext('2d', { willReadFrequently: true })!;
      const rgba = (css: string) => { ctx.clearRect(0, 0, 1, 1); ctx.fillStyle = '#fff'; ctx.fillStyle = css; ctx.fillRect(0, 0, 1, 1); return [...ctx.getImageData(0, 0, 1, 1).data]; };
      const over = ([r, g, b, a]: number[], [br, bgc, bb]: number[]) => [r, g, b].map((c, i) => Math.round((c * a) / 255 + [br, bgc, bb][i] * (1 - a / 255)));
      const luminance = (rgb: number[]) => rgb.map((v) => { const c = v / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; }).reduce((acc, c, i) => acc + c * [0.2126, 0.7152, 0.0722][i], 0);
      // What the paper shows behind the header: white (browsers do not print backgrounds by default).
      const paper = [255, 255, 255];
      const fg = head ? over(rgba(getComputedStyle(head).color), paper) : [0, 0, 0];
      const [hi, lo] = [luminance(fg), luminance(paper)].sort((a, b) => b - a);
      return {
        aside: shown(document.querySelector('aside')),
        topbar: shown(document.querySelector('header')),
        screenLayout: shown(document.querySelector('main .print\\:hidden')),
        sheet: shown(sheet),
        headerCells: sheet ? [...sheet.querySelectorAll('thead th')].map((t) => t.textContent) : [],
        headerColor: fg, contrast: Math.round(((hi + 0.05) / (lo + 0.05)) * 10) / 10,
        headerRule: head ? getComputedStyle(head.closest('thead')!).borderBottomWidth : null,
        sheetText: sheet?.textContent?.replace(/\s+/g, ' ').slice(0, 400),
      };
    });
    report('print view', printed);
    assert.equal(printed.aside, false, 'the sidebar is hidden when printing');
    assert.equal(printed.topbar, false, 'the top bar is hidden when printing');
    assert.equal(printed.screenLayout, false, 'the screen layout (tiles, tabs) is hidden when printing');
    assert.equal(printed.sheet, true, 'the bon de commande is shown when printing');
    assert.deepEqual(printed.headerCells, ['ARTICLE', 'QUANTITÉ', 'PRIX UNITAIRE', 'MONTANT']);
    assert.ok(printed.contrast >= 4.5, `the table header is legible when printing (contrast ${printed.contrast})`);
    await phone.screenshot({ path: join(BUILT, 'bon_de_commande_impression_375.png'), fullPage: true });
    await phone.emulateMedia({ media: 'screen' });

    // 4. Santé: five tabs in one bar that scrolls inside itself, every tab reachable.
    await phone.goto(`${WEB_URL}/m/sante`);
    await phone.getByRole('tab', { name: 'Interventions' }).waitFor();
    const bar = phone.getByRole('tablist');
    const barBox = await bar.evaluate((el) => ({ clientWidth: el.clientWidth, scrollWidth: el.scrollWidth }));
    report('santé tabs', { page: await noPageScroll('santé'), bar: barBox });
    assert.ok(barBox.scrollWidth > barBox.clientWidth, 'the five tabs do not fit: the bar scrolls inside its container');
    assert.ok((await right(bar)) <= 375, 'the tab bar stays inside the phone');
    await phone.getByRole('tab', { name: 'Incidents' }).click();
    await phone.getByRole('tab', { name: 'Incidents', selected: true }).waitFor();
    await noPageScroll('santé, tab Incidents');
    await phone.getByRole('tab', { name: 'Interventions' }).click();

    // 5. The act dialog with its two segmented controls (type, status) and the target kind.
    await phone.getByRole('button', { name: 'Ajouter' }).click();
    const act = phone.getByRole('dialog');
    await act.getByRole('radio', { name: 'Vaccination' }).waitFor();
    const groups = await act.getByRole('radiogroup').evaluateAll((els) =>
      els.map((el) => { const r = el.getBoundingClientRect(); return { label: el.getAttribute('aria-label') ?? el.textContent?.slice(0, 40), right: Math.round(r.right), scroll: el.scrollWidth, client: el.clientWidth }; }),
    );
    report('act dialog', { panel: await box(act), groups, page: await noPageScroll('act dialog') });
    for (const g of groups) assert.ok(g.right <= 375 && g.scroll <= g.client, `segmented control « ${g.label} » fits the phone`);
    const actPanel = await box(act);
    assert.ok(actPanel.x >= 0 && actPanel.y >= 0 && actPanel.x + actPanel.width <= 375 && actPanel.y + actPanel.height <= 812, 'the act dialog fits the phone');
    await phone.screenshot({ path: join(BUILT, 'sante_acte_375.png') });
    await context.close();
  });

  it('tuiles : un montant long (1 120 000 FCFA, 12 345 678 FCFA) ne sort jamais de sa tuile ni ne se coupe, de 360 à 1440 px', async () => {
    // A request with an eight-digit amount, next to the reference one (DA-0089, 1 120 000 FCFA). 100 x 123 456.78.
    const suppliers = await api<{ items: { id: string; name: string }[] }>('/suppliers?pageSize=200', { token: admin.token, farmId: admin.farmId });
    const items = await api<{ items: { id: string; name: string }[] }>('/stock-items?pageSize=200', { token: admin.token, farmId: admin.farmId });
    const big = await api<{ id: string; reference: string }>('/purchases', {
      method: 'POST', token: admin.token, farmId: admin.farmId,
      body: {
        supplierId: suppliers.items.find((x) => x.name === 'Agro Provende SA')!.id, date: new Date().toISOString().slice(0, 10),
        lines: [{ itemId: items.items.find((x) => x.name === 'Aliment ponte')!.id, quantity: 100, unitPrice: 123456.78 }],
      },
    });
    const { context, page: wide } = await newPage(browser);
    await context.addInitScript((farm) => localStorage.setItem('ap_farm', farm), admin.farmId);
    try {
      await uiLoginWithBackupCode(wide, admin.email, admin.backupCodes[3]);
      await wide.getByRole('heading', { name: 'Tableau de bord' }).waitFor();
      await wide.goto(`${WEB_URL}/m/achats`);
      await wide.getByRole('row', { name: /DA-0089/ }).getByRole('link').first().click();
      await wide.getByRole('heading', { name: 'DA-0089' }).waitFor();
      const reference = wide.url();
      const table: string[] = [];
      for (const [label, url] of [['1 120 000', reference], ['12 345 678', reference.replace(/[^/]+$/, big.id)]] as const) {
        for (const width of [360, 375, 640, 1024, 1280, 1440]) {
          await wide.setViewportSize({ width, height: 900 });
          await wide.goto(url);
          await wide.getByText('Montant', { exact: true }).waitFor();
          await settle(wide);
          const tiles = await wide.locator('main .grid > div').evaluateAll((els) =>
            els.map((tile) => {
              const value = tile.querySelector('p:last-child') as HTMLElement;
              const t = tile.getBoundingClientRect();
              const css = getComputedStyle(tile);
              const range = document.createRange();
              range.selectNodeContents(value);
              const text = range.getBoundingClientRect();
              return {
                text: value.textContent!.replace(/\s+/g, ' '), fontSize: getComputedStyle(value).fontSize, tileWidth: Math.round(t.width),
                // The figure's right edge against the tile's content box (its right padding included).
                slack: Math.round((t.right - parseFloat(css.paddingRight) - text.right) * 10) / 10,
                lines: Math.round(value.getBoundingClientRect().height / parseFloat(getComputedStyle(value).lineHeight)),
                scroll: value.scrollWidth - value.clientWidth,
                // Only the unit may drop to a second line: the number (the text up to the last plain space) stays on one.
                brokenNumber: (() => {
                  const node = value.firstChild!;
                  const whole = node.textContent!;
                  const cut = whole.lastIndexOf(' ');
                  const numberRange = document.createRange();
                  numberRange.setStart(node, 0);
                  numberRange.setEnd(node, cut > 0 ? cut : whole.length);
                  return new Set([...numberRange.getClientRects()].map((r) => Math.round(r.top))).size > 1;
                })(),
                right: Math.round(t.right),
              };
            }),
          );
          const figure = tiles.find((t) => /\d{3}/.test(t.text) && /FCFA/.test(t.text))!;
          table.push(`${label} @${width}: ${figure.fontSize}, tile ${figure.tileWidth}px, slack ${figure.slack}px, ${figure.lines} line(s)`);
          for (const t of tiles) {
            assert.ok(t.slack >= 0, `${label} @${width}: « ${t.text} » sticks out of its tile by ${-t.slack}px`);
            assert.ok(t.scroll <= 0, `${label} @${width}: « ${t.text} » is cut (${t.scroll}px of overflow)`);
            assert.equal(t.brokenNumber, false, `${label} @${width}: « ${t.text} » is broken inside its digits`);
            assert.ok(t.right <= width, `${label} @${width}: a tile leaves the viewport`);
          }
          const doc = await wide.evaluate(() => document.documentElement.scrollWidth);
          assert.ok(doc <= width, `${label} @${width}: the page scrolls sideways (${doc})`);
          // From 1440 the figure is the reference's text-3xl (30px).
          if (width === 1440) assert.equal(figure.fontSize, '30px', `${label} @1440: the reference size`);
        }
      }
      console.log(`[tiles]\n${table.join('\n')}`);
    } finally {
      await api(`/purchases/${big.id}`, { method: 'DELETE', token: admin.token, farmId: admin.farmId });
      await context.close();
    }
  });

  it('formulaires larges : la réception (5 colonnes) et le plan vaccinal (4 colonnes) tiennent à 1440 sans défilement latéral, la grille défile dans son cadre à 375', async () => {
    const { context, page: wide } = await newPage(browser, undefined, 2);
    await context.addInitScript((farm) => localStorage.setItem('ap_farm', farm), admin.farmId);
    try {
      await uiLoginWithBackupCode(wide, admin.email, admin.backupCodes[4]);
      await wide.getByRole('heading', { name: 'Tableau de bord' }).waitFor();
      const open = async (what: 'reception' | 'plan') => {
        if (what === 'reception') {
          await wide.goto(`${WEB_URL}/m/achats`);
          await wide.getByRole('row', { name: /BC-0142/ }).getByRole('link').first().click();
          await wide.getByRole('heading', { name: 'BC-0142' }).waitFor();
          await wide.getByRole('button', { name: 'Réceptionner' }).click();
        } else {
          await wide.goto(`${WEB_URL}/m/sante`);
          await wide.getByRole('tab', { name: 'Plans vaccinaux' }).click();
          await wide.getByRole('button', { name: 'Ajouter' }).click();
        }
        const dialog = wide.getByRole('dialog');
        await dialog.locator('fieldset .overflow-x-auto').waitFor();
        await settle(wide);
        return dialog;
      };
      const columns = {
        reception: ['Quantité reçue ligne 1', 'N° de lot ligne 1', 'Péremption ligne 1'],
        plan: ['Âge (jours) ligne 1', 'Produit ligne 1', 'Produit en stock ligne 1', 'Dose ligne 1'],
      } as const;
      for (const what of ['reception', 'plan'] as const) {
        for (const width of [1440, 375]) {
          await wide.setViewportSize({ width, height: 900 });
          const dialog = await open(what);
          const grid = await dialog.locator('fieldset .overflow-x-auto').evaluate((el) => ({ client: el.clientWidth, scroll: el.scrollWidth, right: el.getBoundingClientRect().right }));
          const panel = await box(dialog);
          const lastColumn = await box(dialog.getByLabel(columns[what][columns[what].length - 1], { exact: true }));
          const doc = await wide.evaluate(() => document.documentElement.scrollWidth);
          console.log(`[${what} @${width}] panel ${Math.round(panel.width)}px, grid ${grid.client}px client / ${grid.scroll}px scroll, last column right ${Math.round(lastColumn.x + lastColumn.width)}px (grid right ${Math.round(grid.right)}), page ${doc}px`);
          assert.ok(doc <= width, `${what} @${width}: the page scrolls sideways (${doc})`);
          assert.ok(panel.x >= 0 && panel.x + panel.width <= width, `${what} @${width}: the dialog fits the viewport`);
          if (width === 1440) {
            await wide.screenshot({ path: join(BUILT, what === 'reception' ? 'achat_reception_1440.png' : 'sante_plan_1440.png') });
            assert.equal(Math.round(panel.width), 768, `${what}: the wide dialog (max-w-3xl)`);
            assert.ok(grid.scroll <= grid.client, `${what} @1440: the grid does not scroll sideways (${grid.scroll} > ${grid.client})`);
            assert.ok(lastColumn.x + lastColumn.width <= grid.right, `${what} @1440: every column is visible`);
          } else {
            assert.ok(grid.scroll > grid.client, `${what} @375: the grid scrolls inside its frame`);
          }
          await wide.keyboard.press('Escape');
        }
      }
    } finally {
      await context.close();
    }
  });

  it('barre latérale : 256 px, lignes de 48 px (principales) et 44 px (groupes)', async () => {
    await page.goto(`${WEB_URL}/`);
    await page.getByRole('heading', { name: 'Tableau de bord' }).waitFor();
    assert.equal((await box(page.locator('aside'))).width, 256);

    const links = page.getByRole('navigation', { name: 'Navigation principale' }).getByRole('link');
    const tops = (await links.evaluateAll((els) => els.map((e) => e.getBoundingClientRect().top)));
    assert.ok(tops.length >= 8, 'enough nav rows');
    // Rows 0-2 (Tableau de bord, Alertes, Rapports) are ungrouped: 44 px + 4 px gap.
    assert.equal(tops[1] - tops[0], 48);
    assert.equal(tops[2] - tops[1], 48);
    // Rows 3-6 are the Administration group: 44 px apart.
    for (const i of [4, 5, 6]) assert.equal(tops[i] - tops[i - 1], 44, `row ${i}`);
    const heights = await links.evaluateAll((els) => els.map((e) => e.getBoundingClientRect().height));
    assert.ok(heights.every((h) => h === 44), 'every nav row is 44 px tall');
  });

  it('typographies : Manrope pour le corps, Plus Jakarta Sans pour les titres, polices chargées en local', async () => {
    const family = (sel: string) => page.locator(sel).first().evaluate((el) => getComputedStyle(el).fontFamily);
    assert.match(await family('body'), /^"?Manrope"?/);
    assert.match(await family('h1'), /^"?Plus Jakarta Sans"?/);
    const loaded = await page.evaluate(() => [...document.fonts].filter((f) => f.status === 'loaded').map((f) => f.family.replace(/"/g, '')));
    assert.ok(loaded.includes('Manrope'), `Manrope loaded (got ${loaded})`);
    assert.ok(loaded.includes('Plus Jakarta Sans'), `Plus Jakarta Sans loaded (got ${loaded})`);
  });

  it('page module : titre et première tuile aux dimensions de la référence ; bouton primaire = jeton --primary', async () => {
    await page.goto(`${WEB_URL}/m/batiments`);
    await page.getByRole('row', { name: /Poulailler A/ }).waitFor();
    await settle(page);

    const title = await box(page.getByRole('heading', { name: 'Bâtiments', level: 1 }));
    near(title.x, REF.titleLeft, 'title left');

    const tile = await box(page.getByText('Total enregistrements').locator('xpath=..'));
    near(tile.x, REF.tile.left, 'first tile left');
    near(tile.width, REF.tile.width, 'first tile width');
    near(tile.height, REF.tile.height, 'first tile height');

    const { button, token } = await page.evaluate(() => {
      const add = [...document.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Ajouter')!;
      const probe = document.createElement('div');
      probe.style.background = 'var(--primary)';
      document.body.append(probe);
      const token = getComputedStyle(probe).backgroundColor;
      probe.remove();
      return { button: getComputedStyle(add).backgroundColor, token };
    });
    assert.equal(button, token);
    assert.notEqual(token, 'rgba(0, 0, 0, 0)');
  });

  it('mobile 390x844 : pas de défilement horizontal, le tiroir s’ouvre et se ferme', async () => {
    const { context, page: mobile } = await newPage(browser, { width: 390, height: 844 });
    await uiLoginWithBackupCode(mobile, admin.email, admin.backupCodes[1]);
    await mobile.getByRole('heading', { name: 'Tableau de bord' }).waitFor();

    for (const path of ['/', '/m/batiments', '/admin/utilisateurs']) {
      await mobile.goto(`${WEB_URL}${path}`);
      await mobile.getByRole('heading', { level: 1 }).waitFor();
      await settle(mobile);
      const { scrollWidth, clientWidth } = await mobile.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
      }));
      assert.ok(scrollWidth <= clientWidth, `${path}: scrollWidth ${scrollWidth} > clientWidth ${clientWidth}`);
    }

    assert.equal(await mobile.getByRole('dialog', { name: 'Menu' }).count(), 0);
    await mobile.getByRole('button', { name: 'Ouvrir le menu' }).click();
    const drawer = mobile.getByRole('dialog', { name: 'Menu' });
    await drawer.getByRole('link', { name: 'Bâtiments' }).waitFor();
    // Tap the dimmed backdrop to the right of the 256 px drawer.
    await mobile.mouse.click(370, 400);
    await drawer.waitFor({ state: 'detached' });

    await mobile.getByRole('button', { name: 'Ouvrir le menu' }).click();
    await drawer.getByRole('link', { name: 'Alertes' }).click();
    await drawer.waitFor({ state: 'detached' });

    // A long form never overflows the phone: the dialog body scrolls and the submit button stays reachable.
    await mobile.goto(`${WEB_URL}/m/lots`);
    await mobile.getByRole('button', { name: 'Ajouter' }).click();
    const dialog = mobile.getByRole('dialog');
    const save = dialog.getByRole('button', { name: 'Enregistrer' });
    await save.waitFor();
    const inViewport = () => save.evaluate((el) => {
      const r = el.getBoundingClientRect();
      return r.top >= 0 && r.bottom <= window.innerHeight && r.left >= 0 && r.right <= window.innerWidth;
    });
    assert.ok(await inViewport(), 'the Enregistrer button is inside the 390x844 viewport');
    const panel = await box(dialog);
    assert.ok(panel.y >= 0 && panel.y + panel.height <= 844, 'the dialog panel fits the viewport');
    // A shorter phone (the form is taller than the screen): the body scrolls, the button stays in view.
    await mobile.setViewportSize({ width: 390, height: 520 });
    assert.ok(await inViewport(), 'the Enregistrer button is inside a 390x520 viewport');
    const short = await box(dialog);
    assert.ok(short.y >= 0 && short.y + short.height <= 520, 'the dialog panel fits a 390x520 viewport');
    await dialog.getByLabel('Code (généré si vide)').scrollIntoViewIfNeeded();
    assert.ok(await inViewport(), 'the Enregistrer button stays in view while the body scrolls');
    await context.close();
  });
  it('mobile 375x812 : formulaire de facture à 7 colonnes, détail de facture, avoir, finance (écritures, synthèse) et vues imprimables', async () => {
    const { context, page: phone } = await newPage(browser, { width: 375, height: 812 }, 2);
    await context.addInitScript((farm) => localStorage.setItem('ap_farm', farm), admin.farmId);
    // Headless Chromium prints nothing: the sheets are inspected under `print` media instead.
    await context.addInitScript(() => { window.print = () => undefined; });
    await uiLoginWithBackupCode(phone, admin.email, admin.backupCodes[5]);
    await phone.getByRole('heading', { name: 'Tableau de bord' }).waitFor();
    const report = (what: string, values: unknown) => {
      // Also written to a file: the runner's reporter does not forward a test's console output.
      const line = `[375px] ${what}: ${JSON.stringify(values)}`;
      console.log(line);
      if (process.env.E2E_MEASURES) appendFileSync(process.env.E2E_MEASURES, `${line}\n`);
    };
    const pageWidth = () => phone.evaluate(() => document.documentElement.scrollWidth);
    const noPageScroll = async (what: string) => {
      const w = await pageWidth();
      assert.ok(w <= 375, `${what}: document scrollWidth ${w} > 375`);
      return w;
    };
    const call = <T = { id: string }>(path: string, method = 'GET', body?: unknown) => api<T>(path, { method, token: admin.token, farmId: admin.farmId, body });
    const customers = await call<{ items: { id: string; name: string }[] }>('/customers?pageSize=200');
    const afi = customers.items.find((c) => c.name.startsWith('Marché Hédzranawoé'))!.id;
    const invoices = await call<{ items: { id: string; number: string }[] }>('/sales?pageSize=50');
    const fa309 = invoices.items.find((i) => i.number === 'FA-0309')!.id;

    // 1. The invoice form: seven columns, wide dialog, the grid scrolls inside it, the page does not.
    await phone.goto(`${WEB_URL}/m/ventes`);
    await phone.getByRole('button', { name: 'Ajouter' }).click();
    let dialog = phone.getByRole('dialog');
    await dialog.getByLabel('Type ligne 1').waitFor();
    await settle(phone);
    const grid = dialog.locator('fieldset .overflow-x-auto');
    const gridBox = await grid.evaluate((el) => ({ clientWidth: el.clientWidth, scrollWidth: el.scrollWidth }));
    assert.ok(gridBox.scrollWidth > gridBox.clientWidth, 'the 7-column line grid is wider than its container and scrolls inside it');
    let panel = await box(dialog);
    assert.ok(panel.x >= 0 && panel.x + panel.width <= 375 && panel.y >= 0 && panel.y + panel.height <= 812, 'the invoice dialog fits the phone');
    await grid.evaluate((el) => { el.scrollLeft = el.scrollWidth; });
    report('invoice form', { panel, grid: gridBox, page: await noPageScroll('invoice form') });
    const save = dialog.getByRole('button', { name: 'Enregistrer' });
    await save.scrollIntoViewIfNeeded();
    assert.ok((await box(save)).x + (await box(save)).width <= 375, 'Enregistrer is inside the phone');
    await phone.screenshot({ path: join(BUILT, 'facture_formulaire_375.png') });
    await dialog.getByRole('button', { name: 'Annuler' }).click();

    // 2. The detail of FA-0309 (Partielle): header with every action and print button, tiles, tabs.
    await phone.goto(`${WEB_URL}/m/ventes/${fa309}`);
    await phone.getByRole('heading', { name: 'FA-0309' }).waitFor();
    await settle(phone);
    const buttons = await phone.locator('main button:not([role=tab])').evaluateAll((els) => els.map((el) => ({ text: el.textContent?.trim(), right: Math.round(el.getBoundingClientRect().right), left: Math.round(el.getBoundingClientRect().left) })));
    report('invoice detail header', { buttons: buttons.filter((b) => b.text), page: await noPageScroll('invoice detail') });
    for (const b of buttons.filter((x) => x.text)) assert.ok(b.right <= 375 && b.left >= 0, `the « ${b.text} » button stays inside the phone`);
    const tiles = await phone.locator('main .grid > div').evaluateAll((els) => els.map((tile) => {
      const value = tile.querySelector('p:last-child') as HTMLElement;
      return { text: value.textContent?.replace(/\s+/g, ' '), overflow: value.scrollWidth - value.clientWidth, right: Math.round(tile.getBoundingClientRect().right) };
    }));
    report('invoice tiles', tiles);
    for (const t of tiles) assert.ok(t.overflow <= 0 && t.right <= 375, `tile « ${t.text} » fits`);
    await phone.screenshot({ path: join(BUILT, 'vente_detail_375.png') });

    // 3. The credit-note dialog (loaded with the invoice's lines).
    await phone.getByRole('button', { name: 'Avoir' }).click();
    dialog = phone.getByRole('dialog');
    await dialog.getByLabel(/^Quantité à créditer/).waitFor();
    panel = await box(dialog);
    assert.ok(panel.x >= 0 && panel.x + panel.width <= 375 && panel.y >= 0 && panel.y + panel.height <= 812, 'the credit-note dialog fits the phone');
    const creditGrid = await dialog.locator('fieldset .overflow-x-auto').evaluate((el) => ({ clientWidth: el.clientWidth, scrollWidth: el.scrollWidth }));
    report('credit-note dialog', { panel, grid: creditGrid, page: await noPageScroll('credit-note dialog') });
    await phone.screenshot({ path: join(BUILT, 'avoir_dialogue_375.png') });
    // The credit note itself (1 plateau, no return) is made through the API: a document for the print view below.
    await dialog.getByRole('button', { name: 'Annuler' }).click();
    const invoice = await call<{ lines: { id: string }[] }>(`/sales/${fa309}`);
    await call(`/sales/${fa309}/credit-notes`, 'POST', { date: new Date().toISOString().slice(0, 10), reason: 'Plateau cassé', withReturn: false, lines: [{ lineId: invoice.lines[0].id, quantity: 1 }] });
    const quote = await call<{ id: string }>('/quotes', 'POST', { customerId: afi, date: new Date().toISOString().slice(0, 10), lines: [{ kind: 'SERVICE', designation: 'Livraison', quantity: 1, unitPrice: 15000 }] });

    // 4. Finance: the entries table scrolls inside its card, the Synthèse cards stack.
    await phone.goto(`${WEB_URL}/m/finance`);
    await phone.getByLabel('Du', { exact: true }).fill('2026-10-01');
    await phone.getByLabel('Au', { exact: true }).fill('2026-10-31');
    await phone.getByRole('row', { name: /Salaires septembre/ }).waitFor();
    await settle(phone);
    const table = await phone.locator('main table').first().evaluate((el) => {
      const wrap = el.closest('.overflow-x-auto') as HTMLElement | null;
      return { table: el.scrollWidth, wrap: wrap ? wrap.clientWidth : null, scrolls: wrap ? wrap.scrollWidth > wrap.clientWidth : false };
    });
    report('finance entries table', { table, page: await noPageScroll('finance entries') });
    await phone.screenshot({ path: join(BUILT, 'finance_ecritures_375.png') });
    await phone.getByRole('tab', { name: 'Synthèse' }).click();
    await phone.getByText("Chiffre d'affaires", { exact: true }).waitFor();
    await settle(phone);
    const cards = await phone.locator('main .grid > div').evaluateAll((els) => els.map((c) => {
      const r = c.getBoundingClientRect();
      return { text: c.textContent?.replace(/\s+/g, ' ').slice(0, 40), right: Math.round(r.right), overflow: c.scrollWidth - c.clientWidth };
    }));
    report('synthèse cards', { cards, page: await noPageScroll('synthèse') });
    for (const c of cards) assert.ok(c.right <= 375 && c.overflow <= 0, `card « ${c.text} » fits the phone`);
    await phone.screenshot({ path: join(BUILT, 'finance_synthese_375.png') });
    await phone.goto(`${WEB_URL}/m/finance`);
    await phone.getByRole('tab', { name: 'Rentabilité par lot' }).click();
    await phone.getByRole('row').nth(1).waitFor();
    await noPageScroll('rentabilité par lot');

    // 5. Print views: the app chrome is hidden, the sheet shows (invoice, delivery note, receipt, quote, credit note).
    const printState = (label: string) => phone.evaluate((name) => {
      const shown = (el: Element | null) => Boolean(el) && (el as Element).getClientRects().length > 0;
      const sheet = document.querySelector(`section[aria-label="${name}"]`);
      return {
        aside: shown(document.querySelector('aside')), topbar: shown(document.querySelector('header')), sheet: shown(sheet),
        text: sheet?.textContent?.replace(/\s+/g, ' ').slice(0, 200) ?? null, width: sheet ? Math.round(sheet.getBoundingClientRect().width) : null,
      };
    }, label);
    const expectPrinted = async (what: string, label: string, pattern: RegExp) => {
      await phone.emulateMedia({ media: 'print' });
      const state = await printState(label);
      report(`print ${what}`, state);
      assert.equal(state.aside, false, `${what}: the sidebar is hidden when printing`);
      assert.equal(state.topbar, false, `${what}: the top bar is hidden when printing`);
      assert.equal(state.sheet, true, `${what}: the sheet is shown when printing`);
      assert.match(state.text ?? '', pattern, `${what}: the sheet's content`);
      await phone.screenshot({ path: join(BUILT, `${what.replace(/ /g, '_')}_375.png`), fullPage: true });
      await phone.emulateMedia({ media: 'screen' });
    };
    await phone.goto(`${WEB_URL}/m/ventes/${fa309}`);
    await phone.getByRole('heading', { name: 'FA-0309' }).waitFor();
    await phone.getByRole('button', { name: 'Imprimer la facture' }).click();
    await expectPrinted('facture_impression', 'Facture', /FA-0309/);
    await phone.getByRole('button', { name: 'Bon de livraison' }).click();
    await expectPrinted('bon_de_livraison_impression', 'Bon de livraison', /Œufs/);
    await phone.getByRole('tab', { name: 'Paiements' }).click();
    await phone.getByRole('button', { name: 'Reçu' }).first().click();
    await expectPrinted('recu_impression', 'Reçu', /RC-/);
    await phone.getByRole('tab', { name: 'Avoirs' }).click();
    await phone.getByRole('tabpanel').getByRole('button', { name: 'Imprimer' }).first().click();
    await phone.getByRole('dialog').getByText(/est prêt à imprimer/).waitFor();
    await expectPrinted('avoir_impression', 'Avoir', /AV-/);
    await phone.goto(`${WEB_URL}/m/ventes/devis/${quote.id}`);
    await phone.getByRole('button', { name: 'Imprimer' }).click();
    await expectPrinted('devis_impression', 'Devis', /DV-/);
    await context.close();
  });
});
