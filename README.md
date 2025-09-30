# Light-Engine-Charlie

This repository packages the Light Engine setup wizard seed data in a simple TypeScript structure. It includes:

- Shared type definitions for light catalog entries and setup guides.
- A comprehensive `LIGHTS_SEED` array populated with the Grow3 TopLight MH 300W fixture and the DLC Qualified Product List sample provided in the spec.
- Reusable setup guides for managed, Wi-Fi, 0–10 V analog, RS-485, and DC-powered commissioning paths.

All data lives in `src/data/lightsSeed.ts` and is ready to be consumed by the Light Search → Compare → Guided Setup flow.
