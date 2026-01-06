import json, os, pathlib, re
import pandas as pd
from tqdm import tqdm
import osmium
from unidecode import unidecode

ROOT = pathlib.Path(__file__).resolve().parents[1]
CFG = ROOT / "config" / "europe.json"
RAW = ROOT / "raw"
OUT = ROOT / "intermediate"

PLACE_TAGS = set(["city","town","village","hamlet","isolated_dwelling","suburb","neighbourhood","locality"])

def normalize_name(name: str, strip_diacritics: bool = True) -> str:
    s = name.strip().lower()

    # Remove parenthetical / bracketed disambiguators: "Foo (Bar)" -> "Foo"
    s = re.sub(r"\([^\)]*\)", " ", s)
    s = re.sub(r"\[[^\]]*\]", " ", s)

    # Common punctuation normalization
    s = re.sub(r"[’'`´]", "'", s)
    s = re.sub(r"[-–—]+", "-", s)
    s = re.sub(r"\s+", " ", s)

    if strip_diacritics:
        s = unidecode(s)

    # Replace any remaining weird chars with spaces; keep letters/digits/hyphen/apostrophe
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
    OUT.mkdir(parents=True, exist_ok=True)
    cfg = json.loads(CFG.read_text(encoding="utf-8"))
    for c in cfg["countries"]:
        slug = c["geofabrik_slug"]
        pbf = RAW / f"{slug}-latest.osm.pbf"
        if not pbf.exists():
            print(f"[missing] {pbf} — run 00_download_pbf.py first")
            continue
        out_csv = OUT / f"{c['id']}_{slug}_places.csv"
        if out_csv.exists():
            print(f"[skip] {out_csv.name}")
            continue
        print(f"[parse] {c['name']} ({pbf.name})")
        h = PlaceExtractor(country_id=str(c["id"]), strip_diacritics=True)
        h.apply_file(str(pbf), locations=True)
        df = pd.DataFrame(h.rows)
        df.to_csv(out_csv, index=False)
        print(f"[ok] wrote {len(df):,} places -> {out_csv}")

if __name__ == "__main__":
    main()
