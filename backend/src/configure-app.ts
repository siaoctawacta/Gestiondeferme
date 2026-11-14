import { INestApplication, ValidationPipe } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { assertEncryptionKey } from './auth/crypto';

/** Shared by main.ts and the e2e test app so both behave identically. */
export function configureApp(app: INestApplication): void {
  const secret = process.env.JWT_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error('JWT_SECRET must be set and at least 32 characters long');
  }
  assertEncryptionKey();
  const webOrigin = process.env.WEB_ORIGIN;
  if (!webOrigin) {
    throw new Error('WEB_ORIGIN must be set (CORS never allows any origin)');
  }
  const trustProxy = process.env.TRUST_PROXY;
  if (trustProxy) {
    const value =
      trustProxy === 'true'
        ? true
        : /^\d+$/.test(trustProxy)
          ? Number(trustProxy)
          : trustProxy;
    (app as NestExpressApplication).set('trust proxy', value);
  }
  app.setGlobalPrefix('api');
  app.use(helmet());
  app.use(cookieParser());
  app.enableCors({
    origin: webOrigin,
    credentials: true,
  });
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  const config = new DocumentBuilder()
    .setTitle('AgriPilot API')
    .setDescription('Ferme avicole & porcine')
    .setVersion('1.0')
    .addBearerAuth()
    .build();
  SwaggerModule.setup(
    'api/docs',
    app,
    SwaggerModule.createDocument(app, config),
  );
}
