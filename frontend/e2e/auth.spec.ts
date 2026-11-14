import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import type { Browser, Page } from 'playwright';
import { ADMINS } from './config.ts';
import { launch, newPage, PASSWORD, totp, WEB_URL } from './helpers.ts';

describe('authentification et double authentification obligatoire', () => {
  let browser: Browser;
  let page: Page;
  let enrolCode = '';
  let backupCodes: string[] = [];

  before(async () => {
    browser = await launch();
    ({ page } = await newPage(browser));
  });
  after(async () => {
    await browser.close();
  });

  it('un mauvais mot de passe est refusé', async () => {
    await page.goto(`${WEB_URL}/login`);
    await page.getByLabel('Adresse e-mail').fill(ADMINS.auth);
    await page.getByLabel('Mot de passe').fill('mauvais-mot-de-passe-12');
    await page.getByRole('button', { name: 'Se connecter' }).click();
    await page.getByText(/incorrect|invalide/i).first().waitFor();
    assert.match(page.url(), /\/login$/);
    assert.equal(await page.title(), 'Connexion — AgriPilot');
  });

  it('le premier accès du super admin impose l’activation de la 2FA, puis affiche le tableau de bord', async () => {
    await page.getByLabel('Mot de passe').fill(PASSWORD);
    await page.getByRole('button', { name: 'Se connecter' }).click();
    await page.getByRole('heading', { name: 'Activer la double authentification' }).waitFor();

    const secret = (await page.locator('code').first().innerText()).trim();
    assert.match(secret, /^[A-Z2-7]{32}$/);
    enrolCode = totp(secret);
    await page.getByLabel('Code de vérification').fill(enrolCode);
    await page.getByRole('button', { name: 'Activer' }).click();

    await page.getByText('Conservez ces codes de secours').waitFor();
    backupCodes = await page.locator('li.font-mono').allInnerTexts();
    assert.equal(backupCodes.length, 8);
    for (const c of backupCodes) assert.match(c.trim(), /^[A-Z2-9]{10}$/);

    await page.getByRole('button', { name: "J'ai enregistré mes codes" }).click();
    await page.getByRole('heading', { name: 'Tableau de bord' }).waitFor();
    assert.equal(new URL(page.url()).pathname, '/');
  });

  it('recharger la page conserve la session (cookie de rafraîchissement)', async () => {
    await page.reload();
    await page.getByRole('heading', { name: 'Tableau de bord' }).waitFor();
    assert.equal(new URL(page.url()).pathname, '/');
    // A deep link survives a reload too.
    await page.goto(`${WEB_URL}/m/batiments`);
    await page.getByRole('heading', { name: 'Bâtiments' }).waitFor();
  });

  it('la déconnexion renvoie vers la connexion et protège les pages', async () => {
    await page.getByRole('button', { name: /Super administrateur/ }).click();
    await page.getByRole('menuitem', { name: 'Déconnexion' }).click();
    await page.getByRole('heading', { name: 'Connexion' }).waitFor();
    await page.goto(`${WEB_URL}/m/batiments`);
    await page.getByRole('heading', { name: 'Connexion' }).waitFor();
    assert.match(page.url(), /\/login$/);
  });

  it('la reconnexion demande un code ; un code TOTP déjà utilisé est refusé, un code de secours fonctionne', async () => {
    await page.getByLabel('Adresse e-mail').fill(ADMINS.auth);
    await page.getByLabel('Mot de passe').fill(PASSWORD);
    await page.getByRole('button', { name: 'Se connecter' }).click();
    await page.getByRole('heading', { name: 'Vérification en deux étapes' }).waitFor();

    // The code that enabled 2FA was already accepted: replaying that exact code must fail,
    // even if a new 30 s step has begun since (the server remembers the last accepted step).
    await page.getByLabel('Code de vérification').fill(enrolCode);
    await page.getByRole('button', { name: 'Vérifier' }).click();
    await page.getByText('Code invalide').waitFor();

    await page.getByLabel('Code de vérification').fill(backupCodes[0]);
    await page.getByRole('button', { name: 'Vérifier' }).click();
    // The deep link visited before signing out is restored after login.
    await page.getByRole('heading', { name: 'Bâtiments' }).waitFor();
    assert.equal(new URL(page.url()).pathname, '/m/batiments');
  });

  it('un code de secours ne sert qu’une fois', async () => {
    await page.getByRole('button', { name: /Super administrateur/ }).click();
    await page.getByRole('menuitem', { name: 'Déconnexion' }).click();
    await page.getByLabel('Adresse e-mail').fill(ADMINS.auth);
    await page.getByLabel('Mot de passe').fill(PASSWORD);
    await page.getByRole('button', { name: 'Se connecter' }).click();
    await page.getByLabel('Code de vérification').fill(backupCodes[0]);
    await page.getByRole('button', { name: 'Vérifier' }).click();
    await page.getByText('Code invalide').waitFor();
    await page.getByRole('heading', { name: 'Vérification en deux étapes' }).waitFor();
  });
});
