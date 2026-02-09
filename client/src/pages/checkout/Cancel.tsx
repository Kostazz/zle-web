import { useEffect, useMemo } from "react";
import { useSearch } from "wouter";
import { Layout } from "@/components/layout/Layout";
import { useMutation } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { CheckoutResult } from "@/components/checkout/CheckoutResult";
import type { PaymentMethod } from "@shared/schema";

export default function CheckoutCancel() {
  const searchString = useSearch();
  const params = useMemo(() => new URLSearchParams(searchString), [searchString]);
  const orderId = params.get("order_id");
  const paymentMethod = params.get("pm") as PaymentMethod | null;

  const cancelMutation = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest("POST", `/api/checkout/cancel/${id}`);
    },
  });

  useEffect(() => {
    if (orderId) {
      cancelMutation.mutate(orderId);
    }
  }, [orderId, cancelMutation]);

  return (
    <Layout>
      <section className="py-10 md:py-16">
        <div className="container mx-auto px-4">
          <div className="max-w-2xl mx-auto">
            <CheckoutResult status="cancel" orderId={orderId} paymentMethod={paymentMethod} />
          </div>
        </div>
      </section>
    </Layout>
  );
}
