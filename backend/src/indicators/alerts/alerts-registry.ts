import { Injectable } from '@nestjs/common';
import type { RequestContext } from '../../access/decorators';
import {
  ALERT_LEVEL_ORDER,
  type AlertItem,
  type AlertRule,
  type AlertSettings,
} from './alert.types';

/** Modules add their alert rules here; `dashboard` reads the open alerts without importing them. */
@Injectable()
export class AlertsRegistry {
  private readonly rules: AlertRule[] = [];

  register(rule: AlertRule): void {
    if (!this.rules.includes(rule)) this.rules.push(rule);
  }

  /** URGENT first, then by rule registration order, then by key. */
  async run(
    ctx: RequestContext,
    settings: AlertSettings,
  ): Promise<AlertItem[]> {
    const perRule = await Promise.all(
      this.rules.map((rule) => rule(ctx, settings)),
    );
    const flat = perRule.flatMap((items, order) =>
      [...items]
        .sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))
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
