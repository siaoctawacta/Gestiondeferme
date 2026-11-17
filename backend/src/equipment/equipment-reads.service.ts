import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

/**
 * The equipment figures other modules read (the reports): each is one count
 * over the farms given, whatever the number of rows.
 */
@Injectable()
export class EquipmentReads {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * `breakdowns` declared and `interventions` made between two days (both
   * inclusive), and the equipment in service that is out of order now (the
   * state is today's, whatever the period).
   */
  async periodFigures(
    farmIds: string[],
    from: Date,
    to: Date,
  ): Promise<{ breakdowns: number; interventions: number; broken: number }> {
    const farmId = { in: farmIds };
    const date = { gte: from, lte: to };
    const [breakdowns, interventions, broken] = await Promise.all([
      this.prisma.breakdown.count({ where: { farmId, date } }),
      this.prisma.maintenance.count({ where: { farmId, date } }),
      this.prisma.equipment.count({
        where: { farmId, condition: 'EN_PANNE', retiredAt: null },
      }),
    ]);
    return { breakdowns, interventions, broken };
  }
}
