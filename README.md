# ZLE E-shop

Czech underground skateboard brand e-commerce platform.

## Requirements

**Node.js 20 LTS recommended.**

## Quick Start

### Replit
1. Click "Run" - everything is pre-configured
2. Stripe and auth work automatically via Replit integrations

### GitHub Codespaces / Local Development
1. Start database: `docker compose up -d`
2. Set environment secrets (see below)
3. Apply schema: `npm run db:push`
4. Start dev server: `npm run dev`

The app will be available at http://localhost:5000

## Environment Secrets

| Variable | Required | Description |
|----------|----------|-------------|
| `DATABASE_URL` | Yes | PostgreSQL connection string |
| `SESSION_SECRET` | Yes | Express session secret (any random string) |
| `STRIPE_SECRET_KEY` | No* | Stripe secret key for payments |
| `STRIPE_PUBLISHABLE_KEY` | No* | Stripe publishable key for client |
| `STRIPE_WEBHOOK_SECRET` | No | Stripe webhook signing secret |
| `RESEND_API_KEY` | No | Resend API key for emails |
| `REPL_ID` | Auto | Set automatically in Replit |

*Stripe keys are optional in development - payments will be disabled without them.

### Replit Secrets
Set in the "Secrets" tab:
- `SESSION_SECRET` (required)
- Stripe integration is configured automatically

### Codespaces/Local Secrets
Create `.env` file or set environment variables:
```bash
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/zle
SESSION_SECRET=your-random-secret-here
STRIPE_SECRET_KEY=sk_test_...  # Optional
STRIPE_PUBLISHABLE_KEY=pk_test_...  # Optional
```

## Dev-Safe Fallbacks

The app gracefully handles missing services:

- **No Replit auth?** → Auth routes return 503, app works without login
- **No Stripe keys?** → Payments disabled, shop browsing works
- **No Resend key?** → Emails disabled, orders still process

## Local Development (from ZIP)

### 1. Start Database

```bash
docker compose up -d
```

### 2. Configure Environment

**Linux/Mac:**
```bash
cp .env.example .env
```

**Windows (PowerShell):**
```powershell
Copy-Item .env.example .env
```

Edit `.env` with your Stripe keys if testing payments.

### 3. Install Dependencies

```bash
npm install
```

### 4. Push Database Schema

```bash
npm run db:push
```

### 5. Start Development Server

```bash
npm run dev
```

## Docker Commands

```bash
# Start database
docker compose up -d

# Stop database
docker compose down

# Reset database (wipe data)
docker compose down -v && docker compose up -d
```

## Project Structure

```
├── client/          # React frontend (Vite)
├── server/          # Express backend
├── shared/          # Shared TypeScript schemas
├── docker-compose.yml
├── .env.example
└── drizzle.config.ts
```

## Tech Stack

- **Frontend:** React, TypeScript, Vite, Tailwind CSS, shadcn/ui
- **Backend:** Express.js, Drizzle ORM, PostgreSQL
- **Payments:** Stripe Checkout
- **Email:** Resend

## Brand / Content Guidelines

- [ZLE A-MODE — Content Guardrail v1.0](docs/brand/ZLE_A_MODE_v1.0.md)

## EU Compliance (v1.0)

This version includes skeleton support for:
- Partner payout tracking (20/40/40 split)
- Accounting ledger entries
- Audit logging
- GDPR anonymization endpoint
- VAT fields on orders

## ZLE CORE INFRA + SECURITY + COMPLIANCE PACK (v1.2.2 + v1.2.3)

### New Features
- **Order Events Table** - Guaranteed idempotency for webhook processing
- **Waterfall Payout Engine** - COGS/distributable-based payouts with product model support
- **Atomic Stock Deduction** - Prevents overselling with fail-safe manual review
- **Refund/Returns Skeleton** - EU 14-day withdrawal support with ledger entries
- **Chargeback Handling** - Dispute webhook processing with ledger entries
- **RBAC + 2FA Skeleton** - User roles and TOTP fields (disabled by default)
- **Consents Table** - GDPR cookie/marketing consent logging
- **Payment Providers Table** - Crypto-ready infrastructure (disabled)
- **CSV Exports** - Admin-only ledger, orders, payouts exports
- **Request ID Middleware** - x-request-id for observability
- **Log Sanitizer** - PII redaction in production logs
- **OPS Event Hooks** - Future automation hooks (disabled by default)

### Production Migrations Discipline

**IMPORTANT: In production, never use `db:push`.**

```bash
# Development only
npm run db:push

# Production: Use migrations
npm run db:generate   # Generate migration files
npm run db:migrate    # Apply migrations
```

### Backup/Restore (Manual)

```bash
# Backup
pg_dump $DATABASE_URL > backup_$(date +%Y%m%d).sql

# Restore
psql $DATABASE_URL < backup_YYYYMMDD.sql
```

Retention suggestion: Daily backups + 30 days retention.

### Admin CSV Exports

```
GET /api/admin/exports/ledger.csv
GET /api/admin/exports/orders.csv
GET /api/admin/exports/payouts.csv
```

Requires admin authentication. PII is masked by default.

## License

MIT
