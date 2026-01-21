import { useMutation } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import type { InsertOrder, Order } from "@shared/schema";

export function useCreateOrder() {
  return useMutation<Order, Error, InsertOrder>({
    mutationFn: async (orderData) => {
      const response = await apiRequest("POST", "/api/orders", orderData);
      return response.json();
    },
  });
}
