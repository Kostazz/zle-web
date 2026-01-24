import { useEffect } from "react";
import { Link, useSearch } from "wouter";
import { Layout } from "@/components/layout/Layout";
import { Button } from "@/components/ui/button";
import { useQuery } from "@tanstack/react-query";
import { Check, Flame, Loader2, Package } from "lucide-react";

export default function CheckoutSuccess() {
  const searchString = useSearch();
  const params = new URLSearchParams(searchString);
  const sessionId = params.get("session_id");
  const orderId = params.get("order_id");

  const { data, isLoading, error } = useQuery({
    queryKey: ["/api/checkout/verify", sessionId],
    queryFn: async () => {
      const response = await fetch(`/api/checkout/verify/${sessionId}`);
      return response.json();
    },
    enabled: !!sessionId,
  });

  useEffect(() => {
    // no-op: keep for future client-side side effects (analytics / order storage)
  }, [data]);

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
                OVĚŘUJI PLATBU...
              </h1>
              <p className="font-sans text-white/60">
                Prosím počkej, ověřujeme tvoji platbu.
              </p>
            </div>
          </div>
        </section>
      </Layout>
    );
  }

  if (error || !data?.success) {
    return (
      <Layout>
        <section className="py-16 md:py-24">
          <div className="container mx-auto px-4">
            <div className="max-w-md mx-auto text-center">
              <div className="w-20 h-20 mb-6 rounded-full bg-red-500/20 flex items-center justify-center mx-auto">
                <Package className="h-10 w-10 text-red-400" />
              </div>
              <h1 className="font-display text-3xl text-white tracking-tight mb-4">
                NĚCO SE POKAZILO
              </h1>
              <p className="font-sans text-white/60 mb-4">
                Platba možná proběhla, ale nepodařilo se ji ověřit.
              </p>
              <div className="border border-white/15 bg-black/30 p-4 mb-8 text-left">
                <div className="font-heading text-xs tracking-wider text-white/60 mb-2">
                  DEBUG STAMP
                </div>
                <div className="font-mono text-xs text-white/80 break-all">
                  session_id: {sessionId ?? "(missing)"}
                </div>
              </div>
              <p className="font-sans text-white/55 mb-8">
                Kdyžtak napiš na <span className="text-white">info@zle.cz</span>{" "}
                a pošli nám tenhle stamp.
              </p>
              <Button
                asChild
                className="font-heading text-sm tracking-wider bg-white text-black hover:bg-white/90"
              >
                <Link href="/" data-testid="link-error-to-home">
                  ZPĚT NA HLAVNÍ STRÁNKU
                </Link>
              </Button>
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
                    OBJEDNÁVKA JE HOTOVÁ.
                    <span className="block text-white/70">JEĎ TO ZLE.</span>
                  </h1>
                </div>
              </div>

              <p className="font-sans text-white/65 mb-6">
                Platba prošla. Teď to bereme my — balíme, lepíme, posíláme.
              </p>

              {/* STAMP */}
              <div className="grid gap-4 md:grid-cols-2 mb-6">
                <div className="border border-white/15 bg-white/5 p-4">
                  <div className="font-heading text-xs tracking-wider text-white/60 mb-2">
                    ORDER TAG
                  </div>
                  <div className="font-mono text-sm text-white">
                    {orderId ? orderId.slice(0, 8).toUpperCase() : "ZLE-NEW"}
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
