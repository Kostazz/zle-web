import Stripe from "stripe";
import { db } from "./db";
import { orderIdempotencyKeys, orders, type Order } from "@shared/schema";
import { eq } from "drizzle-orm";

export type StripeOrderAuthorityFailureReason =
  | "stale_session_order_mismatch"
  | "cancelled_order_session"
  | "missing_authoritative_order";

export type StripeOrderAuthorityResult =
  | {
      ok: true;
      order: Order;
      authoritativeOrderId: string;
      idempotencyRow: typeof orderIdempotencyKeys.$inferSelect | null;
      orderIdFromMeta: string | null;
      clientReferenceId: string | null;
      sessionId: string;
    }
  | {
      ok: false;
      reason: StripeOrderAuthorityFailureReason;
      orderIdFromMeta: string | null;
      clientReferenceId: string | null;
      mappedOrderId: string | null;
      sessionId: string;
    };

export async function resolveAuthoritativeStripeOrder(
  session: Stripe.Checkout.Session,
): Promise<StripeOrderAuthorityResult> {
  const sessionId = String(session.id || "");
  const orderIdFromMeta = (session.metadata?.orderId || null) as string | null;
  const clientReferenceId = (session.client_reference_id || null) as string | null;
  const idempotencyKey = (session.metadata?.idempotencyKey || null) as string | null;

  const candidateIds = [orderIdFromMeta, clientReferenceId].filter(
    (value): value is string => Boolean(value && value.trim()),
  );

  const candidateOrders = new Map<string, Order>();
  for (const candidateId of candidateIds) {
    const [order] = await db.select().from(orders).where(eq(orders.id, candidateId)).limit(1);
    if (order) {
      candidateOrders.set(order.id, order);
    }
  }

  let idempotencyRow: typeof orderIdempotencyKeys.$inferSelect | null = null;
  let mappedOrder: Order | null = null;

  if (idempotencyKey) {
    const [row] = await db
      .select()
      .from(orderIdempotencyKeys)
      .where(eq(orderIdempotencyKeys.idempotencyKey, String(idempotencyKey)))
      .limit(1);

    idempotencyRow = row ?? null;

    if (row?.orderId) {
      const [mapped] = await db.select().from(orders).where(eq(orders.id, row.orderId)).limit(1);
      mappedOrder = mapped ?? null;
    }
  }

  const authoritativeOrder = mappedOrder ?? candidateOrders.values().next().value ?? null;

  if (!authoritativeOrder) {
    return {
      ok: false,
      reason: "missing_authoritative_order",
      orderIdFromMeta,
      clientReferenceId,
      mappedOrderId: mappedOrder?.id ?? null,
      sessionId,
    };
  }

  if (authoritativeOrder.status === "cancelled") {
    return {
      ok: false,
      reason: "cancelled_order_session",
      orderIdFromMeta,
      clientReferenceId,
      mappedOrderId: mappedOrder?.id ?? null,
      sessionId,
    };
  }

  if (authoritativeOrder.stripeCheckoutSessionId !== sessionId) {
    return {
      ok: false,
      reason: "stale_session_order_mismatch",
      orderIdFromMeta,
      clientReferenceId,
      mappedOrderId: mappedOrder?.id ?? null,
      sessionId,
    };
  }

  return {
    ok: true,
    order: authoritativeOrder,
    authoritativeOrderId: authoritativeOrder.id,
    idempotencyRow,
    orderIdFromMeta,
    clientReferenceId,
    sessionId,
  };
}
