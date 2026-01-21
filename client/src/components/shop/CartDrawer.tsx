import { Link } from "wouter";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useCart } from "@/lib/cart-context";
import { CartItem } from "./CartItem";
import { ShoppingBag, ArrowRight } from "lucide-react";

export function CartDrawer() {
  const { items, total, isOpen, setIsOpen } = useCart();

  return (
    <Sheet open={isOpen} onOpenChange={setIsOpen}>
      <SheetContent className="w-full sm:max-w-md bg-black border-l border-white/20 flex flex-col">
        <SheetHeader>
          <SheetTitle className="font-display text-2xl text-white tracking-tight flex items-center gap-3">
            <ShoppingBag className="h-6 w-6" />
            KOŠÍK
          </SheetTitle>
        </SheetHeader>

        {items.length === 0 ? (
          <div className="flex-1 flex flex-col items-center justify-center text-center px-4">
            <div className="w-20 h-20 mb-6 rounded-full bg-white/5 flex items-center justify-center">
              <ShoppingBag className="h-10 w-10 text-white/30" />
            </div>
            <p className="font-heading text-lg text-white mb-2">
              Košík je prázdný
            </p>
            <p className="font-sans text-sm text-white/60 mb-8">
              Podívej se do shopu a najdi něco pro sebe.
            </p>
            <Button
              onClick={() => setIsOpen(false)}
              className="font-heading text-sm tracking-wider bg-white text-black hover:bg-white/90"
              asChild
            >
              <Link href="/shop" data-testid="link-cart-to-shop">
                JÍT DO SHOPU
              </Link>
            </Button>
          </div>
        ) : (
          <>
            <ScrollArea className="flex-1 -mx-6 px-6">
              <div className="space-y-4 py-4">
                {items.map((item) => (
                  <CartItem key={`${item.productId}-${item.size}`} item={item} />
                ))}
              </div>
            </ScrollArea>

            <div className="border-t border-white/20 pt-6 mt-auto">
              <div className="flex items-center justify-between mb-6">
                <span className="font-heading text-lg text-white">CELKEM</span>
                <span 
                  className="font-sans text-2xl font-bold text-white"
                  data-testid="text-cart-total"
                >
                  {total} Kč
                </span>
              </div>

              <Button
                className="w-full font-heading text-sm tracking-wider bg-white text-black hover:bg-white/90 py-6 group"
                onClick={() => setIsOpen(false)}
                asChild
              >
                <Link href="/checkout" data-testid="link-cart-checkout">
                  POKRAČOVAT K OBJEDNÁVCE
                  <ArrowRight className="ml-2 h-4 w-4 transition-transform group-hover:translate-x-1" />
                </Link>
              </Button>
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
