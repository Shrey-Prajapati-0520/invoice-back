import {
  WebSocketGateway,
  WebSocketServer,
  OnGatewayConnection,
  OnGatewayDisconnect,
  OnGatewayInit,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { Logger } from '@nestjs/common';
import { createClient } from '@supabase/supabase-js';
import { ConfigService } from '@nestjs/config';
import { normalizePhone } from '../recipient.util';

/** Maps socket id -> Set of rooms (recipient phones or user ids) */
const socketRooms = new Map<string, Set<string>>();

/**
 * Realtime invoice delivery gateway.
 * - User B subscribes by phone (and optionally user_id) when connecting.
 * - When User A creates invoice for User B's phone → emit new_invoice to that room.
 * - Stateless: rooms stored in memory per process; use Redis adapter for multi-instance.
 */
@WebSocketGateway({
  cors: { origin: true, credentials: true },
  path: '/invoice-socket',
  transports: ['websocket', 'polling'],
})
export class InvoiceRealtimeGateway
  implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect
{
  @WebSocketServer()
  server!: Server;

  private readonly logger = new Logger(InvoiceRealtimeGateway.name);

  constructor(private readonly config: ConfigService) {}

  afterInit(): void {
    this.logger.log('Invoice WebSocket gateway initialized');
  }

  async handleConnection(client: Socket): Promise<void> {
    try {
      const token = client.handshake?.auth?.token ?? client.handshake?.query?.token;
      const phone = (client.handshake?.query?.phone ?? '').toString().trim();
      const userId = (client.handshake?.query?.user_id ?? '').toString().trim();

      if (!token && !phone) {
        this.logger.warn(`Client ${client.id} connected without auth or phone`);
        return;
      }

      let resolvedPhone: string | null = null;
      let resolvedUserId: string | null = userId || null;

      if (token) {
        const url = this.config.get<string>('SUPABASE_URL');
        const anonKey = this.config.get<string>('SUPABASE_ANON_KEY');
        if (url && anonKey) {
          try {
            const supabase = createClient(url, anonKey);
            const { data: { user }, error } = await supabase.auth.getUser(token);
            if (!error && user) {
              resolvedUserId = user.id;
              const meta = user.user_metadata as { phone?: string } | undefined;
              resolvedPhone = phone || (meta?.phone ? normalizePhone(meta.phone) : null);
              if (!resolvedPhone) {
                const { data: profile } = await supabase
                  .from('profiles')
                  .select('phone')
                  .eq('id', user.id)
                  .single();
                resolvedPhone = (profile as { phone?: string } | null)?.phone
                  ? normalizePhone((profile as { phone: string }).phone)
                  : null;
              }
            }
          } catch (e) {
            this.logger.warn(`Auth failed for client ${client.id}: ${e instanceof Error ? e.message : 'Unknown'}`);
          }
        }
      }

      if (phone && !resolvedPhone) {
        resolvedPhone = normalizePhone(phone);
      }

      const rooms = new Set<string>();
      if (resolvedPhone && resolvedPhone.length >= 10) {
        const room = `invoice:phone:${resolvedPhone}`;
        client.join(room);
        rooms.add(room);
      }
      if (resolvedUserId) {
        const room = `invoice:user:${resolvedUserId}`;
        client.join(room);
        rooms.add(room);
      }

      if (rooms.size > 0) {
        socketRooms.set(client.id, rooms);
        this.logger.debug(`Client ${client.id} joined rooms: ${[...rooms].join(', ')}`);
      }
    } catch (e) {
      this.logger.error(`Connection error for ${client.id}: ${e instanceof Error ? e.message : 'Unknown'}`);
    }
  }

  handleDisconnect(client: Socket): void {
    try {
      socketRooms.delete(client.id);
    } catch {
      /* no-op */
    }
  }

  /**
   * Emit new invoice to recipient(s). Call from InvoicesController after create.
   * @param recipientPhone - normalized 10-digit phone
   * @param recipientUserIds - User B ids if registered (for user-based rooms)
   * @param invoice - full invoice payload for the client
   */
  emitNewInvoice(
    recipientPhone: string | null,
    recipientUserIds: string[],
    invoice: Record<string, unknown>,
  ): void {
    try {
      if (recipientPhone) {
        const phoneNorm = normalizePhone(recipientPhone);
        if (phoneNorm.length >= 10) {
          const room = `invoice:phone:${phoneNorm}`;
          this.server?.to(room)?.emit('new_invoice', invoice);
          this.logger.debug(`Emitted new_invoice to room ${room}`);
        }
      }
      for (const uid of recipientUserIds) {
        if (uid) {
          const room = `invoice:user:${uid}`;
          this.server?.to(room)?.emit('new_invoice', invoice);
        }
      }
    } catch (e) {
      this.logger.error(`Emit error: ${e instanceof Error ? e.message : 'Unknown'}`);
    }
  }
}
