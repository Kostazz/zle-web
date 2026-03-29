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
      className="grid grid-cols-[auto,1fr] gap-3 overflow-hidden border border-white/10 bg-white/5 p-3 sm:gap-4 sm:p-4"
      data-testid={`cart-item-${item.productId}-${item.size}`}
    >
      <div className="h-16 w-16 shrink-0 bg-white sm:h-20 sm:w-20">
        <img
          src={item.image}
          alt={item.name}
          className="h-full w-full object-cover"
        />
      </div>

      <div className="min-w-0 pr-0.5 sm:pr-1">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <h4 className="truncate font-heading text-sm font-bold text-white">
              {item.name}
            </h4>
            <p className="mt-1 truncate text-xs text-white/60">
              Velikost: {formatSizeLabel(item.size)}
            </p>
          </div>
          <button
            onClick={() => removeItem(item.productId, item.size)}
            className="mt-0.5 shrink-0 self-start rounded-sm border border-white/50 bg-black/60 p-1.5 text-white transition-all hover:border-white hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-black"
            data-testid={`button-remove-${item.productId}-${item.size}`}
            aria-label="Odstranit položku"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="mt-3 flex items-end justify-between gap-3">
          <div className="flex min-w-0 shrink-0 items-center gap-1.5 sm:gap-2">
            <button
              onClick={() => updateQuantity(item.productId, item.size, item.quantity - 1)}
              className="border border-white/30 p-1.5 text-white/70 transition-colors hover:border-white/60 hover:text-white"
              data-testid={`button-cart-minus-${item.productId}-${item.size}`}
              aria-label="Snížit množství"
            >
              <Minus className="h-3 w-3" />
            </button>
            <span className="min-w-[1.75rem] text-center font-sans text-sm font-semibold text-white">
              {item.quantity}
            </span>
            <button
              onClick={() => updateQuantity(item.productId, item.size, item.quantity + 1)}
              className="border border-white/30 p-1.5 text-white/70 transition-colors hover:border-white/60 hover:text-white"
              data-testid={`button-cart-plus-${item.productId}-${item.size}`}
              aria-label="Zvýšit množství"
            >
              <Plus className="h-3 w-3" />
            </button>
          </div>
          <span className="shrink-0 text-right font-sans text-sm font-bold text-white">
            {item.price * item.quantity} Kč
          </span>
        </div>
      </div>
    </div>
  );
}
