function isTruthy(v: string | undefined) {
  if (!v) return false;
  return ["1", "true", "yes", "on"].includes(v.toLowerCase());
}

export function validateRequiredEnv() {
  // DB is always required for the shop to function
  if (!process.env.DATABASE_URL) {
    throw new Error("Missing env variable: DATABASE_URL");
  }

  // Stripe secrets are only required if Stripe is enabled
  const stripeEnabled = isTruthy(process.env.ENABLE_STRIPE ?? "true");

  if (stripeEnabled) {
    const requiredStripe = ["STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET"] as const;
    for (const key of requiredStripe) {
      if (!process.env[key]) {
        throw new Error(`Missing env variable: ${key} (Stripe is enabled)`);
      }
    }
  }
}
