import json, os, sys, pathlib, subprocess
from urllib.request import urlretrieve
from tqdm import tqdm

ROOT = pathlib.Path(__file__).resolve().parents[1]
CFG = ROOT / "config" / "europe.json"
RAW = ROOT / "raw"

def main():
    import argparse
    parser = argparse.ArgumentParser(description="Download Geofabrik PBFs for countries in a config")
    parser.add_argument("--config", help="path to config json (default: data-pipeline/config/europe.json)", default=None)
    parser.add_argument("--region", help="geofabrik region (e.g., europe, asia)", default="europe")
    args = parser.parse_args()

    RAW.mkdir(parents=True, exist_ok=True)
    cfg_path = pathlib.Path(args.config) if args.config else CFG
    cfg = json.loads(cfg_path.read_text(encoding="utf-8"))
    countries = cfg["countries"]
    region = args.region

    # Geofabrik URLs:
    # e.g. Europe: https://download.geofabrik.de/europe/{slug}-latest.osm.pbf
    for c in countries:
        slug = c["geofabrik_slug"]
        url = f"https://download.geofabrik.de/{region}/{slug}-latest.osm.pbf"
        out = RAW / f"{slug}-latest.osm.pbf"
        if out.exists():
            print(f"[skip] {out.name}")
            continue
        print(f"[dl] {c['name']} -> {out.name}")
        urlretrieve(url, out)

if __name__ == "__main__":
    main()
