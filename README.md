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

## Environment Variables

See `.env.example` for all required variables.

## License

MIT
