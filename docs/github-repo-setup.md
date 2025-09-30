# Buyer Registry GitHub Repository Setup

This guide explains how to publish the local mono-repository layout into five GitHub repositories so that each service can evolve independently while sharing the contract packages already present in this workspace.

## Prerequisites

- GitHub organization or user account with permissions to create repositories.
- SSH access configured for `git@github.com` (preferred) or a personal access token for HTTPS pushes.
- Node.js 18+ and PNPM/NPM as required by each package (already defined in the local `package.json` files).

## Repository Mapping

| Local directory | Target GitHub repo | Description |
| --- | --- | --- |
| `repos/buyer-registry-frontend` | `buyer-registry-frontend` | React/Vite portals for buyers, sellers, agents, developers, mortgage brokers, and admins. |
| `repos/buyer-registry-api` | `buyer-registry-api` | Express/TypeScript API hosting wishlist, listing, messaging, analytics, and subscription endpoints. |
| `repos/buyer-registry-infra` | `buyer-registry-infra` | Bicep modules and pipeline definitions for Azure provisioning. |
| `repos/buyer-registry-search-indexer` | `buyer-registry-search-indexer` | Azure Functions that keep Cognitive Search indexes synchronized. |
| `repos/buyer-registry-shared` | `buyer-registry-shared` | Shared TypeScript package with Zod schemas, tokens, and constants consumed by the other projects. |

## Create Empty GitHub Repositories

From the GitHub UI or CLI, create the repositories listed above under the `greenreach2024` organization (or your own namespace if preferred). The repositories should be initialized **without** a README so that history from this workspace can be pushed directly.

Example using the GitHub CLI:

```bash
gh repo create greenreach2024/buyer-registry-frontend --private --disable-wiki --disable-issues --source=./repos/buyer-registry-frontend --push --remote=origin
```

Repeat the `gh repo create` command for each target repository, adjusting the `--source` path and repository name accordingly.

If the repositories already exist, skip creation and simply add them as remotes in the following steps.

## Push Each Project

Run these commands from the workspace root to publish all subdirectories. Each section assumes the GitHub repository was created via the UI/CLI as described above.

### 1. Shared package

```bash
cd repos/buyer-registry-shared
git init
git remote add origin git@github.com:greenreach2024/buyer-registry-shared.git
git checkout -b main
git add .
git commit -m "chore: bootstrap shared schema package"
git push -u origin main
cd ../../
```

### 2. Backend API

```bash
cd repos/buyer-registry-api
git init
git remote add origin git@github.com:greenreach2024/buyer-registry-api.git
git checkout -b main
git add .
git commit -m "feat: scaffold express api for buyer registry"
git push -u origin main
cd ../../
```

### 3. Frontend portals

```bash
cd repos/buyer-registry-frontend
git init
git remote add origin git@github.com:greenreach2024/buyer-registry-frontend.git
git checkout -b main
git add .
git commit -m "feat: bootstrap multi-portal frontend"
git push -u origin main
cd ../../
```

### 4. Search indexer

```bash
cd repos/buyer-registry-search-indexer
git init
git remote add origin git@github.com:greenreach2024/buyer-registry-search-indexer.git
git checkout -b main
git add .
git commit -m "feat: seed cognitive search indexer"
git push -u origin main
cd ../../
```

### 5. Infrastructure templates

```bash
cd repos/buyer-registry-infra
git init
git remote add origin git@github.com:greenreach2024/buyer-registry-infra.git
git checkout -b main
git add .
git commit -m "chore: add azure infrastructure bicep modules"
git push -u origin main
cd ../../
```

> **Note:** If you prefer a single mono-repo on GitHub, you can instead push this entire workspace to `git@github.com:greenreach2024/Realestate-Reach.git` and retain the current folder structure. The dedicated repositories outlined above are useful when teams manage deployments independently.

## Keep Histories in Sync

Because each subproject will maintain its own Git history after being pushed, future updates should be made directly in their respective repositories. If you continue to work locally in this workspace, remember to pull from each remote before making changes.

For automated CI/CD, configure GitHub Actions or Azure Pipelines in each repository using the provided `package.json` scripts and infrastructure definitions.

