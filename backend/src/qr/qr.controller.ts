import { Body, Controller, Get, HttpCode, Param, Post } from '@nestjs/common';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { AnyAuthenticated, Ctx, NoFarm } from '../access/decorators';
import type { RequestContext } from '../access/decorators';
import { QrLabelsDto, QrLabelsResponseDto, QrTargetDto } from './dto/qr.dto';
import { QrService } from './qr.service';

/**
 * Any signed-in user may ask; what he gets depends on the record (its farm, its module): the service
 * answers one 404 for « missing » and « forbidden ». Not farm-scoped: a QR scanned in another farm
 * resolves to that farm so the app can switch to it.
 */
@ApiTags('qr')
@Controller('qr')
@NoFarm()
export class QrController {
  constructor(private readonly qr: QrService) {}

  @Post('labels')
  @HttpCode(200)
  @AnyAuthenticated()
  @ApiOkResponse({ type: QrLabelsResponseDto })
  async labels(
    @Ctx() ctx: RequestContext,
    @Body() dto: QrLabelsDto,
  ): Promise<QrLabelsResponseDto> {
    return { labels: await this.qr.labels(ctx, dto.kind, dto.ids) };
  }

  @Get(':kind/:id')
  @AnyAuthenticated()
  @ApiOkResponse({ type: QrTargetDto })
  resolve(
    @Ctx() ctx: RequestContext,
    @Param('kind') kind: string,
    @Param('id') id: string,
  ): Promise<QrTargetDto> {
    return this.qr.resolve(ctx, kind, id);
  }
}
