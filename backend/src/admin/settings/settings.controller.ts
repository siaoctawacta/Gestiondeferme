import { Body, Controller, Get, Param, Put } from '@nestjs/common';
import { ApiProperty, ApiTags } from '@nestjs/swagger';
import { IsDefined } from 'class-validator';
import {
  AnyAuthenticated,
  Ctx,
  NoFarm,
  RequirePermission,
} from '../../access/decorators';
import type { RequestContext } from '../../access/decorators';
import { Audited } from '../../audit/audited.decorator';
import { SettingsService } from './settings.service';

class SettingValueDto {
  @ApiProperty({
    description: 'Number, string or object, depending on the key',
  })
  @IsDefined({ message: 'La valeur est requise' })
  value!: unknown;
}

@ApiTags('settings')
@NoFarm()
@Controller('settings')
export class SettingsController {
  constructor(private readonly settings: SettingsService) {}

  @Get()
  @RequirePermission('parametres', 'read')
  getAll(@Ctx() ctx: RequestContext) {
    return this.settings.getAll(ctx);
  }

  /** The legal identity and the two figures the documents print, for every signed-in role: nothing else of the settings. */
  @Get('documents')
  @AnyAuthenticated()
  documents(@Ctx() ctx: RequestContext) {
    return this.settings.documents(ctx);
  }

  @Put(':key')
  @RequirePermission('parametres', 'update')
  @Audited('parametres', { label: (r) => (r as { key: string }).key })
  set(
    @Ctx() ctx: RequestContext,
    @Param('key') key: string,
    @Body() dto: SettingValueDto,
  ) {
    return this.settings.set(ctx, key, dto.value);
  }
}
