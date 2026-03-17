/**
 * Payment method and network type definitions
 * Only whitelisted values are allowed
 */

export type PaymentMethod =
  | "card"
  | "bank"
  | "gpay"
  | "applepay"
  | "usdc"
  | "btc"
  | "eth"
  | "sol";

export type CryptoNetwork =
  | "bitcoin"
  | "ethereum"
  | "ethereum-mainnet"
  | "solana"
  | "solana-mainnet";

export const PAYMENT_METHODS: PaymentMethod[] = [
  "card",
  "bank",
  "gpay",
  "applepay",
  "usdc",
  "btc",
  "eth",
  "sol",
];

export const CRYPTO_NETWORKS: CryptoNetwork[] = [
  "bitcoin",
  "ethereum",
  "ethereum-mainnet",
  "solana",
  "solana-mainnet",
];

export const CRYPTO_METHODS: PaymentMethod[] = ["usdc", "btc", "eth", "sol"];

export function isValidPaymentMethod(value: string): value is PaymentMethod {
  return PAYMENT_METHODS.includes(value as PaymentMethod);
}

export function isValidCryptoNetwork(value: string): value is CryptoNetwork {
  return CRYPTO_NETWORKS.includes(value as CryptoNetwork);
}

export function isCryptoMethod(method: PaymentMethod): boolean {
  return CRYPTO_METHODS.includes(method);
}
