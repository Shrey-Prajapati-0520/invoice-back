import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Post,
  Req,
  Res,
  Request,
  UseGuards,
} from '@nestjs/common';
import * as express from 'express';
import { PaymentsService } from './payments.service';
import { AuthGuard } from '../auth/auth.guard';

@Controller('payments')
export class PaymentsController {
  constructor(private readonly payments: PaymentsService) {}

  /**
   * Create payment init - returns SabPaisa checkout URL and encData.
   * Call this from your app when user taps "Pay Invoice".
   */
  @Post('create')
  @UseGuards(AuthGuard)
  async create(
    @Request() req: { user: { id: string; email?: string }; headers: { host?: string } },
    @Body()
    body: {
      invoiceId: string;
      payerName: string;
      payerEmail: string;
      payerMobile: string;
      amount: number;
      clientTxnId?: string;
    },
  ) {
    if (!body.invoiceId || !body.payerName || !body.payerEmail || !body.payerMobile || !body.amount) {
      throw new BadRequestException(
        'invoiceId, payerName, payerEmail, payerMobile, amount are required',
      );
    }

    const clientTxnId =
      body.clientTxnId ||
      `INV${Date.now()}${Math.random().toString(36).slice(2, 10)}`.slice(0, 18);

    const callbackUrl =
      this.payments.getCallbackUrl() ||
      `http://${req.headers.host || 'localhost:3000'}/payments/callback`;

    const init = this.payments.createPaymentInit({
      payerName: body.payerName,
      payerEmail: body.payerEmail,
      payerMobile: body.payerMobile,
      amount: body.amount,
      clientTxnId,
      callbackUrl,
      invoiceId: body.invoiceId,
    });

    return {
      redirectUrl: init.redirectUrl,
      paymentUrl: init.paymentUrl,
      encData: init.encData,
      clientCode: init.clientCode,
      clientTxnId,
    };
  }

  /**
   * Redirect page - loads in WebView, auto-submits form to SabPaisa.
   * Use full URL: {API_BASE}/payments/go/{sid}
   */
  @Get('go/:sid')
  async redirectToSabPaisa(
    @Param('sid') sid: string,
    @Req() req: express.Request,
    @Res() res: express.Response,
  ) {
    const session = this.payments.getSessionForRedirect(sid);
    if (!session) {
      res.status(404).send('<h1>Session expired. Please try again.</h1>');
      return;
    }

    const protocol = req.headers['x-forwarded-proto'] || 'http';
    const host = req.headers['x-forwarded-host'] || req.headers.host || 'localhost:3000';
    const baseUrl = `${protocol}://${host}`;

    const html = `<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"><title>Redirecting to Payment...</title></head>
<body>
<p>Redirecting to payment gateway...</p>
<form id="sabpaisaForm" method="POST" action="${session.paymentUrl}">
  <input type="hidden" name="encData" value="${session.encData.replace(/"/g, '&quot;')}" />
  <input type="hidden" name="clientCode" value="${session.clientCode.replace(/"/g, '&quot;')}" />
</form>
<script>document.getElementById('sabpaisaForm').submit();</script>
</body>
</html>`;

    res.setHeader('Content-Type', 'text/html');
    res.send(html);
  }

  /**
   * SabPaisa callback - receives POST from SabPaisa after payment.
   * Must be publicly accessible (no AuthGuard).
   * Returns HTML so user sees result in WebView.
   */
  @Post('callback')
  async callback(
    @Body() body: { encResponse?: string },
    @Res() res: express.Response,
  ) {
    const encResponse = body.encResponse;
    if (!encResponse) {
      res.status(400).send('<h1>Invalid callback</h1>');
      return;
    }

    try {
      const result = this.payments.handleCallback(encResponse);

      if (result.invoiceId && result.statusCode === '0000') {
        await this.payments.updateInvoiceStatus(result.invoiceId, 'paid');
      }

      const success = result.statusCode === '0000';
      const html = `<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Payment ${success ? 'Success' : 'Result'}</title>
<style>body{font-family:system-ui;max-width:400px;margin:50px auto;padding:24px;text-align:center}
.success{color:#16a34a}.fail{color:#dc2626}</style></head>
<body>
<h1 class="${success ? 'success' : 'fail'}">${success ? '✓ Payment Successful' : '✗ Payment Failed'}</h1>
<p>${result.sabpaisaMessage || (success ? 'Your payment was completed.' : 'Please try again.')}</p>
<p style="font-size:14px;color:#666">You can close this window and return to the app.</p>
</body>
</html>`;

      res.setHeader('Content-Type', 'text/html');
      res.send(html);
    } catch (err) {
      res.status(500).send('<h1>Error processing payment</h1>');
    }
  }
}
