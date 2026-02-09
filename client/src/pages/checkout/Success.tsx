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
  subtotalCzk?: number | null;
  shippingCzk?: number | null;
  codCzk?: number | null;
  totalCzk?: number | null;
  shippingLabel?: string | null;
};

export default function CheckoutSuccess() {
  const searchString = useSearch();
  const params = useMemo(() => new URLSearchParams(searchString), [searchString]);

  const sessionId = params.get("session_id");
  const orderIdParam = params.get("order_id");
  const pmParam = params.get("pm") as PaymentMethod | null;

  const lastLocalOrder = useMemo(() => getLastOrder(), []);
  const fallbackOrderId = orderIdParam || lastLocalOrder?.id || null;

  // Polling settings (fail-safe for Stripe redirect timing + webhook delay)
  const MAX_POLLS = 12; // ~30s if interval 2500ms
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

      // Done
      if (d.success) return false;

      // Only poll on "not_paid" (common timing issue)
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
    // Count polls while we're in the "not_paid" waiting state.
    if (data && !data.success && data.reason === "not_paid") {
      pollsRef.current += 1;
    }
  }, [data]);

  const isWaitingForStripe =
    !!sessionId &&
    !!data &&
    !data.success &&
    data.reason === "not_paid" &&
    pollsRef.current < MAX_POLLS;

  const timedOutWaiting =
    !!sessionId &&
    !!data &&
    !data.success &&
    data.reason === "not_paid" &&
    pollsRef.current >= MAX_POLLS;

  const resolvedOrderId = sessionId
    ? data && data.success
      ? data.orderId || orderIdParam || null
      : orderIdParam || null
    : fallbackOrderId;

  const { data: orderSummary, isLoading: isSummaryLoading } = useQuery<OrderSummaryResponse>({
    queryKey: ["/api/checkout/order-summary", resolvedOrderId],
    queryFn: async () => {
      const response = await fetch(`/api/checkout/order-summary/${encodeURIComponent(String(resolvedOrderId || ""))}`);
      return response.json();
    },
    enabled: !!resolvedOrderId,
    retry: false,
    refetchOnWindowFocus: false,
  });

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

  if (isWaitingForStripe) {
    return (
      <Layout>
        <section className="py-16 md:py-24">
          <div className="container mx-auto px-4">
            <div className="max-w-md mx-auto text-center">
              <div className="w-20 h-20 mb-6 rounded-full bg-white/10 flex items-center justify-center mx-auto">
                <Loader2 className="h-10 w-10 text-white animate-spin" />
              </div>
              <h1 className="font-display text-3xl text-white tracking-tight mb-4">JEŠTĚ TO DOBÍHÁ…</h1>
              <p className="font-sans text-white/60 mb-6">
                Platba proběhla. Potvrzení je na cestě.
                <br />
                Nikdo nikam neutíká. Hlídáme to.
                <br />
                Většinou do ~30 s.
              </p>

              <div className="border border-white/15 bg-black/30 p-4 mb-6 text-left">
                <div className="font-heading text-xs tracking-wider text-white/60 mb-2">SESSION STAMP</div>
                <div className="font-mono text-xs text-white/80 break-all">{sessionId}</div>
                <div className="mt-3 text-xs text-white/45">
                  pokus {Math.min(pollsRef.current, MAX_POLLS)} / {MAX_POLLS} {isFetching ? "· ověřuju…" : ""}
                </div>
              </div>

              <Button
                onClick={() => refetch()}
                className="font-heading text-sm tracking-wider bg-white text-black hover:bg-white/90"
                data-testid="btn-success-manual-refetch"
              >
                ZKONTROLOVAT ZNOVU
              </Button>
            </div>
          </div>
        </section>
      </Layout>
    );
  }

  if ((sessionId && (error || !data?.success)) || timedOutWaiting) {
    return (
      <Layout>
        <section className="py-10 md:py-16">
          <div className="container mx-auto px-4">
            <div className="max-w-2xl mx-auto">
              <CheckoutResult status="cancel" orderId={resolvedOrderId} paymentMethod={pmParam} />
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

  if (!resolvedOrderId) {
    return (
      <Layout>
        <section className="py-10 md:py-16">
          <div className="container mx-auto px-4">
            <div className="max-w-2xl mx-auto">
              <CheckoutResult status="cancel" orderId={null} paymentMethod={pmParam} />
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
              paymentMethod={orderSummary?.paymentMethod ?? pmParam}
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
