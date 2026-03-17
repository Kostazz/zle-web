CREATE INDEX IF NOT EXISTS "IDX_orders_stripe_checkout_session"
ON "orders" ("stripe_checkout_session_id");

CREATE UNIQUE INDEX IF NOT EXISTS "UQ_orders_stripe_checkout_session_non_null"
ON "orders" ("stripe_checkout_session_id")
WHERE "stripe_checkout_session_id" IS NOT NULL;
