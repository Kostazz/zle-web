import type { CartItem as CartItemType } from "@shared/schema";
import { useCart } from "@/lib/cart-context";
import { Plus, Minus, X } from "lucide-react";

interface CartItemProps {
  item: CartItemType;
}

export function CartItem({ item }: CartItemProps) {
  const { updateQuantity, removeItem } = useCart();

  return (
    <div 
      className="flex gap-4 p-4 bg-white/5 border border-white/10"
      data-testid={`cart-item-${item.productId}-${item.size}`}
    >
      <div className="w-20 h-20 bg-white flex-shrink-0">
        <img
          src={item.image}
          alt={item.name}
          className="w-full h-full object-cover"
        />
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-start justify-between gap-2">
          <div>
            <h4 className="font-heading text-sm font-bold text-white truncate">
              {item.name}
            </h4>
            <p className="text-xs text-white/60 mt-1">
              Velikost: {item.size}
            </p>
          </div>
          <button
            onClick={() => removeItem(item.productId, item.size)}
            className="p-1 text-white/40 hover:text-white transition-colors"
            data-testid={`button-remove-${item.productId}-${item.size}`}
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex items-center justify-between mt-3">
          <div className="flex items-center gap-2">
            <button
              onClick={() => updateQuantity(item.productId, item.size, item.quantity - 1)}
              className="p-1 border border-white/20 text-white/60 hover:text-white hover:border-white/40 transition-colors"
              data-testid={`button-cart-minus-${item.productId}-${item.size}`}
            >
              <Minus className="h-3 w-3" />
            </button>
            <span className="font-sans text-sm font-semibold text-white min-w-[1.5rem] text-center">
              {item.quantity}
            </span>
            <button
              onClick={() => updateQuantity(item.productId, item.size, item.quantity + 1)}
              className="p-1 border border-white/20 text-white/60 hover:text-white hover:border-white/40 transition-colors"
              data-testid={`button-cart-plus-${item.productId}-${item.size}`}
            >
              <Plus className="h-3 w-3" />
            </button>
          </div>
          <span className="font-sans text-sm font-bold text-white">
            {item.price * item.quantity} Kč
          </span>
        </div>
      </div>
    </div>
  );
}
