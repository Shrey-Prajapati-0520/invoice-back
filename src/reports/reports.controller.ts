import { BadRequestException, Controller, Get, Query, Request, UseGuards } from '@nestjs/common';
import { SupabaseService } from '../supabase.service';
import { AuthGuard } from '../auth/auth.guard';

type Period = 'this_month' | 'last_30' | 'this_quarter';

function getDateRange(period: Period): { start: Date; end: Date } {
  const end = new Date();
  const start = new Date();
  if (period === 'this_month') {
    start.setDate(1);
    start.setHours(0, 0, 0, 0);
  } else if (period === 'last_30') {
    start.setDate(start.getDate() - 30);
    start.setHours(0, 0, 0, 0);
  } else if (period === 'this_quarter') {
    const q = Math.floor(start.getMonth() / 3) + 1;
    start.setMonth((q - 1) * 3, 1);
    start.setHours(0, 0, 0, 0);
  }
  end.setHours(23, 59, 59, 999);
  return { start, end };
}

function getPrevDateRange(period: Period): { start: Date; end: Date } {
  const { start, end } = getDateRange(period);
  const len = end.getTime() - start.getTime();
  return {
    start: new Date(start.getTime() - len),
    end: new Date(start.getTime() - 1),
  };
}

@Controller('reports')
@UseGuards(AuthGuard)
export class ReportsController {
  constructor(private readonly supabase: SupabaseService) {}

  private getClient() {
    return this.supabase.getClient();
  }

  @Get('analytics')
  async analytics(
    @Request() req: { user: { id: string } },
    @Query('period') period: string = 'this_month',
  ) {
    const p = (period === 'last_30' ? 'last_30' : period === 'this_quarter' ? 'this_quarter' : 'this_month') as Period;
    const { start, end } = getDateRange(p);
    const { start: prevStart, end: prevEnd } = getPrevDateRange(p);

    const client = this.getClient();
    const { data: sentData, error } = await client
      .from('invoices')
      .select(`id, number, status, created_at, invoice_date, due_date, customer_id, customers (id, name)`)
      .eq('user_id', req.user.id)
      .eq('type', 'sent');

    if (error) throw new BadRequestException(error.message);

    const invIds = (sentData ?? []).map((i: { id: string }) => i.id);
    const { data: itemsData } = invIds.length > 0
      ? await client.from('invoice_items').select('invoice_id, qty, rate').in('invoice_id', invIds)
      : { data: [] };

    const itemsByInv = new Map<string, { qty: number; rate: number }[]>();
    (itemsData ?? []).forEach((it: { invoice_id: string; qty?: number; rate?: number }) => {
      const list = itemsByInv.get(it.invoice_id) ?? [];
      list.push({ qty: Number(it.qty) || 1, rate: Number(it.rate) || 0 });
      itemsByInv.set(it.invoice_id, list);
    });

    const toAmount = (invId: string) => {
      const items = itemsByInv.get(invId) ?? [];
      return items.reduce((s, i) => s + i.qty * i.rate, 0);
    };

    const toIso = (d: Date) => d.toISOString().slice(0, 10);
    const startStr = toIso(start);
    const endStr = toIso(end);
    const prevStartStr = toIso(prevStart);
    const prevEndStr = toIso(prevEnd);

    const inRange = (inv: { invoice_date?: string; created_at?: string }) => {
      const d = (inv.invoice_date || inv.created_at || '').toString().slice(0, 10);
      return d >= startStr && d <= endStr;
    };
    const inPrevRange = (inv: { invoice_date?: string; created_at?: string }) => {
      const d = (inv.invoice_date || inv.created_at || '').toString().slice(0, 10);
      return d >= prevStartStr && d <= prevEndStr;
    };

    const current = (sentData ?? []).filter(inRange);
    const prev = (sentData ?? []).filter(inPrevRange);

    let totalInvoiced = 0;
    let received = 0;
    let invoicesPaid = 0;
    let pending = 0;
    let pendingCount = 0;
    let overdue = 0;
    let overdueCount = 0;
    const byMonth = new Map<string, number>();
    const byCustomer = new Map<string, { name: string; amount: number; count: number }>();

    for (const inv of current) {
      const amt = toAmount(inv.id);
      totalInvoiced += amt;
      const cust = inv.customers as { id?: string; name?: string } | null;
      const custId = cust?.id ?? 'unknown';
      const custName = cust?.name ?? 'Unknown';
      const existing = byCustomer.get(custId) ?? { name: custName, amount: 0, count: 0 };
      existing.amount += amt;
      existing.count += 1;
      byCustomer.set(custId, existing);

      const d = (inv.invoice_date || inv.created_at || '').toString().slice(0, 7);
      byMonth.set(d, (byMonth.get(d) ?? 0) + amt);

      if (inv.status === 'paid') {
        received += amt;
        invoicesPaid += 1;
      } else if (inv.status === 'pending') {
        pending += amt;
        pendingCount += 1;
      } else if (inv.status === 'overdue') {
        overdue += amt;
        overdueCount += 1;
      }
    }

    let prevTotal = 0;
    let prevReceived = 0;
    for (const inv of prev) {
      const amt = toAmount(inv.id);
      prevTotal += amt;
      if (inv.status === 'paid') prevReceived += amt;
    }

    const totalChange = prevTotal > 0 ? Math.round(((totalInvoiced - prevTotal) / prevTotal) * 100) : 0;
    const receivedChange = prevReceived > 0 ? Math.round(((received - prevReceived) / prevReceived) * 100) : 0;

    const months: { month: string; amount: number }[] = [];
    const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const sortedMonths = Array.from(byMonth.entries()).sort((a, b) => a[0].localeCompare(b[0]));
    const last6 = sortedMonths.slice(-6);
    for (const [ym, amount] of last6) {
      const [y, m] = ym.split('-');
      months.push({ month: monthNames[parseInt(m, 10) - 1] ?? ym, amount });
    }

    const avgMonthly = months.length > 0 ? Math.round(months.reduce((s, m) => s + m.amount, 0) / months.length) : 0;
    const topClients = Array.from(byCustomer.values())
      .sort((a, b) => b.amount - a.amount)
      .slice(0, 5)
      .map((c) => ({ name: c.name, amount: c.amount, invoices: c.count }));

    const totalInvoices = invoicesPaid + pendingCount + overdueCount;
    const avgPayDays = 18;
    const onTimePct = totalInvoices > 0 ? Math.round((invoicesPaid / totalInvoices) * 100) : 0;

    return {
      totalInvoiced,
      totalChange,
      invoicesSent: current.length,
      received,
      receivedChange,
      invoicesPaid,
      pending,
      pendingCount,
      overdue,
      overdueCount,
      months: months.length > 0 ? months : [{ month: '—', amount: 0 }],
      avgMonthly,
      avgPayDays,
      onTimePct,
      topClients,
    };
  }
}
