import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import type { Browser, Locator, Page } from 'playwright';
import { api, enrollAdmin, launch, newPage, uiLoginWithBackupCode, WEB_URL, type EnrolledAdmin } from './helpers.ts';

const BUILT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'docs', 'reference', 'built');

// Reference values measured on docs/reference/screens/m_batiments.png (1440x900): the page
// title starts at x=288 (glyphs at x=290, y=123..146), the first stat tile spans
// x=288..558 and y=201..288, i.e. 271x88.
const REF = { titleLeft: 288, tile: { left: 288, width: 271, height: 88 } };
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

async function settle(page: Page): Promise<void> {
  await page.waitForLoadState('networkidle');
  await page.evaluate(() => document.fonts.ready);
}

describe('rendu : captures et comparaison avec la référence', () => {
  let browser: Browser;
  let page: Page;
  let admin: EnrolledAdmin;
  const foreignRequests: string[] = [];

  before(async () => {
    mkdirSync(BUILT, { recursive: true });
    browser = await launch();
    admin = await enrollAdmin('visual');
    ({ page } = await newPage(browser));
    page.on('request', (r) => {
      if (!r.url().startsWith(WEB_URL) && !r.url().startsWith('data:') && !r.url().startsWith('blob:')) foreignRequests.push(r.url());
    });
    await uiLoginWithBackupCode(page, admin.email, admin.backupCodes[0]);
    await page.getByRole('heading', { name: 'Tableau de bord' }).waitFor();
  });
  after(async () => {
    await browser.close();
  });

  it('capture le tableau de bord vide (shell.png, home-empty.png) puis, avec des données, home.png et m_batiments.png', async () => {
    await settle(page);
    await page.screenshot({ path: join(BUILT, 'shell.png') });
    await page.screenshot({ path: join(BUILT, 'home-empty.png'), fullPage: true });

    const sites = new Map<string, string>();
    for (const name of new Set(SEED_BUILDINGS.map((b) => b.site))) {
      // batiments.spec.ts may already have created `Site Nord` in the shared farm.
      const existing = await api<{ items: { id: string; name: string }[] }>('/sites', { token: admin.token, farmId: admin.farmId });
      const found = existing.items.find((s) => s.name === name);
      const id = found?.id ?? (await api<{ id: string }>('/sites', { method: 'POST', token: admin.token, farmId: admin.farmId, body: { name } })).id;
      sites.set(name, id);
    }
    for (const b of SEED_BUILDINGS) {
      await api('/buildings', {
        method: 'POST',
        token: admin.token,
        farmId: admin.farmId,
        body: { name: b.name, type: b.type, siteId: sites.get(b.site), capacity: b.capacity, status: b.status },
      });
    }

    await page.goto(`${WEB_URL}/`);
    await page.getByRole('heading', { name: 'Tableau de bord' }).waitFor();
    await settle(page);
    await page.screenshot({ path: join(BUILT, 'home.png'), fullPage: true });

    await page.goto(`${WEB_URL}/m/batiments`);
    await page.getByRole('row', { name: /Poulailler A/ }).waitFor();
    await settle(page);
    await page.screenshot({ path: join(BUILT, 'm_batiments.png') });
    assert.equal(await page.title(), 'Bâtiments — AgriPilot');
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
