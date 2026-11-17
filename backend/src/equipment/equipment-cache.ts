import { formatDay, parseDay } from '../common/days';
import type { Prisma } from '../generated/prisma/client';
import { nextMaintenance } from './equipment-state';

/**
 * Recomputes `Equipment.nextMaintenanceDate` from the interventions and stores
 * it. The caller holds the equipment row lock (every intervention write and
 * every change of the interval or of the first date does).
 */
export async function refreshNextMaintenance(
  tx: Prisma.TransactionClient,
  equipmentId: string,
): Promise<void> {
  const equipment = await tx.equipment.findUniqueOrThrow({
    where: { id: equipmentId },
    select: {
      firstMaintenanceDate: true,
      maintenanceIntervalDays: true,
      maintenances: { select: { date: true, nextDate: true, createdAt: true } },
    },
  });
  const next = nextMaintenance(
    {
      firstMaintenanceDate: equipment.firstMaintenanceDate
        ? formatDay(equipment.firstMaintenanceDate)
        : null,
      maintenanceIntervalDays: equipment.maintenanceIntervalDays,
    },
    equipment.maintenances.map((m) => ({
      date: formatDay(m.date),
      nextDate: m.nextDate ? formatDay(m.nextDate) : null,
      createdAt: m.createdAt,
    })),
  );
  await tx.equipment.update({
    where: { id: equipmentId },
    data: { nextMaintenanceDate: next ? parseDay(next) : null },
  });
}
