import json, os, pathlib, re
import pandas as pd
from tqdm import tqdm
import osmium
from unidecode import unidecode

ROOT = pathlib.Path(__file__).resolve().parents[1]
CFG = ROOT / "config" / "asia.json"
RAW = ROOT / "raw"
OUT = ROOT / "intermediate"

PLACE_TAGS = set(["city","town","village","hamlet"])

def normalize_name(name: str, strip_diacritics: bool = True) -> str:
    s = name.strip().lower()

    s = re.sub(r"\([^\)]*\)", " ", s)
    s = re.sub(r"\[[^\]]*\]", " ", s)

    s = re.sub(r"[’'`´]", "'", s)
    s = re.sub(r"[-–—]+", "-", s)
    s = re.sub(r"\s+", " ", s)

    if strip_diacritics:
        s = unidecode(s)

    s = re.sub(r"[^0-9a-z\-\'\s]+", " ", s)
    s = re.sub(r"\s+", " ", s).strip()
    return s

class PlaceExtractor(osmium.SimpleHandler):
    def __init__(self, country_id: str, strip_diacritics: bool = True):
        super().__init__()
        self.country_id = country_id
        self.strip_diacritics = strip_diacritics
        self.rows = []

    def node(self, n):
        try:
            place = n.tags.get("place")
            if place not in PLACE_TAGS:
                return
            name = n.tags.get("name")
            if not name:
                return
            lon = n.location.lon
            lat = n.location.lat
            self.rows.append({
                "country_id": self.country_id,
                "name": name,
                "name_norm": normalize_name(name, self.strip_diacritics),
                "place": place,
                "lon": lon,
                "lat": lat
            })
        except Exception:
            return

def main():
    import argparse
    parser = argparse.ArgumentParser(description="Extract place nodes from PBFs for countries listed in a config")
    parser.add_argument("-c", "--country", help="comma-separated list of country ids or geofabrik slugs to process (e.g. 8 or 250,8)", default=None)
    parser.add_argument("--config", help="path to config json (default: data-pipeline/config/europe.json)", default=None)
    args = parser.parse_args()

    OUT.mkdir(parents=True, exist_ok=True)
    cfg_path = pathlib.Path(args.config) if args.config else CFG
    cfg = json.loads(cfg_path.read_text(encoding="utf-8"))

    targets = []
    if args.country:
        targets = [t.strip() for t in args.country.split(",") if t.strip()]
        print(f"[filter] processing only: {targets}")

    for c in cfg["countries"]:
        slug = c["geofabrik_slug"]

        if targets:
            match = False
            for t in targets:
                if t == str(c.get("id")) or t.lower() == slug.lower() or t.lower() == c.get("name","").lower():
                    match = True
                    break
            if not match:
                print(f"[skip] {c['name']} ({c['id']})")
                continue

        # accept files like "{slug}-latest.osm.pbf" or "{slug}-*.osm.pbf"
        pbf = RAW / f"{slug}-latest.osm.pbf"
        if not pbf.exists():
            # try wildcard match
            matches = list(RAW.glob(f"{slug}*.osm.pbf"))
            print(f"[debug] wildcard matches for {slug}: {[m.name for m in matches]}")
            if matches:
                pbf = matches[0]
            else:
                print(f"[missing] {RAW / f'{slug}-latest.osm.pbf'} — run 00_download_pbf.py first")
                continue
        out_csv = OUT / f"{c['id']}_{slug}_places.csv"
        if out_csv.exists():
            print(f"[skip] {out_csv.name}")
            continue
        print(f"[parse] {c['name']} ({pbf.name})")
        h = PlaceExtractor(country_id=str(c["id"]), strip_diacritics=True)
        print(f"[apply] starting apply_file for {pbf.name}")
        h.apply_file(str(pbf), locations=True)
        print(f"[apply] finished apply_file for {pbf.name}; collected rows={len(h.rows)}")
        df = pd.DataFrame(h.rows)
        df.to_csv(out_csv, index=False)
        print(f"[ok] wrote {len(df):,} places -> {out_csv}")

if __name__ == "__main__":
    main()
