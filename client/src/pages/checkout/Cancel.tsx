import { useEffect, useMemo, useState } from "react";
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
  const tokenFromQuery = params.get("token");
  const [tokenError, setTokenError] = useState<string | null>(null);

  const cancelMutation = useMutation({
    mutationFn: async ({ id, token }: { id: string; token: string }) => {
      const encodedToken = encodeURIComponent(token);
      await apiRequest("POST", `/api/checkout/cancel/${id}?token=${encodedToken}`);
    },
  });

  useEffect(() => {
    if (!orderId) return;

    const sessionStorageKey = `zle_order_token_${orderId}`;
    const queryToken = (tokenFromQuery || "").trim();

    if (queryToken) {
      sessionStorage.setItem(sessionStorageKey, queryToken);

      const safeParams = new URLSearchParams(searchString);
      safeParams.delete("token");
      const safeSearch = safeParams.toString();
      window.history.replaceState(null, "", safeSearch ? `/cancel?${safeSearch}` : "/cancel");
    }

    const effectiveToken = queryToken || sessionStorage.getItem(sessionStorageKey) || "";

    if (!effectiveToken) {
      setTokenError("Nelze zrušit objednávku – chybí bezpečnostní token.");
      return;
    }

    cancelMutation.mutate({ id: orderId, token: effectiveToken });
  }, [orderId, tokenFromQuery, searchString, cancelMutation]);

  return (
    <Layout>
      <section className="py-10 md:py-16">
        <div className="container mx-auto px-4">
          <div className="max-w-2xl mx-auto space-y-4">
            {tokenError && (
              <div className="border border-red-400/30 bg-red-500/10 p-4 text-sm text-red-100">
                {tokenError}
              </div>
            )}
            {!tokenError && cancelMutation.isError && (
              <div className="border border-red-400/30 bg-red-500/10 p-4 text-sm text-red-100">
                Nepodařilo se zrušit objednávku. Zkontroluj odkaz nebo to zkus znovu.
              </div>
            )}
            <CheckoutResult status="cancel" orderId={orderId} paymentMethod={paymentMethod} />
          </div>
        </div>
      </section>
    </Layout>
  );
}
