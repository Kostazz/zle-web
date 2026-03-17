import { env } from "./env";

export type CoinGateInternalStatus = "pending" | "paid" | "expired" | "canceled" | "invalid";

export type CoinGateOrder = {
  id: string;
  payment_url: string;
  status: string;
  price_amount: number;
  price_currency: string;
  order_id: string;
};

function baseUrl() {
  const mode = String(env.COINGATE_ENV || "sandbox").toLowerCase();
  return mode === "live" ? "https://api.coingate.com" : "https://api-sandbox.coingate.com";
}

function assertConfigured() {
  if (!env.COINGATE_API_TOKEN) {
    throw new Error("coingate_not_configured");
  }
}

async function callCoinGate<T>(path: string, init: RequestInit): Promise<T> {
  assertConfigured();
  const response = await fetch(`${baseUrl()}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Token ${env.COINGATE_API_TOKEN}`,
      ...(init.headers || {}),
    },
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`coingate_http_${response.status}:${body.slice(0, 280)}`);
  }

  return response.json() as Promise<T>;
}

export async function createCoinGateOrder(params: {
  orderId: string;
  amountCzk: number;
  currency?: string;
  receiveCurrency: "BTC" | "ETH" | "USDC" | "SOL";
}) {
  const payload = {
    order_id: params.orderId,
    price_amount: params.amountCzk,
    price_currency: (params.currency || "CZK").toUpperCase(),
    receive_currency: params.receiveCurrency,
    callback_url: env.COINGATE_CALLBACK_URL,
    cancel_url: env.COINGATE_CANCEL_URL,
    success_url: `${env.COINGATE_RETURN_URL}?order_id=${encodeURIComponent(params.orderId)}&pm=${params.receiveCurrency.toLowerCase()}`,
  };

  return callCoinGate<CoinGateOrder>("/v2/orders", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function retrieveCoinGateOrder(providerOrderId: string) {
  return callCoinGate<CoinGateOrder>(`/v2/orders/${encodeURIComponent(providerOrderId)}`, {
    method: "GET",
  });
}

export function mapCoinGateStatus(status: string): CoinGateInternalStatus {
  const s = String(status || "").toLowerCase();
  if (["paid", "confirming", "processing"].includes(s)) return "paid";
  if (["new", "pending"].includes(s)) return "pending";
  if (["expired"].includes(s)) return "expired";
  if (["canceled", "cancelled"].includes(s)) return "canceled";
  return "invalid";
}
