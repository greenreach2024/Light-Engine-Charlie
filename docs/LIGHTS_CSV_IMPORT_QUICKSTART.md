# Quick Start: Importing Your Lights CSV

## Step-by-Step Instructions

### 1. Prepare Your CSV File

Make sure your CSV file has these columns (at minimum):
- `manufacturer` - Light manufacturer name (required)
- `model` - Model number/name (required)
- `wattage` - Power consumption in watts (optional but recommended)
- `ppfd` - PPFD rating in µmol/m²/s (optional)
- `coverage_area` - Coverage area like "4x4 ft" (optional)
- `spectrum` - Light spectrum description (optional)
- `notes` - Additional notes (optional)

You can add any additional columns you need - they will all be imported.

Example CSV:
```csv
manufacturer,model,wattage,ppfd,coverage_area,spectrum,notes
Fluence,SPYDR 2i,645,1500,4x4 ft,Full spectrum with enhanced red,High-end commercial light
Gavita,Pro 1700e LED,645,1700,5x5 ft,White LED full spectrum,Industry standard
Spider Farmer,SF-4000,450,1200,4x4 ft,Samsung LM301B + Osram red,Budget-friendly option
```

### 2. Save Your CSV File

Save your CSV file somewhere on your computer, for example:
```
~/Downloads/grow-lights.csv
```

### 3. Run the Import Script

Open Terminal and run:

```bash
cd /Users/petergilbert/Light-Engine-Charlie
node scripts/import-lights-csv.js ~/Downloads/grow-lights.csv
```

Replace `~/Downloads/grow-lights.csv` with the actual path to your CSV file.

### 4. Verify the Import

Check that the import worked:

```bash
curl http://127.0.0.1:8091/lights/stats | jq
```

You should see output like:
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

View all imported lights:
```bash
curl http://127.0.0.1:8091/lights | jq
```

### 5. Check the Files

Two files will be created:
- `public/data/lights-catalog.json` - The database file (JSON format)
- `public/data/lights-catalog.csv` - A copy of your CSV file

You can view them:
```bash
cat public/data/lights-catalog.json | jq .
```

## Common Issues

### Issue: "ENOENT: no such file or directory"

**Solution**: Make sure the path to your CSV file is correct. Try using the full path:
```bash
node scripts/import-lights-csv.js /Users/petergilbert/Downloads/grow-lights.csv
```

### Issue: "Cannot find module"

**Solution**: Make sure you're in the Light-Engine-Charlie directory:
```bash
cd /Users/petergilbert/Light-Engine-Charlie
```

### Issue: Empty lights array

**Solution**: Check your CSV format. Make sure:
- First row contains column headers
- Each row has the same number of columns
- No blank rows at the end
- File uses UTF-8 encoding

## Using the Lights Database

Once imported, you can:

### From the Terminal (API):

```bash
# Get all lights
curl http://127.0.0.1:8091/lights | jq

# Get manufacturers list
curl http://127.0.0.1:8091/lights/manufacturers | jq

# Filter by manufacturer
curl "http://127.0.0.1:8091/lights?manufacturer=Fluence" | jq

# Search by wattage range
curl "http://127.0.0.1:8091/lights?wattage_min=500&wattage_max=700" | jq
```

### From the Browser (JavaScript):

Open browser console on http://127.0.0.1:8091 and run:

```javascript
// Get all lights
const lights = await fetch('/lights').then(r => r.json());
console.log(lights);

// Get manufacturers
const mfrs = await fetch('/lights/manufacturers').then(r => r.json());
console.log(mfrs);

// Search
const fluence = await fetch('/lights?manufacturer=Fluence').then(r => r.json());
console.log(fluence);
```

## Next Steps

After importing your lights:

1. **Light Setup Wizard**: Lights will be available in the Light Setup wizard for selection
2. **Equipment Overview**: Light specifications will be shown in Equipment Overview
3. **Manual Management**: You can add/edit/delete lights via the API endpoints

See `docs/LIGHTS_DATABASE_API.md` for complete API documentation.

## Re-importing Data

To re-import (this will replace all existing data):

```bash
node scripts/import-lights-csv.js ~/Downloads/updated-lights.csv
```

**Warning**: This will overwrite `public/data/lights-catalog.json`. Make a backup first if you've made manual changes:

```bash
cp public/data/lights-catalog.json public/data/lights-catalog.json.backup
```

## Adding Individual Lights via API

You can also add lights one at a time via the API:

```bash
curl -X POST http://127.0.0.1:8091/lights \
  -H "Content-Type: application/json" \
  -d '{
    "manufacturer": "Mars Hydro",
    "model": "FC 6500",
    "wattage": 650,
    "ppfd": 1525,
    "coverage_area": "5x5 ft",
    "spectrum": "Samsung LM301B + Osram red"
  }' | jq
```

This is useful for adding lights discovered later without re-importing the entire CSV.
