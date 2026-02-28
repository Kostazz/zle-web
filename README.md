# ZLE E-shop

Czech underground skateboard brand e-commerce platform.

## Quick Start

```bash
npm install
node script/bootstrap.mjs
```

That's it! The bootstrap script handles:
1. Starting Docker containers (if docker-compose.yml exists)
2. Waiting for PostgreSQL to be ready
3. Running database migrations
4. Starting the development server

## Requirements

- **Node.js 20 LTS** (required)
- **Docker** (optional, for local PostgreSQL)

## Feature Flags

Control which features are enabled via environment variables:

| Flag | Default | Description |
|------|---------|-------------|
| `ENABLE_AUTH` | `false` | Reserved auth feature flag (disabled by default) |
| `ENABLE_STRIPE` | `true` if keys exist | Enable Stripe payments |
| `ENABLE_EMAIL` | `true` if RESEND_API_KEY set | Enable email notifications |
| `ENABLE_OPS` | `false` | Enable OPS automation webhooks |
| `SEED_ON_START` | `false` | Run database seeding on startup |

### Example: Run with minimal features

```bash
ENABLE_AUTH=false ENABLE_STRIPE=false npm run dev
```

## Environment Variables

### Required

| Variable | Description |
|----------|-------------|
| `DATABASE_URL` | PostgreSQL connection string |
| `SESSION_SECRET` | Express session secret (auto-generated in dev if missing) |

### Optional (Payments)

| Variable | Description |
|----------|-------------|
| `STRIPE_SECRET_KEY` | Stripe secret key (sk_test_...) |
| `STRIPE_PUBLISHABLE_KEY` | Stripe publishable key (pk_test_...) |
| `STRIPE_WEBHOOK_SECRET` | Stripe webhook signing secret |

### Optional (Email)

| Variable | Description |
|----------|-------------|
| `RESEND_API_KEY` | Resend API key for transactional emails |

## Platform Setup

### GitHub Codespaces / Local

1. Start database: `docker compose up -d`
2. Create `.env` file:
```bash
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/zle
SESSION_SECRET=your-random-secret-here
# Optional:
STRIPE_SECRET_KEY=sk_test_...
STRIPE_PUBLISHABLE_KEY=pk_test_...
```
3. Run bootstrap: `node script/bootstrap.mjs`

Or manually:
```bash
docker compose up -d
npm install
npm run db:push
npm run dev
```

## Dev-Safe Fallbacks

The app gracefully handles missing services:

- **No Stripe keys?** → Payments disabled, shop browsing works
- **No Resend key?** → Emails disabled, orders still process
- **No DATABASE_URL?** → Limited functionality mode with warnings

Startup prints a status table showing what's enabled:

```
┌─────────────────────────────────────────┐
│           ZLE Environment Status         │
├─────────────────────────────────────────┤
│  Mode:     development                   │
│  Platform: Local/Codespaces              │
├─────────────────────────────────────────┤
│  Database: configured ✓                  │
│  Auth:     disabled                      │
│  Stripe:   enabled ✓                     │
│  Email:    disabled                      │
│  OPS:      disabled                      │
└─────────────────────────────────────────┘
```

## NPM Scripts

| Script | Description |
|--------|-------------|
| `npm run dev` | Start development server |
| `npm run build` | Build for production |
| `npm start` | Run production build |
| `npm run db:push` | Push Drizzle schema to database |
| `npm run check` | TypeScript type checking |

## Docker Commands

```bash
# Start database
docker compose up -d

# Stop database
docker compose down

# Reset database (wipe data)
docker compose down -v && docker compose up -d
```

## Health Check

```bash
curl http://localhost:5000/health
```

Returns JSON with enabled features and database connectivity status.

## Project Structure

```
├── client/          # React frontend (Vite)
├── server/          # Express backend
│   ├── env.ts       # Feature flags and env validation
│   ├── index.ts     # Server entry point
├── shared/          # Shared TypeScript schemas
├── script/
│   └── bootstrap.mjs # One-command dev setup
├── docker-compose.yml
└── drizzle.config.ts
```

## Tech Stack

- **Frontend:** React, TypeScript, Vite, Tailwind CSS, shadcn/ui
- **Backend:** Express.js, Drizzle ORM, PostgreSQL
- **Payments:** Stripe Checkout
- **Email:** Resend

## Brand Guidelines

- [ZLE A-MODE — Content Guardrail v1.0](docs/brand/ZLE_A_MODE_v1.0.md)

## EU Compliance (v1.0)

- Partner payout tracking (20/40/40 split)
- Accounting ledger entries
- Audit logging
- GDPR anonymization endpoint
- VAT fields on orders

## Security Infrastructure (v1.2.2 + v1.2.3)

- **Order Events Table** - Guaranteed idempotency for webhook processing
- **Waterfall Payout Engine** - COGS/distributable-based payouts
- **Atomic Stock Deduction** - Prevents overselling
- **Refund/Returns Skeleton** - EU 14-day withdrawal support
- **RBAC + 2FA Skeleton** - User roles and TOTP fields
- **Consents Table** - GDPR cookie/marketing consent logging
- **CSV Exports** - Admin-only data exports

## Production Deployment

**Never use `db:push` in production.** Use migrations:

```bash
npm run db:generate   # Generate migration files
npm run db:migrate    # Apply migrations
```

## Admin CSV Exports

```
GET /api/admin/exports/ledger.csv
GET /api/admin/exports/orders.csv
GET /api/admin/exports/payouts.csv
```

Requires admin authentication. PII is masked by default.

## License

MIT
