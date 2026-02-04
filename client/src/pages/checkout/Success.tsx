import { useEffect, useMemo, useRef } from "react";
import { Link, useSearch } from "wouter";
import { Layout } from "@/components/layout/Layout";
import { Button } from "@/components/ui/button";
import { useQuery } from "@tanstack/react-query";
import { Check, Flame, Loader2, Package } from "lucide-react";

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

export default function CheckoutSuccess() {
  const searchString = useSearch();
  const params = useMemo(() => new URLSearchParams(searchString), [searchString]);

  const sessionId = params.get("session_id");
  const orderId = params.get("order_id");

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

  if (!sessionId) {
    return (
      <Layout>
        <section className="py-16 md:py-24">
          <div className="container mx-auto px-4">
            <div className="max-w-md mx-auto text-center">
              <div className="w-20 h-20 mb-6 rounded-full bg-red-500/20 flex items-center justify-center mx-auto">
                <Package className="h-10 w-10 text-red-400" />
              </div>
              <h1 className="font-display text-3xl text-white tracking-tight mb-4">
                CHYBÍ STAMP
              </h1>
              <p className="font-sans text-white/60 mb-8">
                Tenhle odkaz je neúplný. Pokud jsi platil, pošli nám stamp a mrkneme na to.
              </p>

              <Button
                asChild
                className="font-heading text-sm tracking-wider bg-white text-black hover:bg-white/90"
              >
                <Link href="/" data-testid="link-missing-session-to-home">
                  ZPĚT NA HLAVNÍ STRÁNKU
                </Link>
              </Button>
            </div>
          </div>
        </section>
      </Layout>
    );
  }

  // Initial load
  if (isLoading) {
    return (
      <Layout>
        <section className="py-16 md:py-24">
          <div className="container mx-auto px-4">
            <div className="max-w-md mx-auto text-center">
              <div className="w-20 h-20 mb-6 rounded-full bg-white/10 flex items-center justify-center mx-auto">
                <Loader2 className="h-10 w-10 text-white animate-spin" />
              </div>
              <h1 className="font-display text-3xl text-white tracking-tight mb-4">
                DRŽ. KONTROLUJEME PLATBU.
              </h1>
              <p className="font-sans text-white/60">
                Systémy si to právě mezi sebou vyřizují.
              </p>
            </div>
          </div>
        </section>
      </Layout>
    );
  }

  // Waiting state (polling not_paid)
  if (isWaitingForStripe) {
    return (
      <Layout>
        <section className="py-16 md:py-24">
          <div className="container mx-auto px-4">
            <div className="max-w-md mx-auto text-center">
              <div className="w-20 h-20 mb-6 rounded-full bg-white/10 flex items-center justify-center mx-auto">
                <Loader2 className="h-10 w-10 text-white animate-spin" />
              </div>
              <h1 className="font-display text-3xl text-white tracking-tight mb-4">
                JEŠTĚ TO DOBÍHÁ…
              </h1>
              <p className="font-sans text-white/60 mb-6">
                Platba proběhla. Potvrzení je na cestě.
                <br />
                Nikdo nikam neutíká. Hlídáme to.
                <br />
                Většinou do ~30 s.
              </p>

              <div className="border border-white/15 bg-black/30 p-4 mb-6 text-left">
                <div className="font-heading text-xs tracking-wider text-white/60 mb-2">
                  SESSION STAMP
                </div>
                <div className="font-mono text-xs text-white/80 break-all">
                  {sessionId}
                </div>
                <div className="mt-3 text-xs text-white/45">
                  pokus {Math.min(pollsRef.current, MAX_POLLS)} / {MAX_POLLS}{" "}
                  {isFetching ? "· ověřuju…" : ""}
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

  // Hard fail OR timed out waiting
  if (error || !data?.success) {
    const showTimedOutCopy = timedOutWaiting;

    return (
      <Layout>
        <section className="py-16 md:py-24">
          <div className="container mx-auto px-4">
            <div className="max-w-md mx-auto text-center">
              <div className="w-20 h-20 mb-6 rounded-full bg-red-500/20 flex items-center justify-center mx-auto">
                <Package className="h-10 w-10 text-red-400" />
              </div>
              <h1 className="font-display text-3xl text-white tracking-tight mb-4">
                {showTimedOutCopy ? "JEŠTĚ TO NEDOSKOČILO" : "ROZSYPALO SE TO"}
              </h1>

              <p className="font-sans text-white/60 mb-4">
                {showTimedOutCopy
                  ? "Potvrzení je ještě na cestě. Dej tomu chvilku a zkus to znovu – nebo nám pošli stamp."
                  : "Ne u tebe. Někde po cestě. Zkus to znovu – nebo nám pošli stamp."}
              </p>

              <div className="border border-white/15 bg-black/30 p-4 mb-8 text-left">
                <div className="font-heading text-xs tracking-wider text-white/60 mb-2">
                  DEBUG STAMP
                </div>
                <div className="font-mono text-xs text-white/80 break-all">
                  session_id: {sessionId ?? "(missing)"}
                </div>
                <div className="font-mono text-xs text-white/80 break-all">
                  order_id: {orderId ?? "(missing)"}
                </div>
                <div className="font-mono text-xs text-white/70 break-all mt-2">
                  reason: {"success" in (data || {}) ? "unknown" : (data as any)?.reason ?? "unknown"}
                </div>
              </div>

              <p className="font-sans text-white/55 mb-8">
                Když se to sekne, napiš na <span className="text-white">info@zle.cz</span> a pošli nám tenhle stamp.
              </p>

              <div className="flex flex-col sm:flex-row gap-4 justify-center">
                <Button
                  onClick={() => refetch()}
                  className="font-heading text-sm tracking-wider bg-white text-black hover:bg-white/90"
                  data-testid="btn-error-refetch"
                >
                  ZKONTROLOVAT ZNOVU
                </Button>
                <Button
                  asChild
                  variant="outline"
                  className="font-heading text-sm tracking-wider border-white/20 text-white hover:bg-white/10"
                >
                  <Link href="/" data-testid="link-error-to-home">
                    ZPĚT NA HLAVNÍ STRÁNKU
                  </Link>
                </Button>
              </div>
            </div>
          </div>
        </section>
      </Layout>
    );
  }

  // Success (paid + finalized via verify/webhook)
  return (
    <Layout>
      <section className="py-10 md:py-16">
        <div className="container mx-auto px-4">
          <div className="max-w-2xl mx-auto">
            {/* RAW HEADER */}
            <div className="border border-white/15 bg-black/35 p-6 md:p-8">
              <div className="flex items-center gap-3 mb-4">
                <div className="w-12 h-12 rounded-full bg-white flex items-center justify-center shrink-0">
                  <Check className="h-7 w-7 text-black" />
                </div>
                <div className="min-w-0">
                  <div className="font-heading text-xs tracking-[0.25em] text-white/60">
                    PAYMENT LOCKED
                  </div>
                  <h1
                    className="font-display text-3xl md:text-5xl text-white tracking-tight leading-tight"
                    data-testid="text-success-title"
                  >
                    HOTOVO.
                    <span className="block text-white/85">OBJEDNÁVKA JE TVOJE.</span>
                    <span className="block text-white/70">JEĎ TO ZLE.</span>
                  </h1>
                </div>
              </div>

              <p className="font-sans text-white/65 mb-6">
                Zaplaceno. Teď makáme my — balíme, lepíme, posíláme.
              </p>

              {/* STAMP */}
              <div className="grid gap-4 md:grid-cols-2 mb-6">
                <div className="border border-white/15 bg-white/5 p-4">
                  <div className="font-heading text-xs tracking-wider text-white/60 mb-2">
                    ORDER TAG
                  </div>
                  <div className="font-mono text-sm text-white">
                    {orderId
                      ? orderId.slice(0, 8).toUpperCase()
                      : data.orderId
                        ? String(data.orderId).slice(0, 8).toUpperCase()
                        : "ZLE-NEW"}
                  </div>
                </div>
                <div className="border border-white/15 bg-white/5 p-4">
                  <div className="font-heading text-xs tracking-wider text-white/60 mb-2">
                    SESSION STAMP
                  </div>
                  <div className="font-mono text-xs text-white/80 break-all">
                    {sessionId ?? "(missing)"}
                  </div>
                </div>
              </div>

              {/* WHAT NEXT */}
              <div className="border border-white/15 bg-black/25 p-5 md:p-6 mb-6">
                <div className="flex items-center gap-2 mb-3">
                  <Flame className="h-4 w-4 text-white/70" />
                  <h2 className="font-heading text-sm font-bold text-white tracking-wider">
                    CO SE STANE TEĎ
                  </h2>
                </div>
                <ul className="space-y-3">
                  <li className="flex items-start gap-3">
                    <span className="w-6 h-6 rounded-full bg-white/10 flex items-center justify-center flex-shrink-0 mt-0.5">
                      <span className="text-xs font-bold text-white">1</span>
                    </span>
                    <span className="font-sans text-sm text-white/70">
                      Přijde ti potvrzení na email.
                    </span>
                  </li>
                  <li className="flex items-start gap-3">
                    <span className="w-6 h-6 rounded-full bg-white/10 flex items-center justify-center flex-shrink-0 mt-0.5">
                      <span className="text-xs font-bold text-white">2</span>
                    </span>
                    <span className="font-sans text-sm text-white/70">
                      Do 1–2 dnů to balíme a posíláme.
                    </span>
                  </li>
                  <li className="flex items-start gap-3">
                    <span className="w-6 h-6 rounded-full bg-white/10 flex items-center justify-center flex-shrink-0 mt-0.5">
                      <span className="text-xs font-bold text-white">3</span>
                    </span>
                    <span className="font-sans text-sm text-white/70">
                      Dostaneš tracking a jedeš.
                    </span>
                  </li>
                </ul>
              </div>

              <div className="flex flex-col sm:flex-row gap-4">
                <Button
                  asChild
                  className="font-heading text-sm tracking-wider bg-white text-black hover:bg-white/90"
                >
                  <Link href="/shop" data-testid="link-success-to-shop">
                    ZPĚT DO SHOPU
                  </Link>
                </Button>
                <Button
                  asChild
                  variant="outline"
                  className="font-heading text-sm tracking-wider border-white/20 text-white hover:bg-white/10"
                >
                  <Link href="/" data-testid="link-success-to-home">
                    HLAVNÍ STRÁNKA
                  </Link>
                </Button>
              </div>

              <div className="mt-6 text-xs text-white/45">
                Pokud něco nesedí, napiš nám a připoj{" "}
                <span className="text-white/70">SESSION STAMP</span>.
              </div>
            </div>
          </div>
        </div>
      </section>
    </Layout>
  );
}
