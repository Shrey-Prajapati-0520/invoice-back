import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SupabaseService } from '../supabase.service';
import { encrypt, decrypt } from './sabpaisa.util';

const paymentSessionStore = new Map<string, { paymentUrl: string; encData: string; clientCode: string }>();

@Injectable()
export class PaymentsService {
  constructor(
    private config: ConfigService,
    private supabase: SupabaseService,
  ) {}

  private getCredentials() {
    const clientCode = this.config.get<string>('SABPAISA_CLIENT_CODE');
    const transUserName = this.config.get<string>('SABPAISA_TRANS_USERNAME');
    const transUserPassword = this.config.get<string>('SABPAISA_TRANS_PASSWORD');
    const authKey = this.config.get<string>('SABPAISA_AUTH_KEY');
    const authIV = this.config.get<string>('SABPAISA_AUTH_IV');
    const mcc = this.config.get<string>('SABPAISA_MCC') || '5666';
    const baseUrl = this.config.get<string>('SABPAISA_BASE_URL');

    if (!clientCode || !transUserName || !transUserPassword || !authKey || !authIV || !baseUrl) {
      throw new Error(
        'SabPaisa credentials missing. Set SABPAISA_CLIENT_CODE, SABPAISA_TRANS_USERNAME, SABPAISA_TRANS_PASSWORD, SABPAISA_AUTH_KEY, SABPAISA_AUTH_IV, SABPAISA_BASE_URL in .env',
      );
    }
    return { clientCode, transUserName, transUserPassword, authKey, authIV, mcc, baseUrl };
  }

  getCallbackUrl(): string {
    const url = this.config.get<string>('SABPAISA_CALLBACK_URL');
    if (url) return url.trim();
    return '';
  }

  createPaymentInit(params: {
    payerName: string;
    payerEmail: string;
    payerMobile: string;
    amount: number;
    clientTxnId: string;
    callbackUrl: string;
    invoiceId?: string;
    udf1?: string;
  }) {
    const { clientCode, transUserName, transUserPassword, authKey, authIV, mcc, baseUrl } =
      this.getCredentials();

    const transDate = new Date().toISOString().replace('T', ' ').slice(0, 19);
    const channelId = 'M'; // M for mobile

    const plainStr = [
      `payerName=${params.payerName.trim()}`,
      `payerEmail=${params.payerEmail.trim()}`,
      `payerMobile=${params.payerMobile.replace(/\D/g, '').slice(-10)}`,
      `clientTxnId=${params.clientTxnId.trim()}`,
      `amount=${Math.round(params.amount)}`,
      `clientCode=${clientCode.trim()}`,
      `transUserName=${transUserName.trim()}`,
      `transUserPassword=${transUserPassword.trim()}`,
      `callbackUrl=${params.callbackUrl.trim()}`,
      `channelId=${channelId}`,
      `mcc=${mcc}`,
      `transDate=${transDate}`,
      params.invoiceId ? `udf1=${params.invoiceId}` : '',
      params.udf1 ? `udf2=${params.udf1}` : '',
    ]
      .filter(Boolean)
      .join('&');

    const encData = encrypt(plainStr, authKey, authIV);
    const paymentUrl = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;

    const sid = Math.random().toString(36).slice(2, 12);
    paymentSessionStore.set(sid, { paymentUrl, encData, clientCode });
    setTimeout(() => paymentSessionStore.delete(sid), 5 * 60 * 1000);

    return {
      redirectUrl: `/payments/go/${sid}`,
      paymentUrl,
      encData,
      clientCode,
      sid,
    };
  }

  getSessionForRedirect(sid: string): { paymentUrl: string; encData: string; clientCode: string } | null {
    const session = paymentSessionStore.get(sid);
    if (session) paymentSessionStore.delete(sid);
    return session || null;
  }

  handleCallback(encResponse: string): {
    statusCode: string;
    clientTxnId: string;
    sabpaisaTxnId: string;
    amount: string;
    paidAmount: string;
    sabpaisaMessage: string;
    invoiceId?: string;
    [key: string]: string | undefined;
  } {
    const authKey = this.config.get<string>('SABPAISA_AUTH_KEY');
    const authIV = this.config.get<string>('SABPAISA_AUTH_IV');
    if (!authKey || !authIV) {
      throw new Error('SabPaisa AuthKey/AuthIV not configured');
    }

    const decrypted = decrypt(encResponse, authKey, authIV);
    const params: Record<string, string> = {};
    decrypted.split('&').forEach((pair) => {
      const [key, value] = pair.split('=');
      if (key && value !== undefined) params[key.trim()] = decodeURIComponent(value || '').trim();
    });

    return {
      statusCode: params.statusCode || '',
      clientTxnId: params.clientTxnId || '',
      sabpaisaTxnId: params.sabpaisaTxnId || '',
      amount: params.amount || '',
      paidAmount: params.paidAmount || '',
      sabpaisaMessage: params.sabpaisaMessage || '',
      invoiceId: params.udf1,
      ...params,
    };
  }

  async updateInvoiceStatus(invoiceId: string, status: 'paid' | 'pending') {
    const { error } = await this.supabase
      .getClient()
      .from('invoices')
      .update({ status })
      .eq('id', invoiceId);
    if (error) throw new Error(error.message);
  }
}
