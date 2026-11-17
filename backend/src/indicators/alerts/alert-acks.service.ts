import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import type { AlertItem, AlertLevel } from './alert.types';
import { hides } from './alert-acks';

/**
 * « Masquer l'alerte »: a per-user display preference. An acknowledgement never changes what another
 * user sees, is not audited, and costs ONE query on a list of alerts whatever their number.
 */
@Injectable()
export class AlertAcksService {
  constructor(private readonly prisma: PrismaService) {}

  /** The clock; a test replaces it. */
  now: () => Date = () => new Date();

  /** The keys, among `items`, this user has hidden (one query). */
  async hiddenKeys(
    userId: string,
    items: AlertItem[],
    days: number,
  ): Promise<Set<string>> {
    if (items.length === 0) return new Set();
    const acks = await this.prisma.alertAck.findMany({
      where: { userId, key: { in: items.map((i) => i.key) } },
    });
    const now = this.now();
    const level = new Map(items.map((i) => [i.key, i.level]));
    return new Set(
      acks
        .filter((a) => hides(a, level.get(a.key) as AlertLevel, now, days))
        .map((a) => a.key),
    );
  }

  /** Hides the alert for this user; a repeat while it is still hidden changes nothing. */
  async acknowledge(
    userId: string,
    item: Pick<AlertItem, 'key' | 'level'>,
    days: number,
  ): Promise<void> {
    const now = this.now();
    const where = { userId_key: { userId, key: item.key } };
    const existing = await this.prisma.alertAck.findUnique({ where });
    if (existing && hides(existing, item.level, now, days)) return;
    await this.prisma.alertAck.upsert({
      where,
      create: {
        userId,
        key: item.key,
        level: item.level,
        acknowledgedAt: now,
      },
      update: { level: item.level, acknowledgedAt: now },
    });
  }

  async unacknowledge(userId: string, key: string): Promise<void> {
    await this.prisma.alertAck.deleteMany({ where: { userId, key } });
  }
}
