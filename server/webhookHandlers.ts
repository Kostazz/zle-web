/**
 * Webhook handlers for Stripe events - ZLE e-commerce
 * ZLE v1.2.2: Idempotent via order_events + atomic stock deduction + transactional integrity
 * Do not reorder middleware — Stripe signature requires raw body
 */
import { getUncachableStripeClient } from './stripeClient';
import { storage } from './storage';
import { sendOrderConfirmationEmail, sendFulfillmentNewOrderEmail } from './emailService';
import { db } from './db';
import { orders, orderEvents, products, auditLog, orderIdempotencyKeys, type CartItem } from '@shared/schema';
import { eq, and, sql } from 'drizzle-orm';
import { emitOrderEvent, OpsEventType } from './ops/events';
import { handleChargeback } from './refunds';
import { finalizePaidOrder } from './paymentPipeline';
import { env } from './env';

export class WebhookHandlers {
  static async processWebhook(payload: Buffer, signature: string): Promise<void> {
    // Validate payload is a Buffer
    if (!Buffer.isBuffer(payload)) {
      throw new Error(
        'STRIPE WEBHOOK ERROR: Payload must be a Buffer. ' +
        'Received type: ' + typeof payload + '. ' +
        'This usually means express.json() parsed the body before reaching this handler. ' +
        'FIX: Ensure webhook route is registered BEFORE app.use(express.json()).'
      );
    }

    // Render-first: verify using Stripe's built-in signature verification.
    const webhookSecret = env.STRIPE_WEBHOOK_SECRET;
    if (!webhookSecret) {
      throw new Error("STRIPE_WEBHOOK_SECRET is missing");
    }

    const stripe = await getUncachableStripeClient();
    const event = stripe.webhooks.constructEvent(payload, signature, webhookSecret);

    
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
 * Exported for use in verification endpoint as backup for webhook race conditions.
 */
export async function atomicStockDeduction(
  orderId: string,
  items: CartItem[]
): Promise<{ success: boolean; failures: string[] }> {
  const aggregated = new Map<string, { quantity: number; label: string }>();
  for (const item of items) {
    const prev = aggregated.get(item.productId);
    if (prev) {
      prev.quantity += item.quantity;
      continue;
    }
    aggregated.set(item.productId, {
      quantity: item.quantity,
      label: item.name ?? item.productId,
    });
  }

  try {
    return await db.transaction(async (tx) => {
      const failures: string[] = [];
      const aggregatedItems = Array.from(aggregated.entries()).sort(([a], [b]) =>
        String(a).localeCompare(String(b))
      );

      for (const [productId, item] of aggregatedItems) {
        const locked = await tx.execute<{ stock: number | string }>(
          sql`SELECT stock FROM products WHERE id = ${productId} FOR UPDATE`
        );
        const row = locked.rows[0];
        const stock = row ? Number(row.stock) : NaN;

        if (!row || !Number.isFinite(stock) || stock < item.quantity) {
          failures.push(`${item.label} (${productId}): requested ${item.quantity}`);
        }
      }

      if (failures.length > 0) {
        throw new Error(`INSUFFICIENT_STOCK:${failures.join(" | ")}`);
      }

      for (const [productId, item] of aggregatedItems) {
        await tx
          .update(products)
          .set({
            stock: sql`${products.stock} - ${item.quantity}`,
          })
          .where(eq(products.id, productId));
      }

      return { success: true, failures: [] as string[] };
    });
  } catch (error) {
    const msg = (error as Error)?.message ?? "stock_deduction_failed";
    const failures = msg.startsWith("INSUFFICIENT_STOCK:")
      ? msg.replace("INSUFFICIENT_STOCK:", "").split(" | ").filter(Boolean)
      : ["stock_deduction_failed"];

    failures.forEach((failure) => {
      console.warn(`[stock] Oversell or lock conflict for order ${orderId}: ${failure}`);
    });

    return {
      success: false,
      failures,
    };
  }
}

async function handleCheckoutCompleted(session: any, stripeEventId: string) {
  let orderId = session.metadata?.orderId;
  const idempotencyKey = session.metadata?.idempotencyKey;

  if (!orderId && idempotencyKey) {
    const [row] = await db
      .select()
      .from(orderIdempotencyKeys)
      .where(eq(orderIdempotencyKeys.idempotencyKey, String(idempotencyKey)))
      .limit(1);
    orderId = row?.orderId ?? null;
  }
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
    const raw = JSON.parse(order.items);
    const items: CartItem[] = Array.isArray(raw) ? raw : (raw?.items || []);
    const stockResult = await atomicStockDeduction(orderId, items);
    
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
    } else {
      await db.update(orders).set({
        stockDeductedAt: new Date(),
      }).where(eq(orders.id, orderId));
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

  // Finalize order: ledger entry + payouts (idempotent via paymentPipeline)
  await finalizePaidOrder({
    orderId,
    provider: 'stripe',
    providerEventId: stripeEventId,
    meta: { source: 'webhook-checkout', sessionId: session.id },
  });
  
  emitOrderEvent(OpsEventType.PAYOUTS_GENERATED, orderId);
  
  // Send order confirmation email (customer)
  if (updatedOrder) {
    sendOrderConfirmationEmail(updatedOrder).catch((err) =>
      console.error('Failed to send confirmation email:', err)
    );

    // Send fulfillment email (Michal / TotalBoardShop)
    sendFulfillmentNewOrderEmail(updatedOrder).catch((err) =>
      console.error('Failed to send fulfillment email:', err)
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
    const raw = JSON.parse(order.items);
    const items: CartItem[] = Array.isArray(raw) ? raw : (raw?.items || []);
    const stockResult = await atomicStockDeduction(orderId, items);
    
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
    } else {
      await db.update(orders).set({
        stockDeductedAt: new Date(),
      }).where(eq(orders.id, orderId));
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

  // Finalize order: ledger entry + payouts (idempotent via paymentPipeline)
  await finalizePaidOrder({
    orderId,
    provider: 'stripe',
    providerEventId: stripeEventId,
    meta: { source: 'webhook-payment-intent', paymentIntentId: paymentIntent.id },
  });
  
  emitOrderEvent(OpsEventType.PAYOUTS_GENERATED, orderId);
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
