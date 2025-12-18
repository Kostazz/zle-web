/**
 * ZLE Refund & Returns Skeleton (ZLE v1.2.2)
 * EU 14-day withdrawal support with idempotent processing.
 * Refunds create negative ledger entries; never deletes orders.
 */

import { db } from './db';
import { orders, orderEvents, ledgerEntries, orderPayouts, auditLog } from '@shared/schema';
import { eq, and } from 'drizzle-orm';
import { emitOrderEvent, OpsEventType } from './ops/events';

const DEFAULT_CURRENCY = 'CZK';

export interface RefundResult {
  success: boolean;
  orderId: string;
  refundAmount?: string;
  error?: string;
}

/**
 * Apply a refund for an order.
 * - Idempotent via order_events table
 * - Creates negative ledger entry
 * - Cancels/adjusts pending payouts
 * - Updates order status
 * - Does NOT delete orders
 */
export async function applyRefundForOrder(
  orderId: string,
  amount: number,
  reason: string,
  providerEventId: string,
  actorUserId?: string
): Promise<RefundResult> {
  try {
    // Check idempotency via order_events
    const existingEvent = await db
      .select()
      .from(orderEvents)
      .where(and(
        eq(orderEvents.provider, 'manual'),
        eq(orderEvents.providerEventId, providerEventId)
      ))
      .limit(1);

    if (existingEvent.length > 0) {
      console.log(`[refunds] Refund event ${providerEventId} already processed, skipping`);
      return {
        success: true,
        orderId,
        refundAmount: amount.toFixed(2),
      };
    }

    // Get the order
    const [order] = await db.select().from(orders).where(eq(orders.id, orderId));
    if (!order) {
      return {
        success: false,
        orderId,
        error: 'Order not found',
      };
    }

    // Validate refund amount
    if (amount <= 0 || amount > order.total) {
      return {
        success: false,
        orderId,
        error: `Invalid refund amount: ${amount}. Order total: ${order.total}`,
      };
    }

    // Record the refund event (idempotency guard)
    await db.insert(orderEvents).values({
      orderId,
      provider: 'manual',
      providerEventId,
      type: 'refund',
      payload: { amount, reason },
    });

    // Create negative ledger entry for refund
    const dedupeKey = `refund:${orderId}:${providerEventId}`;
    await db.insert(ledgerEntries).values({
      orderId,
      type: 'refund',
      direction: 'out',
      amount: (-amount).toFixed(2),
      currency: DEFAULT_CURRENCY,
      meta: { reason, providerEventId },
      dedupeKey,
    }).onConflictDoNothing();

    // Cancel pending payouts for this order
    await db
      .update(orderPayouts)
      .set({ status: 'cancelled' })
      .where(and(
        eq(orderPayouts.orderId, orderId),
        eq(orderPayouts.status, 'pending')
      ));

    // Update order status
    await db.update(orders).set({
      status: 'refunded',
      refundAmount: amount.toFixed(2),
      refundReason: reason,
    }).where(eq(orders.id, orderId));

    // Create audit log entry
    await db.insert(auditLog).values({
      actorUserId,
      action: 'refund_applied',
      entity: 'order',
      entityId: orderId,
      severity: 'important',
      meta: { amount, reason, providerEventId },
    });

    // Emit ops event
    emitOrderEvent(OpsEventType.REFUND_CREATED, orderId, {
      amount,
      currency: DEFAULT_CURRENCY,
      reason,
    });

    console.log(`[refunds] Refund applied for order ${orderId}: ${amount} ${DEFAULT_CURRENCY}`);

    return {
      success: true,
      orderId,
      refundAmount: amount.toFixed(2),
    };

  } catch (error) {
    console.error(`[refunds] Error applying refund for order ${orderId}:`, error);
    return {
      success: false,
      orderId,
      error: String(error),
    };
  }
}

/**
 * Handle a chargeback/dispute event.
 * Creates ledger entries for chargeback and fees.
 * Does not break existing order flow.
 */
export async function handleChargeback(
  orderId: string,
  chargebackAmount: number,
  feeAmount: number,
  providerEventId: string,
  reason?: string
): Promise<RefundResult> {
  try {
    // Check idempotency
    const existingEvent = await db
      .select()
      .from(orderEvents)
      .where(and(
        eq(orderEvents.provider, 'stripe'),
        eq(orderEvents.providerEventId, providerEventId)
      ))
      .limit(1);

    if (existingEvent.length > 0) {
      console.log(`[refunds] Chargeback event ${providerEventId} already processed, skipping`);
      return { success: true, orderId };
    }

    // Get the order
    const [order] = await db.select().from(orders).where(eq(orders.id, orderId));
    if (!order) {
      return { success: false, orderId, error: 'Order not found' };
    }

    // Record the chargeback event
    await db.insert(orderEvents).values({
      orderId,
      provider: 'stripe',
      providerEventId,
      type: 'chargeback',
      payload: { chargebackAmount, feeAmount, reason },
    });

    // Create ledger entry for chargeback
    await db.insert(ledgerEntries).values({
      orderId,
      type: 'chargeback',
      direction: 'out',
      amount: (-chargebackAmount).toFixed(2),
      currency: DEFAULT_CURRENCY,
      meta: { reason, providerEventId },
      dedupeKey: `chargeback:${orderId}:${providerEventId}`,
    }).onConflictDoNothing();

    // Create ledger entry for chargeback fee
    if (feeAmount > 0) {
      await db.insert(ledgerEntries).values({
        orderId,
        type: 'chargeback_fee',
        direction: 'out',
        amount: (-feeAmount).toFixed(2),
        currency: DEFAULT_CURRENCY,
        meta: { providerEventId },
        dedupeKey: `chargeback_fee:${orderId}:${providerEventId}`,
      }).onConflictDoNothing();
    }

    // Mark order for manual review
    await db.update(orders).set({
      manualReview: true,
      fraudNotes: `Chargeback received: ${reason || 'No reason provided'}`,
    }).where(eq(orders.id, orderId));

    // Create audit log
    await db.insert(auditLog).values({
      action: 'chargeback_received',
      entity: 'order',
      entityId: orderId,
      severity: 'critical',
      meta: { chargebackAmount, feeAmount, reason, providerEventId },
    });

    // Emit ops event
    emitOrderEvent(OpsEventType.CHARGEBACK_RECEIVED, orderId, {
      amount: chargebackAmount,
      currency: DEFAULT_CURRENCY,
      reason,
    });

    console.log(`[refunds] Chargeback processed for order ${orderId}: ${chargebackAmount} ${DEFAULT_CURRENCY}`);

    return { success: true, orderId };

  } catch (error) {
    console.error(`[refunds] Error handling chargeback for order ${orderId}:`, error);
    return { success: false, orderId, error: String(error) };
  }
}

/**
 * Calculate EU 14-day withdrawal deadline from order creation date.
 */
export function calculateWithdrawalDeadline(orderCreatedAt: Date): Date {
  const deadline = new Date(orderCreatedAt);
  deadline.setDate(deadline.getDate() + 14);
  return deadline;
}

/**
 * Check if an order is still within the EU withdrawal period.
 */
export function isWithinWithdrawalPeriod(orderCreatedAt: Date): boolean {
  const deadline = calculateWithdrawalDeadline(orderCreatedAt);
  return new Date() <= deadline;
}
