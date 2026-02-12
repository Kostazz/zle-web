const requiredEnv = ["STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET", "DATABASE_URL"] as const;

export function validateRequiredEnv() {
  requiredEnv.forEach((key) => {
    if (!process.env[key]) {
      throw new Error(`Missing env variable: ${key}`);
    }
  });
}
