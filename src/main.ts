import { NestFactory } from '@nestjs/core';
import { json } from 'express';
import * as dns from 'dns';
import { AppModule } from './app.module';
import { HttpExceptionFilter } from './common/http-exception.filter';
import { ThrottlerExceptionFilter } from './common/throttler-exception.filter';

// Prefer IPv4 for SMTP (fixes ENETUNREACH when IPv6 is unavailable)
if (dns.setDefaultResultOrder) {
  dns.setDefaultResultOrder('ipv4first');
}

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  // Allow larger payloads for avatar upload (base64 ~33% larger than binary)
  app.use(json({ limit: '8mb' }));
  app.useGlobalFilters(new ThrottlerExceptionFilter(), new HttpExceptionFilter());
  app.enableCors({ origin: true, credentials: true });
  const port = Number(process.env.PORT) || 3000;
  await app.listen(port, '0.0.0.0');
  console.log(`Application listening on port ${port}`);
}

bootstrap().catch((err) => {
  console.error('Bootstrap failed:', err);
  process.exit(1);
});
