import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { AuditLogService } from './audit-log.service';

function getClientIp(req: Request): string | undefined {
  const ff = req.headers?.['x-forwarded-for'];
  if (typeof ff === 'string') return ff.split(',')[0]?.trim();
  if (Array.isArray(ff) && ff[0]) return String(ff[0]).split(',')[0]?.trim();
  return undefined;
}

function getUserId(req: Request): string | undefined {
  const u = (req as Request & { user?: { id?: string } }).user;
  return u?.id;
}

/**
 * Global exception filter – prevents unhandled errors from crashing the app.
 * Logs errors and returns safe JSON responses. Audit-logs API errors for security.
 */
@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name);

  constructor(private readonly audit: AuditLogService) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let message = 'Internal server error';
    let error = 'Internal Server Error';

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const res = exception.getResponse();
      if (typeof res === 'object' && res !== null) {
        const msg =
          (res as { message?: string | string[] }).message ??
          (res as { error?: string }).error ??
          message;
        message = Array.isArray(msg) ? msg[0] ?? message : msg;
        error = (res as { error?: string }).error ?? exception.name;
      } else {
        message = String(res);
      }
    } else if (exception instanceof Error) {
      message = exception.message;
      this.logger.error(
        `Unhandled error: ${exception.message}`,
        exception.stack,
      );
    }

    if (status >= 400) {
      this.audit.log({
        type: 'api_error',
        status,
        path: request?.url ?? request?.path ?? 'unknown',
        method: request?.method ?? 'UNKNOWN',
        ip: getClientIp(request),
        ua: request?.headers?.['user-agent'],
        userId: getUserId(request),
        msg: status >= 500 ? message : undefined,
      });
    }

    try {
      response.status(status).json({
        statusCode: status,
        error,
        message,
        timestamp: new Date().toISOString(),
        path: request?.url,
      });
    } catch {
      this.logger.error('Failed to send error response');
    }
  }
}
