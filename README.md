# ZLE E-shop

Czech underground skateboard brand e-commerce platform.

## Requirements

**Node.js 20 LTS recommended.**

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

The app will be available at:
- **Client:** http://localhost:5000
- **API:** http://localhost:5000/api

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

## Environment Variables

See `.env.example` for all required variables.

## License

MIT
