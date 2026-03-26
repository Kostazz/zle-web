import { useEffect, useRef, useState } from "react";
import { Link, useLocation } from "wouter";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useCart } from "@/lib/cart-context";
import { useOverlay } from "@/lib/overlay-context";
import { CartItem } from "./CartItem";
import { ShoppingBag, ArrowRight } from "lucide-react";
import { formatSizeLabel } from "@/lib/product-ui";

const CART_INLINE_STATUS_EVENT = "zle:cart-inline-status";
const INLINE_STATUS_HIDE_DELAY = 3000;

type CartInlineStatus = {
  name: string;
  size: string;
  quantity: number;
};

export function CartDrawer() {
  const { items, total } = useCart();
  const [, setLocation] = useLocation();
  const [inlineStatus, setInlineStatus] = useState<CartInlineStatus | null>(null);
  const statusTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const { isOpen, closeOverlay, closeOverlayAndWait } = useOverlay();

  const isCartOpen = isOpen("cart");

  const handleClose = () => {
    closeOverlay("cart");
  };

  const handleCheckout = async () => {
    await closeOverlayAndWait("cart");
    setLocation("/checkout");
  };

  useEffect(() => {
    const handleInlineStatus = (event: Event) => {
      const customEvent = event as CustomEvent<CartInlineStatus>;
      if (!customEvent.detail) {
        return;
      }

      setInlineStatus(customEvent.detail);

      if (statusTimeoutRef.current) {
        clearTimeout(statusTimeoutRef.current);
        statusTimeoutRef.current = null;
      }

      statusTimeoutRef.current = setTimeout(() => {
        setInlineStatus(null);
        statusTimeoutRef.current = null;
      }, INLINE_STATUS_HIDE_DELAY);
    };

    window.addEventListener(CART_INLINE_STATUS_EVENT, handleInlineStatus);

    return () => {
      window.removeEventListener(CART_INLINE_STATUS_EVENT, handleInlineStatus);
      if (statusTimeoutRef.current) {
        clearTimeout(statusTimeoutRef.current);
        statusTimeoutRef.current = null;
      }
    };
  }, []);

  return (
    <Sheet
      open={isCartOpen}
      onOpenChange={(open) => {
        if (!open) {
          handleClose();
        }
      }}
    >
      <SheetContent className="w-full sm:max-w-md bg-black border-l border-white/20 flex flex-col [&>button]:text-white [&>button]:hover:text-white [&>button]:focus-visible:ring-white/60">
        <SheetHeader>
          <SheetTitle className="font-display text-2xl text-white tracking-tight flex items-center gap-3">
            <ShoppingBag className="h-6 w-6" />
            KOŠÍK
          </SheetTitle>
        </SheetHeader>

        {inlineStatus && (
          <div className="mt-4 border border-white/20 bg-white/[0.03] px-4 py-3">
            <p className="font-heading text-xs tracking-wider text-white">PŘIDÁNO DO KOŠÍKU</p>
            <p className="mt-1 font-sans text-xs text-white/65 break-words">
              {inlineStatus.name} · {formatSizeLabel(inlineStatus.size)} · {inlineStatus.quantity} ks
            </p>
          </div>
        )}

        {items.length === 0 ? (
          <div className="flex-1 flex flex-col items-center justify-center text-center px-4">
            <div className="w-20 h-20 mb-6 rounded-full bg-white/5 flex items-center justify-center">
              <ShoppingBag className="h-10 w-10 text-white/30" />
            </div>
            <p className="font-heading text-lg text-white mb-2">Košík je prázdný</p>
            <p className="font-sans text-sm text-white/60 mb-8">
              Podívej se do shopu a najdi něco pro sebe.
            </p>
            <Button
              onClick={handleClose}
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
            <ScrollArea className="flex-1 mt-4">
              <div className="space-y-3 pb-4">
                {items.map((item) => (
                  <CartItem key={`${item.productId}-${item.size}`} item={item} />
                ))}
              </div>
            </ScrollArea>

            <div className="border-t border-white/20 pt-6 mt-auto">
              <div className="flex items-center justify-between mb-6">
                <span className="font-heading text-lg text-white">CELKEM</span>
                <span className="font-sans text-2xl font-bold text-white" data-testid="text-cart-total">
                  {total} Kč
                </span>
              </div>

              <Button
                className="w-full font-heading text-sm tracking-wider bg-white text-black hover:bg-white/90 py-6 group"
                onClick={handleCheckout}
                data-testid="link-cart-checkout"
              >
                POKRAČOVAT K OBJEDNÁVCE
                <ArrowRight className="ml-2 h-4 w-4 transition-transform group-hover:translate-x-1" />
              </Button>
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
