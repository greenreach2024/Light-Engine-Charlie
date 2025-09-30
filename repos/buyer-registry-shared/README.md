# Buyer Registry Shared Library

Shared schemas, constants, and design tokens published as an npm package for the Buyer Registry platform.

## Publishing

```bash
npm install
npm run build
npm publish --access public
```

Configure GitHub Packages or Azure Artifacts as the registry target before publishing.

## Contents

- `src/schemas` – Zod schemas shared between API, indexer, and frontend (wishlists with consent + geospatial metadata, listings with amenities/media, matches with scoring breakdown).
- `src/constants` – Enumerations for roles and common flags.
- `tokens/` – JSON design tokens for colour and spacing foundations.

Add linting and semantic-release workflows before first release.
