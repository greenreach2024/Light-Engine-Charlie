# Buyer Registry Infrastructure

Infrastructure-as-code assets for deploying the Buyer Registry platform to Azure.

## Contents

- `bicep/` – Main entry point (`main.bicep`) that wires together service modules.
- `modules/` – Reusable building blocks for database, search, storage, and networking components.
- `environments/` – Parameter files for dev, QA, and production environments.
- `pipelines/` – GitHub Actions workflow definitions for validation and deployment.

## Usage

```bash
az deployment sub create \
  --location canadaeast \
  --template-file bicep/main.bicep \
  --parameters @environments/dev/main.parameters.json
```

Use federated credentials from GitHub Actions to authenticate with Azure. Secrets should be stored in Azure Key Vault and referenced from parameter files using `@Microsoft.KeyVault(SecretUri=...)` syntax.
