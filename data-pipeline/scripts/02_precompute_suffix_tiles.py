import json, math, pathlib, re, gzip, random
from collections import Counter, defaultdict
import pandas as pd
from tqdm import tqdm
import orjson

"""
Fast precompute for suffix maps (square slippy-tile grid).

Key change vs the earlier naive version:
- We compute suffix frequencies AND tile distributions in ONE PASS over places:
    for each place: generate suffixes (len range) and increment tile counters for each suffix.
This makes exporting hundreds/thousands of suffix patterns practical.

Config: data-pipeline/config/europe.json
"""

ROOT = pathlib.Path(__file__).resolve().parents[1]
CFG = ROOT / "config" / "europe.json"
INP = ROOT / "intermediate"
OUT = ROOT / "export"

def lonlat_to_tile(lon, lat, z):
    lat = max(min(lat, 85.05112878), -85.05112878)
    n = 2 ** z
    xtile = int((lon + 180.0) / 360.0 * n)
    lat_rad = math.radians(lat)
    ytile = int((1.0 - math.log(math.tan(lat_rad) + 1.0 / math.cos(lat_rad)) / math.pi) / 2.0 * n)
    return xtile, ytile

def slugify(s: str) -> str:
    s = s.lower()
    out = []
    for ch in s:
        if ch.isalnum():
            out.append(ch)
        elif ch in ['-','_']:
            out.append(ch)
        else:
            out.append('_')
    s2 = ''.join(out).strip('_')
    while '__' in s2:
        s2 = s2.replace('__','_')
    return s2

def norm_entropy(counts):
    total = sum(counts)
    if total <= 0 or len(counts) <= 1:
        return 0.0
    ps = [c / total for c in counts if c > 0]
    H = -sum(p * math.log(p) for p in ps)
    Hmax = math.log(len(counts))
    return H / Hmax if Hmax > 0 else 0.0

_SPLIT_TAIL_RE = re.compile(r"[\s\-]+")

def sanitize_token(token: str) -> str:
    """Strip weird leading/trailing punctuation from the final token (e.g. 'aj)' -> 'aj')."""
    t = (token or "").strip().lower()
    # remove bracketed junk that could become the tail token
    t = re.sub(r"\([^\)]*\)", " ", t)
    t = re.sub(r"\[[^\]]*\]", " ", t)
    t = t.strip()
    # strip non-alnum at both edges
    t = re.sub(r"^[^0-9a-z]+", "", t)
    t = re.sub(r"[^0-9a-z]+$", "", t)
    return t


def tail_token(name_norm: str) -> str:
    """Take last token for multiword/hyphen names to avoid suffixes containing spaces."""
    s = (name_norm or "").strip()
    if not s:
        return s
    # remove parenthetical / bracketed parts before tokenizing so "Foo (Bar)" ends as "foo" not "bar)"
    s = re.sub(r"\([^\)]*\)", " ", s)
    s = re.sub(r"\[[^\]]*\]", " ", s)
    parts = [p for p in _SPLIT_TAIL_RE.split(s) if p]
    return sanitize_token(parts[-1] if parts else s)

def suffixes(s: str, min_len: int, max_len: int):
    s = (s or "").strip()
    L = len(s)
    for k in range(min_len, min(max_len, L) + 1):
        yield "-" + s[-k:]

def main():
    cfg = json.loads(CFG.read_text(encoding="utf-8"))
    OUT.mkdir(parents=True, exist_ok=True)

    z = int(cfg.get("zoom", 7))
    min_len = int(cfg.get("suffix_min_len", 2))
    max_len = int(cfg.get("suffix_max_len", 8))
    min_places = int(cfg.get("min_places_for_candidate", 50))
    top_export = int(cfg.get("top_patterns_to_export", 16))
    selection_mode = str(cfg.get("selection_mode", "score")).lower()  # freq | score | hybrid
    analyze_tail_only = bool(cfg.get("analyze_tail_token_only", True))
    export_points = bool(cfg.get("export_points", True))
    points_scale = int(cfg.get("points_quant", 10000))
    max_points = int(cfg.get("max_points_per_pattern", 50000))

    for c in cfg["countries"]:
        cid = str(c["id"])
        slug = c["geofabrik_slug"]
        csv = INP / f"{cid}_{slug}_places.csv"
        if not csv.exists():
            print(f"[missing] {csv} — run 01_extract_places.py")
            continue

        print(f"\n[country] {c['name']} ({cid})")
        df = pd.read_csv(csv)

        freq = Counter()
        tile_counts = defaultdict(lambda: defaultdict(int))

        lons = df["lon"].astype(float).tolist()
        lats = df["lat"].astype(float).tolist()
        names = df["name_norm"].astype(str).tolist()

        for lon, lat, nm in tqdm(list(zip(lons, lats, names)), desc="aggregate suffix tiles"):
            nm2 = tail_token(nm) if analyze_tail_only else (nm or "").strip()
            if not nm2:
                continue
            x, y = lonlat_to_tile(lon, lat, z)
            for suf in suffixes(nm2, min_len, max_len):
                freq[suf] += 1
                tile_counts[suf][(x, y)] += 1

        candidates = [s for s, f in freq.items() if f >= min_places]
        print(f"[candidates] {len(candidates):,} (min_places={min_places})")

        scored = []
        for pat in candidates:
            tc = tile_counts.get(pat, {})
            counts = list(tc.values())
            Hn = norm_entropy(counts)
            score = math.log(1 + freq[pat]) * (1.0 - Hn)
            scored.append({
                "pattern": pat,
                "places": int(freq[pat]),
                "tiles": int(len(tc)),
                "entropy": float(Hn),
                "score": float(score),
            })

        if selection_mode == "freq":
            scored.sort(key=lambda d: (-d["places"], d["pattern"]))
        elif selection_mode == "hybrid":
            scored.sort(key=lambda d: (-d["places"], -d["score"], d["pattern"]))
        else:
            scored.sort(key=lambda d: (-d["score"], -d["places"], d["pattern"]))

        chosen = scored[:top_export]
        chosen_patterns = [d["pattern"] for d in chosen]
        chosen_set = set(chosen_patterns)

        # Optional: collect per-pattern point samples (lon/lat) so the UI can render true place locations.
        # We do this in a second pass, but only for the selected patterns (chosen_set) to keep it fast.
        points_q = {pat: [] for pat in chosen_patterns}
        points_seen = {pat: 0 for pat in chosen_patterns}

        def _reservoir_add(pat, lon_q, lat_q):
            # Reservoir sampling (uniform), capped by max_points
            points_seen[pat] += 1
            arr = points_q[pat]
            if len(arr) < max_points:
                arr.append([lon_q, lat_q])
            else:
                j = random.randint(0, points_seen[pat] - 1)
                if j < max_points:
                    arr[j] = [lon_q, lat_q]

        if export_points and chosen_patterns:
            for lon, lat, nm in tqdm(list(zip(lons, lats, names)), desc="collect points (selected patterns)"):
                nm2 = tail_token(nm) if analyze_tail_only else (nm or "").strip()
                if not nm2:
                    continue

                # quantize for smaller payloads
                lon_q = int(round(float(lon) * points_scale))
                lat_q = int(round(float(lat) * points_scale))

                for suf in suffixes(nm2, min_len, max_len):
                    if suf in chosen_set:
                        _reservoir_add(suf, lon_q, lat_q)

        print("[top]")
        for d in chosen[:10]:
            print(f"  {d['pattern']}  places={d['places']:,}  score={d['score']:.3f}  tiles={d['tiles']:,}  H={d['entropy']:.3f}")

        c_out = OUT / "web" / "public" / "data" / str(cid)
        c_out.mkdir(parents=True, exist_ok=True)

        patterns_index = []
        for d in tqdm(chosen, desc="export patterns"):
            pat = d["pattern"]
            tc = tile_counts.get(pat, {})
            cells = [[x, y, int(c)] for (x, y), c in sorted(tc.items(), key=lambda kv: (-kv[1], kv[0][0], kv[0][1]))]
            payload = {
                "country_id": cid,
                "pattern": pat,
                "mode": "suffix",
                "zoom": z,
                "cells": cells,
                "total_places": int(sum(c for _,_,c in cells)),
            }

            if export_points:
                pts = points_q.get(pat, [])
                payload["points_q"] = pts
                payload["points_scale"] = points_scale
                payload["points_sampled"] = bool(points_seen.get(pat, 0) > len(pts))

            fname = f"{slugify(pat)}_z{z}.json.gz"
            with gzip.open(c_out / fname, "wb") as fz:
                fz.write(orjson.dumps(payload))

            patterns_index.append({
                "pattern": pat,
                "title": pat,
                "mode": "suffix",
                "zoom": z,
                "places": d["places"],
                "file": fname,
                "tiles": d["tiles"],
                "score": d["score"],
                "entropy": d["entropy"],
                "hotspots": cells[:5],
                "points": (len(points_q.get(pat, [])) if export_points else None),
                "points_sampled": (bool(points_seen.get(pat, 0) > len(points_q.get(pat, []))) if export_points else None),
            })

        idx_payload = {
            "country_id": cid,
            "country_name": c["name"],
            "modes": ["suffix"],
            "default_mode": "suffix",
            "default_zoom": z,
            "patterns": patterns_index,
            "selection_mode": selection_mode,
            "min_places_for_candidate": min_places,
            "analyze_tail_token_only": analyze_tail_only,
            "suffix_len": [min_len, max_len],
        }
        (c_out / "patterns.json").write_bytes(orjson.dumps(idx_payload, option=orjson.OPT_INDENT_2))
        print(f"[export] {c_out}  patterns={len(patterns_index)}")

    print("\nDone. Copy export/web/public/data into web/public/data before building the frontend.")

if __name__ == "__main__":
    main()
