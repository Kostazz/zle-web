import { useState } from "react";
import type { Product } from "@shared/schema";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useCart } from "@/lib/cart-context";
import { useToast } from "@/hooks/use-toast";
import { Plus, Minus, ShoppingBag, X, AlertTriangle, ImageOff } from "lucide-react";
import { VisuallyHidden } from "@radix-ui/react-visually-hidden";
import { useOverlay } from "@/lib/overlay-context";

const CART_INLINE_STATUS_EVENT = "zle:cart-inline-status";

type CartInlineStatusDetail = {
  name: string;
  size: string;
  quantity: number;
};

function ModalImagePlaceholder({ name }: { name: string }) {
  return (
    <div className="w-full h-full flex flex-col items-center justify-center bg-white/5">
      <ImageOff className="w-16 h-16 text-white/30 mb-3" />
      <span className="font-heading text-sm text-white/40 tracking-wider text-center px-6">{name}</span>
    </div>
  );
}

interface ProductModalProps {
  product: Product;
}

export function ProductModal({ product }: ProductModalProps) {
  const [selectedSize, setSelectedSize] = useState<string | null>(null);
  const [quantity, setQuantity] = useState(1);
  const [imageError, setImageError] = useState(false);
  const { addItem } = useCart();
  const { toast } = useToast();
  const { closeOverlay, getOverlay, openOverlay } = useOverlay();

  const productOverlay = getOverlay("product");
  const isOpen = productOverlay?.productId === product.id;

  const isSoldOut = product.stock <= 0;
  const isLowStock = product.stock > 0 && product.stock <= 5;
  const maxQuantity = Math.min(product.stock, 10);
  const showPlaceholder = !product.image || imageError;

  const handleClose = () => {
    closeOverlay("product");
  };

  const handleAddToCart = () => {
    if (isSoldOut) {
      toast({
        title: "Vyprodano",
        description: "Tento produkt je momentalne vyprodany.",
        variant: "destructive",
      });
      return;
    }

    if (!selectedSize) {
      toast({
        title: "Vyber velikost",
        description: "Pred pridanim do kosiku musis vybrat velikost.",
        variant: "destructive",
      });
      return;
    }

    if (quantity > product.stock) {
      toast({
        title: "Nedostatecne mnozstvi",
        description: `Na sklade je pouze ${product.stock} kusu.`,
        variant: "destructive",
      });
      return;
    }

    addItem({
      productId: product.id,
      name: product.name,
      price: product.price,
      size: selectedSize,
      quantity,
      image: product.image,
    });

    window.dispatchEvent(
      new CustomEvent<CartInlineStatusDetail>(CART_INLINE_STATUS_EVENT, {
        detail: {
          name: product.name,
          size: selectedSize,
          quantity,
        },
      })
    );

    setSelectedSize(null);
    setQuantity(1);
    openOverlay({ type: "cart" });
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && handleClose()}>
      <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto bg-black border border-white/20 p-0 gap-0">
        <VisuallyHidden>
          <DialogDescription>
            Detail produktu {product.name} za {product.price} Kc
          </DialogDescription>
        </VisuallyHidden>
        <button
          onClick={handleClose}
          className="absolute right-3 top-3 z-20 p-2 bg-black/80 rounded-full text-white/80 hover:text-white hover:bg-black transition-colors"
          data-testid="button-modal-close"
          aria-label="Zavřít"
        >
          <X className="h-6 w-6" />
        </button>

        <div className="grid grid-cols-1 md:grid-cols-2">
          <div className="relative aspect-[4/3] md:aspect-square bg-black">
            {showPlaceholder ? (
              <ModalImagePlaceholder name={product.name} />
            ) : (
              <img
                src={product.image}
                alt={product.name}
                className="w-full h-full object-cover"
                onError={() => setImageError(true)}
              />
            )}
            {isSoldOut && (
              <div className="absolute inset-0 flex items-center justify-center bg-black/60">
                <span className="font-heading text-xl tracking-wider text-white bg-black px-6 py-3 border border-white">
                  VYPRODANO
                </span>
              </div>
            )}
          </div>

          <div className="p-4 md:p-8 flex flex-col">
            <DialogHeader className="text-left mb-3 md:mb-6">
              <DialogTitle className="font-display text-xl md:text-3xl text-white tracking-tight pr-8">
                {product.name}
              </DialogTitle>
              <div className="flex items-center gap-3 mt-1.5">
                <p className="font-sans text-lg md:text-2xl font-bold text-white">{product.price} Kc</p>
                {isLowStock && (
                  <span className="flex items-center gap-1 font-heading text-xs tracking-wider text-yellow-400">
                    <AlertTriangle className="h-3 w-3" />
                    POSLEDNI KUSY
                  </span>
                )}
              </div>
            </DialogHeader>

            <p className="font-sans text-white/70 text-sm mb-3 md:mb-6 leading-relaxed max-h-16 overflow-hidden md:max-h-none">
              {product.description}
            </p>

            {!isSoldOut && (
              <>
                <div className="mb-3 md:mb-6">
                  <label className="font-heading text-xs font-bold text-white/60 tracking-wider block mb-1.5 md:mb-3">
                    VELIKOST
                  </label>
                  <div className="flex flex-wrap gap-1.5 md:gap-2">
                    {product.sizes.map((size) => (
                      <button
                        key={size}
                        onClick={() => setSelectedSize(size)}
                        className={`min-w-[2.25rem] px-2.5 py-1 text-xs md:text-sm font-semibold border transition-all ${
                          selectedSize === size
                            ? "bg-white text-black border-white"
                            : "bg-transparent text-white border-white/30 hover:border-white"
                        }`}
                        data-testid={`button-size-${size}`}
                      >
                        {size}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="mb-2 md:mb-8">
                  <label className="font-heading text-xs font-bold text-white/60 tracking-wider block mb-1.5 md:mb-3">
                    POCET {isLowStock && `(max ${maxQuantity})`}
                  </label>
                  <div className="flex items-center gap-3">
                    <button
                      onClick={() => setQuantity(Math.max(1, quantity - 1))}
                      className="p-1.5 md:p-2 border border-white/30 text-white hover:bg-white hover:text-black transition-colors"
                      data-testid="button-quantity-minus"
                    >
                      <Minus className="h-4 w-4" />
                    </button>
                    <span className="font-sans text-lg md:text-xl font-bold text-white min-w-[1.75rem] md:min-w-[2rem] text-center">
                      {quantity}
                    </span>
                    <button
                      onClick={() => setQuantity(Math.min(maxQuantity, quantity + 1))}
                      className="p-1.5 md:p-2 border border-white/30 text-white hover:bg-white hover:text-black transition-colors"
                      data-testid="button-quantity-plus"
                    >
                      <Plus className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              </>
            )}
          </div>
        </div>

        <div className="sticky bottom-0 left-0 right-0 bg-black border-t border-white/10 p-3 md:p-4">
          <Button
            onClick={handleAddToCart}
            disabled={isSoldOut}
            className={`w-full font-heading text-sm tracking-wider py-4 md:py-6 ${
              isSoldOut
                ? "bg-white/20 text-white/40 cursor-not-allowed"
                : "bg-white text-black hover:bg-white/90 zle-button-3d"
            }`}
            data-testid="button-add-to-cart"
          >
            <ShoppingBag className="mr-2 h-4 w-4" />
            {isSoldOut ? "VYPRODÁNO" : "PŘIDAT DO KOŠÍKU"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
