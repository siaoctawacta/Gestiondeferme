import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { BuildingsController } from './buildings/buildings.controller';
import { BuildingsService } from './buildings/buildings.service';
import { FarmsController } from './farms/farms.controller';
import { FarmsService } from './farms/farms.service';
import { SettingsController } from './settings/settings.controller';
import { SettingsService } from './settings/settings.service';
import { SitesController } from './sites/sites.controller';
import { SitesService } from './sites/sites.service';
import { UsersController } from './users/users.controller';
import { UsersService } from './users/users.service';
import { ZonesController } from './zones/zones.controller';
import { ZonesService } from './zones/zones.service';

@Module({
  imports: [AuthModule],
  controllers: [
    FarmsController,
    SitesController,
    BuildingsController,
    ZonesController,
    UsersController,
    SettingsController,
  ],
  providers: [
    FarmsService,
    SitesService,
    BuildingsService,
    ZonesService,
    UsersService,
    SettingsService,
  ],
  exports: [BuildingsService],
})
export class AdminModule {}
