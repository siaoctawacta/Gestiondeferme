import { Injectable } from '@nestjs/common';
import type { RequestContext } from '../../access/decorators';
import { SourceRegistry } from '../../common/source-registry';
import { can } from '../../access/permissions';
import {
  ALERT_LEVEL_ORDER,
  type AlertRank,
  type AlertItem,
  type AlertRule,
  type AlertSettings,
} from './alert.types';

interface RankedRule {
  rule: AlertRule;
  rank: AlertRank;
}

/** Modules add their alert rules here; `dashboard` reads the open alerts without importing them. */
@Injectable()
export class AlertsRegistry extends SourceRegistry<RankedRule> {
  constructor() {
    super('alertes');
  }

  /** A rule and its module's place among the others (`ALERT_RANK`); registering a rule twice keeps one entry. */
  addRule(rule: AlertRule, rank: AlertRank): void {
    const known = this.all().find((e) => e.rule === rule);
    if (!known) super.register({ rule, rank });
  }

  /**
   * Only the alerts whose modules the caller's role can all read (an alert
   * names sow tags, lot mortality, feed anomalies: data a role without the
   * module may not see) and that name at least one module (an alert with none
   * is shown to no one). URGENT first, then by the rank of the rule's module
   * (never by module initialisation order), then by registration order between
   * rules of one rank, then in the order the rule returned them: each rule
   * ranks its own alerts.
   */
  async run(
    ctx: RequestContext,
    settings: AlertSettings,
  ): Promise<AlertItem[]> {
    const rules = this.all();
    const perRule = await Promise.all(rules.map((e) => e.rule(ctx, settings)));
    const flat = perRule.flatMap((items, order) =>
      items
        .filter(
          (item) =>
            item.modules.length > 0 &&
            item.modules.every((m) => can(ctx.user.role, m, 'read')),
        )
        .map((item) => ({
          item,
          order,
          rank: rules[order].rank,
        })),
    );
    return flat
      .sort(
        (a, b) =>
          ALERT_LEVEL_ORDER.indexOf(a.item.level) -
            ALERT_LEVEL_ORDER.indexOf(b.item.level) ||
          a.rank - b.rank ||
          a.order - b.order,
      )
      .map((entry) => entry.item);
  }
}
