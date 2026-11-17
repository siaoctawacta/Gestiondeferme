import { Workbook } from 'exceljs';
import { reportCsv, reportFilename, reportXlsx } from './report-export';
import type { ReportDto } from './report.types';

const report: ReportDto = {
  type: 'mensuel',
  title: 'Rapport mensuel — octobre 2026',
  from: '2026-10-01',
  to: '2026-10-31',
  generatedAt: '2026-11-17T09:00:00.000Z',
  farmName: 'Ferme Kpalimé',
  sections: [
    {
      key: 'avicole',
      title: 'Production avicole',
      rows: [
        { key: 'collected', label: 'Œufs collectés', value: 12465, unit: '' },
        { key: 'laying', label: 'Taux de ponte moyen', value: 3.6, unit: '%' },
        { key: 'none', label: 'Sans valeur', value: null, unit: 'kg' },
      ],
    },
    {
      key: 'finance',
      title: 'Finance',
      rows: [{ key: 'margin', label: 'Marge', value: -1135000, unit: 'FCFA' }],
      cards: [
        {
          activity: 'AVICOLE',
          revenue: 2050000,
          expenses: 1140000,
          margin: 910000,
        },
        {
          activity: 'GENERAL',
          revenue: 0,
          expenses: 1135000,
          margin: -1135000,
        },
      ],
      table: {
        columns: [
          { key: 'category', header: 'CATÉGORIE' },
          { key: 'amount', header: 'MONTANT', unit: 'FCFA' },
        ],
        rows: [
          { category: '=Ventes', amount: 3970000 },
          { category: 'Aliment; "gros"', amount: 12.5 },
        ],
      },
    },
  ],
};

describe('reportCsv', () => {
  it('writes the rows, the cards and then each table after an empty line, with BOM and CRLF', () => {
    expect(reportCsv(report)).toBe(
      '﻿' +
        [
          'Section;Indicateur;Valeur;Unité',
          'Production avicole;Œufs collectés;12465;',
          'Production avicole;Taux de ponte moyen;3,6;%',
          'Production avicole;Sans valeur;;kg',
          'Finance;Marge;-1135000;FCFA',
          'Activité Avicole;Recettes;2050000;FCFA',
          'Activité Avicole;Dépenses;1140000;FCFA',
          'Activité Avicole;Marge;910000;FCFA',
          'Activité Général;Recettes;0;FCFA',
          'Activité Général;Dépenses;1135000;FCFA',
          'Activité Général;Marge;-1135000;FCFA',
          '',
          'Finance',
          'CATÉGORIE;MONTANT (FCFA)',
          "'=Ventes;3970000",
          '"Aliment; ""gros""";12,5',
          '',
        ].join('\r\n'),
    );
  });

  it('is only the header line for a report with no section', () => {
    expect(reportCsv({ ...report, sections: [] })).toBe(
      '﻿Section;Indicateur;Valeur;Unité\r\n',
    );
  });
});

describe('reportFilename', () => {
  it('is rapport-{type}-{from}_{to}', () => {
    expect(reportFilename(report)).toBe(
      'rapport-mensuel-2026-10-01_2026-10-31',
    );
  });
});

describe('reportXlsx', () => {
  it('holds the Indicateurs sheet and one sheet per table, numbers as numbers', async () => {
    const wb = new Workbook();
    await wb.xlsx.load((await reportXlsx(report)) as unknown as ArrayBuffer);
    expect(wb.worksheets.map((w) => w.name)).toEqual([
      'Indicateurs',
      'Finance',
    ]);
    const rows = wb.getWorksheet('Indicateurs')!;
    expect(rows.getRow(1).values).toEqual([
      undefined,
      'Section',
      'Indicateur',
      'Valeur',
      'Unité',
    ]);
    expect(rows.getRow(3).values).toEqual([
      undefined,
      'Production avicole',
      'Taux de ponte moyen',
      3.6,
      '%',
    ]);
    const table = wb.getWorksheet('Finance')!;
    expect(table.getRow(1).values).toEqual([
      undefined,
      'CATÉGORIE',
      'MONTANT (FCFA)',
    ]);
    expect(table.getRow(3).values).toEqual([
      undefined,
      'Aliment; "gros"',
      12.5,
    ]);
  });

  it('writes a date column as real dates', async () => {
    const wb = new Workbook();
    await wb.xlsx.load(
      (await reportXlsx({
        ...report,
        sections: [
          {
            key: 'd',
            title: 'Délais',
            table: {
              columns: [{ key: 'until', header: "JUSQU'AU", date: true }],
              rows: [{ until: '04/11/2026' }],
            },
          },
        ],
      })) as unknown as ArrayBuffer,
    );
    const cell = wb.getWorksheet('Délais')!.getCell('A2');
    expect(cell.value).toEqual(new Date(Date.UTC(2026, 10, 4)));
    expect(cell.numFmt).toBe('dd/mm/yyyy');
  });

  it('cuts sheet names to 31 characters, without the characters Excel refuses, and keeps them unique', async () => {
    const long = 'Rentabilité des lots / animaux en cours de période [x]';
    const table = {
      columns: [{ key: 'a', header: 'A' }],
      rows: [{ a: 1 }],
    };
    const wb = new Workbook();
    await wb.xlsx.load(
      (await reportXlsx({
        ...report,
        sections: [
          { key: 'a', title: long, table },
          { key: 'b', title: long, table },
        ],
      })) as unknown as ArrayBuffer,
    );
    const names = wb.worksheets.map((w) => w.name);
    expect(names).toHaveLength(3);
    expect(new Set(names).size).toBe(3);
    for (const n of names) {
      expect(n.length).toBeLessThanOrEqual(31);
      expect(n).not.toMatch(/[:\\/?*[\]]/);
    }
  });
});
