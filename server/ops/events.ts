/**
 * ZLE OPS Event Hooks (ZLE v1.2.3)
 * Prepares future automation (notify Michal/partners) without implementing messaging now.
 * DISABLED BY DEFAULT - set OPS_EVENTS_ENABLED=true to enable logging.
 */

export const OpsEventType = {
  ORDER_CREATED: 'ORDER_CREATED',
  PAYMENT_CONFIRMED: 'PAYMENT_CONFIRMED',
  REFUND_CREATED: 'REFUND_CREATED',
  STOCK_ISSUE: 'STOCK_ISSUE',
  PAYOUTS_GENERATED: 'PAYOUTS_GENERATED',
  CHARGEBACK_RECEIVED: 'CHARGEBACK_RECEIVED',
  MANUAL_REVIEW_REQUIRED: 'MANUAL_REVIEW_REQUIRED',
} as const;

export type OpsEventTypeValue = typeof OpsEventType[keyof typeof OpsEventType];

export interface OpsEventPayload {
  orderId?: string;
  userId?: string;
  amount?: number;
  currency?: string;
  reason?: string;
  meta?: Record<string, unknown>;
}

const isEnabled = (): boolean => {
  return process.env.OPS_EVENTS_ENABLED === 'true';
};

const isDev = (): boolean => {
  return process.env.NODE_ENV !== 'production';
};

/**
 * Emit an ops event. By default does nothing except optionally log in dev.
 * Explicitly disabled in production unless OPS_EVENTS_ENABLED=true.
 * 
 * Future: Can be extended to send webhooks, emails, Slack notifications, etc.
 */
export function emitOpsEvent(type: OpsEventTypeValue, payload: OpsEventPayload): void {
  try {
    if (!isEnabled() && !isDev()) {
      return;
    }

    const timestamp = new Date().toISOString();
    const eventData = {
      type,
      timestamp,
      ...payload,
    };

    if (isDev() || isEnabled()) {
      console.log(`[ops] Event: ${type}`, JSON.stringify(eventData, null, 2));
    }

    // Future: Send to webhook if configured
    // const webhookUrl = process.env.OPS_WEBHOOK_URL;
    // if (webhookUrl && isEnabled()) {
    //   sendWebhook(webhookUrl, eventData).catch(console.error);
    // }

    // Future: Send email if configured
    // const emailTo = process.env.OPS_EMAIL_TO;
    // if (emailTo && isEnabled()) {
    //   sendOpsEmail(emailTo, eventData).catch(console.error);
    // }

  } catch (error) {
    // Never throw or block primary flow
    console.error('[ops] Failed to emit event:', error);
  }
}

/**
 * Helper to emit order-related events with minimal safe payload.
 */
export function emitOrderEvent(
  type: OpsEventTypeValue,
  orderId: string,
  additionalData?: Partial<OpsEventPayload>
): void {
  emitOpsEvent(type, {
    orderId,
    ...additionalData,
  });
}
