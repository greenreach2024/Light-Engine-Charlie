# Buyer Registry Platform – GitHub Repository Alignment

The Buyer Registry project must be published to the existing GitHub repository `git@github.com:greenreach2024/Realestate-Reach.git`. Rather than spinning up five independent repositories, treat that remote as the canonical mono-repository that houses the frontend, API, infrastructure, shared package, and background worker code already organized under the local [`repos`](../repos) directory tree.

## Repository Goal

- **Remote:** `git@github.com:greenreach2024/Realestate-Reach.git`
- **Default branch:** `main`
- **Purpose:** Retain the current folder structure (frontend, API, infra, search indexer, shared schemas) in a single Git history so that all services stay in sync while the Realestate Reach team evaluates the Buyer Registry concept.

## Recommended Directory Layout

| Path | Description |
|------|-------------|
| `repos/buyer-registry-frontend` | React/Vite portals covering buyers, sellers/agents, developers, mortgage brokers, and admins. |
| `repos/buyer-registry-api` | Express/TypeScript backend for onboarding, wishlists, listings, matchmaking, messaging, subscriptions, and compliance. |
| `repos/buyer-registry-search-indexer` | Azure Functions workers that hydrate Azure Cognitive Search with listings/wishlists and demand analytics snapshots. |
| `repos/buyer-registry-infra` | Bicep modules, environment parameters, and pipeline templates for Azure provisioning. |
| `repos/buyer-registry-shared` | Shared TypeScript schemas, design tokens, and configuration consumed by the other packages. |
| `docs/` | Operational runbooks (including this document) that explain how to work with the mono-repository. |

Because the mono-repo already contains Git-ready subprojects, keep each directory self-contained (own `package.json`, `tsconfig`, etc.) but commit them together so cross-service changes remain atomic.

## Branch & Workflow Guidance

- Use feature branches from `main` (e.g., `feature/match-service-adjustments`) and open pull requests back into `main`.
- Adopt Conventional Commits across the mono-repo to keep history consistent.
- Configure GitHub Actions inside the Realestate Reach repository to run per-package scripts (lint, build, test) by leveraging workspace-level tooling or package-specific npm scripts.
- If sub-teams prefer focused diffs, they can use sparse checkouts or partial clones locally, but all pushes should return to `main` on the same remote.

## Automation & Future Splits

Should the organization later decide to fan out into multiple repositories, the `repos/*` directories can be extracted with `git filter-repo` or GitHub's `svn` export. Until then, keep CI, release tagging, and issue tracking centralized in Realestate Reach to avoid fragmentation.

Document any repository-specific settings (branch protection, secret names, environments) in [`docs/github-repo-setup.md`](./github-repo-setup.md) so administrators can replicate them in the Realestate Reach settings UI.
