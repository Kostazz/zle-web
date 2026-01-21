import Stripe from "stripe";

let stripeDisabled = false;

export function disableStripe() {
  stripeDisabled = true;
  console.warn("[stripe] disabled");
}

export function isStripeAvailable(): boolean {
  return !stripeDisabled && Boolean(process.env.STRIPE_SECRET_KEY);
}

function requireStripeSecretKey(): string {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error("STRIPE_SECRET_KEY is missing");
  return key;
}

export async function getUncachableStripeClient(): Promise<Stripe> {
  if (!isStripeAvailable()) throw new Error("Stripe is disabled");

  const secretKey = requireStripeSecretKey();

  return new Stripe(secretKey, {
    // Safe, widely supported apiVersion for stripe@17.x types
    apiVersion: "2025-02-24.acacia",
  });
}

export async function getStripePublishableKey(): Promise<string> {
  if (!isStripeAvailable()) throw new Error("Stripe is disabled");
  return process.env.STRIPE_PUBLISHABLE_KEY || "";
}

export async function getStripeSecretKey(): Promise<string> {
  if (!isStripeAvailable()) throw new Error("Stripe is disabled");
  return requireStripeSecretKey();
}

/**
 * Replit-only StripeSync byl odstraněn.
 * Pokud to někde voláš, je to teď vědomě nepodporované v Render-first režimu.
 */
export async function getStripeSync(): Promise<never> {
  throw new Error("StripeSync is not available (Render-first build).");
}
