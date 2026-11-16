import { BadRequestException, Injectable } from '@nestjs/common';
import type { RequestContext } from '../../access/decorators';
import type { Prisma } from '../../generated/prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

const LEGAL_FIELDS = ['name', 'address', 'nif', 'rccm'] as const;
type Legal = Record<(typeof LEGAL_FIELDS)[number], string>;
type SettingValue = number | string | Legal;

/** A whole number of days (or similar): 1, 2, 3... */
const positiveInteger =
  (label: string, max?: number) =>
  (value: unknown): number => {
    if (
      typeof value !== 'number' ||
      !Number.isSafeInteger(value) ||
      value <= 0
    ) {
      throw new BadRequestException(
        `${label} doit être un nombre entier supérieur à 0`,
      );
    }
    if (max !== undefined && value > max) {
      throw new BadRequestException(`${label} ne peut pas dépasser ${max}`);
    }
    return value;
  };

/** A percentage in ]0, 100]. */
const percentage =
  (label: string) =>
  (value: unknown): number => {
    if (
      typeof value !== 'number' ||
      !Number.isFinite(value) ||
      value <= 0 ||
      value > 100
    ) {
      throw new BadRequestException(
        `${label} doit être un pourcentage supérieur à 0 et au plus 100`,
      );
    }
    return value;
  };

function currency(value: unknown): string {
  const text = typeof value === 'string' ? value.trim() : '';
  if (text === '' || text.length > 10) {
    throw new BadRequestException(
      'La devise doit contenir entre 1 et 10 caractères',
    );
  }
  return text;
}

function legal(value: unknown): Legal {
  const invalid = () =>
    new BadRequestException(
      'Les informations légales doivent contenir nom, adresse, NIF et RCCM',
    );
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw invalid();
  }
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record);
  if (
    keys.length !== LEGAL_FIELDS.length ||
    !LEGAL_FIELDS.every((f) => typeof record[f] === 'string')
  ) {
    throw invalid();
  }
  return Object.fromEntries(
    LEGAL_FIELDS.map((f) => [f, record[f] as string]),
  ) as Legal;
}

interface SettingDefinition {
  default: SettingValue;
  parse: (value: unknown) => SettingValue;
}

const SETTINGS: Record<string, SettingDefinition> = {
  currency: { default: 'FCFA', parse: currency },
  mortalityDailyPct: {
    default: 0.5,
    parse: percentage('Le seuil de mortalité journalière'),
  },
  mortalityCumulPct: {
    default: 3,
    parse: percentage('Le seuil de mortalité cumulée'),
  },
  consumptionDeviationPct: {
    default: 25,
    parse: percentage("L'écart de consommation"),
  },
  expiryWarningDays: {
    default: 30,
    parse: positiveInteger("Le délai d'alerte de péremption"),
  },
  farrowingWarningDays: {
    default: 7,
    parse: positiveInteger("Le délai d'alerte de mise bas"),
  },
  vaccinationWarningDays: {
    default: 3,
    parse: positiveInteger("Le délai d'alerte de vaccination"),
  },
  gestationDays: {
    default: 114,
    parse: positiveInteger('La durée de gestation'),
  },
  invoiceDueDays: {
    default: 15,
    parse: positiveInteger("Le délai d'échéance des factures", 365),
  },
  eggsPerTray: {
    default: 30,
    parse: positiveInteger("Le nombre d'œufs par plateau", 1000),
  },
  legal: {
    default: { name: '', address: '', nif: '', rccm: '' },
    parse: legal,
  },
};

/** The part of the settings every role may read (`GET /settings/documents`). */
export interface DocumentSettings {
  legal: Legal;
  invoiceDueDays: number;
  eggsPerTray: number;
}

/** The settings the sales documents snapshot (days to pay an invoice, eggs in a tray). */
export type SaleSetting = 'invoiceDueDays' | 'eggsPerTray';

@Injectable()
export class SettingsService {
  constructor(private readonly prisma: PrismaService) {}

  /** Every known key, with the organisation's stored value or the default. */
  async getAll(ctx: RequestContext): Promise<Record<string, SettingValue>> {
    const stored = await this.prisma.setting.findMany({
      where: { organizationId: ctx.user.organizationId },
    });
    const byKey = new Map(stored.map((s) => [s.key, s.value]));
    return Object.fromEntries(
      Object.entries(SETTINGS).map(([key, def]) => [
        key,
        (byKey.get(key) as SettingValue | undefined) ?? def.default,
      ]),
    );
  }

  /** One whole-number setting of the organisation (its stored value or the default); inside `tx` when given. */
  async number(
    organizationId: string,
    key: SaleSetting,
    tx?: Prisma.TransactionClient,
  ): Promise<number> {
    const stored = await (tx ?? this.prisma).setting.findUnique({
      where: { organizationId_key: { organizationId, key } },
    });
    return (
      (stored?.value as number | undefined) ?? (SETTINGS[key].default as number)
    );
  }

  /**
   * What the print sheets of the sales documents show, for EVERY signed-in
   * role (read-only, nothing else of the settings): the legal identity, the
   * days to pay an invoice (the due-date hint) and the eggs of a tray.
   */
  async documents(ctx: RequestContext): Promise<DocumentSettings> {
    const all = await this.getAll(ctx);
    return {
      legal: all.legal as Legal,
      invoiceDueDays: all.invoiceDueDays as number,
      eggsPerTray: all.eggsPerTray as number,
    };
  }

  async set(
    ctx: RequestContext,
    key: string,
    raw: unknown,
  ): Promise<{ key: string; value: SettingValue }> {
    if (!Object.hasOwn(SETTINGS, key)) {
      throw new BadRequestException('Paramètre inconnu');
    }
    const value = SETTINGS[key].parse(raw);
    const organizationId = ctx.user.organizationId;
    await this.prisma.setting.upsert({
      where: { organizationId_key: { organizationId, key } },
      update: { value },
      create: { organizationId, key, value },
    });
    return { key, value };
  }
}
