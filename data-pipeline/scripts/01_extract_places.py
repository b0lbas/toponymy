import json, os, pathlib, re, sys
from typing import Dict, Iterable, List, Optional, Tuple
import pandas as pd
from tqdm import tqdm
import osmium
from unidecode import unidecode

ROOT = pathlib.Path(__file__).resolve().parents[1]

def _pick_existing_dir(*candidates: pathlib.Path) -> pathlib.Path:
    for p in candidates:
        if p.exists():
            return p
    return candidates[0]

RAW = _pick_existing_dir(ROOT / "raw", ROOT.parent / "raw")
OUT = _pick_existing_dir(ROOT / "intermediate", ROOT.parent / "intermediate")

ADMIN0_TOPO = _pick_existing_dir(ROOT / "web" / "public" / "geo", ROOT.parent / "web" / "public" / "geo") / "ne_10m_admin0.json"

PLACE_TAGS = set(["city","town","village"])
TOWNSHIP_RE = re.compile(r"\btownship\b", re.IGNORECASE)
CHARTER_RE = re.compile(r"\bcharter\b", re.IGNORECASE)

def clean_place_name(name: str, country_id: str) -> str:
    """Clean place name from special characters and unwanted content"""
    if not name:
        return ""
    
    # For USA, strip noisy words like "township" and "charter"
    if country_id == "840":
        name = TOWNSHIP_RE.sub(" ", name)
        name = CHARTER_RE.sub(" ", name)
    
    # Remove content in parentheses and brackets
    name = re.sub(r"\([^\)]*\)", " ", name)
    name = re.sub(r"\[[^\]]*\]", " ", name)
    name = re.sub(r"\{[^\}]*\}", " ", name)
    
    # Remove quotes
    name = re.sub(r'[""]', " ", name)
    name = re.sub(r'[«»„"❝❞]', " ", name)
    
    # Remove all digits
    name = re.sub(r"\d+", " ", name)
    
    # Normalize quotes and dashes
    name = re.sub(r"[''`´]", "'", name)
    name = re.sub(r"[-–—]+", "-", name)
    
    # Remove all special characters except letters (any unicode), spaces, hyphens, apostrophes
    name = re.sub(r"[^\w\s\-']", " ", name, flags=re.UNICODE)
    
    # Normalize whitespace
    name = re.sub(r"\s+", " ", name).strip()
    
    return name

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
            name = clean_place_name(name, self.country_id)
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


def _decode_topo_arc(
    arcs: List[List[List[int]]],
    arc_index: int,
    scale: Tuple[float, float],
    translate: Tuple[float, float],
    cache: Dict[int, List[Tuple[float, float]]],
) -> List[Tuple[float, float]]:
    reverse = arc_index < 0
    idx = (~arc_index) if reverse else arc_index

    if idx not in cache:
        x = 0
        y = 0
        out: List[Tuple[float, float]] = []
        for i, (dx, dy) in enumerate(arcs[idx]):
            if i == 0:
                x, y = dx, dy
            else:
                x += dx
                y += dy
            lon = x * scale[0] + translate[0]
            lat = y * scale[1] + translate[1]
            out.append((lon, lat))
        cache[idx] = out

    coords = cache[idx]
    return list(reversed(coords)) if reverse else coords


def _stitch_ring(
    arcs: List[List[List[int]]],
    arc_indices: List[int],
    scale: Tuple[float, float],
    translate: Tuple[float, float],
    cache: Dict[int, List[Tuple[float, float]]],
) -> List[Tuple[float, float]]:
    ring: List[Tuple[float, float]] = []
    for a in arc_indices:
        pts = _decode_topo_arc(arcs, a, scale, translate, cache)
        if ring:
            ring.extend(pts[1:])
        else:
            ring.extend(pts)
    return ring


def _point_in_ring(x: float, y: float, ring: List[Tuple[float, float]]) -> bool:
    inside = False
    n = len(ring)
    if n < 3:
        return False
    x1, y1 = ring[0]
    for i in range(1, n + 1):
        x2, y2 = ring[i % n]
        if ((y1 > y) != (y2 > y)):
            xinters = (x2 - x1) * (y - y1) / ((y2 - y1) or 1e-12) + x1
            if x < xinters:
                inside = not inside
        x1, y1 = x2, y2
    return inside


def _point_in_polygon(x: float, y: float, outer: List[Tuple[float, float]], holes: List[List[Tuple[float, float]]]) -> bool:
    if not _point_in_ring(x, y, outer):
        return False
    for h in holes:
        if _point_in_ring(x, y, h):
            return False
    return True


class Admin0Locator:
    def __init__(self, topo_path: pathlib.Path, wanted_iso_n3: Iterable[str]):
        if not topo_path.exists():
            raise FileNotFoundError(f"admin0 topojson not found: {topo_path}")

        topo = json.loads(topo_path.read_text(encoding="utf-8"))
        transform = topo.get("transform") or {}
        scale = tuple(transform.get("scale") or [1.0, 1.0])
        translate = tuple(transform.get("translate") or [0.0, 0.0])
        self.scale = (float(scale[0]), float(scale[1]))
        self.translate = (float(translate[0]), float(translate[1]))
        self.arcs = topo["arcs"]
        self._arc_cache: Dict[int, List[Tuple[float, float]]] = {}

        wanted = {str(x) for x in wanted_iso_n3}

        geoms = topo.get("objects", {}).get("admin0", {}).get("geometries", [])
        self.polys_by_id: Dict[str, List[Tuple[Tuple[float, float, float, float], List[Tuple[float, float]], List[List[Tuple[float, float]]]]]] = {}

        for g in geoms:
            props = g.get("properties") or {}
            iso_n3 = props.get("ISO_N3")
            if not iso_n3:
                continue
            iso_n3 = str(iso_n3)
            if iso_n3 not in wanted:
                continue

            g_arcs = g.get("arcs")
            if not g_arcs:
                continue

            polys: List[Tuple[Tuple[float, float, float, float], List[Tuple[float, float]], List[List[Tuple[float, float]]]]] = []
            if g.get("type") == "Polygon":
                g_arcs = [g_arcs]

            for poly in g_arcs:
                if not poly:
                    continue
                outer = _stitch_ring(self.arcs, poly[0], self.scale, self.translate, self._arc_cache)
                holes = [_stitch_ring(self.arcs, ring, self.scale, self.translate, self._arc_cache) for ring in poly[1:]]
                xs = [p[0] for p in outer]
                ys = [p[1] for p in outer]
                bbox = (min(xs), min(ys), max(xs), max(ys))
                polys.append((bbox, outer, holes))
            self.polys_by_id[iso_n3] = polys

    def locate(self, lon: float, lat: float) -> Optional[str]:
        x = float(lon)
        y = float(lat)
        for cid, polys in self.polys_by_id.items():
            for (minx, miny, maxx, maxy), outer, holes in polys:
                if x < minx or x > maxx or y < miny or y > maxy:
                    continue
                if _point_in_polygon(x, y, outer, holes):
                    return cid
        return None


class SharedPlaceExtractor(osmium.SimpleHandler):
    def __init__(self, locator: Admin0Locator, strip_diacritics: bool = True):
        super().__init__()
        self.locator = locator
        self.strip_diacritics = strip_diacritics
        self.rows_by_country: Dict[str, List[dict]] = {cid: [] for cid in locator.polys_by_id.keys()}
        self.dropped = 0

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
            cid = self.locator.locate(lon, lat)
            if not cid:
                self.dropped += 1
                return
            name = clean_place_name(name, cid)
            if not name:
                return
            self.rows_by_country[cid].append({
                "country_id": cid,
                "name": name,
                "name_norm": normalize_name(name, self.strip_diacritics),
                "place": place,
                "lon": lon,
                "lat": lat,
            })
        except Exception:
            return

def main():
    import argparse
    parser = argparse.ArgumentParser(description="Extract place nodes from PBFs for countries listed in a config")
    parser.add_argument("-c", "--country", help="comma-separated list of country ids or geofabrik slugs to process (e.g. 8 or 250,8)", default=None)
    parser.add_argument("--config", help="path to config json (default: data-pipeline/config/europe.json)", default="config/europe.json")
    parser.add_argument("--force", action="store_true", help="overwrite existing *_places.csv outputs")
    args = parser.parse_args()

    OUT.mkdir(parents=True, exist_ok=True)
    cfg_path = ROOT / args.config
    print(f"[info] Using config: {cfg_path.name}")
    cfg = json.loads(cfg_path.read_text(encoding="utf-8"))

    targets = []
    if args.country:
        targets = [t.strip() for t in args.country.split(",") if t.strip()]
        print(f"[filter] processing only: {targets}")

    countries_by_slug: Dict[str, List[dict]] = {}
    for c in cfg["countries"]:
        countries_by_slug.setdefault(c["geofabrik_slug"], []).append(c)

    for slug, group in countries_by_slug.items():
        full_group = group
        is_shared_slug = len(full_group) > 1

        if targets:
            filtered: List[dict] = []
            for c in full_group:
                cid = str(c.get("id"))
                name = str(c.get("name", "")).lower()
                match = False
                for t in targets:
                    if t == cid or t.lower() == slug.lower() or t.lower() == name:
                        match = True
                        break
                if match:
                    filtered.append(c)
            if not filtered:
                continue
            group = filtered

        pbf = RAW / f"{slug}-latest.osm.pbf"
        if not pbf.exists():
            matches = list(RAW.glob(f"{slug}*.osm.pbf"))
            print(f"[debug] wildcard matches for {slug}: {[m.name for m in matches]}")
            if matches:
                pbf = matches[0]
            else:
                print(f"[missing] {RAW / f'{slug}-latest.osm.pbf'} — run 00_download_pbf.py first")
                continue

        # If multiple countries share the same PBF slug in the config (e.g. gcc-states), we must split
        # by admin0 polygons even when the user filters to only one country via --country.
        if is_shared_slug:
            wanted = [str(c.get("country_id") or c.get("id")) for c in full_group]
            print(f"[shared] {slug}: splitting into {wanted} using {ADMIN0_TOPO}")
            locator = Admin0Locator(ADMIN0_TOPO, wanted)
            h = SharedPlaceExtractor(locator=locator, strip_diacritics=True)
            print(f"[apply] starting apply_file for {pbf.name}")
            h.apply_file(str(pbf), locations=False)
            print(f"[apply] finished apply_file for {pbf.name}; dropped_unassigned={h.dropped}")

            for c in group:
                cid = str(c.get("id"))
                out_csv = OUT / f"{cid}_{slug}_places.csv"
                if out_csv.exists() and not args.force:
                    print(f"[skip] {out_csv.name}")
                    continue
                rows = h.rows_by_country.get(str(c.get("country_id") or cid), [])
                df = pd.DataFrame(rows)
                df.to_csv(out_csv, index=False)
                print(f"[ok] wrote {len(df):,} places -> {out_csv}")
            continue

        c = group[0]
        cid = str(c.get("id"))
        out_csv = OUT / f"{cid}_{slug}_places.csv"
        if out_csv.exists() and not args.force:
            print(f"[skip] {out_csv.name}")
            continue
        print(f"[parse] {c['name']} ({pbf.name})")
        h = PlaceExtractor(country_id=cid, strip_diacritics=True)
        print(f"[apply] starting apply_file for {pbf.name}")
        h.apply_file(str(pbf), locations=False)
        print(f"[apply] finished apply_file for {pbf.name}; collected rows={len(h.rows)}")
        df = pd.DataFrame(h.rows)
        df.to_csv(out_csv, index=False)
        print(f"[ok] wrote {len(df):,} places -> {out_csv}")

if __name__ == "__main__":
    main()
