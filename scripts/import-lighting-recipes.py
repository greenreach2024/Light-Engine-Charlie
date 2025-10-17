"""
Import lighting recipes from Excel (multi-tab, crop-specific) and output normalized JSON for frontend/backend use.

- Input: public/data/Lighting_Recipes_With_Varieties_Daily_Full_EXPANDED_HydroPerformers-2.xlsx
- Output: public/data/lighting-recipes.json

Each tab = crop/variety. Each row = daily plan.
"""
import os
import json
import pandas as pd
import re

EXCEL_PATH = 'public/data/Lighting_Recipes_With_Varieties_Daily_Full_EXPANDED_HydroPerformers-2.xlsx'
OUTPUT_PATH = 'public/data/lighting-recipes.json'

def parse_temperature(val):
    if pd.isnull(val):
        return None
    s = str(val).replace('°C','').replace('C','').strip()
    # Match single value or range
    match = re.match(r'^(\d+(?:\.\d+)?)[–-]?(\d+(?:\.\d+)?)?$', s)
    if match:
        if match.group(2):
            # Range: average
            return (float(match.group(1)) + float(match.group(2))) / 2
        return float(match.group(1))
    # Fallback: extract first number
    num = re.findall(r'\d+(?:\.\d+)?', s)
    if num:
        return float(num[0])
    return None

assert os.path.exists(EXCEL_PATH), f"Excel file not found: {EXCEL_PATH}"

# Load all sheets
sheets = pd.read_excel(EXCEL_PATH, sheet_name=None)

recipes = {}
for crop, df in sheets.items():
    # Clean column names
    df.columns = [str(c).strip() for c in df.columns]
    # Only keep rows with valid day and spectra
    if 'Day' not in df.columns:
        continue
    df = df[df['Day'].notnull()]
    plans = []
    for _, row in df.iterrows():
        day_val = row.get('Day', None)
        try:
            day = int(day_val)
        except (ValueError, TypeError):
            continue  # skip non-numeric day rows
        # Try both column naming conventions for spectrum values
        def get_spectrum_value(row, col1, col2=None):
            """Get spectrum value from row, trying col1 first, then col2 if provided"""
            val = row.get(col1, None)
            # Only try col2 if col1 doesn't exist or is NaN (not if it's 0, as 0 is valid)
            if (pd.isna(val) or val is None) and col2:
                val = row.get(col2, None)
            return float(val) if not pd.isna(val) and val is not None else 0.0
        
        blue = get_spectrum_value(row, 'Blue (%)', 'Blue (450 nm)')
        green = get_spectrum_value(row, 'Green (%)')
        red = get_spectrum_value(row, 'Red (%)', 'Red (660 nm)')
        far_red = get_spectrum_value(row, 'Far-Red (%)', 'Far-Red (730 nm)')
        
        plans.append({
            'day': day,
            'stage': str(row.get('Stage', '')).strip(),
            'temperature': parse_temperature(row.get('Temperature (°C)', None)),
            'blue': blue,
            'green': green,
            'red': red,
            'far_red': far_red,
            'ppfd': float(row.get('PPFD (µmol/m²/s)', 0)),
        })
    recipes[crop.strip()] = plans

with open(OUTPUT_PATH, 'w') as f:
    json.dump({'crops': recipes}, f, indent=2)

print(f"✅ Imported {len(recipes)} crops. Output: {OUTPUT_PATH}")
