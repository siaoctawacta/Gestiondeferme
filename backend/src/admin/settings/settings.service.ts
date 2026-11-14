import { BadRequestException, Injectable } from '@nestjs/common';
import type { RequestContext } from '../../access/decorators';
import { PrismaService } from '../../prisma/prisma.service';

const LEGAL_FIELDS = ['name', 'address', 'nif', 'rccm'] as const;
type Legal = Record<(typeof LEGAL_FIELDS)[number], string>;
type SettingValue = number | string | Legal;

const positiveNumber =
  (label: string) =>
  (value: unknown): number => {
    if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
      throw new BadRequestException(
        `${label} doit être un nombre supérieur à 0`,
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
    parse: positiveNumber('Le seuil de mortalité journalière'),
  },
  mortalityCumulPct: {
    default: 3,
    parse: positiveNumber('Le seuil de mortalité cumulée'),
  },
  consumptionDeviationPct: {
    default: 25,
    parse: positiveNumber("L'écart de consommation"),
  },
  expiryWarningDays: {
    default: 30,
    parse: positiveNumber("Le délai d'alerte de péremption"),
  },
  farrowingWarningDays: {
    default: 7,
    parse: positiveNumber("Le délai d'alerte de mise bas"),
  },
  gestationDays: {
    default: 114,
    parse: positiveNumber('La durée de gestation'),
  },
  legal: {
    default: { name: '', address: '', nif: '', rccm: '' },
    parse: legal,
  },
};

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
