import { Injectable, NestMiddleware } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';

/**
 * Enforces HTTPS in production when behind a reverse proxy (Railway, Nginx, etc.)
 * Trust X-Forwarded-Proto. If request came over HTTP, redirect to HTTPS.
 */
@Injectable()
export class HttpsRedirectMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction): void {
    if (process.env.NODE_ENV !== 'production') {
      return next();
    }
    const proto = req.headers['x-forwarded-proto'] as string | undefined;
    if (proto === 'https') {
      return next();
    }
    if (proto === 'http') {
      const host = req.headers['x-forwarded-host'] || req.headers.host || '';
      const url = `https://${host}${req.originalUrl}`;
      res.redirect(301, url);
      return;
    }
    next();
  }
}
