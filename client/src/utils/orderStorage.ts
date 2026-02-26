/**
 * Safe localStorage access for ZLE orders
 * Handles corrupted data, SSR, and quota errors gracefully
 */

export interface ZleOrder {
  id: string;
  createdAt: string;
  amount: number;
  currency: string;
  shippingMethod?: string;
  shippingPrice?: number;
  codFee?: number;
  paymentMethod: string;
  paymentNetwork?: string;
  items: any[];
  customerEmail?: string;
  customerName?: string;
  customerAddress?: string;
  customerCity?: string;
  customerZip?: string;
}

const STORAGE_KEY = "zle-orders";

export function loadOrders(): ZleOrder[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed;
  } catch {
    // Corrupted data – reset
    window.localStorage.removeItem(STORAGE_KEY);
    return [];
  }
}

export function saveOrders(orders: ZleOrder[]) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(orders));
  } catch {
    // Ignore quota errors in MVP
  }
}

export function appendOrder(order: ZleOrder) {
  const current = loadOrders();
  const withoutSameId = current.filter((existing) => existing.id !== order.id);
  withoutSameId.push(order);
  saveOrders(withoutSameId);
}

export function getLastOrder(): ZleOrder | null {
  const all = loadOrders();
  if (!all.length) return null;
  return all[all.length - 1] || null;
}

export function clearOrders() {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Ignore errors
  }
}
