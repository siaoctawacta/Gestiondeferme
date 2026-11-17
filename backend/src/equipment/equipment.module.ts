import { Module } from '@nestjs/common';
import { AdminModule } from '../admin/admin.module';
import { FinanceModule } from '../finance/finance.module';
import { IndicatorsModule } from '../indicators/indicators.module';
import { EquipmentAlertsService } from './equipment-alerts.service';
import { EquipmentController } from './equipment.controller';
import { EquipmentReads } from './equipment-reads.service';
import { EquipmentService } from './equipment.service';
import { MaintenanceController } from './maintenance.controller';
import { MaintenanceService } from './maintenance.service';

/**
 * Equipment, its interventions and breakdowns. Registers the breakdown and
 * maintenance alert rules in `IndicatorsModule`'s registry; reads the
 * maintenance expenses back from the finance ledger view (`FinanceLedger`);
 * the cost itself is written nowhere but the intervention.
 */
@Module({
  imports: [AdminModule, FinanceModule, IndicatorsModule],
  controllers: [EquipmentController, MaintenanceController],
  providers: [
    EquipmentService,
    MaintenanceService,
    EquipmentAlertsService,
    EquipmentReads,
  ],
  exports: [EquipmentReads],
})
export class EquipmentModule {}
