/**
 * Webhook handlers for Stripe events - ZLE e-commerce
 * ZLE v1.2.2: Idempotent via order_events + atomic stock deduction + transactional integrity
 * Do not reorder middleware — Stripe signature requires raw body
 */
import { getStripeSync } from './stripeClient';
import { storage } from './storage';
import { sendOrderConfirmationEmail } from './emailService';
import { db } from './db';
import { orders, orderEvents, products, auditLog, type CartItem } from '@shared/schema';
import { eq, and, sql, gte } from 'drizzle-orm';
import { emitOrderEvent, OpsEventType } from './ops/events';
import { handleChargeback } from './refunds';

export class WebhookHandlers {
  static async processWebhook(payload: Buffer, signature: string, uuid: string): Promise<void> {
    // Validate payload is a Buffer
    if (!Buffer.isBuffer(payload)) {
      throw new Error(
        'STRIPE WEBHOOK ERROR: Payload must be a Buffer. ' +
        'Received type: ' + typeof payload + '. ' +
        'This usually means express.json() parsed the body before reaching this handler. ' +
        'FIX: Ensure webhook route is registered BEFORE app.use(express.json()).'
      );
    }

    const sync = await getStripeSync();
    
    // processWebhook returns the verified event - use it instead of re-constructing
    const event = await sync.processWebhook(payload, signature, uuid);
    
    // Handle specific events for our e-commerce flow
    if (event) {
      await handleStripeEvent(event);
    }
  }
}

// Handle specific Stripe events
async function handleStripeEvent(event: any) {
  console.log(`Processing Stripe event: ${event.type} (${event.id})`);
  
  switch (event.type) {
    case 'checkout.session.completed':
      await handleCheckoutCompleted(event.data.object, event.id);
      break;
    case 'payment_intent.succeeded':
      await handlePaymentSucceeded(event.data.object, event.id);
      break;
    case 'payment_intent.payment_failed':
      await handlePaymentFailed(event.data.object, event.id);
      break;
    case 'charge.dispute.created':
      await handleDisputeCreated(event.data.object, event.id);
      break;
  }
}

/**
 * Check if event has already been processed (idempotency guard).
 * Returns true if already processed.
 */
async function isEventProcessed(provider: string, providerEventId: string): Promise<boolean> {
  const existing = await db
    .select()
    .from(orderEvents)
    .where(and(
      eq(orderEvents.provider, provider),
      eq(orderEvents.providerEventId, providerEventId)
    ))
    .limit(1);
  
  return existing.length > 0;
}

/**
 * Record event for idempotency.
 */
async function recordEvent(
  orderId: string | null,
  provider: string,
  providerEventId: string,
  type: string,
  payload?: Record<string, unknown>
): Promise<void> {
  await db.insert(orderEvents).values({
    orderId,
    provider,
    providerEventId,
    type,
    payload: payload ? JSON.parse(JSON.stringify(payload)) : null,
  }).onConflictDoNothing();
}

/**
 * Atomic stock deduction with fail-safe handling.
 * Returns list of failed deductions for manual review.
 */
async function atomicStockDeduction(
  orderId: string,
  items: CartItem[]
): Promise<{ success: boolean; failures: string[] }> {
  const failures: string[] = [];
  
  for (const item of items) {
    try {
      // Atomic conditional update: only deduct if stock >= quantity
      const result = await db
        .update(products)
        .set({
          stock: sql`GREATEST(0, ${products.stock} - ${item.quantity})`,
        })
        .where(and(
          eq(products.id, item.productId),
          gte(products.stock, item.quantity)
        ))
        .returning();
      
      if (result.length === 0) {
        // Stock was insufficient - this is an oversell situation
        failures.push(`${item.name} (${item.productId}): requested ${item.quantity}`);
        console.warn(`[stock] Oversell detected for ${item.productId}, order ${orderId}`);
      }
    } catch (error) {
      failures.push(`${item.name} (${item.productId}): deduction failed`);
      console.error(`[stock] Failed to deduct stock for ${item.productId}:`, error);
    }
  }
  
  return {
    success: failures.length === 0,
    failures,
  };
}

async function handleCheckoutCompleted(session: any, stripeEventId: string) {
  const orderId = session.metadata?.orderId;
  console.log(`Checkout session completed for order: ${orderId}`);
  
  if (!orderId) {
    console.warn('[webhook] No orderId in session metadata');
    return;
  }

  // Idempotency check via order_events
  if (await isEventProcessed('stripe', stripeEventId)) {
    console.log(`[webhook] Event ${stripeEventId} already processed, skipping`);
    return;
  }

  const order = await storage.getOrder(orderId);
  if (!order) {
    console.warn(`[webhook] Order ${orderId} not found`);
    return;
  }

  if (order.paymentStatus === 'paid') {
    console.log(`[webhook] Order ${orderId} already paid, skipping`);
    return;
  }

  // Record the event (idempotency guard)
  await recordEvent(orderId, 'stripe', stripeEventId, 'checkout_completed', {
    sessionId: session.id,
    paymentIntent: session.payment_intent,
  });

  // Check if stock already deducted
  const currentOrder = await db.select().from(orders).where(eq(orders.id, orderId)).limit(1);
  const stockAlreadyDeducted = currentOrder[0]?.stockDeductedAt !== null;

  if (!stockAlreadyDeducted) {
    // Atomic stock deduction with fail-safe
    const items: CartItem[] = JSON.parse(order.items);
    const stockResult = await atomicStockDeduction(orderId, items);
    
    // Mark stock as deducted
    await db.update(orders).set({
      stockDeductedAt: new Date(),
    }).where(eq(orders.id, orderId));

    if (!stockResult.success) {
      // Stock issues detected - mark for manual review but don't block payment
      await db.update(orders).set({
        manualReview: true,
        opsNotes: `Stock deduction failed — possible oversell: ${stockResult.failures.join('; ')}`,
      }).where(eq(orders.id, orderId));

      await db.insert(auditLog).values({
        action: 'stock_deduction_failed',
        entity: 'order',
        entityId: orderId,
        severity: 'important',
        meta: { failures: stockResult.failures },
      });

      emitOrderEvent(OpsEventType.STOCK_ISSUE, orderId, {
        reason: stockResult.failures.join('; '),
      });
    }
  }

  // Update order status
  const updatedOrder = await storage.updateOrder(orderId, {
    paymentStatus: 'paid',
    paymentIntentId: session.payment_intent,
    status: 'confirmed',
  });
  console.log(`Order ${orderId} payment completed via checkout.session.completed`);

  // Emit payment confirmed event
  emitOrderEvent(OpsEventType.PAYMENT_CONFIRMED, orderId, {
    amount: order.total,
    currency: 'CZK',
  });

  // Generate payouts for confirmed order (ZLE EU + OPS PACK v1.0)
  import('./payouts').then(({ generatePayoutsForOrder }) => {
    generatePayoutsForOrder(orderId)
      .then(() => {
        emitOrderEvent(OpsEventType.PAYOUTS_GENERATED, orderId);
      })
      .catch(err => 
        console.error('Failed to generate payouts:', err)
      );
  });
  
  // Send order confirmation email
  if (updatedOrder) {
    sendOrderConfirmationEmail(updatedOrder).catch(err => 
      console.error('Failed to send confirmation email:', err)
    );
  }
}

async function handlePaymentSucceeded(paymentIntent: any, stripeEventId: string) {
  const orderId = paymentIntent.metadata?.orderId;
  console.log(`Payment intent succeeded for order: ${orderId}`);
  
  if (!orderId) {
    // Payment intent without orderId might be from a different flow
    return;
  }

  // Idempotency check
  if (await isEventProcessed('stripe', stripeEventId)) {
    console.log(`[webhook] Event ${stripeEventId} already processed, skipping`);
    return;
  }

  const order = await storage.getOrder(orderId);
  if (!order || order.paymentStatus === 'paid') {
    return;
  }

  // Record the event
  await recordEvent(orderId, 'stripe', stripeEventId, 'payment_succeeded', {
    paymentIntentId: paymentIntent.id,
  });

  // Check if stock already deducted
  const currentOrder = await db.select().from(orders).where(eq(orders.id, orderId)).limit(1);
  const stockAlreadyDeducted = currentOrder[0]?.stockDeductedAt !== null;

  if (!stockAlreadyDeducted) {
    const items: CartItem[] = JSON.parse(order.items);
    const stockResult = await atomicStockDeduction(orderId, items);
    
    await db.update(orders).set({
      stockDeductedAt: new Date(),
    }).where(eq(orders.id, orderId));

    if (!stockResult.success) {
      await db.update(orders).set({
        manualReview: true,
        opsNotes: `Stock deduction failed — possible oversell: ${stockResult.failures.join('; ')}`,
      }).where(eq(orders.id, orderId));

      await db.insert(auditLog).values({
        action: 'stock_deduction_failed',
        entity: 'order',
        entityId: orderId,
        severity: 'important',
        meta: { failures: stockResult.failures },
      });

      emitOrderEvent(OpsEventType.STOCK_ISSUE, orderId, {
        reason: stockResult.failures.join('; '),
      });
    }
  }
  
  await storage.updateOrder(orderId, {
    paymentStatus: 'paid',
    paymentIntentId: paymentIntent.id,
    status: 'confirmed',
  });
  console.log(`Order ${orderId} payment confirmed via payment_intent.succeeded`);
  
  emitOrderEvent(OpsEventType.PAYMENT_CONFIRMED, orderId, {
    amount: order.total,
    currency: 'CZK',
  });

  // Generate payouts
  import('./payouts').then(({ generatePayoutsForOrder }) => {
    generatePayoutsForOrder(orderId)
      .then(() => {
        emitOrderEvent(OpsEventType.PAYOUTS_GENERATED, orderId);
      })
      .catch(err => 
        console.error('Failed to generate payouts:', err)
      );
  });
}

async function handlePaymentFailed(paymentIntent: any, stripeEventId: string) {
  const orderId = paymentIntent.metadata?.orderId;
  console.log(`Payment intent failed for order: ${orderId}`);
  
  if (!orderId) return;

  // Idempotency check
  if (await isEventProcessed('stripe', stripeEventId)) {
    console.log(`[webhook] Event ${stripeEventId} already processed, skipping`);
    return;
  }

  // Record the event
  await recordEvent(orderId, 'stripe', stripeEventId, 'payment_failed', {
    paymentIntentId: paymentIntent.id,
    failureMessage: paymentIntent.last_payment_error?.message,
  });

  await storage.updateOrder(orderId, {
    paymentStatus: 'failed',
  });
  console.log(`Order ${orderId} payment failed`);
}

async function handleDisputeCreated(dispute: any, stripeEventId: string) {
  const chargeId = dispute.charge;
  console.log(`Dispute created for charge: ${chargeId}`);

  // Idempotency check
  if (await isEventProcessed('stripe', stripeEventId)) {
    console.log(`[webhook] Event ${stripeEventId} already processed, skipping`);
    return;
  }

  // Find order by payment intent (dispute.payment_intent)
  const paymentIntentId = dispute.payment_intent;
  if (!paymentIntentId) {
    console.warn('[webhook] No payment intent in dispute');
    return;
  }

  const [order] = await db
    .select()
    .from(orders)
    .where(eq(orders.paymentIntentId, paymentIntentId))
    .limit(1);

  if (!order) {
    console.warn(`[webhook] No order found for payment intent ${paymentIntentId}`);
    return;
  }

  // Handle the chargeback
  const chargebackAmount = dispute.amount / 100; // Convert from cents
  const feeAmount = 15; // Stripe chargeback fee in USD (approximate)
  
  await handleChargeback(
    order.id,
    chargebackAmount,
    feeAmount,
    stripeEventId,
    dispute.reason
  );
}
