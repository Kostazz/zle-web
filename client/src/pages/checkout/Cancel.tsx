import { useEffect } from "react";
import { Link, useSearch } from "wouter";
import { Layout } from "@/components/layout/Layout";
import { Button } from "@/components/ui/button";
import { useMutation } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { XCircle } from "lucide-react";

export default function CheckoutCancel() {
  const searchString = useSearch();
  const params = new URLSearchParams(searchString);
  const orderId = params.get("order_id");

  const cancelMutation = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest("POST", `/api/checkout/cancel/${id}`);
    },
  });

  useEffect(() => {
    if (orderId) {
      cancelMutation.mutate(orderId);
    }
  }, [orderId]);

  return (
    <Layout>
      <section className="py-16 md:py-24">
        <div className="container mx-auto px-4">
          <div className="max-w-md mx-auto text-center">
            <div className="w-20 h-20 mb-6 rounded-full bg-white/10 flex items-center justify-center mx-auto">
              <XCircle className="h-10 w-10 text-white/60" />
            </div>
            <h1 
              className="font-display text-3xl text-white tracking-tight mb-4"
              data-testid="text-cancel-title"
            >
              PLATBA ZRUŠENA
            </h1>
            <p className="font-sans text-white/60 mb-8">
              Tvoje objednávka nebyla dokončena. Žádné peníze nebyly strženy.
            </p>
            
            <div className="flex flex-col sm:flex-row gap-4 justify-center">
              <Button
                asChild
                className="font-heading text-sm tracking-wider bg-white text-black hover:bg-white/90"
              >
                <Link href="/checkout" data-testid="link-cancel-to-checkout">
                  ZKUSIT ZNOVU
                </Link>
              </Button>
              <Button
                asChild
                variant="outline"
                className="font-heading text-sm tracking-wider border-white/20 text-white hover:bg-white/10"
              >
                <Link href="/shop" data-testid="link-cancel-to-shop">
                  ZPĚT DO SHOPU
                </Link>
              </Button>
            </div>
          </div>
        </div>
      </section>
    </Layout>
  );
}
