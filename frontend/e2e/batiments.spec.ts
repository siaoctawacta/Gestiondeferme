import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import type { Browser, Page } from 'playwright';
import { api, enrollAdmin, launch, newPage, PASSWORD, uiLoginWithBackupCode, WEB_URL, type EnrolledAdmin } from './helpers.ts';

describe('bâtiments, sites, droits et journal d’audit', () => {
  let browser: Browser;
  let page: Page;
  let admin: EnrolledAdmin;

  before(async () => {
    browser = await launch();
    admin = await enrollAdmin('batiments');
    ({ page } = await newPage(browser));
    await uiLoginWithBackupCode(page, admin.email, admin.backupCodes[0]);
    await page.getByRole('heading', { name: 'Tableau de bord' }).waitFor();
  });
  after(async () => {
    await browser.close();
  });

  it('crée le site « Site Nord » dans Fermes & sites', async () => {
    await page.goto(`${WEB_URL}/admin/fermes`);
    await page.getByRole('tab', { name: 'Sites' }).click();
    await page.getByRole('button', { name: 'Ajouter' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('Nom').fill('Site Nord');
    await dialog.getByRole('button', { name: 'Enregistrer' }).click();
    await dialog.waitFor({ state: 'detached' });
    await page.getByRole('row', { name: /Site Nord/ }).waitFor();
  });

  it('crée « Poulailler A » (capacité 5000) et le voit dans le tableau avec la pastille Actif', async () => {
    await page.goto(`${WEB_URL}/m/batiments`);
    await page.getByRole('button', { name: 'Ajouter' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('Nom').fill('Poulailler A');
    await dialog.getByLabel('Type').selectOption({ label: 'Avicole' });
    await dialog.getByLabel('Site').selectOption({ label: 'Site Nord' });
    await dialog.getByLabel('Capacité').fill('5000');
    await dialog.getByLabel('Statut').selectOption({ label: 'Actif' });
    await dialog.getByRole('button', { name: 'Enregistrer' }).click();
    await dialog.waitFor({ state: 'detached' });

    const row = page.getByRole('row', { name: /Poulailler A/ });
    await row.waitFor();
    const text = await row.innerText();
    assert.match(text, /Avicole/);
    assert.match(text, /Site Nord/);
    assert.match(text.replace(/\s/g, ''), /5000/); // 5 000 with a locale separator
    await row.getByText('Actif', { exact: true }).waitFor();
  });

  it('refuse un doublon avec « Ce nom existe déjà »', async () => {
    await page.getByRole('button', { name: 'Ajouter' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('Nom').fill('Poulailler A');
    await dialog.getByLabel('Type').selectOption({ label: 'Avicole' });
    await dialog.getByLabel('Site').selectOption({ label: 'Site Nord' });
    await dialog.getByLabel('Capacité').fill('100');
    await dialog.getByLabel('Statut').selectOption({ label: 'Actif' });
    await dialog.getByRole('button', { name: 'Enregistrer' }).click();
    await dialog.getByText('Ce nom existe déjà').waitFor();
    await dialog.getByRole('button', { name: 'Annuler' }).click();
    await dialog.waitFor({ state: 'detached' });
    assert.equal(await page.getByRole('row', { name: /Poulailler A/ }).count(), 1);
  });

  it('le journal d’audit liste la création', async () => {
    await page.goto(`${WEB_URL}/audit`);
    await page.getByRole('heading', { name: "Journal d'audit" }).waitFor();
    const row = page.getByRole('row').filter({ hasText: 'Création' }).filter({ hasText: 'Bâtiments' });
    await row.first().waitFor();
    assert.match(await row.first().innerText(), /Super administrateur/);
  });

  it('un auditeur ne voit pas « Ajouter » et ne peut pas écrire via l’API', async () => {
    await api('/users', {
      method: 'POST',
      token: admin.token,
      farmId: admin.farmId,
      body: {
        name: 'Auditeur Test',
        email: 'auditeur@e2e.test',
        role: 'AUDITEUR',
        farmIds: [admin.farmId],
        password: PASSWORD,
      },
    });
    const { context, page: audit } = await newPage(browser);
    await audit.goto(`${WEB_URL}/login`);
    await audit.getByLabel('Adresse e-mail').fill('auditeur@e2e.test');
    await audit.getByLabel('Mot de passe').fill(PASSWORD);
    await audit.getByRole('button', { name: 'Se connecter' }).click();
    await audit.getByRole('heading', { name: 'Tableau de bord' }).waitFor();

    await audit.goto(`${WEB_URL}/m/batiments`);
    await audit.getByRole('row', { name: /Poulailler A/ }).waitFor();
    assert.equal(await audit.getByRole('button', { name: 'Ajouter' }).count(), 0);
    assert.equal(await audit.getByRole('button', { name: 'Modifier' }).count(), 0);
    assert.equal(await audit.getByRole('button', { name: 'Supprimer' }).count(), 0);

    const login = await api<{ accessToken: string }>('/auth/login', {
      method: 'POST',
      body: { email: 'auditeur@e2e.test', password: PASSWORD },
    });
    await assert.rejects(
      api('/buildings', { method: 'POST', token: login.accessToken, farmId: admin.farmId, body: { name: 'X' } }),
      /403/,
    );
    await context.close();
  });

  it('supprime le bâtiment', async () => {
    await page.goto(`${WEB_URL}/m/batiments`);
    const row = page.getByRole('row', { name: /Poulailler A/ });
    await row.getByRole('button', { name: 'Supprimer' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByText(/Supprimer « Poulailler A »/).waitFor();
    await dialog.getByRole('button', { name: 'Supprimer' }).click();
    await dialog.waitFor({ state: 'detached' });
    await row.waitFor({ state: 'detached' });
  });
});
