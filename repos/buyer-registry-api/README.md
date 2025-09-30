# Buyer Registry API

Express + TypeScript API that powers onboarding, wishlist capture, listing ingestion, matchmaking, chat, and subscription features for the Buyer Registry platform.

## Quick start

```bash
npm install
npm run dev
```

Set the following environment variables in a `.env` file:

- `PORT` – API port (defaults to 4000).
- `DATABASE_URL` – PostgreSQL/PostGIS connection string.
- `MATCH_QUEUE_NAME` – Queue used to trigger match recomputations.

## Key modules

- `routes/` – REST entry points for wishlists, matches, listings, messages, and subscriptions.
- `services/` – Validation schemas and integrations.
- `match/` – Background job orchestration entry points.
- `analytics/` – Demand snapshot builders consumed by portals.
- `messaging/` – SignalR chat handlers and message persistence helpers.
- `payments/` – Stripe/Moneris integration stubs.
- `compliance/` – PIPEDA audit log helpers.

Add integration tests using a PostgreSQL container before production deployment.
