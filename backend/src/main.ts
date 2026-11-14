import { config } from 'dotenv';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { TokensService } from './auth/tokens.service';
import { configureApp } from './configure-app';

config({ quiet: true });

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  configureApp(app);
  app.enableShutdownHooks();
  await app.get(TokensService).purgeExpired();
  await app.listen(process.env.PORT ?? 3000);
}
void bootstrap();
