import { Injectable } from '@nestjs/common';
import type { RequestContext } from '../../access/decorators';
import { SourceRegistry } from '../../common/source-registry';
import { can } from '../../access/permissions';
import {
  ALERT_LEVEL_ORDER,
  type AlertItem,
  type AlertRule,
  type AlertSettings,
} from './alert.types';

/** Modules add their alert rules here; `dashboard` reads the open alerts without importing them. */
@Injectable()
export class AlertsRegistry extends SourceRegistry<AlertRule> {
  constructor() {
    super('alertes');
  }

  /**
   * Only the alerts whose modules the caller's role can all read (an alert
   * names sow tags, lot mortality, feed anomalies: data a role without the
   * module may not see) and that name at least one module (an alert with none
   * is shown to no one). URGENT first, then by rule registration order, then
   * in the order the rule returned them: each rule ranks its own alerts.
   */
  async run(
    ctx: RequestContext,
    settings: AlertSettings,
  ): Promise<AlertItem[]> {
    const perRule = await Promise.all(
      this.all().map((rule) => rule(ctx, settings)),
    );
    const flat = perRule.flatMap((items, order) =>
      items
        .filter(
          (item) =>
            item.modules.length > 0 &&
            item.modules.every((m) => can(ctx.user.role, m, 'read')),
        )
        .map((item) => ({ item, order })),
    );
    return flat
      .sort(
        (a, b) =>
          ALERT_LEVEL_ORDER.indexOf(a.item.level) -
            ALERT_LEVEL_ORDER.indexOf(b.item.level) || a.order - b.order,
      )
      .map((entry) => entry.item);
  }
}
