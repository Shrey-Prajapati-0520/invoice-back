import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpStatus,
} from '@nestjs/common';
import { ThrottlerException } from '@nestjs/throttler';
import { Request, Response } from 'express';
import { AuditLogService } from './audit-log.service';

function getClientIp(req: Request): string | undefined {
  const ff = req.headers?.['x-forwarded-for'];
  if (typeof ff === 'string') return ff.split(',')[0]?.trim();
  if (Array.isArray(ff) && ff[0]) return String(ff[0]).split(',')[0]?.trim();
  return undefined;
}

/**
 * Ensures rate limit (429) responses are returned as JSON.
 * Audit-logs rate limit events as suspicious traffic for security monitoring.
 */
@Catch(ThrottlerException)
export class ThrottlerExceptionFilter implements ExceptionFilter {
  constructor(private readonly audit: AuditLogService) {}

  catch(exception: ThrottlerException, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    if (this.audit) {
      this.audit.log({
        type: 'rate_limit',
        path: request?.url ?? request?.path ?? 'unknown',
        method: request?.method ?? 'UNKNOWN',
        ip: getClientIp(request),
        ua: request?.headers?.['user-agent'],
      });
    }

    response.status(HttpStatus.TOO_MANY_REQUESTS).json({
      statusCode: HttpStatus.TOO_MANY_REQUESTS,
      message: 'Too many requests. Please try again later.',
      error: 'Too Many Requests',
    });
  }
}
