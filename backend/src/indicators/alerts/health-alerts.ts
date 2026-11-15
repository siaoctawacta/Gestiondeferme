import type { RequestContext } from '../../access/decorators';
import { signedDaysBetween, today } from '../../common/days';
import type { Species } from '../../generated/prisma/enums';
import { speciesModule } from '../../herd/species';
import { ALERT_LEVEL_ORDER } from './alert.types';
import type {
  AlertItem,
  AlertModules,
  AlertRule,
  AlertSettings,
} from './alert.types';

/** A planned health act, as the alert rules see it. */
export interface HealthActAlert {
  id: string;
  type: 'VACCINATION' | 'TRAITEMENT' | 'DESINFECTION';
  /** The planned date, `YYYY-MM-DD`. */
  date: string;
  /** Lot code, animal tag or building name. */
  target: string;
  /** Species of the lot or animal; absent for a building. */
  species?: Species;
  productName: string | null;
}

/**
 * What the rules read; the health alerts service implements it with the same
 * `EN_RETARD` derivation as the health list (planned, dated before today, on
 * an open lot or a live animal).
 */
export interface HealthAlertData {
  /** Overdue vaccinations plus those planned up to `days` days from `now`. */
  vaccinations(
    ctx: RequestContext,
    now: Date,
    days: number,
  ): Promise<HealthActAlert[]>;
  /** Overdue treatments and disinfections. */
  lateActs(ctx: RequestContext, now: Date): Promise<HealthActAlert[]>;
}

const compare = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** `sante`, plus the species module of the lot or animal the act is on. */
const modulesOf = (act: HealthActAlert): AlertModules =>
  act.species ? ['sante', speciesModule(act.species)] : ['sante'];

const detailOf = (act: HealthActAlert, suffix = ''): string =>
  `${[act.target, act.productName].filter(Boolean).join(' — ')}${suffix}`;

/** URGENT first, then by planned date, target and id. */
function ranked(
  items: { act: HealthActAlert; alert: AlertItem }[],
): AlertItem[] {
  return items
    .sort(
      (a, b) =>
        ALERT_LEVEL_ORDER.indexOf(a.alert.level) -
          ALERT_LEVEL_ORDER.indexOf(b.alert.level) ||
        compare(a.act.date, b.act.date) ||
        compare(a.act.target, b.act.target) ||
        compare(a.act.id, b.act.id),
    )
    .map((i) => i.alert);
}

/**
 * A planned vaccination dated before today is `Vaccination en retard`
 * (URGENT); one dated from today up to and including `vaccinationWarningDays`
 * days ahead, `Vaccination à venir` (A_VOIR).
 */
export function vaccinationAlerts(
  acts: HealthActAlert[],
  settings: AlertSettings,
  now: Date,
): AlertItem[] {
  const start = today(now);
  const items: { act: HealthActAlert; alert: AlertItem }[] = [];
  for (const act of acts) {
    if (act.type !== 'VACCINATION') continue;
    const days = signedDaysBetween(start, new Date(act.date));
    const base = {
      key: `vaccination:${act.id}`,
      module: 'sante' as const,
      modules: modulesOf(act),
    };
    if (days < 0) {
      items.push({
        act,
        alert: {
          ...base,
          title: 'Vaccination en retard',
          detail: detailOf(act),
          level: 'URGENT',
        },
      });
    } else if (days <= settings.vaccinationWarningDays) {
      items.push({
        act,
        alert: {
          ...base,
          title: 'Vaccination à venir',
          detail: detailOf(act, ` (${act.date})`),
          level: 'A_VOIR',
        },
      });
    }
  }
  return ranked(items);
}

/**
 * `Désinfection en retard` and `Traitement en retard` (A_VOIR): planned and
 * dated before today. A disinfection tolerates `biosecurityWarningDays` days
 * of delay before it is reported (0 by default: late from the day after).
 */
export function otherHealthAlerts(
  acts: HealthActAlert[],
  settings: AlertSettings,
  now: Date,
): AlertItem[] {
  const start = today(now);
  const items: { act: HealthActAlert; alert: AlertItem }[] = [];
  for (const act of acts) {
    if (act.type === 'VACCINATION') continue;
    const late = -signedDaysBetween(start, new Date(act.date));
    const tolerated =
      act.type === 'DESINFECTION' ? settings.biosecurityWarningDays : 0;
    if (late <= tolerated) continue;
    items.push({
      act,
      alert: {
        key: `health:${act.id}`,
        title:
          act.type === 'DESINFECTION'
            ? 'Désinfection en retard'
            : 'Traitement en retard',
        detail: detailOf(act),
        level: 'A_VOIR',
        module: 'sante',
        modules: modulesOf(act),
      },
    });
  }
  return ranked(items);
}

/** The rules, in the order they rank: vaccinations, then the other late acts. */
export function healthAlertRules(
  data: HealthAlertData,
  now: () => Date = () => new Date(),
): AlertRule[] {
  return [
    async (ctx, settings) => {
      const at = now();
      return vaccinationAlerts(
        await data.vaccinations(ctx, at, settings.vaccinationWarningDays),
        settings,
        at,
      );
    },
    async (ctx, settings) => {
      const at = now();
      return otherHealthAlerts(await data.lateActs(ctx, at), settings, at);
    },
  ];
}
