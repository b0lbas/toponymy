# Toponym Atlas — Europe (Precompute + Interactive Site)

This repo contains:
- `data-pipeline/` — scripts to precompute suffix distributions from OpenStreetMap (Geofabrik country extracts)
- `web/` — a smooth interactive site:
  - pan/zoom map of Europe with clickable countries
  - when a country is selected, it shows multiple “suffix heatmaps” as small-multiples (square grid)

> Note: the `web/public/data/` folder contains **small synthetic demo data** for Germany / France so the UI works immediately.
> Run the pipeline to generate **real** data for more countries.

---

## 1) Run the website (demo)

```bash
cd web
npm install
npm run dev
```

Open the dev server URL shown in the terminal.

---

## 2) Generate real data (OSM → suffix maps)

### Install Python deps
```bash
cd data-pipeline
python -m venv .venv
# Windows: .venv\Scripts\activate
# macOS/Linux: source .venv/bin/activate
pip install -r requirements.txt
```

### Download OSM extracts (Geofabrik)
```bash
python scripts/00_download_pbf.py
```

### Extract populated places (nodes with place=* and name=*)
```bash
python scripts/01_extract_places.py
```

### Precompute suffix maps → `data-pipeline/export/web/public/data/<country_id>/...`
```bash
python scripts/02_precompute_suffix_tiles.py
```

Then copy the exported `public/data` into the website:

```bash
# from repo root
rm -rf web/public/data
cp -R data-pipeline/export/web/public/data web/public/data
```

Now run/build the site normally:

```bash
cd web
npm run dev
# or
npm run build && npm run preview
```

---

## How patterns are selected (precompute)

Pipeline computes suffix frequencies for each country (length 2..8 by default), keeps top-N by frequency,
then scores each candidate by:

- `score = log(1 + freq) * (1 - normalized_entropy(tile_distribution))`

This favors **common** + **geographically clustered** suffixes (often the most interesting maps).

You can tweak all knobs in:
- `data-pipeline/config/europe.json`

---

## Notes & future upgrades

- Add “substring” mode (n-grams or arbitrary contains) with thresholds, caching, and/or separate precompute.
- Use multiple zoom levels and switch grids in the UI.
- Add normalized heatmap options (matches / all places per tile).
- Consider admin boundaries or multilingual names for certain regions.

---

## Attribution / licensing

If you use OpenStreetMap-derived datasets, you must comply with ODbL requirements and provide proper attribution.
Map tiles in the UI use OpenStreetMap raster tiles by default.


## Troubleshooting

- If `pip` cannot find `pyosmium`, use the package name **`osmium`** (PyOsmium) on PyPI.
- On Windows, if wheels are unavailable for your Python version, try Python 3.11/3.12 or install via conda-forge.

- The website loads country names directly from `world-atlas@2/countries-110m.json` (no external TSV needed).


### Cleaning weird suffix artifacts
OSM `name` values sometimes contain disambiguators like parentheses or punctuation. The pipeline strips bracketed parts (e.g. "Foo (Bar)") and trims trailing punctuation so you won’t get suffixes like `-aj)`.
After updating, rerun `01_extract_places.py` and `02_precompute_suffix_tiles.py` to regenerate clean outputs.

## Point-based mini-maps (cities as dots)

The pipeline can export true place locations (quantized lon/lat) into each pattern payload (`points_q`).
If `points_q` is present, the frontend renders **dots at city locations** (with opacity so dense areas get darker).
If not present, it falls back to tile heatmaps.

Configure in `data-pipeline/config/europe.json`:

- `export_points`: `true`
- `points_quant`: e.g. `10000` (stores lon/lat as ints; decode by dividing by this)
- `max_points_per_pattern`: cap with reservoir sampling to keep payloads reasonable

After changing the pipeline, regenerate and copy data:

```bash
cd data-pipeline
python scripts/01_extract_places.py
python scripts/02_precompute_suffix_tiles.py
rm -rf ../web/public/data
cp -R export/web/public/data ../web/public/data
```

## Removing overseas territories (France, Denmark, Netherlands, etc.)

For cleaner scaling on country cards, the frontend removes MultiPolygon parts whose centroids fall outside a Europe bounding box.
This hides overseas territories like French Guiana / Réunion, Greenland, etc.
