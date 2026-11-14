import { INestApplication, ValidationPipe } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import cookieParser from 'cookie-parser';
import type { NextFunction, Request, Response } from 'express';
import helmet from 'helmet';
import { assertEncryptionKey } from './auth/crypto';

/** Fail-fast check; also rejects the placeholder shipped in .env.example. */
export function assertJwtSecret(secret: string | undefined): void {
  if (!secret || secret.length < 32) {
    throw new Error('JWT_SECRET must be set and at least 32 characters long');
  }
  if (secret.startsWith('change-me')) {
    throw new Error(
      'JWT_SECRET is still the placeholder: generate a real one (openssl rand -base64 48)',
    );
  }
}

/** Swagger UI is always on outside production; in production only when explicitly enabled. */
export function apiDocsEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.NODE_ENV !== 'production' || env.ENABLE_API_DOCS === 'true';
}

/** Shared by main.ts and the e2e test app so both behave identically. */
export function configureApp(app: INestApplication): void {
  assertJwtSecret(process.env.JWT_SECRET);
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
  // This is an API, never a page to index (applies to every response, errors included).
  app.use((_req: Request, res: Response, next: NextFunction) => {
    res.setHeader('X-Robots-Tag', 'noindex, nofollow');
    next();
  });
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

  if (!apiDocsEnabled()) return;
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
