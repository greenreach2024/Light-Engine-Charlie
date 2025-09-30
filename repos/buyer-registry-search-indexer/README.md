# Buyer Registry Search Indexer

Azure Functions-style workers that synchronize wishlists and listings into Azure Cognitive Search indexes.

## Functions

- `listings-ingest` – Processes listing upsert events from queues and pushes documents into the `listings` index.
- `wishlists-ingest` – Processes wishlist updates to power demand analytics.
- `analytics-snapshot` – (planned) Generates aggregated demand slices for seller/agent dashboards.

## Local development

```bash
npm install
npm run build
```

Set the following environment variables via `local.settings.json` or `.env`:

- `AZURE_SEARCH_ENDPOINT`
- `AZURE_SEARCH_API_KEY`
- `AZURE_SEARCH_INDEX`
- `AZURE_STORAGE_QUEUE`

## Testing strategy

Add unit tests for transformation logic in `src/lib/transformers.ts` once implemented. Use Azurite queues for local development.
