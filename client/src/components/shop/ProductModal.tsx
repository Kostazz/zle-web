import { useState } from "react";
import type { Product } from "@shared/schema";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useCart } from "@/lib/cart-context";
import { useToast } from "@/hooks/use-toast";
import { Plus, Minus, ShoppingBag, X } from "lucide-react";
import { VisuallyHidden } from "@radix-ui/react-visually-hidden";

interface ProductModalProps {
  product: Product;
  isOpen: boolean;
  onClose: () => void;
}

export function ProductModal({ product, isOpen, onClose }: ProductModalProps) {
  const [selectedSize, setSelectedSize] = useState<string | null>(null);
  const [quantity, setQuantity] = useState(1);
  const { addItem, setIsOpen: setCartOpen } = useCart();
  const { toast } = useToast();

  const handleAddToCart = () => {
    if (!selectedSize) {
      toast({
        title: "Vyber velikost",
        description: "Před přidáním do košíku musíš vybrat velikost.",
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

    toast({
      title: "Přidáno do košíku",
      description: `${product.name} (${selectedSize}) x${quantity}`,
    });

    setSelectedSize(null);
    setQuantity(1);
    onClose();
    setCartOpen(true);
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-2xl bg-black border border-white/20 p-0 gap-0">
        <VisuallyHidden>
          <DialogDescription>
            Detail produktu {product.name} za {product.price} Kč
          </DialogDescription>
        </VisuallyHidden>
        <button
          onClick={onClose}
          className="absolute right-4 top-4 z-10 p-2 text-white/60 hover:text-white transition-colors"
          data-testid="button-modal-close"
        >
          <X className="h-5 w-5" />
        </button>
        
        <div className="grid grid-cols-1 md:grid-cols-2">
          <div className="aspect-square bg-white">
            <img
              src={product.image}
              alt={product.name}
              className="w-full h-full object-cover"
            />
          </div>

          <div className="p-6 md:p-8 flex flex-col">
            <DialogHeader className="text-left mb-6">
              <DialogTitle className="font-display text-2xl md:text-3xl text-white tracking-tight">
                {product.name}
              </DialogTitle>
              <p className="font-sans text-2xl font-bold text-white mt-2">
                {product.price} Kč
              </p>
            </DialogHeader>

            <p className="font-sans text-white/70 text-sm mb-6 leading-relaxed">
              {product.description}
            </p>

            <div className="mb-6">
              <label className="font-heading text-xs font-bold text-white/60 tracking-wider block mb-3">
                VELIKOST
              </label>
              <div className="flex flex-wrap gap-2">
                {product.sizes.map((size) => (
                  <button
                    key={size}
                    onClick={() => setSelectedSize(size)}
                    className={`min-w-[3rem] px-4 py-2 text-sm font-semibold border transition-all ${
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

            <div className="mb-8">
              <label className="font-heading text-xs font-bold text-white/60 tracking-wider block mb-3">
                POČET
              </label>
              <div className="flex items-center gap-4">
                <button
                  onClick={() => setQuantity(Math.max(1, quantity - 1))}
                  className="p-2 border border-white/30 text-white hover:bg-white hover:text-black transition-colors"
                  data-testid="button-quantity-minus"
                >
                  <Minus className="h-4 w-4" />
                </button>
                <span className="font-sans text-xl font-bold text-white min-w-[2rem] text-center">
                  {quantity}
                </span>
                <button
                  onClick={() => setQuantity(quantity + 1)}
                  className="p-2 border border-white/30 text-white hover:bg-white hover:text-black transition-colors"
                  data-testid="button-quantity-plus"
                >
                  <Plus className="h-4 w-4" />
                </button>
              </div>
            </div>

            <div className="mt-auto">
              <Button
                onClick={handleAddToCart}
                className="w-full font-heading text-sm tracking-wider bg-white text-black hover:bg-white/90 py-6"
                data-testid="button-add-to-cart"
              >
                <ShoppingBag className="mr-2 h-4 w-4" />
                PŘIDAT DO KOŠÍKU
              </Button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
