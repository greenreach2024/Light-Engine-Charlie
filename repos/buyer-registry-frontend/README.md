# Buyer Registry Frontend

Seed project for the Buyer Registry multi-portal experience targeting buyers, sellers, licensed agents, developers, mortgage brokers, and admins. The frontend is built with React, Vite, and TypeScript and integrates with Azure AD B2C for authentication.

## Available apps

- `/buyer` – onboarding, wishlist builder, demand analytics, and match exploration.
- `/seller` – listing wizard, aggregated demand analytics, and secure messaging prompts.
- `/agent` – Pro-tier regional analytics, proactive matching, and reporting snapshots.
- `/developer` – project demand tracking and reservation readiness.
- `/mortgage` – opt-in lead desk and in-app financing conversations.
- `/admin` – compliance console and audit trail monitoring.

## Getting started

```bash
npm install
npm run dev
```

Environment configuration is provided through Vite environment variables prefixed with `VITE_`. For example, `VITE_AD_B2C_CLIENT_ID` and `VITE_API_BASE_URL` should be defined per environment.

## Next steps

- Connect MSAL to Azure AD B2C user flows.
- Replace placeholder analytics and matches with API calls.
- Localize copy in `public/locales/en` and `public/locales/fr`.
- Replace mock data with API-driven hooks backed by the shared schema package.
- Wire shared messaging components to Azure SignalR hubs for real-time chat.
- Add e2e tests via Playwright once routing stabilizes.
