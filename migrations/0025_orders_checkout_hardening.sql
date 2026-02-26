ALTER TABLE "orders"
ADD COLUMN IF NOT EXISTS "fingerprint" text,
ADD COLUMN IF NOT EXISTS "fingerprint_created_at" timestamp,
ADD COLUMN IF NOT EXISTS "stripe_checkout_session_id" text,
ADD COLUMN IF NOT EXISTS "stripe_checkout_session_created_at" timestamp;

CREATE INDEX IF NOT EXISTS "IDX_orders_fingerprint"
ON "orders" ("fingerprint");
