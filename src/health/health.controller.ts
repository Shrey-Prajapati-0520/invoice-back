import { Controller, Get } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { SupabaseService } from '../supabase.service';

/**
 * Health checks for hosted environments (load balancers, orchestrators).
 * Stateless – no session or in-memory state required.
 */
@Controller('health')
@SkipThrottle()
export class HealthController {
  constructor(private readonly supabase: SupabaseService) {}

  /** Liveness – process is running. */
  @Get('live')
  live() {
    return { status: 'ok', timestamp: new Date().toISOString() };
  }

  /** Readiness – can accept traffic (DB reachable). */
  @Get('ready')
  async ready() {
    try {
      const client = this.supabase.getClient();
      const { error } = await client.from('profiles').select('id').limit(1);
      if (error) {
        return { status: 'degraded', db: 'error', message: error.message };
      }
      // Verify verification_status has pan_number column (required for PAN verification)
      const { error: vsError } = await client.from('verification_status').select('pan_number, pan_holder_name, gstin_number').limit(1);
      if (vsError) {
        const hint = vsError.message?.includes('does not exist') || vsError.message?.includes('pan_number')
          ? ' Run supabase/verification-status-pan-gstin-columns.sql in Supabase SQL Editor'
          : '';
        return {
          status: 'degraded',
          db: 'connected',
          message: `verification_status: ${vsError.message}${hint}`,
        };
      }
    } catch (e) {
      return {
        status: 'unhealthy',
        db: 'unreachable',
        message: e instanceof Error ? e.message : 'Unknown error',
      };
    }
    return { status: 'ok', db: 'connected', timestamp: new Date().toISOString() };
  }
}
