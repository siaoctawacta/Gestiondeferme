import { INestApplication } from '@nestjs/common';
import { Workbook } from 'exceljs';
import { PrismaService } from '../src/prisma/prisma.service';
import { daysAgo, Headers, Id, World } from './fixtures';
import { createTestApp } from './setup';

interface Page {
  items: unknown[];
  total: number;
  statusCounts?: Record<string, number>;
}

/** The CSV of an export, as header and rows of cells (the BOM stripped). */
const parse = (text: string): { header: string; rows: string[][] } => {
  const lines = text
    .replace(/^\uFEFF/, '')
    .split('\r\n')
    .filter(Boolean);
  return {
    header: lines[0],
    rows: lines.slice(1).map((l) => l.split(';')),
  };
};

describe('Remaining list exports (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let world: World;
  let admin: Headers;

  beforeAll(async () => {
    app = await createTestApp();
    prisma = new PrismaService();
    world = new World(app, prisma);
  });

  beforeEach(async () => {
    await world.reset();
    admin = await world.actor('SUPER_ADMIN');
  });

  afterAll(async () => {
    await prisma.$disconnect();
    await app.close();
  });

  const http = () => world.http();
  const csv = async (path: string, h: Headers = admin) => {
    const sep = path.includes('?') ? '&' : '?';
    const res = await http().get(`/api${path}${sep}format=csv`).set(h);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/csv');
    return parse(res.text);
  };
  const xlsx = async (path: string, h: Headers = admin) => {
    const sep = path.includes('?') ? '&' : '?';
    const res = await http().get(`/api${path}${sep}format=xlsx`).set(h);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('spreadsheetml');
  };

  describe('health', () => {
    it('quarantines: header, rows, statusCounts', async () => {
      const lot = await world.lot(admin);
      const sow = await world.animal(admin);
      await world.post(admin, '/quarantines', {
        batchId: lot.id,
        startDate: daysAgo(5),
        reason: 'Toux suspecte',
      });
      const lifted = await world.post<Id>(admin, '/quarantines', {
        animalId: sow.id,
        startDate: daysAgo(9),
        reason: 'Boiterie',
      });
      await http()
        .post(`/api/quarantines/${lifted.id}/lift`)
        .set(admin)
        .send({ date: daysAgo(8) })
        .expect(200);
      const { header, rows } = await csv('/quarantines');
      expect(header).toBe('Début;Lot / animal;Motif;Fin;Statut');
      expect(rows).toEqual([
        [daysAgo(5), lot.code, 'Toux suspecte', '', 'En cours'],
        [daysAgo(9), sow.tag, 'Boiterie', daysAgo(8), 'Levée'],
      ]);
      await xlsx('/quarantines');
      const page = (await http().get('/api/quarantines').set(admin).expect(200))
        .body as Page;
      expect(page.statusCounts).toEqual({ EN_COURS: 1, LEVEE: 1 });
      const filtered = (
        await http().get('/api/quarantines?status=LEVEE').set(admin).expect(200)
      ).body as Page;
      expect(filtered.total).toBe(1);
      // The totals follow every filter but the status.
      expect(filtered.statusCounts).toEqual({ EN_COURS: 1, LEVEE: 1 });
    });

    it('writes the days of a list workbook as real date cells, the CSV staying text', async () => {
      const lot = await world.lot(admin);
      await world.post(admin, '/quarantines', {
        batchId: lot.id,
        startDate: daysAgo(5),
        reason: 'Toux suspecte',
      });
      const res = await http()
        .get('/api/quarantines?format=xlsx')
        .set(admin)
        .buffer(true)
        .parse((r, cb) => {
          const chunks: Buffer[] = [];
          r.on('data', (c: Buffer) => chunks.push(c));
          r.on('end', () => cb(null, Buffer.concat(chunks)));
        })
        .expect(200);
      const wb = new Workbook();
      await wb.xlsx.load(res.body as ArrayBuffer);
      const cell = wb.worksheets[0].getRow(2).getCell(1);
      expect(cell.value).toEqual(new Date(`${daysAgo(5)}T00:00:00Z`));
      expect(cell.numFmt).toBe('dd/mm/yyyy');
      expect((await csv('/quarantines')).rows[0][0]).toBe(daysAgo(5));
    });

    it('incidents: header, rows, statusCounts, and a role without sante is refused', async () => {
      const lot = await world.lot(admin);
      await world.post(admin, '/incidents', {
        date: daysAgo(2),
        title: 'Coryza',
        severity: 'GRAVE',
        batchId: lot.id,
      });
      const { header, rows } = await csv('/incidents');
      expect(header).toBe('Date;Titre;Gravité;Cible;Statut');
      expect(rows).toEqual([
        [daysAgo(2), 'Coryza', 'Grave', lot.code, 'Ouvert'],
      ]);
      await xlsx('/incidents');
      const page = (await http().get('/api/incidents').set(admin).expect(200))
        .body as Page;
      expect(page.statusCounts).toEqual({ OUVERT: 1, CLOS: 0 });
      const magasinier = await world.actor('MAGASINIER');
      await http().get('/api/incidents?format=csv').set(magasinier).expect(403);
    });

    it('biosecurity logs', async () => {
      await world.post(admin, '/biosecurity-logs', {
        date: daysAgo(1),
        type: 'DESINFECTION',
        buildingId: world.poultryBld,
        productName: 'Javel',
      });
      const { header, rows } = await csv('/biosecurity-logs');
      expect(header).toBe('Date;Type;Bâtiment;Produit;Visiteur;Note');
      expect(rows).toEqual([
        [daysAgo(1), 'Désinfection', 'Poulailler', 'Javel', '', ''],
      ]);
      await xlsx('/biosecurity-logs');
    });

    it('vaccination plans', async () => {
      await world.post(admin, '/vaccination-plans', {
        name: 'Plan chair',
        species: 'AVICOLE',
        type: 'CHAIR',
        items: [
          { ageDays: 7, productName: 'Gumboro' },
          { ageDays: 21, productName: 'Newcastle' },
        ],
      });
      const { header, rows } = await csv('/vaccination-plans');
      expect(header).toBe('Nom;Espèce;Type de lot;Étapes');
      expect(rows).toEqual([['Plan chair', 'Avicole', 'Chair', '2']]);
      await xlsx('/vaccination-plans');
    });
  });

  describe('production and feed', () => {
    it('incubations', async () => {
      await world.post(admin, '/incubations', {
        startDate: daysAgo(10),
        eggsSet: 300,
        incubator: 'Couveuse 1',
      });
      const { header, rows } = await csv('/incubations');
      expect(header).toBe(
        "Code;Couveuse;Début;Œufs incubés;Fertiles;Éclosion prévue;Poussins;Taux d'éclosion;Statut",
      );
      expect(rows).toHaveLength(1);
      expect(rows[0].slice(1, 5)).toEqual([
        'Couveuse 1',
        daysAgo(10),
        '300',
        '',
      ]);
      expect(rows[0][6]).toBe('');
      expect(rows[0][8]).toBe('En cours');
      await xlsx('/incubations');
    });

    it('feed products and formulas', async () => {
      const product = await world.post<Id>(admin, '/feed-products', {
        name: 'Maïs',
        kind: 'MATIERE_PREMIERE',
        unitCost: 250.5,
      });
      const fp = await csv('/feed-products');
      expect(fp.header).toBe('Nom;Type;Coût unitaire;Actif');
      expect(fp.rows).toHaveLength(1);
      expect(fp.rows[0][0]).toBe('Maïs');
      expect(fp.rows[0][1]).toBe('Matière première');
      expect(fp.rows[0][2]).toBe('250,5');
      expect(fp.rows[0][3]).toBe('Actif');
      await world.post(admin, '/feed-formulas', {
        name: 'Ponte 1',
        species: 'AVICOLE',
        stage: 'Ponte',
        items: [{ feedProductId: product.id, percentage: 100 }],
      });
      const ff = await csv('/feed-formulas');
      expect(ff.header).toBe('Nom;Espèce;Stade;Coût / kg;Actif');
      expect(ff.rows).toEqual([
        ['Ponte 1', 'Avicole', 'Ponte', '250,5', 'Actif'],
      ]);
      await xlsx('/feed-products');
      await xlsx('/feed-formulas');
    });

    it('water', async () => {
      const lot = await world.lot(admin);
      await world.post(admin, '/water', {
        batchId: lot.id,
        date: daysAgo(1),
        liters: 1200,
      });
      const { header, rows } = await csv('/water');
      expect(header).toBe('Date;Lot / bâtiment;Eau (L)');
      expect(rows).toEqual([[daysAgo(1), lot.code, '1200']]);
      await xlsx('/water');
    });

    it('lot events and weighings', async () => {
      const lot = await world.lot(admin);
      await world.post(admin, `/batches/${lot.id}/events`, {
        type: 'MORTALITE',
        date: daysAgo(2),
        quantity: 4,
        cause: 'Chaleur',
      });
      const ev = await csv(`/batches/${lot.id}/events`);
      expect(ev.header).toBe('Date;Type;Quantité;Cause');
      expect(ev.rows).toEqual([[daysAgo(2), 'Mortalité', '4', 'Chaleur']]);
      await xlsx(`/batches/${lot.id}/events`);

      await world.post(admin, `/batches/${lot.id}/weighings`, {
        date: daysAgo(3),
        sampleSize: 20,
        averageWeightG: 850,
      });
      const w = await csv(`/batches/${lot.id}/weighings`);
      expect(w.header).toBe('Date;Échantillon;Poids moyen (g)');
      expect(w.rows).toEqual([[daysAgo(3), '20', '850']]);
      await xlsx(`/batches/${lot.id}/weighings`);
    });

    it('animal weighings and heats', async () => {
      const sow = await world.animal(admin);
      await world.post(admin, `/animals/${sow.id}/weighings`, {
        date: daysAgo(3),
        weightKg: 142.5,
      });
      const w = await csv(`/animals/${sow.id}/weighings`);
      expect(w.header).toBe('Date;Poids (kg)');
      expect(w.rows).toEqual([[daysAgo(3), '142,5']]);
      await world.post(admin, `/animals/${sow.id}/heats`, {
        date: daysAgo(4),
        note: 'Franche',
      });
      const h = await csv(`/animals/${sow.id}/heats`);
      expect(h.header).toBe('Date;Note');
      expect(h.rows).toEqual([[daysAgo(4), 'Franche']]);
      await xlsx(`/animals/${sow.id}/weighings`);
      await xlsx(`/animals/${sow.id}/heats`);
    });
  });

  describe('stock', () => {
    it('inventories and movements, readable by a role that reads the stock', async () => {
      const item = await world.post<Id>(admin, '/stock-items', {
        name: 'Vaccin Gumboro',
        category: 'VACCIN',
        unit: 'flacon',
      });
      await world.post(admin, '/stock/movements', {
        itemId: item.id,
        type: 'ENTREE',
        date: daysAgo(10),
        quantity: 20,
        unitCost: 1500.25,
        reason: 'ACHAT',
        lotNumber: 'L-77',
      });
      await world.post(admin, '/inventories', {
        date: daysAgo(2),
        note: 'Comptage',
      });
      const commercial = await world.actor('COMMERCIAL');
      const mv = await csv('/stock/movements', commercial);
      expect(mv.header).toBe(
        'Date;Article;Type;Quantité;Coût unitaire;Motif;N° de lot',
      );
      expect(mv.rows).toEqual([
        [
          daysAgo(10),
          'Vaccin Gumboro',
          'Entrée',
          '20',
          '1500,25',
          'Achat',
          'L-77',
        ],
      ]);
      const inv = await csv('/inventories');
      expect(inv.header).toBe('Date;Statut;Lignes comptées;Note');
      expect(inv.rows).toEqual([[daysAgo(2), 'Brouillon', '0', 'Comptage']]);
      await xlsx('/stock/movements');
      await xlsx('/inventories');
    });
  });
});
