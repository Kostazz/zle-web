/**
 * ZLE Payment Pipeline (ZLE v1.2.4)
 * Shared idempotent post-payment processing for both webhook and verify endpoints.
 * Ensures ledger entries, payouts, and events are created exactly once.
 */

import { db } from './db';
import { orders, orderEvents, ledgerEntries, auditLog } from '@shared/schema';
import { eq, and } from 'drizzle-orm';

const DEFAULT_CURRENCY = 'CZK';

interface FinalizePaidOrderParams {
  orderId: string;
  provider: string;
  providerEventId: string;
  meta?: Record<string, unknown>;
}

/**
 * Finalize a paid order with idempotent side effects.
 * Safe to call from both webhook and verify endpoints.
 * 
 * Does:
 * A) Records event in order_events (idempotent via unique constraint)
 * B) Creates ledger sale entry (idempotent via dedupeKey)
 * C) Generates payouts (already idempotent in payouts.ts)
 * D) Logs to audit_log
 * 
 * @returns { success: boolean, skipped: boolean, error?: string }
 */
export async function finalizePaidOrder({
  orderId,
  provider,
  providerEventId,
  meta = {},
}: FinalizePaidOrderParams): Promise<{ success: boolean; skipped: boolean; error?: string }> {
  try {
    // Check if ledger entry already exists (true idempotency guard)
    const dedupeKey = `sale-${orderId}`;
    const existingLedger = await db
      .select({ id: ledgerEntries.id })
      .from(ledgerEntries)
      .where(eq(ledgerEntries.dedupeKey, dedupeKey))
      .limit(1);

    if (existingLedger.length > 0) {
      console.log(`[pipeline] Order ${orderId} already finalized (ledger exists), skipping`);
      return { success: true, skipped: true };
    }

    console.log(`[pipeline] Finalizing order ${orderId} via ${provider}:${providerEventId}`);
    
    // A) Record event for traceability
    try {
      await db
        .insert(orderEvents)
        .values({
          orderId,
          provider,
          providerEventId,
          type: 'payment_finalized',
          payload: meta,
        })
        .onConflictDoNothing();
    } catch (eventError) {
      console.warn(`[pipeline] Event insert error (non-critical):`, eventError);
    }

    // Fetch order data
    const [order] = await db.select().from(orders).where(eq(orders.id, orderId)).limit(1);
    if (!order) {
      console.warn(`[pipeline] Order ${orderId} not found`);
      return { success: false, skipped: false, error: 'Order not found' };
    }

    // B) Create ledger sale entry (idempotent via dedupeKey unique constraint)
    try {
      await db.insert(ledgerEntries).values({
        orderId,
        type: 'sale',
        direction: 'in',
        amount: order.total.toString(),
        currency: DEFAULT_CURRENCY,
        dedupeKey,
        meta: { 
          provider, 
          providerEventId,
          source: meta.source || 'pipeline',
        },
      }).onConflictDoNothing();
      console.log(`[pipeline] Ledger sale entry created for order ${orderId}`);
    } catch (ledgerError: any) {
      // Unique constraint violation means entry already exists - that's OK
      if (ledgerError.code !== '23505') {
        console.error(`[pipeline] Ledger insert error for ${orderId}:`, ledgerError);
      }
    }

    // C) Generate payouts (async, non-blocking, already idempotent)
    import('./payouts').then(({ generatePayoutsForOrder }) => {
      generatePayoutsForOrder(orderId).catch(err => 
        console.error(`[pipeline] Payout generation error for ${orderId}:`, err)
      );
    });

    // D) Audit log entry
    try {
      await db.insert(auditLog).values({
        actorUserId: null,
        action: 'payment_finalized',
        entity: 'order',
        entityId: orderId,
        meta: {
          provider,
          providerEventId,
          source: meta.source || 'pipeline',
          total: order.total,
        },
        severity: 'info',
      });
    } catch (auditError) {
      console.warn(`[pipeline] Audit log error for ${orderId}:`, auditError);
    }

    console.log(`[pipeline] Order ${orderId} finalized successfully`);
    return { success: true, skipped: false };

  } catch (error: any) {
    console.error(`[pipeline] Error finalizing order ${orderId}:`, error);
    return { success: false, skipped: false, error: error.message };
  }
}
