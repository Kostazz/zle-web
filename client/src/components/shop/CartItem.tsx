import type { CartItem as CartItemType } from "@shared/schema";
import { useCart } from "@/lib/cart-context";
import { Plus, Minus, X } from "lucide-react";
import { formatSizeLabel } from "@/lib/product-ui";

interface CartItemProps {
  item: CartItemType;
}

export function CartItem({ item }: CartItemProps) {
  const { updateQuantity, removeItem } = useCart();

  return (
    <div
      className="relative flex gap-3 p-3 pr-12 sm:gap-4 sm:p-4 sm:pr-14 bg-white/5 border border-white/10 overflow-x-hidden"
      data-testid={`cart-item-${item.productId}-${item.size}`}
    >
      <button
        onClick={() => removeItem(item.productId, item.size)}
        className="absolute right-2 top-2 sm:right-3 sm:top-3 z-10 shrink-0 rounded-sm border border-white/50 bg-black/60 p-1.5 text-white hover:border-white hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-black transition-all"
        data-testid={`button-remove-${item.productId}-${item.size}`}
        aria-label="Odstranit položku"
      >
        <X className="h-4 w-4" />
      </button>

      <div className="w-16 h-16 sm:w-20 sm:h-20 bg-white flex-shrink-0">
        <img
          src={item.image}
          alt={item.name}
          className="w-full h-full object-cover"
        />
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-start gap-2">
          <div className="min-w-0 flex-1">
            <h4 className="font-heading text-sm font-bold text-white truncate">
              {item.name}
            </h4>
            <p className="text-xs text-white/60 mt-1 truncate">Velikost: {formatSizeLabel(item.size)}</p>
          </div>
        </div>

        <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-1.5 sm:gap-2 min-w-0">
            <button
              onClick={() => updateQuantity(item.productId, item.size, item.quantity - 1)}
              className="p-1.5 border border-white/30 text-white/70 hover:text-white hover:border-white/60 transition-colors"
              data-testid={`button-cart-minus-${item.productId}-${item.size}`}
              aria-label="Snížit množství"
            >
              <Minus className="h-3 w-3" />
            </button>
            <span className="font-sans text-sm font-semibold text-white min-w-[1.75rem] text-center">
              {item.quantity}
            </span>
            <button
              onClick={() => updateQuantity(item.productId, item.size, item.quantity + 1)}
              className="p-1.5 border border-white/30 text-white/70 hover:text-white hover:border-white/60 transition-colors"
              data-testid={`button-cart-plus-${item.productId}-${item.size}`}
              aria-label="Zvýšit množství"
            >
              <Plus className="h-3 w-3" />
            </button>
          </div>
          <span className="font-sans text-sm font-bold text-white shrink-0">
            {item.price * item.quantity} Kč
          </span>
        </div>
      </div>
    </div>
  );
}
