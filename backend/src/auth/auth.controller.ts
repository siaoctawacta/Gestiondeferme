import {
  Body,
  Controller,
  Get,
  HttpCode,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { ThrottlerGuard } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { AnyAuthenticated, Ctx, NoFarm, Public } from '../access/decorators';
import type { RequestContext } from '../access/decorators';
import { AuthService } from './auth.service';
import { ChangePasswordDto } from './dto/change-password.dto';
import { LoginDto } from './dto/login.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { TokensService } from './tokens.service';

@ApiTags('auth')
@NoFarm()
@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly tokens: TokensService,
  ) {}

  @Public()
  @UseGuards(ThrottlerGuard)
  @HttpCode(200)
  @Post('login')
  login(
    @Body() dto: LoginDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    return this.auth.login(dto.email, dto.password, req, res);
  }

  /** Authenticated by the httpOnly refresh cookie, not by a bearer token. */
  @Public()
  @HttpCode(200)
  @Post('refresh')
  refresh(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    return this.tokens.rotate(req, res);
  }

  /** Public so an expired access token never prevents signing out. */
  @Public()
  @HttpCode(204)
  @Post('logout')
  async logout(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<void> {
    await this.auth.logout(req, res);
  }

  @AnyAuthenticated()
  @Get('me')
  me(@Ctx() ctx: RequestContext) {
    return this.auth.me(ctx.user.id);
  }

  @AnyAuthenticated()
  @UseGuards(ThrottlerGuard)
  @HttpCode(204)
  @Post('change-password')
  async changePassword(
    @Ctx() ctx: RequestContext,
    @Body() dto: ChangePasswordDto,
    @Req() req: Request,
  ): Promise<void> {
    await this.auth.changePassword(
      ctx.user.id,
      dto.currentPassword,
      dto.newPassword,
      req,
    );
  }

  @Public()
  @UseGuards(ThrottlerGuard)
  @HttpCode(204)
  @Post('reset-password')
  async resetPassword(@Body() dto: ResetPasswordDto): Promise<void> {
    await this.auth.resetPassword(dto.token, dto.newPassword);
  }
}
