CREATE TABLE IF NOT EXISTS "agent_reports" (
  "id" varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  "agent" text NOT NULL,
  "status" text NOT NULL,
  "summary" text NOT NULL,
  "issues_json" text NOT NULL,
  "metrics_json" text NOT NULL,
  "created_at" timestamp DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "IDX_agent_reports_created_at"
ON "agent_reports" ("created_at");

CREATE INDEX IF NOT EXISTS "IDX_agent_reports_agent_created_at"
ON "agent_reports" ("agent", "created_at");
