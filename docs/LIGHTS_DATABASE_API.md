# Lights Database API

## Overview

The Lights Database provides a centralized catalog of grow lights accessible from multiple UI components (Light Setup wizard, Equipment Overview, etc.). The database is stored in `public/data/lights-catalog.json` and accessed via REST API endpoints.

## Architecture

### Components

1. **Data Storage**: `public/data/lights-catalog.json` - JSON file storing all light records
2. **Import Tool**: `scripts/import-lights-csv.js` - Converts CSV files to JSON format
3. **Database Module**: `lib/lights-database.js` - Singleton class providing CRUD operations with 1-minute caching
4. **REST API**: Endpoints in `server-charlie.js` exposing database functionality

### Data Structure

```json
{
  "version": "1.0",
  "updated_at": "2025-10-16T11:27:39.054Z",
  "source": "imported from lights.csv",
  "count": 1,
  "lights": [
    {
      "id": "light_1760614019186",
      "manufacturer": "Fluence",
      "model": "SPYDR 2i",
      "wattage": 650,
      "ppfd": 1500,
      "coverage_area": "4x4 ft",
      "spectrum": "Full spectrum with enhanced red",
      "added_at": "2025-10-16T11:26:59.186Z",
      "updated_at": "2025-10-16T11:27:39.054Z",
      "notes": "Optional notes field"
    }
  ]
}
```

## Importing CSV Data

### Step 1: Prepare CSV File

Your CSV should have columns for light specifications:

```csv
manufacturer,model,wattage,ppfd,coverage_area,spectrum,notes
Fluence,SPYDR 2i,645,1500,4x4 ft,Full spectrum with enhanced red,High-end commercial light
Gavita,Pro 1700e LED,645,1700,5x5 ft,White LED full spectrum,Industry standard
Spider Farmer,SF-4000,450,1200,4x4 ft,Samsung LM301B + Osram red,Budget-friendly option
```

### Step 2: Run Import Script

```bash
node scripts/import-lights-csv.js path/to/your/lights.csv
```

The script will:
- Parse the CSV file
- Generate unique IDs for each light (`light_<timestamp>_<index>`)
- Add metadata (version, updated_at, source, count)
- Save to `public/data/lights-catalog.json`
- Save CSV copy to `public/data/lights-catalog.csv`

### Step 3: Verify Import

```bash
curl http://127.0.0.1:8091/lights/stats | jq
```

Expected output:
```json
{
  "ok": true,
  "stats": {
    "total": 3,
    "manufacturers": 3,
    "updated_at": "2025-10-16T11:26:59.186Z",
    "version": "1.0"
  }
}
```

## REST API Endpoints

### GET /lights

Get all lights with optional filtering.

**Query Parameters:**
- `manufacturer` (string) - Filter by manufacturer (case-insensitive)
- `wattage_min` (number) - Minimum wattage
- `wattage_max` (number) - Maximum wattage
- `search` (string) - Search in manufacturer, model, and name fields

**Examples:**

```bash
# Get all lights
curl http://127.0.0.1:8091/lights | jq

# Filter by manufacturer
curl "http://127.0.0.1:8091/lights?manufacturer=Fluence" | jq

# Filter by wattage range
curl "http://127.0.0.1:8091/lights?wattage_min=500&wattage_max=700" | jq

# Search across multiple fields
curl "http://127.0.0.1:8091/lights?search=SPYDR" | jq
```

**Response:**
```json
{
  "ok": true,
  "lights": [...],
  "count": 3
}
```

### GET /lights/:id

Get a single light by ID.

**Example:**
```bash
curl http://127.0.0.1:8091/lights/light_1760614019186 | jq
```

**Response:**
```json
{
  "ok": true,
  "light": {
    "id": "light_1760614019186",
    "manufacturer": "Fluence",
    "model": "SPYDR 2i",
    ...
  }
}
```

**Error Response (404):**
```json
{
  "ok": false,
  "error": "Light not found"
}
```

### GET /lights/manufacturers

Get list of unique manufacturers.

**Example:**
```bash
curl http://127.0.0.1:8091/lights/manufacturers | jq
```

**Response:**
```json
{
  "ok": true,
  "manufacturers": ["Fluence", "Gavita", "Spider Farmer"]
}
```

### GET /lights/stats

Get database statistics.

**Example:**
```bash
curl http://127.0.0.1:8091/lights/stats | jq
```

**Response:**
```json
{
  "ok": true,
  "stats": {
    "total": 3,
    "manufacturers": 3,
    "updated_at": "2025-10-16T11:26:59.186Z",
    "version": "1.0"
  }
}
```

### POST /lights

Create a new light.

**Required Fields:**
- `manufacturer` (string)
- `model` (string)

**Optional Fields:**
- `wattage` (number)
- `ppfd` (number)
- `coverage_area` (string)
- `spectrum` (string)
- `notes` (string)
- Any custom fields

**Example:**
```bash
curl -X POST http://127.0.0.1:8091/lights \
  -H "Content-Type: application/json" \
  -d '{
    "manufacturer": "Fluence",
    "model": "SPYDR 2i",
    "wattage": 645,
    "ppfd": 1500,
    "coverage_area": "4x4 ft",
    "spectrum": "Full spectrum with enhanced red"
  }' | jq
```

**Response:**
```json
{
  "ok": true,
  "light": {
    "manufacturer": "Fluence",
    "model": "SPYDR 2i",
    "wattage": 645,
    "ppfd": 1500,
    "coverage_area": "4x4 ft",
    "spectrum": "Full spectrum with enhanced red",
    "id": "light_1760614019186",
    "added_at": "2025-10-16T11:26:59.186Z"
  }
}
```

**Error Response (400):**
```json
{
  "ok": false,
  "error": "Missing required fields: manufacturer and model"
}
```

### POST /lights/search

Advanced search with complex criteria.

**Criteria Object:**
- Exact match: `{ "manufacturer": "Fluence" }`
- String search: `{ "model": "SPYDR" }` (case-insensitive includes)
- Range query: `{ "wattage": { "min": 500, "max": 700 } }`
- Multiple criteria: All must match (AND logic)

**Examples:**

```bash
# Exact manufacturer match
curl -X POST http://127.0.0.1:8091/lights/search \
  -H "Content-Type: application/json" \
  -d '{"manufacturer": "Fluence"}' | jq

# Wattage range
curl -X POST http://127.0.0.1:8091/lights/search \
  -H "Content-Type: application/json" \
  -d '{"wattage": {"min": 500, "max": 700}}' | jq

# Multiple criteria
curl -X POST http://127.0.0.1:8091/lights/search \
  -H "Content-Type: application/json" \
  -d '{
    "manufacturer": "Fluence",
    "wattage": {"min": 600}
  }' | jq
```

**Response:**
```json
{
  "ok": true,
  "lights": [...],
  "count": 2
}
```

### PATCH /lights/:id

Update an existing light.

**Example:**
```bash
curl -X PATCH http://127.0.0.1:8091/lights/light_1760614019186 \
  -H "Content-Type: application/json" \
  -d '{
    "wattage": 650,
    "notes": "Updated wattage specification"
  }' | jq
```

**Response:**
```json
{
  "ok": true,
  "light": {
    "manufacturer": "Fluence",
    "model": "SPYDR 2i",
    "wattage": 650,
    "notes": "Updated wattage specification",
    "updated_at": "2025-10-16T11:27:39.054Z",
    ...
  }
}
```

**Error Response (404):**
```json
{
  "ok": false,
  "error": "Light not found: light_12345"
}
```

### DELETE /lights/:id

Delete a light.

**Example:**
```bash
curl -X DELETE http://127.0.0.1:8091/lights/light_1760614019186 | jq
```

**Response:**
```json
{
  "ok": true,
  "deleted": true
}
```

**Error Response (404):**
```json
{
  "ok": false,
  "error": "Light not found: light_12345"
}
```

## Frontend Integration

### JavaScript API Wrapper

Add to `public/app.charlie.js`:

```javascript
// Lights Database API
const lightsAPI = {
  /**
   * Get all lights with optional filtering
   */
  async getAll(filters = {}) {
    const params = new URLSearchParams(filters);
    const url = `/lights?${params}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Failed to fetch lights: ${res.statusText}`);
    const data = await res.json();
    return data.lights;
  },

  /**
   * Get single light by ID
   */
  async getById(id) {
    const res = await fetch(`/lights/${id}`);
    if (!res.ok) {
      if (res.status === 404) return null;
      throw new Error(`Failed to fetch light: ${res.statusText}`);
    }
    const data = await res.json();
    return data.light;
  },

  /**
   * Get manufacturers list
   */
  async getManufacturers() {
    const res = await fetch('/lights/manufacturers');
    if (!res.ok) throw new Error(`Failed to fetch manufacturers: ${res.statusText}`);
    const data = await res.json();
    return data.manufacturers;
  },

  /**
   * Search lights with complex criteria
   */
  async search(criteria) {
    const res = await fetch('/lights/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(criteria)
    });
    if (!res.ok) throw new Error(`Search failed: ${res.statusText}`);
    const data = await res.json();
    return data.lights;
  },

  /**
   * Create new light
   */
  async create(lightData) {
    const res = await fetch('/lights', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(lightData)
    });
    if (!res.ok) {
      const error = await res.json();
      throw new Error(error.error || 'Failed to create light');
    }
    const data = await res.json();
    return data.light;
  },

  /**
   * Update existing light
   */
  async update(id, updates) {
    const res = await fetch(`/lights/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updates)
    });
    if (!res.ok) {
      const error = await res.json();
      throw new Error(error.error || 'Failed to update light');
    }
    const data = await res.json();
    return data.light;
  },

  /**
   * Delete light
   */
  async delete(id) {
    const res = await fetch(`/lights/${id}`, {
      method: 'DELETE'
    });
    if (!res.ok) {
      const error = await res.json();
      throw new Error(error.error || 'Failed to delete light');
    }
    return true;
  }
};

// Add to window for global access
window.lightsAPI = lightsAPI;
```

### Usage Examples

```javascript
// Get all lights
const lights = await lightsAPI.getAll();

// Filter by manufacturer
const fluenceLights = await lightsAPI.getAll({ manufacturer: 'Fluence' });

// Get manufacturers for dropdown
const manufacturers = await lightsAPI.getManufacturers();

// Search with complex criteria
const lights = await lightsAPI.search({
  manufacturer: 'Fluence',
  wattage: { min: 600, max: 700 }
});

// Create new light
const newLight = await lightsAPI.create({
  manufacturer: 'Gavita',
  model: 'Pro 1700e LED',
  wattage: 645,
  ppfd: 1700
});

// Update light
await lightsAPI.update('light_1760614019186', {
  wattage: 650,
  notes: 'Updated specification'
});

// Delete light
await lightsAPI.delete('light_1760614019186');
```

## Database Module (Backend)

The `lib/lights-database.js` module can be used directly in Node.js:

```javascript
import lightsDB from './lib/lights-database.js';

// Get all lights
const lights = await lightsDB.getAll();

// Find by ID
const light = await lightsDB.findById('light_1760614019186');

// Search
const results = await lightsDB.search({ manufacturer: 'Fluence' });

// Get manufacturers
const manufacturers = await lightsDB.getManufacturers();

// Add light
const newLight = await lightsDB.add({
  manufacturer: 'Gavita',
  model: 'Pro 1700e LED',
  wattage: 645
});

// Update light
const updated = await lightsDB.update('light_1760614019186', {
  wattage: 650
});

// Delete light
await lightsDB.delete('light_1760614019186');

// Clear cache (force reload)
lightsDB.clearCache();
```

## Performance

- **Caching**: Database module caches data for 1 minute
- **File Size**: JSON file should stay under 1MB for optimal performance
- **Concurrency**: File writes are atomic (write + rename)
- **Memory**: Entire catalog loaded into memory (suitable for 1000s of lights)

## Error Handling

All endpoints return consistent error responses:

```json
{
  "ok": false,
  "error": "Error message here"
}
```

HTTP status codes:
- `200` - Success
- `400` - Bad request (validation error)
- `404` - Resource not found
- `500` - Server error

## Future Enhancements

- [ ] Bulk import/export endpoints
- [ ] Image upload for light fixtures
- [ ] Vendor API integration for pricing
- [ ] Usage statistics (which lights are most used)
- [ ] Recommendations based on grow room size
- [ ] Full-text search with fuzzy matching
- [ ] Pagination for large catalogs

## Related Documentation

- `SETUP_WIZARD_SYSTEM.md` - Setup wizard architecture
- `LIGHT_FIXTURE_WORKFLOW.md` - Light fixture configuration workflow
- `EQUIPMENT_MANAGEMENT.md` - Equipment overview integration
