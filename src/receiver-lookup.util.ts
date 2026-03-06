/**
 * Shared receiver lookup for invoices, quotations, recurring.
 * Finds User B (receiver) by matching recipient phone/email with profiles.
 * MNC-grade: defense in depth (RPC → fallback), structured logging, no throws.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { normalizeEmail } from './recipient.util';

export interface ReceiverLookupOptions {
  recipientPhone: string | null;
  recipientEmail: string | null;
  excludeId: string;
  getClient: () => SupabaseClient;
  logContext?: string;
  onLog?: (msg: string) => void;
}

/**
 * Find receiver profile IDs by phone and/or email.
 * Uses RPC find_receiver_ids_by_phone first, then profiles fallback.
 * Never throws; returns empty Set on any error.
 */
export async function findReceiverIds(options: ReceiverLookupOptions): Promise<Set<string>> {
  const { recipientPhone, recipientEmail, excludeId, getClient, logContext = '', onLog } = options;
  const receiverIds = new Set<string>();
  const client = getClient();

  const log = (msg: string) => {
    onLog?.(`[Receiver] ${logContext}${logContext ? ' ' : ''}${msg}`);
  };

  const maskedPhone = recipientPhone ? `***${recipientPhone.slice(-4)}` : 'null';
  const emailStatus = recipientEmail ? 'set' : 'null';
  log(`Lookup: recipient_phone=${maskedPhone}, recipient_email=${emailStatus}`);

  // Step 1: RPC find_receiver_ids_by_phone
  if (recipientPhone) {
    try {
      const { data: byPhoneRpc } = await client.rpc('find_receiver_ids_by_phone', {
        phone_10: recipientPhone,
        exclude_id: excludeId,
      });
      if (Array.isArray(byPhoneRpc)) {
        byPhoneRpc.forEach((r: { id?: string }) => r?.id && receiverIds.add(String(r.id)));
      }
    } catch (rpcErr) {
      log(`RPC fallback: ${(rpcErr as Error)?.message}`);
    }

    // Step 2: Fallback – exact or suffix match on profiles.phone
    if (receiverIds.size === 0) {
      try {
        const [exact, suffix] = await Promise.all([
          client.from('profiles').select('id').eq('phone', recipientPhone).neq('id', excludeId),
          client.from('profiles').select('id').neq('id', excludeId).ilike('phone', `%${recipientPhone}`),
        ]);
        [...(exact.data ?? []), ...(suffix.data ?? [])].forEach((p: { id: string }) =>
          receiverIds.add(String(p.id)),
        );
      } catch {
        /* non-fatal */
      }
    }
  }

  // Step 3: Email lookup
  if (recipientEmail) {
    const normEmail = normalizeEmail(recipientEmail);
    if (normEmail) {
      try {
        const { data: byEmail } = await client
          .from('profiles')
          .select('id')
          .ilike('email', normEmail)
          .neq('id', excludeId);
        (byEmail ?? []).forEach((p: { id: string }) => receiverIds.add(p.id));
      } catch {
        /* non-fatal */
      }
    }
  }

  if (receiverIds.size > 0) {
    log(`Found ${receiverIds.size} receiver(s): [${Array.from(receiverIds).slice(0, 3).join(', ')}${receiverIds.size > 3 ? '...' : ''}]`);
  } else {
    log(
      `No receivers found – User B must have signed up; phone/email must match customer. ` +
        `Run supabase/recipient-lookup-function.sql if RPC missing.`,
    );
  }

  return receiverIds;
}
