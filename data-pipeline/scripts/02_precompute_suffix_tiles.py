import json, math, pathlib, re, gzip, random, sys
from collections import Counter, defaultdict
import pandas as pd
from tqdm import tqdm
import orjson

ROOT = pathlib.Path(__file__).resolve().parents[1]  # data-pipeline when run from correct folder
CFG_NAME = sys.argv[1] if len(sys.argv) > 1 else "europe.json"
CFG = ROOT / "config" / CFG_NAME
INP = ROOT / "intermediate"
OUT = ROOT / "export"

print(f"[info] Using config: {CFG.name}")

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
    t = re.sub(r"\([^\)]*\)", " ", t)
    t = re.sub(r"\[[^\]]*\]", " ", t)
    t = t.strip()
    t = re.sub(r"^[^0-9a-z]+", "", t)
    t = re.sub(r"[^0-9a-z]+$", "", t)
    return t


def tail_token(name_norm: str) -> str:
    """Take last token for multiword/hyphen names to avoid suffixes containing spaces."""
    s = (name_norm or "").strip()
    if not s:
        return s
    s = re.sub(r"\([^)]+\)", " ", s)
    s = re.sub(r"\[[^]]+\]", " ", s)
    parts = [p for p in _SPLIT_TAIL_RE.split(s) if p]
    return sanitize_token(parts[-1] if parts else s)

def head_token(name_norm: str) -> str:
    """Take first token for multiword/hyphen names to avoid prefixes containing spaces."""
    s = (name_norm or "").strip()
    if not s:
        return s
    s = re.sub(r"\([^)]+\)", " ", s)
    s = re.sub(r"\[[^]]+\]", " ", s)
    parts = [p for p in _SPLIT_TAIL_RE.split(s) if p]
    return sanitize_token(parts[0] if parts else s)

def suffixes(s: str, min_len: int, max_len: int):
    s = (s or "").strip()
    L = len(s)
    for k in range(min_len, min(max_len, L) + 1):
        yield "-" + s[-k:]

def prefixes(s: str, min_len: int, max_len: int):
    s = (s or "").strip()
    L = len(s)
    for k in range(min_len, min(max_len, L) + 1):
        yield s[:k]

# Blacklist: non-city suffixes (geographic features, infrastructure, etc.)
SUFFIX_BLACKLIST = {
    'road', 'mountain', 'creek', 'island', 'islands', 'lake', 'river',
    'colony', 'falls', 'beach', 'bay', 'harbour', 'harbor', 'inlet',
    'point', 'ridge', 'valley', 'brook', 'stream', 'fork', 'forks',
    'hill', 'hills', 'park', 'ranch', 'station', 'junction', 'crossing',
    'portage', 'narrows', 'pond', 'cove', 'corner', 'corners', 'landing',
    'settlement', 'reserve', 'rapids', 'bridge', 'branch'
}

def is_valid_city_suffix(pattern: str) -> bool:
    """Filter out patterns that are clearly non-city geographic features."""
    pat = pattern.lower().lstrip('-')
    return not any(bad in pat for bad in SUFFIX_BLACKLIST)

def main():
    import argparse

    parser = argparse.ArgumentParser(description="Precompute suffix tiles (optionally filter by country id or slug)")
    parser.add_argument("-c", "--country", help="comma-separated list of country ids or geofabrik slugs to process (e.g. 8 or 250,8)", default=None)
    parser.add_argument("--config", help="path to config json to use (default: data-pipeline/config/europe.json)", default=None)
    parser.add_argument("--mode", choices=["suffix", "prefix"], default=None, help="pattern mode to compute (default: prefix)")
    args = parser.parse_args()

    cfg_path = pathlib.Path(args.config) if args.config else CFG
    cfg = json.loads(cfg_path.read_text(encoding="utf-8"))

    targets = []
    if args.country:
        targets = [t.strip() for t in args.country.split(",") if t.strip()]
        print(f"[filter] processing only: {targets}")

    OUT.mkdir(parents=True, exist_ok=True)

    z = int(cfg.get("zoom", 7))
    min_len = int(cfg.get("suffix_min_len", 2))
    max_len = int(cfg.get("suffix_max_len", 8))
    min_places = int(cfg.get("min_places_for_candidate", 50))
    top_export = int(cfg.get("top_patterns_to_export", 16))
    selection_mode = str(cfg.get("selection_mode", "score")).lower()
    analyze_tail_only = bool(cfg.get("analyze_tail_token_only", True))
    export_points = bool(cfg.get("export_points", True))
    points_scale = int(cfg.get("points_quant", 10000))
    max_points = int(cfg.get("max_points_per_pattern", 50000))

    # --- MODE SWITCH: 'suffix' or 'prefix' ---
    mode = (args.mode or str(cfg.get("mode", cfg.get("default_mode", "prefix")))).lower()
    if mode not in {"suffix", "prefix"}:
        print(f"[warn] Unknown mode={mode!r}; falling back to 'prefix'")
        mode = "prefix"
    print(f"[info] Mode: {mode}")

    for c in cfg["countries"]:
        cid = str(c["id"])
        slug = c["geofabrik_slug"]

        if targets:
            match = False
            for t in targets:
                if t == cid or t.lower() == slug.lower() or t.lower() == c["name"].lower():
                    match = True
                    break
            if not match:
                print(f"[skip] {c['name']} ({cid})")
                continue

        csv = INP / f"{cid}_{slug}_places.csv"
        if not csv.exists():
            print(f"[missing] {csv} — run 01_extract_places.py")
            continue

        print(f"\n[country] {c['name']} ({cid})")
        df = pd.read_csv(csv)
        total_places = int(len(df))

        # For very small countries, a fixed min_places threshold can result in zero candidates.
        # Adapt it downward so we still export some patterns.
        eff_min_places = int(min_places)
        if total_places > 0:
            adaptive = max(3, total_places // 10)
            if adaptive < eff_min_places:
                eff_min_places = adaptive
                print(f"[min_places] adjusted {min_places} -> {eff_min_places} (total_places={total_places})")

        freq = Counter()
        tile_counts = defaultdict(lambda: defaultdict(int))

        lons = df["lon"].astype(float).tolist()
        lats = df["lat"].astype(float).tolist()
        names = df["name_norm"].astype(str).tolist()

        for lon, lat, nm in tqdm(list(zip(lons, lats, names)), desc=f"aggregate {mode} tiles"):
            if mode == 'suffix':
                nm2 = tail_token(nm) if analyze_tail_only else (nm or "").strip()
                patterns_gen = suffixes(nm2, min_len, max_len)
            else:
                nm2 = head_token(nm) if analyze_tail_only else (nm or "").strip()
                patterns_gen = prefixes(nm2, min_len, max_len)
            if not nm2:
                continue
            x, y = lonlat_to_tile(lon, lat, z)
            for pat in patterns_gen:
                freq[pat] += 1
                tile_counts[pat][(x, y)] += 1

        candidates = [s for s, f in freq.items() if f >= eff_min_places]
        print(f"[candidates] {len(candidates):,} (min_places={eff_min_places})")

        if mode == "suffix":
            # Filter out non-city suffixes (roads, mountains, etc.)
            candidates = [s for s in candidates if is_valid_city_suffix(s)]
            print(f"[filtered] {len(candidates):,} after removing non-city patterns")

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

        points_q = {pat: [] for pat in chosen_patterns}
        points_seen = {pat: 0 for pat in chosen_patterns}

        def _reservoir_add(pat, lon_q, lat_q, name):
            points_seen[pat] += 1
            arr = points_q[pat]
            if len(arr) < max_points:
                arr.append([lon_q, lat_q, name])
            else:
                j = random.randint(0, points_seen[pat] - 1)
                if j < max_points:
                    arr[j] = [lon_q, lat_q, name]

        if export_points and chosen_patterns:
            names_norm = df["name_norm"].astype(str).tolist()
            names_raw = df["name"].astype(str).tolist() if "name" in df.columns else names_norm
            for lon, lat, nm_raw, nm_norm in tqdm(list(zip(lons, lats, names_raw, names_norm)), desc="collect points (selected patterns)"):
                if mode == "suffix":
                    nm2 = tail_token(nm_norm) if analyze_tail_only else (nm_norm or "").strip()
                else:
                    nm2 = head_token(nm_norm) if analyze_tail_only else (nm_norm or "").strip()
                if not nm2:
                    continue

                lon_q = int(round(float(lon) * points_scale))
                lat_q = int(round(float(lat) * points_scale))

                if mode == "suffix":
                    for pat in suffixes(nm2, min_len, max_len):
                        if pat in chosen_set:
                            _reservoir_add(pat, lon_q, lat_q, nm_raw)
                else:
                    for pat in prefixes(nm2, min_len, max_len):
                        if pat in chosen_set:
                            _reservoir_add(pat, lon_q, lat_q, nm_raw)

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
                "mode": mode,
                "zoom": z,
                "cells": cells,
                "total_places": int(sum(c for _,_,c in cells)),
            }
            if export_points:
                pts = points_q.get(pat, [])
                payload["points_q"] = [[lon_q, lat_q] for lon_q, lat_q, *_ in pts]
                payload["points_named"] = pts
                payload["points_scale"] = points_scale
                payload["points_sampled"] = bool(points_seen.get(pat, 0) > len(pts))
                payload["points_named_sampled"] = payload["points_sampled"]
            fname = f"{slugify(pat)}_z{z}.json.gz"
            with gzip.open(c_out / fname, "wb") as fz:
                fz.write(orjson.dumps(payload))
            patterns_index.append({
                "pattern": pat,
                "title": pat,
                "mode": mode,
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
        # --- Экспорт индекса после цикла ---
        idx_payload = {
            "country_id": cid,
            "country_name": c["name"],
            "modes": [mode],
            "default_mode": mode,
            "default_zoom": z,
            "patterns": patterns_index,
            "selection_mode": selection_mode,
            "min_places_for_candidate": eff_min_places,
            "analyze_tail_token_only": analyze_tail_only,
            "pattern_len": [min_len, max_len],
        }
        fname = "patterns.json" if mode == "suffix" else "patterns_prefix.json"
        (c_out / fname).write_bytes(orjson.dumps(idx_payload, option=orjson.OPT_INDENT_2))
        print(f"[export] {c_out}  {fname} patterns={len(patterns_index)}")

    print("\nDone. Copy export/web/public/data into web/public/data before building the frontend.")

if __name__ == "__main__":
    main()
