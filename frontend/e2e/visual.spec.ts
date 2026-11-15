import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import type { Browser, Locator, Page } from 'playwright';
import { api, enrollAdmin, launch, newPage, uiLoginWithBackupCode, WEB_URL, type EnrolledAdmin } from './helpers.ts';
import { PLANNED_VACCINATION_DATE, seedLogisticsReferenceData, seedReferenceData } from './referenceData.ts';

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
  near(header.y - tile.y, 181, `${name}: table header offset from the tiles`);
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
      const pill = [...document.querySelectorAll('tbody span.inline-flex.rounded-full')].find((e) => e.textContent?.trim() === text);
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
  if ('more' in ref) assert.equal(bodyRows, ref.more.length + 1, `${name}: exactly the reference rows`);
}

async function settle(page: Page): Promise<void> {
  await page.waitForLoadState('networkidle');
  await page.evaluate(() => document.fonts.ready);
}

// Precondition: the server's date is after 2026-10-22, because the reference rows are dated October 2026 (no future
// dates are accepted). The overdue-farrowing alert counts days from today, so it is matched with a regex and
// home.png differs by that one number from day to day.
describe('rendu : captures et comparaison avec la référence', () => {
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

    await page.goto(`${WEB_URL}/`);
    await page.getByRole('heading', { name: 'Tableau de bord' }).waitFor();
    await page.getByText('Mortalité élevée').first().waitFor();
    await settle(page);
    await page.screenshot({ path: join(BUILT, 'home.png'), fullPage: true });

    const text = flat(await page.locator('main').innerText());
    for (const expected of ['11 570', '3 lots en cours', '245', '2 480', 'Taux de ponte 87%', '3.6%', 'Mise bas TR-014', /Dépassée depuis \d+ j \(2026-10-27\)/, 'Mortalité élevée LC-2026-14', 'Mortalité élevée LP-2026-03', '5 bâtiments actifs']) {
      assert.ok(typeof expected === 'string' ? text.includes(expected) : expected.test(text), `home shows « ${expected} »`);
    }

    await page.goto(`${WEB_URL}/m/batiments`);
    await page.getByRole('row', { name: /Poulailler A/ }).waitFor();
    await settle(page);
    await page.screenshot({ path: join(BUILT, 'm_batiments.png') });

    for (const [name, ref] of Object.entries(REF_SCREENS)) {
      await page.goto(`${WEB_URL}${ref.path}`);
      await page.getByRole('row', { name: new RegExp(ref.wait) }).first().waitFor();
      await settle(page);
      await page.screenshot({ path: join(BUILT, `${name}.png`) });
      await compareWithReference(page, name, ref);
    }
    assert.equal(await page.title(), 'Santé & biosécurité — AgriPilot');
    assert.deepEqual(foreignRequests, [], 'every asset (fonts included) is served locally');
  });

  it('mobile 375x812 : feuille d’inventaire, réception, tuiles d’un achat, cinq onglets de Santé, formulaire d’acte, bon de commande à l’impression', async () => {
    const { context, page: phone } = await newPage(browser, { width: 375, height: 812 });
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
    await phone.pdf({ path: join(BUILT, 'bon_de_commande.pdf'), format: 'A4' });
    await phone.emulateMedia({ media: 'screen' });

    // 4. Santé: five tabs in one bar that scrolls inside itself, every tab reachable.
    await phone.goto(`${WEB_URL}/m/sante`);
    await phone.getByRole('tab', { name: 'Interventions' }).waitFor();
    const bar = phone.getByRole('tablist');
    const barBox = await bar.evaluate((el) => ({ clientWidth: el.clientWidth, scrollWidth: el.scrollWidth }));
    report('santé tabs', { page: await noPageScroll('santé'), bar: barBox });
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
    assert.ok(actPanel.x >= 0 && actPanel.x + actPanel.height >= 0 && actPanel.x + actPanel.width <= 375 && actPanel.y + actPanel.height <= 812, 'the act dialog fits the phone');
    await phone.screenshot({ path: join(BUILT, 'sante_acte_375.png') });
    await context.close();
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
});
