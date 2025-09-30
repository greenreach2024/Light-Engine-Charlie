# Buyer Registry GitHub Repository Setup

This guide explains how to publish the current workspace into the existing GitHub repository `git@github.com:greenreach2024/Realestate-Reach.git`. The Realestate Reach remote will host the mono-repository that already contains the frontend, API, search indexer, infrastructure templates, and shared package directories under `/repos`.

## Prerequisites

- Contributor access to `git@github.com:greenreach2024/Realestate-Reach.git`.
- SSH connectivity to GitHub (preferred) or HTTPS credentials.
- Git installed locally (already present in this environment).

## Initialize the Mono-Repo

Run the following commands from the workspace root:

```bash
# Ensure we are at /workspace/Light-Engine-Charlie
cd /workspace/Light-Engine-Charlie

git init

git remote add origin git@github.com:greenreach2024/Realestate-Reach.git

git checkout -b main

git add .

git commit -m "chore: bootstrap buyer registry workspace"
```

The commit message can be adjusted to describe the specific changes you are pushing.

## Publish to GitHub

With the commit created, push the mono-repository to the Realestate Reach remote:

```bash
git push -u origin main
```

If the remote already contains history, pull the latest changes first and resolve any conflicts before pushing:

```bash
git fetch origin

git merge origin/main
# Resolve conflicts as needed, then

git push -u origin main
```

## Keeping the Remote in Sync

- Continue using feature branches off `main` (e.g., `feature/wishlist-builder-ui`).
- Open pull requests in the Realestate Reach repository so reviewers can approve changes before they land in `main`.
- When updating tooling inside a subdirectory (such as `repos/buyer-registry-api`), commit the changes together with any related documentation updates so the mono-repo stays coherent.

## Optional: Tagging and Releases

The Realestate Reach repository can adopt semantic version tags to coordinate releases:

```bash
git tag v0.1.0
git push origin v0.1.0
```

Document any repository-specific settings (branch protection rules, required checks, environments) directly in the GitHub UI or within this `docs/` folder so future pushes stay aligned with Realestate Reach governance.
