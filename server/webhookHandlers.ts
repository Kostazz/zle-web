// Webhook handlers for Stripe events - ZLE e-commerce
import { getStripeSync } from './stripeClient';
import { storage } from './storage';
import { sendOrderConfirmationEmail } from './emailService';
import type { CartItem } from '@shared/schema';

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
  console.log(`Processing Stripe event: ${event.type}`);
  
  switch (event.type) {
    case 'checkout.session.completed':
      await handleCheckoutCompleted(event.data.object);
      break;
    case 'payment_intent.succeeded':
      await handlePaymentSucceeded(event.data.object);
      break;
    case 'payment_intent.payment_failed':
      await handlePaymentFailed(event.data.object);
      break;
  }
}

async function handleCheckoutCompleted(session: any) {
  const orderId = session.metadata?.orderId;
  console.log(`Checkout session completed for order: ${orderId}`);
  
  if (orderId) {
    const order = await storage.getOrder(orderId);
    if (order && order.paymentStatus !== 'paid') {
      // Deduct stock for paid order
      const items: CartItem[] = JSON.parse(order.items);
      for (const item of items) {
        await storage.updateStock(item.productId, item.quantity);
      }
      
      const updatedOrder = await storage.updateOrder(orderId, {
        paymentStatus: 'paid',
        paymentIntentId: session.payment_intent,
        status: 'confirmed',
      });
      console.log(`Order ${orderId} payment completed via checkout.session.completed`);
      
      // Generate payouts for confirmed order (ZLE EU + OPS PACK v1.0)
      import('./payouts').then(({ generatePayoutsForOrder }) => {
        generatePayoutsForOrder(orderId).catch(err => 
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
  }
}

async function handlePaymentSucceeded(paymentIntent: any) {
  const orderId = paymentIntent.metadata?.orderId;
  console.log(`Payment intent succeeded for order: ${orderId}`);
  
  if (orderId) {
    const order = await storage.getOrder(orderId);
    if (order && order.paymentStatus !== 'paid') {
      // Deduct stock for paid order
      const items: CartItem[] = JSON.parse(order.items);
      for (const item of items) {
        await storage.updateStock(item.productId, item.quantity);
      }
      
      await storage.updateOrder(orderId, {
        paymentStatus: 'paid',
        paymentIntentId: paymentIntent.id,
        status: 'confirmed',
      });
      console.log(`Order ${orderId} payment confirmed via payment_intent.succeeded`);
      
      // Generate payouts for confirmed order (ZLE EU + OPS PACK v1.0)
      import('./payouts').then(({ generatePayoutsForOrder }) => {
        generatePayoutsForOrder(orderId).catch(err => 
          console.error('Failed to generate payouts:', err)
        );
      });
    }
  }
}

async function handlePaymentFailed(paymentIntent: any) {
  const orderId = paymentIntent.metadata?.orderId;
  console.log(`Payment intent failed for order: ${orderId}`);
  
  if (orderId) {
    await storage.updateOrder(orderId, {
      paymentStatus: 'failed',
    });
    console.log(`Order ${orderId} payment failed`);
  }
}
