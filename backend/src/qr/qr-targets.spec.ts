import {
  QR_KINDS,
  isQrKind,
  qrLabels,
  qrModule,
  qrPath,
  type QrFacts,
} from './qr-targets';

const lot = (over: Partial<QrFacts & { kind: 'lot' }> = {}): QrFacts => ({
  kind: 'lot',
  id: 'l1',
  code: 'LC-2026-14',
  species: 'AVICOLE',
  type: 'CHAIR',
  buildingName: 'Poulailler A',
  ...over,
});

describe('qr-targets', () => {
  it('knows the five kinds and nothing else', () => {
    expect([...QR_KINDS]).toEqual([
      'lot',
      'animal',
      'batiment',
      'article',
      'equipement',
    ]);
    expect(isQrKind('lot')).toBe(true);
    expect(isQrKind('facture')).toBe(false);
    expect(isQrKind('constructor')).toBe(false);
  });

  it('maps each record to the module a role must read', () => {
    expect(qrModule(lot())).toBe('lots');
    expect(qrModule(lot({ species: 'PORCIN', type: 'ENGRAISSEMENT' }))).toBe(
      'porcs',
    );
    expect(
      qrModule({
        kind: 'animal',
        id: 'a',
        tag: 'TR-027',
        category: 'TRUIE',
        breedName: null,
      }),
    ).toBe('porcs');
    expect(
      qrModule({
        kind: 'batiment',
        id: 'b',
        name: 'x',
        type: 'AVICOLE',
        siteName: 's',
      }),
    ).toBe('batiments');
    expect(
      qrModule({
        kind: 'article',
        id: 'x',
        name: 'x',
        category: 'VACCIN',
        unit: 'u',
      }),
    ).toBe('stocks');
    expect(
      qrModule({
        kind: 'equipement',
        id: 'e',
        name: 'x',
        type: 'POMPE',
        location: null,
      }),
    ).toBe('equipements');
  });

  it('gives the in-app path of each record', () => {
    expect(qrPath(lot())).toBe('/m/lots/l1');
    expect(qrPath(lot({ species: 'PORCIN', type: 'PORCELET' }))).toBe(
      '/m/porcs/lot-l1',
    );
    expect(
      qrPath({
        kind: 'animal',
        id: 'a1',
        tag: 'TR-1',
        category: 'TRUIE',
        breedName: null,
      }),
    ).toBe('/m/porcs/a1');
    expect(
      qrPath({
        kind: 'batiment',
        id: 'b1',
        name: 'x',
        type: 'AUTRE',
        siteName: 's',
      }),
    ).toBe('/m/batiments/b1');
    expect(
      qrPath({
        kind: 'article',
        id: 's1',
        name: 'x',
        category: 'ALIMENT',
        unit: 'kg',
      }),
    ).toBe('/m/stocks/s1');
    expect(
      qrPath({
        kind: 'equipement',
        id: 'q1',
        name: 'x',
        type: 'AUTRE',
        location: null,
      }),
    ).toBe('/m/equipements/q1');
  });

  it('writes the label and the sub-label of each record', () => {
    expect(qrLabels(lot())).toEqual({
      label: 'LC-2026-14',
      sublabel: 'Poulets de chair — Poulailler A',
    });
    expect(
      qrLabels({
        kind: 'animal',
        id: 'a',
        tag: 'TR-027',
        category: 'TRUIE',
        breedName: 'Large White',
      }),
    ).toEqual({ label: 'TR-027', sublabel: 'Truie Large White' });
    expect(
      qrLabels({
        kind: 'animal',
        id: 'a',
        tag: 'VE-1',
        category: 'VERRAT',
        breedName: null,
      }),
    ).toEqual({ label: 'VE-1', sublabel: 'Verrat' });
    expect(
      qrLabels({
        kind: 'batiment',
        id: 'b',
        name: 'Poulailler A',
        type: 'AVICOLE',
        siteName: 'Site Nord',
      }),
    ).toEqual({ label: 'Poulailler A', sublabel: 'Avicole — Site Nord' });
    expect(
      qrLabels({
        kind: 'article',
        id: 'x',
        name: 'Vaccin Gumboro',
        category: 'VACCIN',
        unit: 'flacon',
      }),
    ).toEqual({ label: 'Vaccin Gumboro', sublabel: 'Vaccin — flacon' });
    expect(
      qrLabels({
        kind: 'equipement',
        id: 'e',
        name: 'Groupe électrogène 20 kVA',
        type: 'GROUPE_ELECTROGENE',
        location: 'Site Nord',
      }),
    ).toEqual({
      label: 'Groupe électrogène 20 kVA',
      sublabel: 'Groupe électrogène — Site Nord',
    });
    expect(
      qrLabels({
        kind: 'equipement',
        id: 'e',
        name: 'Pompe 2',
        type: 'POMPE',
        location: null,
      }).sublabel,
    ).toBe('Pompe');
  });
});
