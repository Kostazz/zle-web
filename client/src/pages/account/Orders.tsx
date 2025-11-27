import { useEffect } from "react";
import { Layout } from "@/components/layout/Layout";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { useQuery } from "@tanstack/react-query";
import type { Order } from "@shared/schema";
import { Package, ArrowLeft, Clock, CheckCircle, Truck, XCircle } from "lucide-react";
import { Link } from "wouter";
import { Skeleton } from "@/components/ui/skeleton";

const statusConfig: Record<string, { label: string; icon: any; color: string }> = {
  pending: { label: "Ceka na zpracovani", icon: Clock, color: "text-yellow-400" },
  confirmed: { label: "Potvrzeno", icon: CheckCircle, color: "text-green-400" },
  shipped: { label: "Odeslano", icon: Truck, color: "text-blue-400" },
  delivered: { label: "Doruceno", icon: CheckCircle, color: "text-green-400" },
  cancelled: { label: "Zruseno", icon: XCircle, color: "text-red-400" },
};

function OrderSkeleton() {
  return (
    <div className="border border-white/20 bg-white/5 p-6">
      <div className="flex items-center justify-between mb-4">
        <Skeleton className="h-5 w-32 bg-white/10" />
        <Skeleton className="h-4 w-24 bg-white/10" />
      </div>
      <Skeleton className="h-4 w-48 bg-white/10 mb-2" />
      <Skeleton className="h-6 w-24 bg-white/10" />
    </div>
  );
}

export default function Orders() {
  const { toast } = useToast();
  const { isAuthenticated, isLoading: authLoading } = useAuth();

  useEffect(() => {
    if (!authLoading && !isAuthenticated) {
      toast({
        title: "Neprihlasen",
        description: "Pro zobrazeni objednavek se musis prihlasit.",
        variant: "destructive",
      });
      setTimeout(() => {
        window.location.href = "/api/login";
      }, 500);
    }
  }, [isAuthenticated, authLoading, toast]);

  const { data: orders, isLoading } = useQuery<Order[]>({
    queryKey: ["/api/user/orders"],
    enabled: isAuthenticated,
  });

  if (authLoading || (!isAuthenticated && !authLoading)) {
    return (
      <Layout>
        <section className="py-16 md:py-24">
          <div className="container mx-auto px-4">
            <div className="max-w-3xl mx-auto">
              <div className="space-y-4">
                {Array.from({ length: 3 }).map((_, i) => (
                  <OrderSkeleton key={i} />
                ))}
              </div>
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
          <div className="max-w-3xl mx-auto">
            <Link href="/" className="inline-flex items-center gap-2 text-white/60 hover:text-white transition-colors mb-8">
              <ArrowLeft className="h-4 w-4" />
              <span className="font-heading text-sm tracking-wider">ZPET</span>
            </Link>

            <h1 className="font-display text-4xl md:text-5xl text-white tracking-tight mb-12">
              MOJE OBJEDNAVKY
            </h1>

            {isLoading ? (
              <div className="space-y-4">
                {Array.from({ length: 3 }).map((_, i) => (
                  <OrderSkeleton key={i} />
                ))}
              </div>
            ) : orders && orders.length > 0 ? (
              <div className="space-y-4">
                {orders.map((order) => {
                  const status = statusConfig[order.status] || statusConfig.pending;
                  const StatusIcon = status.icon;
                  const items = JSON.parse(order.items);
                  const date = order.createdAt ? new Date(order.createdAt).toLocaleDateString("cs-CZ") : "";

                  return (
                    <div 
                      key={order.id}
                      className="border border-white/20 bg-white/5 p-6"
                      data-testid={`order-${order.id}`}
                    >
                      <div className="flex items-center justify-between mb-4">
                        <div className="flex items-center gap-3">
                          <Package className="h-5 w-5 text-white/60" />
                          <span className="font-heading text-sm font-bold text-white tracking-wider">
                            #{order.id.slice(0, 8).toUpperCase()}
                          </span>
                        </div>
                        <div className={`flex items-center gap-2 ${status.color}`}>
                          <StatusIcon className="h-4 w-4" />
                          <span className="font-heading text-xs tracking-wider">
                            {status.label}
                          </span>
                        </div>
                      </div>

                      <div className="space-y-2 mb-4">
                        {items.slice(0, 3).map((item: any, index: number) => (
                          <div key={index} className="flex items-center justify-between text-sm">
                            <span className="text-white/70">
                              {item.name} ({item.size}) x{item.quantity}
                            </span>
                            <span className="text-white font-semibold">
                              {item.price * item.quantity} Kc
                            </span>
                          </div>
                        ))}
                        {items.length > 3 && (
                          <p className="text-xs text-white/50">
                            +{items.length - 3} dalsich polozek
                          </p>
                        )}
                      </div>

                      <div className="flex items-center justify-between pt-4 border-t border-white/10">
                        <span className="text-xs text-white/50">{date}</span>
                        <span className="font-sans text-lg font-bold text-white">
                          {order.total} Kc
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="text-center py-16">
                <div className="w-20 h-20 mb-6 rounded-full bg-white/5 flex items-center justify-center mx-auto">
                  <Package className="h-10 w-10 text-white/30" />
                </div>
                <h2 className="font-heading text-xl text-white mb-2">
                  ZATIM ZADNE OBJEDNAVKY
                </h2>
                <p className="font-sans text-white/60 mb-8">
                  Jakmile si neco objednas, uvidis to tady.
                </p>
                <Link 
                  href="/shop"
                  className="inline-block font-heading text-sm tracking-wider bg-white text-black px-6 py-3 hover:bg-white/90 transition-colors"
                >
                  JDI DO SHOPU
                </Link>
              </div>
            )}
          </div>
        </div>
      </section>
    </Layout>
  );
}
