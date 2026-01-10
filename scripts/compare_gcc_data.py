from __future__ import annotations

import gzip
import hashlib
import json
import csv
from pathlib import Path
from typing import Any, Iterable

ROOT = Path(r"c:\Users\bolba\OneDrive\Desktop\toponymyv2\toponymy")
WEB_DATA = ROOT / "web" / "public" / "data"
EXPORT_DATA = ROOT / "data-pipeline" / "export" / "web" / "public" / "data"

COUNTRIES = ["512", "634", "682"]  # Oman, Qatar, Saudi Arabia


def sha256_bytes(b: bytes) -> str:
    return hashlib.sha256(b).hexdigest()


def load_json(path: Path) -> Any:
    return json.loads(path.read_text("utf-8"))


def list_common_payload_names(folders: Iterable[Path]) -> list[str]:
    common: set[str] | None = None
    for folder in folders:
        names = {p.name for p in folder.iterdir() if p.is_file() and p.name.endswith(".json.gz")}
        common = names if common is None else (common & names)
    return sorted(common or [])


def patterns_set(doc: Any) -> set[tuple[str, str]]:
    if not isinstance(doc, dict):
        return set()
    pats = doc.get("patterns")
    if not isinstance(pats, list):
        return set()
    out: set[tuple[str, str]] = set()
    for row in pats:
        if isinstance(row, dict):
            pat = str(row.get("pattern"))
            file = str(row.get("file"))
            out.add((pat, file))
    return out


def summarize_index(index_path: Path) -> dict[str, Any]:
    b = index_path.read_bytes()
    doc = json.loads(b.decode("utf-8"))
    pats = doc.get("patterns") if isinstance(doc, dict) else None
    return {
        "exists": index_path.exists(),
        "bytes": len(b),
        "sha256": sha256_bytes(b),
        "patterns": len(pats) if isinstance(pats, list) else None,
        "first": (pats[0].get("pattern") if isinstance(pats, list) and pats and isinstance(pats[0], dict) else None),
    }


def read_payload_gz(path: Path) -> Any:
    with gzip.open(path, "rb") as f:
        raw = f.read()
    return json.loads(raw.decode("utf-8"))


def normalize_payload(payload: Any) -> Any:
    """Remove fields expected to differ per-country so we can detect accidental duplication."""
    if not isinstance(payload, dict):
        return payload
    p = dict(payload)
    p.pop("country_id", None)
    return p


def main() -> None:
    print("=== patterns.json (web/public/data) ===")
    web_docs: dict[str, Any] = {}
    for cid in COUNTRIES:
        p = WEB_DATA / cid / "patterns.json"
        s = summarize_index(p)
        print(cid, s)
        web_docs[cid] = load_json(p)

    print("\n=== patterns.json (data-pipeline/export) ===")
    export_docs: dict[str, Any] = {}
    for cid in COUNTRIES:
        p = EXPORT_DATA / cid / "patterns.json"
        s = summarize_index(p)
        print(cid, s)
        export_docs[cid] = load_json(p)

    print("\n=== Pairwise overlap (pattern,file) ===")
    for a in COUNTRIES:
        for b in COUNTRIES:
            if a >= b:
                continue
            wa = patterns_set(web_docs[a])
            wb = patterns_set(web_docs[b])
            ea = patterns_set(export_docs[a])
            eb = patterns_set(export_docs[b])
            print(f"web {a} vs {b}: inter={len(wa & wb)}  a={len(wa)} b={len(wb)}")
            print(f"exp {a} vs {b}: inter={len(ea & eb)}  a={len(ea)} b={len(eb)}")

    print("\n=== Intermediate CSV core-data hashes (lon,lat,name_norm) ===")
    for cid in COUNTRIES:
        csv_path = ROOT / "data-pipeline" / "intermediate" / f"{cid}_gcc-states_places.csv"
        if not csv_path.exists():
            print(cid, "missing", csv_path)
            continue
        h = hashlib.sha256()
        rows = 0
        with csv_path.open("r", encoding="utf-8", newline="") as f:
            reader = csv.DictReader(f)
            for row in reader:
                # hash only the fields used downstream
                h.update((row.get("lon", "") + "," + row.get("lat", "") + "," + row.get("name_norm", "") + "\n").encode("utf-8"))
                rows += 1
        print(cid, "rows", rows, "sha256(core)", h.hexdigest())

    print("\n=== Common payload filenames (web/public/data) ===")
    common = list_common_payload_names([WEB_DATA / cid for cid in COUNTRIES])
    print("common count:", len(common))
    for nm in common[:5]:
        hashes = []
        sizes = []
        for cid in COUNTRIES:
            b = (WEB_DATA / cid / nm).read_bytes()
            hashes.append(sha256_bytes(b))
            sizes.append(len(b))
        print(nm)
        print("  sizes ", sizes)
        print("  sha256 ", hashes)

    # Inspect a payload structure for each country for a shared filename (if any)
    if common:
        nm = common[0]
        print(f"\n=== Payload structure sample for {nm} ===")
        for cid in COUNTRIES:
            payload = read_payload_gz(WEB_DATA / cid / nm)
            keys = sorted(payload.keys()) if isinstance(payload, dict) else []
            print(cid, "keys", keys[:20])
            if isinstance(payload, dict) and "points_named" in payload:
                pn = payload.get("points_named")
                if isinstance(pn, list) and pn:
                    print(cid, "points_named[0]", pn[0])

    print("\n=== Export payload duplication check (normalized JSON) ===")
    # Use a pattern file we know exists from export indexes.
    export_nm = "-yl_z7.json.gz"
    export_payloads: dict[str, Any] = {}
    for cid in COUNTRIES:
        p = EXPORT_DATA / cid / export_nm
        if not p.exists():
            print(cid, f"missing {export_nm} in export")
            continue
        export_payloads[cid] = normalize_payload(read_payload_gz(p))

    if len(export_payloads) == len(COUNTRIES):
        a, b, c = COUNTRIES
        eq_ab = export_payloads[a] == export_payloads[b]
        eq_ac = export_payloads[a] == export_payloads[c]
        eq_bc = export_payloads[b] == export_payloads[c]
        print(f"normalized equality for {export_nm}: {a}=={b}? {eq_ab}  {a}=={c}? {eq_ac}  {b}=={c}? {eq_bc}")
        # If they are still equal, we have true duplication; if not, patterns match but spatial distributions differ.


if __name__ == "__main__":
    main()
