import { Module } from '@nestjs/common';
import { ThrottlerModule } from '@nestjs/throttler';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { TokensService } from './tokens.service';

@Module({
  imports: [
    // 10 requests per minute per IP on the routes that apply ThrottlerGuard.
    // Skipped under NODE_ENV=test so the e2e suite is not throttled; the
    // throttle spec opts back in with THROTTLE_IN_TEST=1.
    ThrottlerModule.forRoot({
      throttlers: [{ ttl: 60_000, limit: 10 }],
      skipIf: () =>
        process.env.NODE_ENV === 'test' && process.env.THROTTLE_IN_TEST !== '1',
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, TokensService],
  exports: [TokensService],
})
export class AuthModule {}
