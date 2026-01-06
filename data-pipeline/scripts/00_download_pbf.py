import json, os, sys, pathlib, subprocess
from urllib.request import urlretrieve
from tqdm import tqdm

ROOT = pathlib.Path(__file__).resolve().parents[1]
CFG = ROOT / "config" / "europe.json"
RAW = ROOT / "raw"

def main():
    RAW.mkdir(parents=True, exist_ok=True)
    cfg = json.loads(CFG.read_text(encoding="utf-8"))
    countries = cfg["countries"]

    # Geofabrik URLs:
    # Europe: https://download.geofabrik.de/europe/{slug}-latest.osm.pbf
    # Some are nested; adjust slug if needed.
    for c in countries:
        slug = c["geofabrik_slug"]
        url = f"https://download.geofabrik.de/europe/{slug}-latest.osm.pbf"
        out = RAW / f"{slug}-latest.osm.pbf"
        if out.exists():
            print(f"[skip] {out.name}")
            continue
        print(f"[dl] {c['name']} -> {out.name}")
        urlretrieve(url, out)

if __name__ == "__main__":
    main()
