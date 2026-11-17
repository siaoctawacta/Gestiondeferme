import { Workbook } from 'exceljs';
import { csvCell, ExportColumn, toCsv, toXlsx } from './export';

interface Row {
  name: string;
  qty: number | null;
  note: string;
}

const cols: ExportColumn<Row>[] = [
  { header: 'Nom', value: (r) => r.name },
  { header: 'Quantité', value: (r) => r.qty },
  { header: 'Note', value: (r) => r.note },
];

describe('toCsv', () => {
  const rows: Row[] = [{ name: 'A;"b"', qty: 1000, note: '=1+1' }];

  it('quotes, doubles quotes, uses ; and neutralises formulas', () => {
    const lines = toCsv(rows, cols).split('\r\n');
    expect(lines[0]).toBe('﻿Nom;Quantité;Note');
    expect(lines[1]).toBe('"A;""b""";1000;\'=1+1');
  });

  it('starts with a UTF-8 BOM and ends with CRLF', () => {
    const csv = toCsv(rows, cols);
    expect(csv.startsWith('﻿')).toBe(true);
    expect(csv.endsWith('\r\n')).toBe(true);
  });

  it('prefixes every formula trigger and leaves null empty', () => {
    const csv = toCsv(
      [
        { name: '+1', qty: null, note: '-2' },
        { name: '@x', qty: 5, note: 'ok' },
      ],
      cols,
    );
    const lines = csv.split('\r\n');
    expect(lines[1]).toBe("'+1;;'-2");
    expect(lines[2]).toBe("'@x;5;ok");
  });
});

describe('csvCell', () => {
  it('writes a decimal with a comma and leaves integers, negatives and exponents alone', () => {
    expect(csvCell(3.6)).toBe('3,6');
    expect(csvCell(-12.25)).toBe('-12,25');
    expect(csvCell(1000)).toBe('1000');
    expect(csvCell(-1135000)).toBe('-1135000');
    expect(csvCell(0)).toBe('0');
    expect(csvCell(null)).toBe('');
  });

  it('keeps the text rules: quotes, doubled quotes, formula neutralising', () => {
    expect(csvCell('a;b')).toBe('"a;b"');
    expect(csvCell('1.5')).toBe('1.5');
    expect(csvCell('-x')).toBe("'-x");
  });

  it('neutralises a formula behind blanks, a leading tab or CR, and leaves numbers alone', () => {
    expect(csvCell('  =1+1')).toBe("'  =1+1");
    expect(csvCell(' @SUM(A1)')).toBe("' @SUM(A1)");
    expect(csvCell('\t+1')).toBe("'\t+1");
    expect(csvCell('\r=1')).toBe('"\'\r=1"');
    expect(csvCell('ok = fine')).toBe('ok = fine');
    expect(csvCell(-5)).toBe('-5');
  });
});

describe('toXlsx', () => {
  it('round-trips header and values', async () => {
    const buf = await toXlsx(
      [{ name: 'Poule', qty: 12, note: 'x' }],
      cols,
      'Test',
    );
    const wb = new Workbook();
    await wb.xlsx.load(buf as unknown as ArrayBuffer);
    const ws = wb.getWorksheet('Test')!;
    expect(ws.getRow(1).values).toEqual([undefined, 'Nom', 'Quantité', 'Note']);
    expect(ws.getRow(2).values).toEqual([undefined, 'Poule', 12, 'x']);
  });
});
