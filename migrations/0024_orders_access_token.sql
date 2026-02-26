ALTER TABLE "orders"
ADD COLUMN IF NOT EXISTS "access_token" varchar(64);

CREATE UNIQUE INDEX IF NOT EXISTS "orders_access_token_unique"
ON "orders" ("access_token")
WHERE "access_token" IS NOT NULL;
