/**
 * ZLE Admin CSV Export Skeleton (ZLE v1.2.3)
 * Enable accounting export with minimal work.
 * Admin-only, read-only, no raw PII by default.
 */

import { db } from './db';
import { ledgerEntries, orders, orderPayouts } from '@shared/schema';
import { desc } from 'drizzle-orm';

/**
 * Generate CSV string from array of objects.
 */
function arrayToCsv(data: Record<string, unknown>[], columns: string[]): string {
  if (data.length === 0) {
    return columns.join(',') + '\n';
  }

  const header = columns.join(',');
  const rows = data.map(row => {
    return columns.map(col => {
      const value = row[col];
      if (value === null || value === undefined) {
        return '';
      }
      const str = typeof value === 'object' ? JSON.stringify(value) : String(value);
      // Escape quotes and wrap in quotes if contains comma or quote
      if (str.includes(',') || str.includes('"') || str.includes('\n')) {
        return `"${str.replace(/"/g, '""')}"`;
      }
      return str;
    }).join(',');
  });

  return [header, ...rows].join('\n');
}

/**
 * Hash/mask sensitive string for export.
 */
function maskSensitive(value: string | null | undefined): string {
  if (!value) return '';
  if (value.length <= 4) return '****';
  return `${value.substring(0, 2)}...${value.slice(-2)}`;
}

/**
 * Export ledger entries as CSV.
 * Columns: createdAt, orderId, type, direction, amount, currency, meta
 */
export async function exportLedgerCsv(): Promise<string> {
  const entries = await db
    .select()
    .from(ledgerEntries)
    .orderBy(desc(ledgerEntries.createdAt));

  const data = entries.map(e => ({
    createdAt: e.createdAt?.toISOString() || '',
    orderId: e.orderId || '',
    type: e.type,
    direction: e.direction,
    amount: e.amount,
    currency: e.currency,
    meta: e.meta ? JSON.stringify(e.meta) : '',
  }));

  return arrayToCsv(data, ['createdAt', 'orderId', 'type', 'direction', 'amount', 'currency', 'meta']);
}

/**
 * Export orders as CSV.
 * Columns: id, createdAt, status, total, netTotal, vatRate, vatAmount, currency
 * Does NOT include customer PII by default.
 */
export async function exportOrdersCsv(): Promise<string> {
  const orderList = await db
    .select()
    .from(orders)
    .orderBy(desc(orders.createdAt));

  const data = orderList.map(o => ({
    id: o.id,
    createdAt: o.createdAt?.toISOString() || '',
    status: o.status,
    paymentStatus: o.paymentStatus || '',
    total: o.total,
    netTotal: o.netTotal || '',
    vatRate: o.vatRate || '',
    vatAmount: o.vatAmount || '',
    currency: 'CZK',
    paymentMethod: o.paymentMethod || '',
    manualReview: o.manualReview ? 'yes' : 'no',
    // PII masked
    customerEmailHash: maskSensitive(o.customerEmail),
  }));

  return arrayToCsv(data, [
    'id', 'createdAt', 'status', 'paymentStatus', 'total', 'netTotal',
    'vatRate', 'vatAmount', 'currency', 'paymentMethod', 'manualReview', 'customerEmailHash'
  ]);
}

/**
 * Export payouts as CSV.
 * Columns: orderId, partnerCode, amount, status, createdAt, paidAt
 */
export async function exportPayoutsCsv(): Promise<string> {
  const payouts = await db
    .select()
    .from(orderPayouts)
    .orderBy(desc(orderPayouts.createdAt));

  const data = payouts.map(p => ({
    orderId: p.orderId,
    partnerCode: p.partnerCode,
    amount: p.amount,
    currency: p.currency,
    status: p.status,
    createdAt: p.createdAt?.toISOString() || '',
    paidAt: p.paidAt?.toISOString() || '',
  }));

  return arrayToCsv(data, ['orderId', 'partnerCode', 'amount', 'currency', 'status', 'createdAt', 'paidAt']);
}
