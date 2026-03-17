ALTER TABLE "orders"
  ADD COLUMN IF NOT EXISTS "payment_provider" text DEFAULT 'stripe',
  ADD COLUMN IF NOT EXISTS "provider_order_id" text,
  ADD COLUMN IF NOT EXISTS "provider_payment_url" text,
  ADD COLUMN IF NOT EXISTS "provider_status" text,
  ADD COLUMN IF NOT EXISTS "provider_reference" text,
  ADD COLUMN IF NOT EXISTS "bank_transfer_expires_at" timestamp,
  ADD COLUMN IF NOT EXISTS "paid_at" timestamp,
  ADD COLUMN IF NOT EXISTS "payment_confirmed_at" timestamp,
  ADD COLUMN IF NOT EXISTS "payment_confirmed_by" text;

CREATE INDEX IF NOT EXISTS "IDX_orders_provider_order_id"
ON "orders" ("provider_order_id");

CREATE INDEX IF NOT EXISTS "IDX_orders_payment_provider_order_id"
ON "orders" ("payment_provider", "provider_order_id");
