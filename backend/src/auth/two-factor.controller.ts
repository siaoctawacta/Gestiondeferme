import {
  Body,
  Controller,
  HttpCode,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { ThrottlerGuard } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import type { TokenStage } from '../access/access-token';
import {
  AllowStage,
  AnyAuthenticated,
  Ctx,
  NoFarm,
  Stage,
} from '../access/decorators';
import type { RequestContext } from '../access/decorators';
import { DisableTwoFactorDto, TwoFactorCodeDto } from './dto/two-factor.dto';
import { TwoFactorService } from './two-factor.service';

@ApiTags('auth')
@AnyAuthenticated()
@NoFarm()
@UseGuards(ThrottlerGuard)
@Controller('auth/2fa')
export class TwoFactorController {
  constructor(private readonly twoFactor: TwoFactorService) {}

  @AllowStage('setup', 'full')
  @Post('setup')
  setup(@Ctx() ctx: RequestContext) {
    return this.twoFactor.setup(ctx.user.id);
  }

  @AllowStage('setup', 'full')
  @Post('enable')
  enable(
    @Ctx() ctx: RequestContext,
    @Stage() stage: TokenStage,
    @Body() dto: TwoFactorCodeDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    return this.twoFactor.enable(ctx.user.id, dto.code, stage, res);
  }

  @AllowStage('2fa')
  @HttpCode(200)
  @Post('verify')
  verify(
    @Ctx() ctx: RequestContext,
    @Body() dto: TwoFactorCodeDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    return this.twoFactor.verify(ctx.user.id, dto.code, req, res);
  }

  @HttpCode(204)
  @Post('disable')
  async disable(
    @Ctx() ctx: RequestContext,
    @Body() dto: DisableTwoFactorDto,
  ): Promise<void> {
    await this.twoFactor.disable(ctx.user.id, dto.password, dto.code);
  }
}
