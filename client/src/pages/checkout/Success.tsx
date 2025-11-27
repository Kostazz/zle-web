import { useEffect, useState } from "react";
import { Link, useSearch } from "wouter";
import { Layout } from "@/components/layout/Layout";
import { Button } from "@/components/ui/button";
import { useQuery } from "@tanstack/react-query";
import { Check, Loader2, Package } from "lucide-react";

export default function CheckoutSuccess() {
  const searchString = useSearch();
  const params = new URLSearchParams(searchString);
  const sessionId = params.get("session_id");
  const orderId = params.get("order_id");
  const [isVerified, setIsVerified] = useState(false);

  const { data, isLoading, error } = useQuery({
    queryKey: ["/api/checkout/verify", sessionId],
    queryFn: async () => {
      const response = await fetch(`/api/checkout/verify/${sessionId}`);
      return response.json();
    },
    enabled: !!sessionId,
  });

  useEffect(() => {
    if (data?.success) {
      setIsVerified(true);
    }
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
              <p className="font-sans text-white/60 mb-8">
                Nepodařilo se ověřit platbu. Kontaktuj nás prosím na info@zle.cz
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
      <section className="py-16 md:py-24">
        <div className="container mx-auto px-4">
          <div className="max-w-md mx-auto text-center">
            <div className="w-20 h-20 mb-6 rounded-full bg-white flex items-center justify-center mx-auto">
              <Check className="h-10 w-10 text-black" />
            </div>
            <h1 
              className="font-display text-3xl text-white tracking-tight mb-4"
              data-testid="text-success-title"
            >
              DÍKY ZA OBJEDNÁVKU!
            </h1>
            <p className="font-sans text-white/60 mb-2">
              Tvoje platba byla úspěšně přijata.
            </p>
            {orderId && (
              <p className="font-sans text-white/40 text-sm mb-8">
                Číslo objednávky: <span className="text-white font-mono">{orderId.slice(0, 8).toUpperCase()}</span>
              </p>
            )}
            
            <div className="border border-white/20 bg-white/5 p-6 mb-8 text-left">
              <h3 className="font-heading text-sm font-bold text-white tracking-wider mb-4">
                CO SE STANE DÁL?
              </h3>
              <ul className="space-y-3">
                <li className="flex items-start gap-3">
                  <span className="w-6 h-6 rounded-full bg-white/10 flex items-center justify-center flex-shrink-0 mt-0.5">
                    <span className="text-xs font-bold text-white">1</span>
                  </span>
                  <span className="font-sans text-sm text-white/70">
                    Pošleme ti potvrzení na email
                  </span>
                </li>
                <li className="flex items-start gap-3">
                  <span className="w-6 h-6 rounded-full bg-white/10 flex items-center justify-center flex-shrink-0 mt-0.5">
                    <span className="text-xs font-bold text-white">2</span>
                  </span>
                  <span className="font-sans text-sm text-white/70">
                    Připravíme tvoji objednávku do 1-2 dnů
                  </span>
                </li>
                <li className="flex items-start gap-3">
                  <span className="w-6 h-6 rounded-full bg-white/10 flex items-center justify-center flex-shrink-0 mt-0.5">
                    <span className="text-xs font-bold text-white">3</span>
                  </span>
                  <span className="font-sans text-sm text-white/70">
                    Odešleme ti balík s tracking číslem
                  </span>
                </li>
              </ul>
            </div>

            <div className="flex flex-col sm:flex-row gap-4 justify-center">
              <Button
                asChild
                className="font-heading text-sm tracking-wider bg-white text-black hover:bg-white/90"
              >
                <Link href="/shop" data-testid="link-success-to-shop">
                  POKRAČOVAT V NÁKUPU
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
          </div>
        </div>
      </section>
    </Layout>
  );
}
