import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { json } from 'express';
import helmet from 'helmet';
import * as dns from 'dns';
import { AppModule } from './app.module';
import { HttpExceptionFilter } from './common/http-exception.filter';
import { ThrottlerExceptionFilter } from './common/throttler-exception.filter';
import { HttpsRedirectMiddleware } from './common/security.middleware';

// Prefer IPv4 for SMTP (fixes ENETUNREACH when IPv6 is unavailable)
if (dns.setDefaultResultOrder) {
  dns.setDefaultResultOrder('ipv4first');
}

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  app.set('trust proxy', 1);
  if (process.env.NODE_ENV === 'production') {
    const mw = new HttpsRedirectMiddleware();
    app.use((req, res, next) => mw.use(req, res, next));
  }
  app.use(
    helmet({
      contentSecurityPolicy: false,
      crossOriginEmbedderPolicy: false,
    }),
  );
  app.use(json({ limit: '8mb' }));
  app.enableCors({ origin: true, credentials: true });
  const port = Number(process.env.PORT) || 3000;
  await app.listen(port, '0.0.0.0');
  console.log(`Application listening on port ${port}`);
}

bootstrap().catch((err) => {
  console.error('Bootstrap failed:', err);
  process.exit(1);
});
