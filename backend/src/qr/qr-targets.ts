import type { ModuleKey } from '../access/permissions';
import type {
  AnimalCategory,
  BatchType,
  BuildingType,
  EquipmentType,
  Species,
  StockCategory,
} from '../generated/prisma/enums';

export const QR_KINDS = [
  'lot',
  'animal',
  'batiment',
  'article',
  'equipement',
] as const;
export type QrKind = (typeof QR_KINDS)[number];
export const isQrKind = (v: string): v is QrKind =>
  (QR_KINDS as readonly string[]).includes(v);

export type QrFacts =
  | {
      kind: 'lot';
      id: string;
      code: string;
      species: Species;
      type: BatchType;
      buildingName: string;
    }
  | {
      kind: 'animal';
      id: string;
      tag: string;
      category: AnimalCategory;
      breedName: string | null;
    }
  | {
      kind: 'batiment';
      id: string;
      name: string;
      type: BuildingType;
      siteName: string;
    }
  | {
      kind: 'article';
      id: string;
      name: string;
      category: StockCategory;
      unit: string;
    }
  | {
      kind: 'equipement';
      id: string;
      name: string;
      type: EquipmentType;
      location: string | null;
    };

const LOT_TYPE: Record<BatchType, string> = {
  CHAIR: 'Poulets de chair',
  PONDEUSE: 'Pondeuses',
  POUSSIN: 'Poussins',
  REPRODUCTEUR: 'Reproducteurs',
  PORCELET: 'Porcelets',
  ENGRAISSEMENT: 'Porcs à l’engrais',
};
const ANIMAL_CATEGORY: Record<AnimalCategory, string> = {
  TRUIE: 'Truie',
  VERRAT: 'Verrat',
  COCHETTE: 'Cochette',
};
const BUILDING_TYPE: Record<BuildingType, string> = {
  AVICOLE: 'Avicole',
  PORCIN: 'Porcin',
  AUTRE: 'Autre',
};
const STOCK_CATEGORY: Record<StockCategory, string> = {
  ALIMENT: 'Aliment',
  MEDICAMENT: 'Médicament',
  VACCIN: 'Vaccin',
  MATERIEL: 'Matériel',
  CONSOMMABLE: 'Consommable',
};
const EQUIPMENT_TYPE: Record<EquipmentType, string> = {
  COUVEUSE: 'Couveuse',
  BALANCE: 'Balance',
  POMPE: 'Pompe',
  GROUPE_ELECTROGENE: 'Groupe électrogène',
  VENTILATEUR: 'Ventilateur',
  CHAUFFAGE: 'Chauffage',
  ABREUVOIR: 'Abreuvoir',
  MANGEOIRE: 'Mangeoire',
  VEHICULE: 'Véhicule',
  AUTRE: 'Autre',
};

/** The module a role must be able to read to open the record (a lot's depends on its species). */
export function qrModule(f: QrFacts): ModuleKey {
  switch (f.kind) {
    case 'lot':
      return f.species === 'PORCIN' ? 'porcs' : 'lots';
    case 'animal':
      return 'porcs';
    case 'batiment':
      return 'batiments';
    case 'article':
      return 'stocks';
    case 'equipement':
      return 'equipements';
  }
}

/** The in-app page of the record (the screens' own routes). */
export function qrPath(f: QrFacts): string {
  switch (f.kind) {
    case 'lot':
      return f.species === 'PORCIN'
        ? `/m/porcs/lot-${f.id}`
        : `/m/lots/${f.id}`;
    case 'animal':
      return `/m/porcs/${f.id}`;
    case 'batiment':
      return `/m/batiments/${f.id}`;
    case 'article':
      return `/m/stocks/${f.id}`;
    case 'equipement':
      return `/m/equipements/${f.id}`;
  }
}

/** What the label of the record says: its name or code, then what it is and where. */
export function qrLabels(f: QrFacts): { label: string; sublabel: string } {
  switch (f.kind) {
    case 'lot':
      return {
        label: f.code,
        sublabel: `${LOT_TYPE[f.type]} — ${f.buildingName}`,
      };
    case 'animal':
      return {
        label: f.tag,
        sublabel: [ANIMAL_CATEGORY[f.category], f.breedName]
          .filter(Boolean)
          .join(' '),
      };
    case 'batiment':
      return {
        label: f.name,
        sublabel: `${BUILDING_TYPE[f.type]} — ${f.siteName}`,
      };
    case 'article':
      return {
        label: f.name,
        sublabel: `${STOCK_CATEGORY[f.category]} — ${f.unit}`,
      };
    case 'equipement':
      return {
        label: f.name,
        sublabel: [EQUIPMENT_TYPE[f.type], f.location]
          .filter(Boolean)
          .join(' — '),
      };
  }
}
