import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import type { Browser, Locator, Page } from 'playwright';
import { api, enrollAdmin, launch, newPage, uiLoginWithBackupCode, WEB_URL, type EnrolledAdmin } from './helpers.ts';
import { seedReferenceData } from './referenceData.ts';

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
} as const;
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
      const classes = { success: 'bg-primary-soft', warning: 'bg-warning/35', danger: 'bg-destructive/15' } as const;
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

  // The reference row (the API orders rows its own way, so find it by its content).
  const rows = (await page.locator('tbody tr').all());
  const cells = await Promise.all(rows.map(async (r) => (await r.locator('td').allInnerTexts()).map(flat).filter(Boolean)));
  assert.ok(cells.some((c) => JSON.stringify(c) === JSON.stringify(ref.row)), `${name}: a row reads ${ref.row.join(' | ')} (got ${JSON.stringify(cells)})`);
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
    const opened = await newPage(browser);
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
    await seedReferenceData(admin, buildings);

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
    assert.equal(await page.title(), 'Alimentation & eau — AgriPilot');
    assert.deepEqual(foreignRequests, [], 'every asset (fonts included) is served locally');
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
    await context.close();
  });
});
