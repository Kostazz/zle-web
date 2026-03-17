import { useEffect, useMemo, useRef } from "react";
import { useSearch } from "wouter";
import { Layout } from "@/components/layout/Layout";
import { Button } from "@/components/ui/button";
import { useQuery } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { getLastOrder } from "@/utils/orderStorage";
import { CheckoutResult } from "@/components/checkout/CheckoutResult";
import type { PaymentMethod } from "@shared/schema";

type VerifyResponse =
  | {
      success: true;
      orderId?: string | null;
      paymentStatus?: string | null;
      amountTotalCzk?: number | null;
      currency?: string | null;
    }
  | {
      success: false;
      reason?: string;
      paymentStatus?: string | null;
      orderId?: string | null;
      retryAfterMs?: number | null;
    };

type OrderSummaryResponse = {
  success: boolean;
  orderId?: string;
  paymentMethod?: PaymentMethod;
  paymentStatus?: string | null;
  subtotalCzk?: number | null;
  shippingCzk?: number | null;
  codCzk?: number | null;
  totalCzk?: number | null;
  shippingLabel?: string | null;
};

const STRIPE_LIKE_METHODS: PaymentMethod[] = ["card", "gpay", "applepay"];

export default function CheckoutSuccess() {
  const searchString = useSearch();
  const params = useMemo(() => new URLSearchParams(searchString), [searchString]);

  const sessionId = params.get("session_id");
  const orderIdParam = params.get("order_id");
  const pmParam = params.get("pm") as PaymentMethod | null;

  const lastLocalOrder = useMemo(() => getLastOrder(), []);
  const canUseOfflineFallback = pmParam === "cod" || pmParam === "in_person";

  const MAX_POLLS = 12;
  const DEFAULT_RETRY_MS = 2500;
  const pollsRef = useRef(0);

  const { data, isLoading, error, refetch, isFetching } = useQuery<VerifyResponse>({
    queryKey: ["/api/checkout/verify", sessionId],
    queryFn: async () => {
      const response = await fetch(`/api/checkout/verify/${sessionId}`);
      return response.json();
    },
    enabled: !!sessionId,
    retry: false,
    refetchInterval: (query) => {
      const d = query.state.data as VerifyResponse | undefined;
      if (!d) return false;
      if (d.success) return false;
      if (d.reason === "not_paid") {
        if (pollsRef.current >= MAX_POLLS) return false;
        const suggested = typeof d.retryAfterMs === "number" ? d.retryAfterMs : DEFAULT_RETRY_MS;
        return suggested;
      }
      return false;
    },
    refetchOnWindowFocus: false,
  });

  useEffect(() => {
    if (data && !data.success && data.reason === "not_paid") {
      pollsRef.current += 1;
    }
  }, [data]);

  const isWaitingForStripe =
    !!sessionId && !!data && !data.success && data.reason === "not_paid" && pollsRef.current < MAX_POLLS;
  const timedOutWaiting =
    !!sessionId && !!data && !data.success && data.reason === "not_paid" && pollsRef.current >= MAX_POLLS;
  const hasVerifiedStripeSuccess = Boolean(sessionId && data?.success && data.orderId);
  const hasConflictRedirectFallback = !sessionId && Boolean(orderIdParam);

  const resolvedOrderId = hasVerifiedStripeSuccess
    ? (data as Extract<VerifyResponse, { success: true }>).orderId || null
    : hasConflictRedirectFallback
      ? orderIdParam
      : canUseOfflineFallback
        ? lastLocalOrder?.id || null
        : null;

  const { data: orderSummary, isLoading: isSummaryLoading } = useQuery<OrderSummaryResponse>({
    queryKey: ["/api/checkout/order-summary", resolvedOrderId],
    queryFn: async () => {
      const response = await fetch(`/api/checkout/order-summary/${encodeURIComponent(String(resolvedOrderId || ""))}`);
      return response.json();
    },
    enabled: !!resolvedOrderId && (hasVerifiedStripeSuccess || canUseOfflineFallback),
    retry: false,
    refetchOnWindowFocus: false,
  });

  const effectivePaymentMethod = orderSummary?.paymentMethod ?? pmParam;
  const isStripeLikePaymentMethod = !!effectivePaymentMethod && STRIPE_LIKE_METHODS.includes(effectivePaymentMethod);

  if (sessionId && isLoading) {
    return (
      <Layout>
        <section className="py-16 md:py-24">
          <div className="container mx-auto px-4">
            <div className="max-w-md mx-auto text-center">
              <div className="w-20 h-20 mb-6 rounded-full bg-white/10 flex items-center justify-center mx-auto">
                <Loader2 className="h-10 w-10 text-white animate-spin" />
              </div>
              <h1 className="font-display text-3xl text-white tracking-tight mb-4">DRŽ. KONTROLUJEME PLATBU.</h1>
              <p className="font-sans text-white/60">Systémy si to právě mezi sebou vyřizují.</p>
            </div>
          </div>
        </section>
      </Layout>
    );
  }

  if (isWaitingForStripe || timedOutWaiting) {
    return (
      <Layout>
        <section className="py-16 md:py-24">
          <div className="container mx-auto px-4">
            <div className="max-w-md mx-auto text-center">
              <div className="w-20 h-20 mb-6 rounded-full bg-white/10 flex items-center justify-center mx-auto">
                <Loader2 className="h-10 w-10 text-white animate-spin" />
              </div>
              <h1 className="font-display text-3xl text-white tracking-tight mb-4">PLATBA SE JEŠTĚ ZPRACOVÁVÁ</h1>
              <p className="font-sans text-white/60 mb-6">
                Potvrzení od Stripe ještě nedorazilo. Zkus ruční kontrolu nebo se vrať za chvíli.
              </p>
              <div className="border border-white/15 bg-black/30 p-4 mb-6 text-left">
                <div className="font-heading text-xs tracking-wider text-white/60 mb-2">SESSION STAMP</div>
                <div className="font-mono text-xs text-white/80 break-all">{sessionId}</div>
                <div className="mt-3 text-xs text-white/45">
                  pokus {Math.min(pollsRef.current, MAX_POLLS)} / {MAX_POLLS} {isFetching ? "· ověřuju…" : ""}
                </div>
              </div>
              <div className="flex flex-col gap-3">
                <Button
                  onClick={() => refetch()}
                  className="font-heading text-sm tracking-wider bg-white text-black hover:bg-white/90"
                  data-testid="btn-success-manual-refetch"
                >
                  ZKONTROLOVAT ZNOVU
                </Button>
                <Button asChild variant="outline" className="font-heading text-sm tracking-wider border-white/25 text-white hover:bg-white/10">
                  <a href="/shop">VRÁTIT SE POZDĚJI</a>
                </Button>
              </div>
            </div>
          </div>
        </section>
      </Layout>
    );
  }

  if (isSummaryLoading) {
    return (
      <Layout>
        <section className="py-16 md:py-24">
          <div className="container mx-auto px-4">
            <div className="max-w-md mx-auto text-center">
              <div className="w-20 h-20 mb-6 rounded-full bg-white/10 flex items-center justify-center mx-auto">
                <Loader2 className="h-10 w-10 text-white animate-spin" />
              </div>
              <h1 className="font-display text-3xl text-white tracking-tight mb-4">NAČÍTÁME OBJEDNÁVKU…</h1>
              <p className="font-sans text-white/60">Chvilku počkej, připravujeme shrnutí.</p>
            </div>
          </div>
        </section>
      </Layout>
    );
  }

  const shouldRenderCancel =
    (sessionId && (error || !data?.success || !hasVerifiedStripeSuccess)) ||
    (!sessionId && isStripeLikePaymentMethod && !hasConflictRedirectFallback && !canUseOfflineFallback);

  if (shouldRenderCancel || !resolvedOrderId) {
    return (
      <Layout>
        <section className="py-10 md:py-16">
          <div className="container mx-auto px-4">
            <div className="max-w-2xl mx-auto">
              <CheckoutResult status="cancel" orderId={resolvedOrderId} paymentMethod={effectivePaymentMethod ?? pmParam} />
            </div>
          </div>
        </section>
      </Layout>
    );
  }

  return (
    <Layout>
      <section className="py-10 md:py-16">
        <div className="container mx-auto px-4">
          <div className="max-w-2xl mx-auto">
            <CheckoutResult
              status="success"
              orderId={resolvedOrderId}
              paymentMethod={effectivePaymentMethod}
              totals={
                orderSummary
                  ? {
                      subtotalCzk: orderSummary.subtotalCzk ?? null,
                      shippingCzk: orderSummary.shippingCzk ?? null,
                      codCzk: orderSummary.codCzk ?? null,
                      totalCzk: orderSummary.totalCzk ?? null,
                      shippingLabel: orderSummary.shippingLabel ?? null,
                    }
                  : null
              }
            />
          </div>
        </div>
      </section>
    </Layout>
  );
}
