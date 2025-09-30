# Buyer Registry Platform – Repository Strategy

This document describes the GitHub repositories that should be created for the Buyer Registry platform. It captures their responsibilities, initial scaffolding commands, shared conventions, and automation hooks so the engineering team can stand up the project quickly once access to GitHub is available.

> **Execution status:** Lightweight starter scaffolding for each repository now lives under [`/repos`](../repos) in this workspace. The directories mirror the structure outlined below and can be pushed to freshly created GitHub repositories.

## Repository Overview

| Repository | Purpose | Primary Stack | Key Integrations |
|------------|---------|---------------|------------------|
| `buyer-registry-frontend` | Multi-portal UI covering buyer wishlists, seller/agent analytics, developer pipelines, mortgage lead outreach, and administrative tooling. | React, TypeScript, Vite, Azure AD B2C SDK | Azure AD B2C, Azure Maps, Azure Blob Storage (media), Azure SignalR Service |
| `buyer-registry-api` | Core domain APIs for onboarding, wishlists, listings, matchmaking, messaging, subscriptions, and compliance reporting backed by PostgreSQL/PostGIS. | Node.js, Express, TypeScript | Azure Database for PostgreSQL, Azure Key Vault, Azure SignalR, Stripe/Moneris webhooks |
| `buyer-registry-search-indexer` | Background workers that hydrate Azure Cognitive Search with listings and wishlist geometry plus analytics snapshots for faceted queries. | Node.js workers with Azure Functions bindings | Azure Cognitive Search, Azure Storage Queues |
| `buyer-registry-infra` | Infrastructure-as-code definitions for Azure resources, policy baselines, monitoring, and deployment automation. | Bicep/ARM (or Terraform), Azure DevOps/GitHub Actions | Azure App Service, Azure Functions, Azure Database for PostgreSQL, Azure SignalR, Azure Monitor |
| `buyer-registry-shared` | Shared TypeScript/JSON schemas, lint configs, API contracts, design tokens, and consent copy to keep repos aligned. | TypeScript, JSON Schema | npm package distribution |

## Creation Steps

> **Note:** Actual GitHub repository creation must be performed outside this environment using the GitHub web UI or CLI. The steps below assume the GitHub CLI (`gh`) is installed and authenticated.

### 1. Frontend Repository

```bash
# Create repository
gh repo create your-org/buyer-registry-frontend --private --description "Buyer Registry portals (buyer, seller, developer, mortgage, admin)"

# Bootstrap project
mkdir buyer-registry-frontend && cd buyer-registry-frontend
npm create vite@latest buyer-registry-frontend -- --template react-ts
cd buyer-registry-frontend
npm install @azure/msal-browser @azure/msal-react @azure/communication-signaling axios react-query zustand
git init
cp ../templates/.editorconfig .
```

Include the following directories from day one:

- `src/apps/buyer`, `src/apps/seller`, `src/apps/agent`, `src/apps/developer`, `src/apps/mortgage`, `src/apps/admin` for role-specific shells.
- `src/apps/shared/messaging` for the SignalR chat widgets reused across portals.
- `src/shared/components` and `src/shared/hooks` for reuse.
- `public/locales/en`, `public/locales/fr` for localization resources.

### 2. API Repository

```bash
gh repo create your-org/buyer-registry-api --private --description "Buyer Registry Node.js API"
mkdir buyer-registry-api && cd buyer-registry-api
npm init -y
npm install express zod pg pg-promise bullmq @azure/identity @azure/keyvault-secrets @azure/storage-blob
npm install -D typescript ts-node-dev jest @types/express @types/jest
npx tsc --init --rootDir src --outDir dist --esModuleInterop --resolveJsonModule
mkdir -p src/routes src/controllers src/services src/jobs src/middleware src/config
```

Key directories:

- `src/match` – encapsulated matching engine with adjustable weights and audit logging.
- `src/messaging` – SignalR hub integrations and chat persistence.
- `src/payments` – Stripe/Moneris webhook handlers and subscription logic.
- `src/analytics` – demand snapshot builders and query helpers for dashboards.
- `migrations/` – `node-pg-migrate` or `knex` migrations for PostgreSQL/PostGIS schema.

### 3. Search Indexer Repository

```bash
gh repo create your-org/buyer-registry-search-indexer --private --description "Pipelines for Azure Cognitive Search"
mkdir buyer-registry-search-indexer && cd buyer-registry-search-indexer
npm init -y
npm install @azure/cosmos @azure/search-documents @azure/storage-queue dotenv
mkdir -p src/functions/listings src/functions/wishlists src/lib
```

Responsibilities:

- Azure Function triggers that respond to PostgreSQL change feed or storage queue messages.
- Batch upserts/deletes into Azure Cognitive Search indexes.
- Shared validation for geospatial payloads before indexing.
- Project demand snapshot exports consumed by analytics dashboards.
- Backfills for polygon-based buyer wishlists and listing media metadata.

### 4. Infrastructure Repository

```bash
gh repo create your-org/buyer-registry-infra --private --description "Azure infrastructure definitions"
mkdir buyer-registry-infra && cd buyer-registry-infra
mkdir -p bicep modules pipelines environments
```

Recommended contents:

- `bicep/main.bicep` – master template referencing modules for database, search, app services, SignalR, Key Vault, storage, CDN.
- `pipelines/` – GitHub Actions workflows for CI/CD (lint, test, deploy).
- `environments/dev|qa|prod` – parameter files with SKU sizing, networking, secrets references.

### 5. Shared Package Repository

```bash
gh repo create your-org/buyer-registry-shared --private --description "Shared types, schemas, and utilities"
mkdir buyer-registry-shared && cd buyer-registry-shared
npm init -y
npm install zod @azure/msal-browser
mkdir -p src/schemas src/constants src/hooks
```

Usage guidelines:

- Publish to GitHub Packages (npm registry) to share TypeScript types and JSON schemas.
- Store linting configurations (`.eslintrc.cjs`, `prettier.config.cjs`) consumed via `npm pkg set eslintConfig.extends="@buyer-registry/eslint-config"`.
- Design tokens (`tokens/colors.json`, `tokens/spacing.json`) exported for the frontend.
- Zod schemas for wishlists, listings, and matches that enforce PIPEDA consent fields and geospatial structures.

## Cross-Repository Standards

- **Branch Strategy:** `main` for production-ready code, `develop` for integration. Feature branches prefixed with role (e.g., `fe/`, `api/`, `infra/`).
- **Issue Templates:** Use shared `.github/ISSUE_TEMPLATE/` from `buyer-registry-shared` via GitHub template sync.
- **Commitlint:** Adopt Conventional Commits enforced via Husky/commitlint in each repo.
- **Security:** Enable branch protection, required reviews, Dependabot updates, and secret scanning across all repos.
- **Documentation:** Host architecture docs in `buyer-registry-infra/docs` with links back to the other repos; use MkDocs or Docusaurus.

## Automation

1. **CI Pipelines**
   - Frontend: Lint (`eslint`), type-check (`tsc --noEmit`), unit tests (`vitest`), build.
   - API: Lint, unit tests (`jest`), integration tests against a Postgres/PostGIS container, OpenAPI docs generation.
   - Search Indexer: Unit tests for index transformations, `azure-functions-core-tools` build.
   - Shared: Tests on exported utilities, publish preview packages on tagged releases.
   - Infrastructure: Validate Bicep (`az bicep build`), run ARM/Terraform plan, and `checkov` security scans.

2. **Release Channels**
   - Tag releases with semantic versioning (`vMAJOR.MINOR.PATCH`).
   - Use GitHub environments (`dev`, `qa`, `prod`) with required approvals.
   - Store environment secrets in GitHub and mirror to Azure Key Vault via automation runbooks.

3. **Dependency Management**
   - Dependabot updates weekly per repo.
   - Shared repo publishes updated packages; frontend/API consume via Renovate or Dependabot PRs.

## Next Steps

1. Obtain approval for repository names and privacy level (private until launch).
2. Execute the `gh repo create` commands above or use GitHub UI.
3. Copy shared templates (EditorConfig, lint configs) into each repo.
4. Configure GitHub Actions secrets (`AZURE_CREDENTIALS`, `POSTGRES_CONNECTION`, `STRIPE_WEBHOOK_SECRET`, etc.).
5. Create initial backlog issues referencing the feature requirements in the Buyer Registry specification.

Once the repositories exist, update this document with actual URLs and cross-link READMEs for discoverability.
